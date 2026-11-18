from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
import hashlib

root = Path(__file__).resolve().parent.parent
source = root / 'work' / 'veil-usdt-macos'
destination = root / 'public' / 'downloads' / 'veil-usdt-macos-20261118.zip'
destination.parent.mkdir(parents=True, exist_ok=True)
expected = {'启动Mac执行器.command', '先读我.txt', 'usdt-follow-server.mjs', 'macos-setup.mjs', 'macos-preload.mjs', 'version.json'}
assert {p.name for p in source.iterdir()} == expected
with ZipFile(destination, 'w', ZIP_DEFLATED) as archive:
    for path in sorted(source.iterdir()):
        info = ZipInfo('veil-usdt-macos/' + path.name)
        info.create_system = 3
        info.external_attr = (0o100755 if path.suffix == '.command' else 0o100644) << 16
        info.compress_type = ZIP_DEFLATED
        archive.writestr(info, path.read_bytes())
with ZipFile(destination) as archive:
    assert archive.testzip() is None
print(destination.name, destination.stat().st_size, hashlib.sha256(destination.read_bytes()).hexdigest())
