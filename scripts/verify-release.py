"""Check the four uploaded CI artifacts before distributing any of them."""
import argparse
import hashlib
import json
import re
import tarfile
import zipfile
from pathlib import Path


def file_digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def inspect_package(path, mode, prefix, commit, version):
    if path.suffix == ".tar":
        with tarfile.open(path) as bundle:
            entries = {m.name.removeprefix("./"): m for m in bundle if m.isfile()}
            def read(name):
                return bundle.extractfile(entries[name]).read()
            info, revision = read_game(read, commit, mode, version)
    else:
        with zipfile.ZipFile(path) as bundle:
            info, revision = read_game(lambda name: bundle.read(prefix + name), commit, mode, version)
    return {"filename": path.name, "sha256": file_digest(path), "build": info["build"],
            "physicsRevision": revision}


def read_game(read, commit, mode, version):
    if not read("index.html").strip():
        raise ValueError("Empty game entry point")
    info = json.loads(read("build-info.json"))
    if info.get("version") != version:
        raise ValueError(f"Expected release {version}, got {info.get('version')}")
    if info["commit"] != commit or info["mode"] != mode:
        raise ValueError(f"Expected {commit} / {mode}, got {info['commit']} / {info['mode']}")
    return info, hashlib.sha256(read("assets/chess-set.meta.json")).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("release_dir", type=Path)
    parser.add_argument("--commit", required=True)
    args = parser.parse_args()
    gradle = (Path(__file__).resolve().parents[1] / "web/android/app/build.gradle").read_text()
    version = re.search(r'^\s*versionName\s+"([^"]+)"', gradle, re.M)[1]
    code = int(re.search(r"^\s*versionCode\s+(\d+)", gradle, re.M)[1])
    packages = {}
    for platform, name, mode, prefix in [
        ("web", "artifact.tar", "production", ""), ("itch", "itch.zip", "itch", ""),
        ("crazygames", "crazygames.zip", "crazygames", ""),
        ("android", "app-release.aab", "production", "base/assets/public/"),
    ]:
        packages[platform] = inspect_package(args.release_dir / name, mode, prefix, args.commit, version)
    if len({p["physicsRevision"] for p in packages.values()}) != 1:
        raise ValueError("Platforms have different multiplayer physics revisions")
    manifest = {"version": version, "androidVersionCode": code, "commit": args.commit, "platforms": packages}
    (args.release_dir / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"Verified four artifacts for {version} ({code}), commit {args.commit}")


if __name__ == "__main__":
    main()
