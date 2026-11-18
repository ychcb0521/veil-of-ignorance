import { createHash, generateKeyPairSync, randomUUID, sign, verify } from 'node:crypto';
import type { openUsdtFollowStore, UsdtLedgerSnapshot } from './usdt-follow-store.ts';

export const HANDOFF_PROTOCOL = 'veil-usdt-handoff-v1' as const;
export const handoffHash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
type Store = ReturnType<typeof openUsdtFollowStore>;
type Stage = 'empty' | 'active' | 'frozen' | 'outgoing' | 'staged' | 'cancelled';
type Signed<T> = { payload: T; publicKey: string; signature: string };
interface Device { id: string; publicKey: string; privateKey: string }
export interface ReceiveRequest {
  protocol: typeof HANDOFF_PROTOCOL; kind: 'receive'; nonce: string; device: string;
  account: string; owner: string; epoch: number; chain?: string; runtime: string;
}
export interface HandoffPayload {
  protocol: typeof HANDOFF_PROTOCOL; kind: 'handoff'; id: string; epoch: number; parent: string;
  request: Signed<ReceiveRequest>; frozenAt: number; wasPaused: boolean;
  ledger: UsdtLedgerSnapshot; evidence: unknown; runtime: string;
}
interface Cancellation {
  protocol: typeof HANDOFF_PROTOCOL; kind: 'cancel'; transfer: string; nonce: string; bundleHash: string;
}
export interface HandoffAuthority {
  stage: Stage; epoch: number; chain: string; wasPaused?: boolean;
  bundle?: Signed<HandoffPayload>; request?: Signed<ReceiveRequest>;
}
function requireValue(ok: unknown, message: string): asserts ok { if (!ok) throw Error(message); }
function checked<T>(envelope: Signed<T>): T {
  requireValue(envelope && typeof envelope.publicKey === 'string' && typeof envelope.signature === 'string', '交接签名缺失');
  try {
    requireValue(verify(null, Buffer.from(JSON.stringify(envelope.payload)), envelope.publicKey, Buffer.from(envelope.signature, 'base64')), '交接文件签名不符');
  } catch { throw Error('交接文件签名无效或已损坏'); }
  return envelope.payload;
}

