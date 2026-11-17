import { DatabaseSync } from 'node:sqlite';
import type { UsdtFollowCampaign, UsdtFollowStatus } from '../src/lib/fish/usdtFollow.ts';
import type { BinanceManualPosition } from '../src/lib/fish/binanceManualMonitor.ts';

export interface UsdtFill {
  id: string;
  quantity: number;
  price: number;
  at: number;
  commission: number;
  commissionAsset: string;
  realized: number;
}
export interface UsdtOrder {
  id: string;
  side: 'BUY' | 'SELL';
  quantity: string;
  limitPrice?: string;
  terminal: boolean;
  exchangeId?: string;
  fills?: UsdtFill[];
}
export interface UsdtCampaignLedger {
  campaign: UsdtFollowCampaign;
  managed?: BinanceManualPosition;
  orders: Record<string, UsdtOrder>;
  skipped: string[];
  status: UsdtFollowStatus;
}

type SwitchedFollowLedger = Omit<UsdtCampaignLedger, 'managed'> & {
  switchedMonitor: NonNullable<UsdtCampaignLedger['managed']>;
  switchedStatus: UsdtFollowStatus;
};

function decodeLedger(payload: unknown): UsdtCampaignLedger {
  const row = JSON.parse(String(payload)) as UsdtCampaignLedger | SwitchedFollowLedger;
  if (!('switchedMonitor' in row)) return row;
  const { switchedMonitor, switchedStatus, ...rest } = row;
  return { ...rest, managed: switchedMonitor, status: switchedStatus };
}

export function openUsdtFollowStore(file: string, account: string, owner: string) {
  const db = new DatabaseSync(file);
  try {
    db.exec('PRAGMA busy_timeout=4000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL');
    db.exec('CREATE TABLE IF NOT EXISTS connection (id INTEGER PRIMARY KEY CHECK(id=1), account TEXT NOT NULL, owner TEXT NOT NULL)');
    db.exec('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    db.exec('CREATE TABLE IF NOT EXISTS campaigns (id TEXT PRIMARY KEY, payload TEXT NOT NULL)');
    db.exec('CREATE TABLE IF NOT EXISTS managed_campaigns (id TEXT PRIMARY KEY, payload TEXT NOT NULL)');
    db.exec('CREATE TABLE IF NOT EXISTS position_controls (id TEXT PRIMARY KEY, payload TEXT NOT NULL, pending INTEGER NOT NULL)');
    db.exec('CREATE TABLE IF NOT EXISTS desk_orders (id TEXT PRIMARY KEY, payload TEXT NOT NULL, pending INTEGER NOT NULL)');
    db.prepare('INSERT OR IGNORE INTO connection VALUES (1, ?, ?)').run(account, owner);
    const connection = db.prepare('SELECT account, owner FROM connection WHERE id=1').get();
    if (connection?.account !== account || connection.owner !== owner) throw Error('本机实盘账本绑定了另一个账户');
  } catch (error) {
    db.close();
    throw error;
  }
  const read = db.prepare('SELECT payload FROM campaigns ORDER BY rowid');
  const readManaged = db.prepare('SELECT payload FROM managed_campaigns ORDER BY rowid');
  const save = db.prepare('INSERT INTO campaigns VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload');
  const saveManaged = db.prepare('INSERT INTO managed_campaigns VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload');
  const getControl = db.prepare('SELECT payload FROM position_controls WHERE id=?');
  const listControls = db.prepare('SELECT payload FROM position_controls WHERE pending=1 ORDER BY rowid');
  const saveControl = db.prepare('INSERT INTO position_controls VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload, pending=excluded.pending');
  const getDesk = db.prepare('SELECT payload FROM desk_orders WHERE id=?');
  const listDesk = db.prepare('SELECT payload FROM desk_orders WHERE pending=1');
  const saveDesk = db.prepare('INSERT INTO desk_orders VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload, pending=excluded.pending');
  const readSetting = db.prepare('SELECT value FROM settings WHERE key=?');
  const saveSetting = db.prepare('INSERT INTO settings VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
  const controlRevision = () => Number(readSetting.get('follow-control-revision')?.value ?? 0);
  return {
    paused: () => db.prepare("SELECT 1 FROM settings WHERE key='paused'").get() != null,
    controlRevision,
    setPaused(paused: boolean) {
      db.exec('BEGIN IMMEDIATE');
      try {
        if (paused) saveSetting.run('paused', '1');
        else db.prepare("DELETE FROM settings WHERE key='paused'").run();
        saveSetting.run('follow-control-revision', String(controlRevision() + 1));
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
    readAll: () => [...read.all(), ...readManaged.all()].map(row => decodeLedger(row.payload)),
    save(row: UsdtCampaignLedger) {
      if (row.managed?.followBasis) {
        // Retain the campaign ID in the same table. An older executor sees an inactive row and cannot replay it.
        const { managed, status, ...rest } = row;
        const payload: SwitchedFollowLedger = { ...rest, status: { ...status, state: 'ignored' }, switchedMonitor: managed, switchedStatus: status };
        save.run(row.campaign.id, JSON.stringify(payload));
      } else (row.managed ? saveManaged : save).run(row.campaign.id, JSON.stringify(row));
    },
    getPositionControl<T>(id: string): T | undefined {
      const row = getControl.get(id);
      return row && JSON.parse(String(row.payload));
    },
    pendingPositionControls<T>(): T[] { return listControls.all().map(row => JSON.parse(String(row.payload))); },
    savePositionControl(id: string, value: unknown, pending: boolean) { saveControl.run(id, JSON.stringify(value), Number(pending)); },
    getDeskOrder<T>(id: string): T | undefined {
      const row = getDesk.get(id);
      return row && JSON.parse(String(row.payload));
    },
    pendingDeskOrders<T>(): T[] { return listDesk.all().map(row => JSON.parse(String(row.payload))); },
    saveDeskOrder(id: string, value: unknown, pending: boolean) { saveDesk.run(id, JSON.stringify(value), Number(pending)); },
    positionLeverage(id: string): { leverage: number; at: number } | undefined {
      const row = readSetting.get('position-leverage:' + id);
      return row && JSON.parse(String(row.value));
    },
    savePositionLeverage(id: string, value: { leverage: number; at: number }) {
      const key = 'position-leverage:' + id;
      const old = readSetting.get(key);
      if (!old || Number(JSON.parse(String(old.value)).at) < value.at) saveSetting.run(key, JSON.stringify(value));
    },
    close: () => db.close(),
  };
}
