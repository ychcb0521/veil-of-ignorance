import { createUsdtPositionReader } from './usdt-position-reader.ts';
import { loadUsdtCredentials, readUsdtConfig, usdtRuntime, lockUsdtDirectory } from './usdt-executor-context.ts';
import { createUsdtHandoffService } from './usdt-handoff-service.ts';
import { createUsdtCampaignReader } from './usdt-campaign-reader.ts';
import { findUsdtCampaignFollow, usdtLiveCampaignId } from '../src/lib/fish/usdtLiveCampaign.ts';
import { USDT_FOLLOW_MONITOR_BASIS } from '../src/lib/fish/usdtFollowMonitorBasis.ts';
import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { join } from 'node:path';
import { mkdirSync, openSync, closeSync, unlinkSync, writeFileSync, readFileSync } from 'node:fs';
import { createUsdtExchange, createUsdtRequest } from './usdt-exchange.ts';
import { openUsdtFollowStore } from './usdt-follow-store.ts';
import { createUsdtFollower } from './usdt-follow-engine.ts';
import type { UsdtFollowCampaign } from '../src/lib/fish/usdtFollow.ts';
import type { BinanceManualAnchor, BinanceManualDecision } from '../src/lib/fish/binanceManualMonitor.ts';
import type { InstantMonitorSettings } from '../src/lib/fish/instantMonitorSettings.ts';
import type { QualityResult } from '../src/lib/fish/quality.ts';
import { matchesManualAnchor } from './usdt-managed-execution.ts';
import { createUsdtPositionControls } from './usdt-position-controls.ts';
import { createUsdtOrderDesk } from './usdt-order-desk.ts';
import type { UsdtRequest } from './usdt-exchange.ts';
import { USDT_EXECUTION_PATH, USDT_EXECUTION_SAFETY, validUsdtLiveEntry } from '../src/lib/fish/usdtLiveEntry.ts';

const origin = 'https://veil-of-ignorance-ten.vercel.app';
const dashPort = 47321;
const bodyLimit = 8_000_000;

function parseCampaigns(value: unknown, now: number): UsdtFollowCampaign[] {
  if (!Array.isArray(value) || value.length > 250) throw Error('即时交易请求格式无效');
  const campaigns = new Set<string>();
  const safeTime = (at: number) => Number.isSafeInteger(at) && at > 0 && at <= now + 10_000;
  const validPositive = (n: number) => Number.isFinite(n) && n > 0;
  for (const row of value) {
    if (!row || !/^fish-instant-[\w-]{3,80}$/.test(row.id ?? '') || campaigns.has(row.id)
      || typeof row.source?.symbol !== 'string' || !/^[A-Za-z0-9_/.:-]{1,35}$/.test(row.source.symbol)
      || (row.source.exchange != null && typeof row.source.exchange !== 'string')
      || (row.source.market != null && typeof row.source.market !== 'string')
      || !safeTime(row.admittedAt) || !validPositive(row.notional) || !Number.isInteger(row.leverage) || row.leverage < 1 || row.leverage > 125
      || row.liveEntry !== undefined && !validUsdtLiveEntry(row)
      || !Array.isArray(row.actions) || row.actions.length < 1 || row.actions.length > 250
      || row.actions[0]?.id !== 'open' || row.actions[0].action !== 'open') throw Error('即时交易战役格式无效');
    if (row.liveEntry?.confirmedAt !== undefined && row.actions[0].at !== row.liveEntry.confirmedAt)
      throw Error('实盘首仓动作与首次入选确认时间不一致');
    const ids = new Set<string>();
    for (const [index, action] of row.actions.entries()) {
      if (!action || ids.has(action.id) || !safeTime(action.at) || (index > 0 && row.actions[index - 1].at > action.at)) throw Error('即时交易动作顺序无效');
      const actionValid = action.action === 'open' ? index === 0 && action.id === 'open'
        : action.action === 'close' ? /^(close|mirror|manual-[1-9]\d*)$/.test(action.id)
        : action.action === 'add' ? validPositive(action.notional) && (action.impulseFreshUntil===undefined
          ? /^add-[1-9]\d*$/.test(action.id)
          : row.requiresGuardPlus===true && /^add-impulse-[a-f0-9]{32}$/.test(action.id) &&
            action.at%300_000===0 && action.impulseFreshUntil===action.at+300_000)
        : action.action === 'mirror' ? action.id === 'mirror' && validPositive(action.fraction) && action.fraction < 1
        : action.action === 'support-reduction' ? /^support-[1-9]\d*$/.test(action.id) && validPositive(action.fraction) && action.fraction < 1
        : action.action === 'manual-reduction' && /^manual-[1-9]\d*$/.test(action.id) && validPositive(action.fraction) && action.fraction < 1;
      if (!actionValid) throw Error('即时交易动作参数无效');
      ids.add(action.id);
    }
    campaigns.add(row.id);
  }
  return value as UsdtFollowCampaign[];
}