/** Offline ownership transfer. No timer, UI resume or network retry may release a surrendered source. */
export function createUsdtHandoff(store: Store, account: string, owner: string, runtime: string) {
  let device = store.local<Device>('device');
  if (!device) {
    const pair = generateKeyPairSync('ed25519', { publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
    device = { id: handoffHash(pair.publicKey), publicKey: pair.publicKey, privateKey: pair.privateKey };
    store.setLocal('device', device);
  }
  const local = device;
  const seal = <T>(payload: T): Signed<T> => ({ payload, publicKey: local.publicKey,
    signature: sign(null, Buffer.from(JSON.stringify(payload)), local.privateKey).toString('base64') });
  const state = (): HandoffAuthority => store.local('authority') ?? { stage: 'empty', epoch: 0, chain: '' };
  const save = (value: HandoffAuthority) => store.setLocal('authority', value);
  const assertActive = () => requireValue(state().stage === 'active', '执行权尚未核对或已经交出；本端禁止交易');
  return {
    device: local.id, state, assertActive,
    initializeSource() {
      requireValue(state().stage === 'empty' && !store.local('receive-request'), '本端已有交接记录，不能重新初始化');
      save({ stage: 'active', epoch: 0, chain: handoffHash(randomUUID()) });
    },
    receiveRequest() {
      const current = state();
      requireValue(['empty', 'outgoing', 'cancelled'].includes(current.stage), '本端尚未交出执行权，不能申请接管');
      const previous = store.local<Signed<ReceiveRequest>>('receive-request');
      if (previous && !store.local('consumed:' + previous.payload.nonce)) return previous;
      const request = seal<ReceiveRequest>({ protocol: HANDOFF_PROTOCOL, kind: 'receive', nonce: randomUUID(),
        device: local.id, account, owner, epoch: current.epoch, runtime, ...(current.chain ? { chain: current.chain } : {}) });
      store.setLocal('receive-request', request);
      return request;
    },
    freeze() {
      const current = state();
      if (current.stage === 'frozen') return;
      requireValue(current.stage === 'active', '本端没有可冻结的执行权');
      // Durable first. It gates ALL POST/DELETEs, including sells, cleanup and already-awaiting requests.
      save({ ...current, stage: 'frozen', wasPaused: store.paused() });
      store.setPaused(true);
    },
    export(request: Signed<ReceiveRequest>, evidence: unknown, frozenAt: number) {
      const current = state(), receive = checked(request);
      requireValue(receive.protocol === HANDOFF_PROTOCOL && receive.kind === 'receive' &&
        receive.account === account && receive.owner === owner && receive.device === handoffHash(request.publicKey) &&
        receive.device !== local.id && receive.runtime === runtime && /^[a-f0-9-]{36}$/i.test(receive.nonce), '接管请求的账户、设备或执行代码版本不符');
      if (current.stage === 'outgoing') {
        requireValue(handoffHash(current.bundle!.payload.request) === handoffHash(request), '本端已交出执行权，不能再导出给另一台设备');
        return current.bundle!;
      }
      requireValue(current.stage === 'frozen', '必须先停止执行并冻结账本');
      requireValue(current.epoch >= receive.epoch && (!receive.chain || receive.chain === current.chain), '接管请求属于旧交接链');
      const bundle = seal<HandoffPayload>({ protocol: HANDOFF_PROTOCOL, kind: 'handoff', id: randomUUID(),
        epoch: current.epoch + 1, parent: current.chain, request, frozenAt, wasPaused: current.wasPaused ?? true,
        ledger: store.snapshot(), evidence, runtime });
      // Commit surrender BEFORE exposing any bytes. Failed file writes can only re-export this exact bundle.
      save({ stage: 'outgoing', epoch: bundle.payload.epoch, chain: handoffHash(bundle), bundle, wasPaused: current.wasPaused });
      return bundle;
    },
    import(bundle: Signed<HandoffPayload>) {
      const value = checked(bundle), current = state();
      const receive = checked(value.request);
      const ownRequest = store.local<Signed<ReceiveRequest>>('receive-request');
      requireValue(value.protocol === HANDOFF_PROTOCOL && value.kind === 'handoff' && value.runtime === runtime, '交接协议或执行代码版本不一致');
      requireValue(ownRequest && handoffHash(ownRequest) === handoffHash(value.request) && value.request.publicKey === local.publicKey &&
        receive.device === local.id && receive.account === account && receive.owner === owner &&
        !store.local('consumed:' + receive.nonce), '交接文件不属于本次接管请求，或已经使用/作废');
      requireValue(['empty', 'outgoing', 'cancelled'].includes(current.stage) && value.epoch > current.epoch &&
        (!current.chain || value.parent === current.chain), '本端已有执行权或交接文件已过期');
      requireValue(current.stage !== 'empty' || (store.readAll().length === 0 && store.snapshot().tables.position_controls.length === 0 &&
        store.snapshot().tables.desk_orders.length === 0), '目标端已有未纳入交接的旧账本，必须先核对历史，禁止直接覆盖');
      if (current.stage === 'outgoing') requireValue(bundle.publicKey === current.bundle!.payload.request.publicKey, '退回账本并非来自接管设备');
      requireValue(createHash('sha256').update(value.ledger.account).digest('hex') === account && value.ledger.owner === owner, '交接账本的账户不符');
      const next: HandoffAuthority = { stage: 'staged', epoch: value.epoch, chain: handoffHash(bundle), bundle,
        request: ownRequest, wasPaused: value.wasPaused };
      // Rows and blocked role commit together; exceptions roll back every imported table.
      store.importSnapshot(value.ledger, next);
      store.setLocal('consumed:' + receive.nonce, true);
    },
    activateAfterReconciliation() {
      const current = state();
      requireValue(current.stage === 'staged' || current.stage === 'frozen', '本端不能恢复：已交出的执行权需要接收端作废凭据或反向交接');
      if (current.bundle) store.setLocal('activated:' + current.bundle.payload.id, true);
      save({ ...current, stage: 'active' });
      store.setPaused(current.wasPaused ?? true);
    },
    cancelIncoming(bundle?: Signed<HandoffPayload>) {
      const current = state(), incoming = bundle ?? current.bundle;
      requireValue(incoming, '需要原交接文件才能生成作废凭据');
      const value = checked(incoming), receive = checked(value.request);
      const own = store.local<Signed<ReceiveRequest>>('receive-request');
      const prior = store.local<Signed<Cancellation>>('cancel:' + value.id);
      if (prior) return prior;
      requireValue(!store.local('activated:' + value.id) && current.stage !== 'active' && current.stage !== 'frozen' &&
        own && handoffHash(own) === handoffHash(value.request) &&
        value.request.publicKey === local.publicKey && createHash('sha256').update(value.ledger.account).digest('hex') === account && value.ledger.owner === owner,
      '已经执行过的接管必须反向交接，不能生成作废凭据');
      const receipt = seal<Cancellation>({ protocol: HANDOFF_PROTOCOL, kind: 'cancel', transfer: value.id,
        nonce: receive.nonce, bundleHash: handoffHash(incoming) });
      store.setLocal('consumed:' + receive.nonce, true);
      save({ ...current, stage: 'cancelled' });
      store.setLocal('cancel:' + value.id, receipt);
      return receipt;
    },
    acceptCancellation(receipt: Signed<Cancellation>) {
      const value = checked(receipt), current = state(), bundle = current.bundle;
      requireValue(current.stage === 'outgoing' && bundle && value.protocol === HANDOFF_PROTOCOL && value.kind === 'cancel' &&
        receipt.publicKey === bundle.payload.request.publicKey && value.transfer === bundle.payload.id &&
        value.nonce === bundle.payload.request.payload.nonce && value.bundleHash === handoffHash(bundle), '作废凭据与本次交接不符');
      save({ ...current, stage: 'frozen' });
      // Still blocked until a fresh reconciliation and explicit resume.
    },
  };
}
