import { createUsdtHandoff, handoffHash } from './usdt-handoff.ts';
import { reconcileUsdtHandoff, type HandoffEvidence } from './usdt-handoff-reconcile.ts';
import type { openUsdtFollowStore } from './usdt-follow-store.ts';
import type { createUsdtFollower } from './usdt-follow-engine.ts';
import type { UsdtExchange, UsdtRequest } from './usdt-exchange.ts';
import { createHash } from 'node:crypto';

export function createUsdtHandoffService(store: ReturnType<typeof openUsdtFollowStore>, account: string, owner: string,
  runtime: string, exchange: UsdtExchange, read: UsdtRequest) {
  const machine = createUsdtHandoff(store, createHash('sha256').update(account).digest('hex'), owner, runtime);
  let authorized = false, busy = false;
  let issue = '';
  const assertWritable = () => {
    machine.assertActive();
    if (!authorized) throw Error('本次启动尚未完成交接对账，禁止交易');
  };
  const describe = () => ({ protocol: 1, device: machine.device, stage: machine.state().stage, epoch: machine.state().epoch,
    authorized, ...(issue ? { issue } : {}) });
  const begin = async (follower: ReturnType<typeof createUsdtFollower>) => {
    await follower.quiesce();
    if (machine.state().stage !== 'active') return;
    busy = true;
    try {
      await follower.reconcileForHandoff();
      await reconcileUsdtHandoff(store, exchange, read, owner);
      if (machine.state().stage === 'active') { authorized = true; issue = ''; follower.thaw(); }
    } catch (error) { issue = error instanceof Error ? error.message : '启动对账失败'; }
    finally { busy = false; }
  };
  return {
    machine, assertWritable, describe, begin,
    capturable: () => !busy && ['empty','frozen'].includes(machine.state().stage),
    async stop(follower: ReturnType<typeof createUsdtFollower>) {
      if (machine.state().stage === 'active') machine.freeze();
      authorized = false;
      await follower.quiesce();
    },
    async command(content: Record<string, any>, follower: ReturnType<typeof createUsdtFollower>) {
      if (busy) throw Error('交接操作正在进行，请稍后读取状态');
      busy = true;
      try {
        if (content.command === 'handoff-request') return { request: machine.receiveRequest(), handoff: describe() };
        if (content.command === 'handoff-initialize') {
          if (content.confirmed !== true || !store.local('legacy-windows-stopped') || machine.state().stage !== 'empty')
            throw Error('首次执行权只能由已经停用旧计划任务的 Windows 原端建立');
          await follower.quiesce();
          await follower.reconcileForHandoff();
          await reconcileUsdtHandoff(store, exchange, read, owner);
          machine.initializeSource(); authorized = true; issue = ''; follower.thaw();
          return { handoff: describe() };
        }
        if (content.command === 'handoff-freeze' || content.command === 'handoff-export') {
          if (machine.state().stage === 'outgoing' && content.command === 'handoff-export')
            return { bundle: machine.export(content.request, null, 0), handoff: describe() };
          machine.freeze();
          authorized = false;
          await follower.quiesce();
          if (content.command === 'handoff-freeze') return { handoff: describe() };
          await follower.reconcileForHandoff();
          const evidence = await reconcileUsdtHandoff(store, exchange, read, owner);
          const bundle = machine.export(content.request, evidence, evidence.at);
          return { bundle, handoff: describe() };
        }
        if (content.command === 'handoff-resume') {
          if (content.confirmed !== true || machine.state().stage !== 'frozen') throw Error('只有冻结原端可明确确认恢复；已交出端需要接收端作废凭据');
          await follower.reconcileForHandoff();
          await reconcileUsdtHandoff(store, exchange, read, owner);
          machine.activateAfterReconciliation(); authorized = true; issue = ''; follower.thaw();
          return { handoff: describe() };
        }
        if (content.command === 'handoff-cancellation') {
          machine.acceptCancellation(content.receipt);
          authorized = false;
          await follower.quiesce();
          return { handoff: describe() };
        }
        throw Error('未知交接指令');
      } catch (error) {
        issue = error instanceof Error ? error.message : '交接失败；本端保持冻结';
        throw error;
      } finally { busy = false; }
    },
  };
}