async function jsonBody(req: IncomingMessage) {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    if ((size += chunk.length) > bodyLimit) throw Error('即时交易请求超过大小限制');
    chunks.push(chunk);
  }
  const request = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!request || typeof request !== 'object' || Array.isArray(request)) throw Error('即时交易请求格式无效');
  return request;
}

const digest = (value: string) => createHash('sha256').update(value).digest();
const json = (res: ServerResponse, status: number, data: unknown) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
};

function manualAnchor(value: BinanceManualAnchor, now: number) {
  if (!value || !/^[A-Z0-9]{2,24}USDT$/.test(value.symbol) ||
    (value.positionSide !== 'LONG' && value.positionSide !== 'BOTH') ||
    !Number.isSafeInteger(value.openedAt) || value.openedAt <= 0 || value.openedAt > now + 1000 ||
    typeof value.openingTradeId !== 'string' || !/^\d{1,25}$/.test(value.openingTradeId) ||
    typeof value.openingOrderId !== 'string' || !/^\d{1,25}$/.test(value.openingOrderId)) throw Error('币安首仓身份无效');
  return { symbol: value.symbol, positionSide: value.positionSide, openedAt: value.openedAt,
    openingTradeId: value.openingTradeId, openingOrderId: value.openingOrderId };
}

function manualMonitor(value: InstantMonitorSettings) {
  if (!value || value.version !== 'instant-template-monitor-v1' || typeof value.templateId !== 'string' ||
    typeof value.name !== 'string' || value.name.length > 200 || typeof value.plan?.id !== 'string' ||
    !Array.isArray(value.plan.frozenVersions) || !value.plan.frozenVersions.length ||
    value.plan.preEntryThreeStage || value.plan.preEntryConditions) throw Error('手动仓位需要已保存且版本可核验的买后策略');
  return value;
}

