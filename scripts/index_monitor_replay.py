"""Package a completed native monitoring round for the site's read-only local library."""
import argparse
import gzip
import hashlib
import json
import math
import os
import tempfile
from pathlib import Path
from uuid import UUID

PAGE = 32


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def file_hash(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for part in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(part)
    return digest.hexdigest()


def records(path, metadata):
    # Native replay exports are compact JSON. Decode one record at a time,
    # retaining only the current chunk and the frozen settings/round metadata.
    marker = ',"records":['
    decoder = json.JSONDecoder()
    with path.open(encoding="utf-8-sig") as stream:
        buf = ""
        while marker not in buf:
            chunk = stream.read(65536)
            if not chunk:
                raise ValueError("Missing native records array")
            buf += chunk
        prefix, buf = buf.split(marker, 1)
        metadata.update(json.loads(prefix + "}"))
        while True:
            if not buf:
                buf = stream.read(65536)
            if buf.startswith("]"):
                suffix = buf[1:] + stream.read()
                metadata.update(json.loads("{" + suffix.removeprefix(","))
                                if suffix != "}" else {})
                return
            while True:
                try:
                    record, end = decoder.raw_decode(buf)
                    break
                except json.JSONDecodeError:
                    chunk = stream.read(65536)
                    if not chunk:
                        raise
                    buf += chunk
            yield record
            buf = buf[end:] or stream.read(65536)
            if buf.startswith(","):
                buf = buf[1:]
            elif not buf.startswith("]"):
                raise ValueError("Invalid record delimiter")


def validate_campaign_record(record):
    result = record.get("result") or {}
    if result.get("entryRejected") or result.get("status") not in ("open", "closed"):
        return
    def finite(key):
        value = result.get(key)
        return type(value) in (int, float) and math.isfinite(value)
    if (not all(result.get(key) for key in ("key", "groupId", "sampleId"))
            or not all(finite(key) and result[key] > 0 for key in ("entryTime", "entryPrice", "evaluatedAt"))
            or not record.get("source", {}).get("symbol")):
        raise ValueError(f"Incomplete campaign entry: {record['id']}")
    if result["status"] == "closed" and not (
            finite("endTime") and result["endTime"] >= result["entryTime"]
            and finite("endPrice") and result["endPrice"] > 0 and finite("pnl")):
        raise ValueError(f"Incomplete campaign settlement: {record['id']}")
    for fill in (result.get("additionFills") or []) + ([result["additionFill"]] if result.get("additionFill") else []):
        if not all(type(fill.get(k)) in (int, float) and math.isfinite(fill[k]) and fill[k] > 0
                   for k in ("at", "price", "quantity", "notional")):
            raise ValueError(f"Incomplete campaign addition: {record['id']}")
    mirror = result.get("mirrorFill")
    if mirror and (not all(type(mirror.get(k)) in (int, float) and math.isfinite(mirror[k]) and mirror[k] > 0
                           for k in ("at", "price", "fraction")) or mirror["fraction"] > 1):
        raise ValueError(f"Incomplete campaign mirror fill: {record['id']}")


def write_block(out, value):
    raw = json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode()
    data = gzip.compress(raw, compresslevel=4, mtime=0)
    start = out.tell()
    out.write(data)
    return [start, len(data), hashlib.sha256(data).hexdigest()]


def package(source, target, owner):
    proof = read_json(source / "native-proof.json")
    entry = read_json(source / "native-entry.json")
    if (entry["id"] != proof["round"] or entry["bodyId"] != proof["bodyId"]
            or "recent-v1-" + file_hash(source / "native-body.json") != entry["bodyId"]):
        raise ValueError("Native round and verified body disagree")
    frozen = {}
    ids = set()
    setting_ids = set()
    blocks = []
    page = []
    with tempfile.NamedTemporaryFile(dir=target, delete=False) as out:
        temp = Path(out.name)
    try:
        with temp.open("wb") as out:
            for record in records(source / "native-library.json", frozen):
                rid = record["id"]
                if rid in ids or not rid.startswith(entry["id"] + ":"):
                    raise ValueError("Duplicate or foreign record")
                validate_campaign_record(record)
                setting_ids.add(record["settingId"])
                ids.add(rid)
                page.append(record)
                if len(page) == PAGE:
                    blocks.append(write_block(out, page))
                    page = []
            if page:
                blocks.append(write_block(out, page))
            rounds = frozen["rounds"]
            if (len(rounds) != 1 or rounds[0]["id"] != entry["id"]
                    or ids != set(rounds[0]["recordIds"]) or len(ids) != sum(proof["counts"].values())):
                raise ValueError("Native membership or count mismatch")
            available = {s["id"] for s in frozen["settings"] if s.get("plan", {}).get("snapshot")
                         and isinstance(s.get("detectors"), list) and s.get("notional", 0) > 0 and s.get("leverage", 0) > 0}
            if not setting_ids <= available:
                raise ValueError("Missing frozen campaign settings")
            settings = write_block(out, frozen)
        digest = file_hash(temp)
        manifest = dict(version=1, owner=owner, id=entry["id"], at=entry["at"],
                        title=source.parent.name, bodyId=entry["bodyId"], count=len(ids),
                        data=digest + ".vmon", pageSize=PAGE, pages=blocks, settings=settings)
        index_name = hashlib.sha256((owner + "/" + entry["id"]).encode()).hexdigest() + ".index.json"
        index = target / index_name
        if index.exists() and read_json(index) != manifest:
            raise ValueError("Existing round differs; retaining the original")
        data = target / manifest["data"]
        if data.exists():
            if file_hash(data) != digest:
                raise ValueError("Existing local data failed verification")
        else:
            os.replace(temp, data)
        # Verify every block using only local reads before publishing the index.
        with data.open("rb") as stream:
            for start, size, checksum in blocks + [settings]:
                stream.seek(start)
                if hashlib.sha256(stream.read(size)).hexdigest() != checksum:
                    raise ValueError("Local block verification failed")
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=target, delete=False) as f:
            json.dump(manifest, f, separators=(",", ":"), ensure_ascii=False)
        os.replace(f.name, index)
        print(entry["id"], len(ids), len(blocks), data.stat().st_size)
    finally:
        temp.unlink(missing_ok=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--owner", required=True, type=UUID)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("rounds", nargs="+", type=Path)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    for source in args.rounds:
        package(source, args.output, str(args.owner))
