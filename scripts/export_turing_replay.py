"""Create the continuous clock in Data_2 and export an account-local chart archive."""

import argparse
import json
import math
import sqlite3
from contextlib import closing
from pathlib import Path


MINUTE_MS = 60_000
CLOCK_SQL = '''CREATE VIEW turing_trading_clock AS
    WITH slots AS (
        SELECT source_day_index, source_first_step, source_last_step,
               open_time_utc_ms AS session_time_utc_ms
        FROM replay_minutes_usdt
        WHERE source_code = 0 AND is_partial_slot = 0
    )
    SELECT *, ROW_NUMBER() OVER (ORDER BY session_time_utc_ms) - 1 AS minute_index,
        MIN(session_time_utc_ms) OVER () +
            (ROW_NUMBER() OVER (ORDER BY session_time_utc_ms) - 1) * 60000 AS trading_time_utc_ms,
        CASE WHEN source_first_step = 2401 THEN 'lunch'
             WHEN source_first_step = 0 AND source_day_index > 0 THEN 'session-gap' END AS reopen
    FROM slots'''
BAR_SQL = '''CREATE VIEW turing_trading_minutes_usdt AS
    SELECT bar.*, clock.minute_index, clock.trading_time_utc_ms, clock.reopen
    FROM replay_minutes_usdt AS bar JOIN turing_trading_clock AS clock
    USING (source_day_index, source_first_step)'''


def install_clock(db):
    db.execute('BEGIN IMMEDIATE')
    try:
        if db.execute("SELECT 1 FROM sqlite_schema WHERE name = 'turing_trading_clock'").fetchone() is None:
            db.execute(CLOCK_SQL)
            db.execute(BAR_SQL)
            revision, = db.execute('SELECT MAX(revision) + 1 FROM inference_runs').fetchone()
            digest, = db.execute("SELECT value FROM dataset_metadata WHERE key = 'source_sha256'").fetchone()
            db.execute('INSERT INTO inference_runs VALUES (?, ?, ?, ?)',
                       (revision, '2026-11-06', digest, '用完整交易分钟建立连续回放时钟，保留时段边界与原始步号。'))
            db.execute('INSERT INTO label_history VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                       ('trading_minutes_clock', revision, '时间', 'date,time', '连续交易分钟', 'source',
                        '从回放起点按完整交易分钟递增。午休与隔夜不推进交易时钟。',
                        '时钟同时保存原会话时间、标的来源步号、午休重开与隔夜/尾盘缺样边界。',
                        '开市内部的标的异常和只有一个快照的边界分钟单独保留。'))
        if db.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
            raise ValueError('Data_2 integrity check failed')
        db.commit()
    except BaseException:
        db.rollback()
        raise


def export_archive(db):
    clock = db.execute('SELECT * FROM turing_trading_clock ORDER BY minute_index').fetchall()
    anchor = clock[0]['trading_time_utc_ms']
    if any(bar['trading_time_utc_ms'] != anchor + i * MINUTE_MS for i, bar in enumerate(clock)):
        raise ValueError('Trading minute clock is discontinuous')
    quote = db.execute('SELECT quote_currency, usdt_per_price_tick FROM replay_market_units').fetchone()
    if tuple(quote) != ('USDT', .01):
        raise ValueError('Unexpected pricing units')
    bars_by_symbol = {}
    previous_close = None
    for bar in db.execute('SELECT * FROM turing_trading_minutes_usdt ORDER BY source_code, minute_index'):
        ticker = bar['symbol'].upper()
        if ticker not in bars_by_symbol:
            bars_by_symbol[ticker] = []
            previous_close = None
        series = bars_by_symbol[ticker]
        if len(series) != bar['minute_index']:
            raise ValueError(f'Unaligned source minute for {ticker}')
        prices = [bar[key] for key in ('open_usdt', 'high_usdt', 'low_usdt', 'close_usdt')]
        volume, amount, buy, buy_amount = [bar[key] for key in (
            'volume_units_est', 'quote_amount_usdt_est', 'taker_buy_volume_units_est', 'taker_buy_quote_amount_usdt_est')]
        if bar['stale_clock_snapshot_count'] or bar['suspect_price_snapshot_count']:
            series.append(None)
            previous_close = None
            continue
        if volume == 0 and previous_close is not None:
            prices = [previous_close] * 4
        if any(value is None or not math.isfinite(value) or value <= 0 for value in prices):
            series.append(None)
            continue
        open_ticks, high_ticks, low_ticks, close_ticks = [round(value * 100) for value in prices]
        previous_close = close_ticks / 100
        series.append([open_ticks, high_ticks, low_ticks, close_ticks, volume, amount, min(volume, buy), min(amount, buy_amount)])
    if not all(len(series) == len(clock) for series in bars_by_symbol.values()):
        raise ValueError('Symbol archive does not cover the shared clock')
    return {'version': 1, 'anchorMs': anchor, 'minutes': len(clock), 'markets': bars_by_symbol,
            'reopens': [[bar['minute_index'], bar['reopen']] for bar in clock if bar['reopen']]}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('database', type=Path)
    parser.add_argument('archive', type=Path)
    options = parser.parse_args()
    if options.archive.exists():
        raise FileExistsError(options.archive)
    with closing(sqlite3.connect(options.database.resolve().as_uri() + '?mode=rw', uri=True)) as db:
        db.row_factory = sqlite3.Row
        install_clock(db)
        archive = export_archive(db)
    with options.archive.open('x', encoding='utf-8') as target:
        json.dump(archive, target, allow_nan=False, ensure_ascii=False, separators=(',', ':'))
    missing = sum(row is None for series in archive['markets'].values() for row in series)
    print(f"{len(archive['markets'])} symbols, {archive['minutes']} shared trading minutes, {missing} missing symbol minutes")


if __name__ == '__main__':
    main()
