"""Build a reproducible, independently installable mod archive."""

import argparse
import hashlib
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parent.parent
EXCLUDED = {".DS_Store", "runtime.json", "gpui-kit.d.ts", "herdr.d.ts", "jsconfig.json"}


def build(mod, output):
    source = ROOT / mod
    output.mkdir(parents=True, exist_ok=True)
    archive = output / f"{mod}.zip"
    files = sorted(path for path in source.rglob("*") if path.is_file())
    with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as bundle:
        for path in files:
            relative = path.relative_to(source)
            if any(part.startswith(".") or part in {"data", "node_modules", "layouts"} for part in relative.parts):
                continue
            if path.name in EXCLUDED:
                continue
            if path.is_symlink():
                raise ValueError(f"Refusing to package a symlink: {relative}")
            info = zipfile.ZipInfo(f"{mod}/{relative.as_posix()}", date_time=(2020, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            bundle.writestr(info, path.read_bytes())
    checksum = hashlib.sha256(archive.read_bytes()).hexdigest()
    archive.with_suffix(".zip.sha256").write_text(f"{checksum}  {archive.name}\n")
    print(f"{archive}: {checksum}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mod", choices=("floatterm", "analytics"))
    parser.add_argument("--output", type=Path, default=ROOT / "dist")
    args = parser.parse_args()
    build(args.mod, args.output)
