"""Create a small Mac build source ZIP without profiles or generated output."""
from pathlib import Path
import hashlib
import json
import stat
import time
import zipfile

root = Path(__file__).resolve().parents[1]
selected = []
for name in ["src", "electron", "backend", "scripts", "public", "sandbox", ".github"]:
    selected.extend(path for path in (root / name).rglob("*") if path.is_file())
selected.extend(path for path in (root / "docs").rglob("*.md") if path.is_file())
selected.extend(path for path in (root / "build" / "fontspec").rglob("*") if path.is_file())
selected.extend(root / name for name in [
    "package.json", "package-lock.json", ".nvmrc", ".gitignore", "index.html",
    "vite.config.js", "eslint.config.js", "electron-builder.config.cjs",
    "README.md", "ARCHITECTURE.md", "build/app-icon.icns", "build/entitlements.mac.plist", "build/app-icon.png",
    "build/app-icon.svg", "docs/MAC-INSTALLER.md", "docs/LAN-SYNC.md", "docs/UPGRADE-0.5.0.md",
])
version = json.loads((root / "package.json").read_text(encoding="utf-8"))["version"]
output = root / "release-desktop" / ("Viet-Latex-Studio-" + version + "-Mac-Build-Source.zip")
prefix = "Viet-Latex-Studio-" + version + "/"
expected = {}
output.parent.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
    for path in sorted(set(selected)):
        rel = path.relative_to(root).as_posix()
        if path.is_symlink() or not path.resolve().is_relative_to(root):
            raise RuntimeError("Source path escapes project: " + rel)
        if "__pycache__" in path.parts or not path.is_file():
            continue
        if not path.exists(): continue
        data = path.read_bytes()
        mode = 0o755 if path.suffix in [".command", ".sh"] else 0o644
        if mode == 0o755:
            data = data.replace(b"\r\n", b"\n")
        info = zipfile.ZipInfo(prefix + rel, tuple(time.localtime(path.stat().st_mtime)[:6]))
        info.create_system = 3
        info.external_attr = (stat.S_IFREG | mode) << 16
        info.compress_type = zipfile.ZIP_DEFLATED
        archive.writestr(info, data)
        expected[info.filename] = hashlib.sha256(data).hexdigest()
    info = zipfile.ZipInfo(prefix + ".npmrc")
    info.create_system = 3
    info.external_attr = (stat.S_IFREG | 0o644) << 16
    info.compress_type = zipfile.ZIP_DEFLATED
    archive.writestr(info, b"engine-strict=true\n")
    expected[info.filename] = hashlib.sha256(b"engine-strict=true\n").hexdigest()

with zipfile.ZipFile(output) as archive:
    if archive.testzip() is not None:
        raise RuntimeError("ZIP integrity failed")
    for name, digest in expected.items():
        if hashlib.sha256(archive.read(name)).hexdigest() != digest:
            raise RuntimeError("Source ZIP checksum failed: " + name)
    for name in archive.namelist():
        if any(part in ["user-data", "node_modules", "artifacts", "dist", "release-desktop"] for part in Path(name).parts):
            raise RuntimeError("Unexpected private/generated directory in ZIP")
    if ((archive.getinfo(prefix + "scripts/build-mac.command").external_attr >> 16) & 0o777) != 0o755:
        raise RuntimeError("Mac command permissions were not preserved")
digest = hashlib.sha256(output.read_bytes()).hexdigest()
Path(str(output) + ".sha256").write_text(digest + "  " + output.name + "\n", encoding="utf-8")
print(json.dumps({"sourceZip": str(output), "filesVerified": len(expected), "bytes": output.stat().st_size, "sha256": digest, "containsUserData": False, "macCommandMode": "0755"}))
