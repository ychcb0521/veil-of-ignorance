import { DatabaseSync } from 'node:sqlite';
import type { UsdtFollowCampaign, UsdtFollowStatus } from '../src/lib/fish/usdtFollow.ts';

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
  orders: Record<string, UsdtOrder>;
  skipped: string[];
  status: UsdtFollowStatus;
}

export function openUsdtFollowStore(file: string, account: string, owner: string) {
  const db = new DatabaseSync(file);
  try {
    db.exec('PRAGMA busy_timeout=4000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL');
    db.exec('CREATE TABLE IF NOT EXISTS connection (id INTEGER PRIMARY KEY CHECK(id=1), account TEXT NOT NULL, owner TEXT NOT NULL)');
    db.exec('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    db.exec('CREATE TABLE IF NOT EXISTS campaigns (id TEXT PRIMARY KEY, payload TEXT NOT NULL)');
    db.prepare('INSERT OR IGNORE INTO connection VALUES (1, ?, ?)').run(account, owner);
    const connection = db.prepare('SELECT account, owner FROM connection WHERE id=1').get();
    if (connection?.account !== account || connection.owner !== owner) throw Error('本机实盘账本绑定了另一个账户');
  } catch (error) {
    db.close();
    throw error;
  }
  const read = db.prepare('SELECT payload FROM campaigns ORDER BY rowid');
  const save = db.prepare('INSERT INTO campaigns VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload');
  return {
    paused: () => db.prepare("SELECT 1 FROM settings WHERE key='paused'").get() != null,
    pause: () => { db.prepare("INSERT OR IGNORE INTO settings VALUES ('paused','1')").run(); },
    resume: () => { db.prepare("DELETE FROM settings WHERE key='paused'").run(); },
    readAll: () => read.all().map(row => JSON.parse(String(row.payload)) as UsdtCampaignLedger),
    save: (row: UsdtCampaignLedger) => { save.run(row.campaign.id, JSON.stringify(row)); },
    close: () => db.close(),
  };
}