export function serveUsdtFollower({
  owner, token, exchange, store, mode, startedAt, positionReader, campaignReader, managedClock, positionRequest,
  allowedOrigin = origin, port = dashPort, statusFile, handoff,
}: {
  owner: string; token: string; exchange: ReturnType<typeof createUsdtExchange>;
  store: ReturnType<typeof openUsdtFollowStore>; mode: 'hedge' | 'one-way'; startedAt: number;
  positionReader?: ReturnType<typeof createUsdtPositionReader>;
  campaignReader?: ReturnType<typeof createUsdtCampaignReader>;
  managedClock?: () => number;
  positionRequest?: UsdtRequest;
  allowedOrigin?: string; port?: number; statusFile?: string;
  handoff?: ReturnType<typeof createUsdtHandoffService>;
}) {
  const readManaged = campaignReader && managedClock ? async (anchor: BinanceManualAnchor) => {
    const from = Math.max(1, anchor.openedAt - 1000);
    const result = await campaignReader(from, [{ symbol: anchor.symbol, openedAt: anchor.openedAt }], anchor.symbol);
    const actual = result.campaigns.find(campaign => matchesManualAnchor(anchor, campaign));
    if (!actual) throw Error('币安未返回这一笔仓位的完整成交');
    return actual;
  } : undefined;
  const controls = positionRequest && positionReader && campaignReader ?
    createUsdtPositionControls(positionRequest, store, owner, exchange.market, campaignReader, positionReader.invalidate, managedClock, exchange.book) : undefined;
  const follower = createUsdtFollower(store, exchange, owner, mode, startedAt, readManaged, managedClock,
    controls?.protectionIds, controls ? positionReader?.positions : undefined, controls);
  const desk = controls && positionRequest && createUsdtOrderDesk(positionRequest, exchange, store, owner, mode, async symbol => {
    if (follower.statuses().some(row => (row.market ?? row.symbol) === symbol && !['closed','ignored'].includes(row.state)))
      throw Error('该合约存在策略跟随的仓位或待核对委托，请先处理原仓位');
    await controls.beforeOpening(symbol);
  }, managedClock);
  void handoff?.begin(follower);
  const tokenDigest = digest(token);
  const snapshot = () => ({ connected: true, paused: follower.paused, startedAt: follower.entryAfter, statuses: follower.statuses(),
    guardPlusAdditions: 1, executionSafety: USDT_EXECUTION_SAFETY, controlRevision: store.controlRevision(),
    ...(positionReader ? { positionMirror: 1 } : {}), ...(campaignReader ? { campaignMirror: 1 } : {}),
    ...(readManaged ? { manualMonitor: 1, monitorSwitch: 1, marginRejectExit: 1 } : {}), ...(controls ? { positionControls: 1 } : {}),
    ...(readManaged && controls ? { followMonitorSwitch: USDT_FOLLOW_MONITOR_BASIS } : {}),
    ...(desk ? { orderDesk: 1 } : {}), ...(handoff ? { handoff: handoff.describe() } : {}) });
  const server = createServer({ maxHeaderSize: 4000, requestTimeout: 10_000, headersTimeout: 6000 }, (req, res) => {
    const work = async () => {
      if (req.headers.origin !== allowedOrigin ||
          req.headers.host !== '127.0.0.1:' + (server.address() as { port: number }).port ||
          (req.url !== '/api/usdt-follow' && req.url !== USDT_EXECUTION_PATH)) {
        json(res, 403, { error: '本机执行端只接受配对页面' });
        return;
      }
      res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
      res.setHeader('Vary', 'Origin');
      if (req.method === 'OPTIONS') {
        res.writeHead(204, { 'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Private-Network': 'true' }).end();
        return;
      }
      if (req.method !== 'POST' || !req.headers['content-type']?.startsWith('application/json') ||
          !timingSafeEqual(tokenDigest, digest(req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : ''))) {
        json(res, 401, { error: '本机配对码无效' });
        return;
      }
      const content = await jsonBody(req);
      if (content.owner !== owner) return json(res, 403, { error: '本机执行端绑定了另一个无知之幕账号' });
      if (content.command === 'status') return json(res, 200, snapshot());
      if (handoff && ['handoff-freeze','handoff-export','handoff-resume','handoff-cancellation','handoff-initialize','handoff-request'].includes(content.command))
        return json(res, 200, await handoff.command(content, follower));
      if (content.command === 'handoff-monitor-state') return json(res, 200, {
        epoch: handoff?.describe().epoch, handoff: handoff?.describe(),
        campaigns: store.readAll().filter(row => !row.managed && !['closed','ignored'].includes(row.status.state) &&
          store.local('imported-monitor:' + row.campaign.id)).map(row => ({ campaign: row.campaign,
            revision: store.local<number>('monitor-revision:' + row.campaign.id) ?? 0 })) });
      if (handoff && content.command === 'sync' && handoff.capturable()) {
        follower.captureFrozenMonitors(parseCampaigns(content.campaigns, Date.now()));
        return json(res, 200, snapshot());
      }
      const readCommands = ['positions','position-history','position-campaigns','manual-monitor-status','desk-info'];
      if (handoff && !readCommands.includes(content.command)) handoff.assertWritable();
      if (content.command === 'handoff-monitor-update') {
        const entries = parseCampaigns([content.campaign], Date.now()), id = entries[0].id;
        if (content.epoch !== handoff?.describe().epoch || content.revision !== (store.local<number>('monitor-revision:' + id) ?? 0))
          throw Error('接管监测状态已更新，请重新读取');
        follower.updateRecovered(entries[0]);
        store.setLocal('monitor-revision:' + id, content.revision + 1);
        return json(res, 200, { ok: true });
      }
      if (req.url === USDT_EXECUTION_PATH && desk) {
        if (content.command === 'desk-info') return json(res, 200, await desk.info(content.symbol));
        if (content.command === 'desk-open')
          return json(res, 200, await follower.runPositionControl(() => desk.execute(content.request)));
        if (content.command === 'desk-close' && content.request?.action?.kind === 'close' && content.request.action.order)
          return json(res, 200, await follower.runPositionControl(() => controls!.execute(content.request)));
      }
      if (content.command === 'position-control') {
        if (!controls) return json(res, 501, { error: '请更新 Windows 本机执行端以操作币安实盘仓位' });
        return json(res, 200, await follower.runPositionControl(() => controls.execute(content.request)));
      }
      if (readManaged && managedClock) {
        if (content.command === 'manual-monitor-status') {
          return json(res, 200, { observedAt: managedClock(), positions: follower.managed(content.followBasisVersion === USDT_FOLLOW_MONITOR_BASIS).filter(({position})=>!position.monitor.plan.addition?.marginRejectExit || content.marginRejectExit === 1) });
        }
        if (content.command === 'manual-monitor-adopt') {
          if (content.confirmed !== true || content.controlRevision !== store.controlRevision())
            throw Error('请按当前实盘状态逐笔确认策略托管');
          const position = await follower.runPositionControl(() =>
            follower.adopt(manualAnchor(content.anchor, managedClock()), manualMonitor(content.monitor), content.controlRevision));
          return json(res, 200, { position });
        }
        if (content.command === 'manual-monitor-switch' && req.url === USDT_EXECUTION_PATH) {
          if (content.confirmed !== true || typeof content.id !== 'string' || !Number.isSafeInteger(content.planEpoch) || content.planEpoch < 0)
            throw Error('请逐笔确认实盘持仓方案切换');
          const position = await follower.runPositionControl(() => follower.switchManaged(content.id, content.planEpoch, manualMonitor(content.monitor)));
          return json(res, 200, { position });
        }
        if (content.command === 'manual-monitor-update') {
          if (typeof content.id !== 'string' || !Number.isSafeInteger(content.revision) || !content.checkpoint) throw Error('手动托管进度无效');
          follower.updateManaged(content.id, content.revision, content.checkpoint as QualityResult, content.decision as BinanceManualDecision | undefined, content.planEpoch, content.followBasisVersion);
          json(res, 200, { ok: true });
          void follower.tick();
          return;
        }
        if (content.command === 'follow-monitor-switch' && controls && req.url === USDT_EXECUTION_PATH) {
          if (content.confirmed !== true || content.followBasisVersion !== USDT_FOLLOW_MONITOR_BASIS || typeof content.id !== 'string'
            || !Number.isSafeInteger(content.planEpoch) || content.planEpoch < 0) throw Error('请逐笔确认跟单持仓的新方案');
          const anchor = manualAnchor(content.anchor, managedClock());
          const monitor = manualMonitor(content.monitor);
          const original = content.original && manualMonitor(content.original);
          const position = await follower.runPositionControl(() => follower.switchFollowMonitor(content.id, anchor,
            content.planEpoch, monitor, original, content.followSample));
          return json(res, 200, { position });
        }
      }
      if (content.command === 'position-campaigns') {
        if (!campaignReader) return json(res, 501, { error: '请更新 Windows 本机执行端以同步实盘战役' });
        const result = await campaignReader(content.since, content.open);
        const statuses = follower.statuses();
        return json(res, 200, { ...result, campaigns: result.campaigns.map(campaign => {
          const follow = findUsdtCampaignFollow(campaign, statuses);
          const liveId = usdtLiveCampaignId(campaign);
          const management = follower.managedArchive(follow?.id ?? liveId);
          return { ...campaign, ...(management ? { management } : {}), ...(follow && follow.id !== liveId ? { followId: follow.id } : {}) };
        }) });
      }
      if (content.command === 'positions' || content.command === 'position-history') {
        if (!positionReader) return json(res, 501, { error: '请更新 Windows 本机执行端以同步币安持仓' });
        if (content.command === 'positions') {
          const state = await positionReader.positions();
          return json(res, 200, content.withDetails === true && controls ? await controls.readDetails(state) : state);
        }
        const state = await positionReader.history(content.symbol, content.positionSide, content.revision);
        return json(res, 200, state);
      }
      if (content.command !== 'sync' && content.command !== 'pause' && content.command !== 'resume') throw Error('未知的实盘指令');
      const campaigns = parseCampaigns(content.campaigns, Date.now());
      if (content.command !== 'sync') {
        const legacyPause = content.command === 'pause' && content.controlRevision === undefined;
        if ((!legacyPause && campaigns.length) ||
          (content.command === 'resume' && content.controlRevision !== store.controlRevision())) {
          return json(res, 409, { ...snapshot(), staleControl: true, error: '实盘跟随状态已变化，请核对后重新操作' });
        }
        if (content.command === 'pause') follower.pauseNewOrders();
        else follower.resumeNewOrders();
      } else follower.ingest(campaigns);
      json(res, 200, snapshot());
      void follower.tick();
    };
    void work().catch(error => {
      if (!res.headersSent) json(res, 400, { error: error instanceof SyntaxError ? '本机请求格式无效' : error instanceof Error ? error.message : '本机执行端拒绝请求' });
    });
  });
  let nextCleanup = 0;
  const timer = setInterval(() => {
    if (controls && Date.now() >= nextCleanup) {
      nextCleanup = Date.now() + 10_000;
      if (controls.hasPending()) void follower.runPositionControl(controls.cleanup).catch(() => undefined);
    }
    void follower.tick();
    if (statusFile) {
      try { writeFileSync(statusFile, JSON.stringify(snapshot()), { mode: 0o600 }); } catch { /* API still has authoritative state. */ }
    }
  }, 1000);
  server.once('close', () => clearInterval(timer));
  server.listen(port, '127.0.0.1');
  return Object.assign(server, { follower });
}

