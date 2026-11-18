from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
import hashlib
import json

root = Path(__file__).resolve().parent.parent
source = root / 'work' / 'veil-usdt-handoff'
destination = root / 'public' / 'downloads' / 'veil-usdt-handoff-20261118-v1.zip'
expected = {'usdt-follow-server.mjs', 'handoff.mjs', 'handoff-menu.mjs', 'macos-preload.mjs',
            'windows-preload.mjs', 'macos-setup.mjs', '启动Mac交接执行器.command',
            'Windows执行器开关.cmd', '交接与恢复说明.md', 'version.json'}
assert {p.name for p in source.iterdir()} == expected
destination.parent.mkdir(parents=True, exist_ok=True)
with ZipFile(destination, 'w', ZIP_DEFLATED) as archive:
    for path in sorted(source.iterdir()):
        info = ZipInfo('veil-usdt-handoff/' + path.name)
        info.create_system = 3
        info.external_attr = (0o100755 if path.suffix == '.command' else 0o100644) << 16
        info.compress_type = ZIP_DEFLATED
        archive.writestr(info, path.read_bytes())
with ZipFile(destination) as archive:
    assert archive.testzip() is None
    assert (archive.getinfo('veil-usdt-handoff/启动Mac交接执行器.command').external_attr >> 16) & 0o111
print(json.dumps({'file': destination.name, 'bytes': destination.stat().st_size,
                  'sha256': hashlib.sha256(destination.read_bytes()).hexdigest()}))