async function main() {
  const directory = process.argv[2];
  if (!directory) throw Error('请指定保存币安凭证的本机目录');
  const live = process.argv.includes('--live');
  const setup = process.argv.includes('--prepare');
  const credentials = loadUsdtCredentials(directory);
  let authorizeWrite: () => void = () => { throw Error('执行权尚未核验，禁止交易'); };
  const request = createUsdtRequest(credentials, fetch, () => authorizeWrite());
  const exchange = createUsdtExchange(request);
  let verified: Awaited<ReturnType<typeof exchange.account>>;
  try { verified = await exchange.account(); }
  catch (error) {
    credentials.secret.fill(0);
    if (error instanceof TypeError) throw Error('本机网络无法访问币安 U 本位账户接口');
    throw error;
  }
  if (setup) {
    const account = createHash('sha256').update(verified.id).digest('hex');
    credentials.secret.fill(0);
    console.log(JSON.stringify({ connected: true, market: 'USDT-M', mode: verified.mode, account }));
    return;
  }
  if (!live) {
    credentials.secret.fill(0);
    console.log(JSON.stringify({ connected: true, market: 'USDT-M', mode: verified.mode }));
    return;
  }
  const config = readUsdtConfig(directory);
  if (config.account !== createHash('sha256').update(verified.id).digest('hex')) throw Error('本机配对账户不符');
  const unlock = lockUsdtDirectory(directory);
  const store = openUsdtFollowStore(join(directory, 'usdt-follow.sqlite'), verified.id, config.owner);
  const handoff = createUsdtHandoffService(store, verified.id, config.owner, usdtRuntime(), exchange, request);
  authorizeWrite = handoff.assertWritable;
  process.once('exit', () => { try { store.close(); } finally { unlock(); credentials.secret.fill(0); } });
  const clockStart = performance.now();
  const clockReply = await fetch('https://fapi.binance.com/fapi/v1/time', { redirect: 'error', signal: AbortSignal.timeout(10_000) });
  const { serverTime } = await clockReply.json();
  if (!clockReply.ok || !Number.isSafeInteger(serverTime) || serverTime <= 0) throw Error('币安服务器时间暂不可用');
  const clockMidpoint = (clockStart + performance.now()) / 2;
  const managedClock = () => Math.round(serverTime + performance.now() - clockMidpoint);
  const server = serveUsdtFollower({ owner: config.owner, token: config.token, exchange, store, mode: verified.mode, managedClock,
    startedAt: Date.now(), positionReader: createUsdtPositionReader(request, managedClock), campaignReader: createUsdtCampaignReader(request, managedClock),
    positionRequest: request, handoff,
    statusFile: join(directory, 'usdt-follow-status.json') });
  server.once('listening', () => console.log('本机接口已就绪；以交接状态及本次账户对账结果决定是否允许执行。'));
  for (const signal of ['SIGINT','SIGTERM'] as const) process.once(signal, () => {
    void handoff.stop((server as typeof server & { follower: ReturnType<typeof createUsdtFollower> }).follower).then(() => server.close(() => process.exit(0)));
  });
  server.once('error', () => { console.error('本机执行端端口不可用'); process.exit(1); });
}

if (process.argv[1] && /usdt-follow-server\.(?:mjs|ts)$/.test(process.argv[1])) {
  void main().catch(error => {
    console.error(error instanceof Error && !error.stack?.includes('readFileSync') ? error.message : '本机执行端无法启动');
    process.exitCode = 1;
  });
}
