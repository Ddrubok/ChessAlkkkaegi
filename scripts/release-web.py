"""Build the web game and both portal ZIPs from the current checkout."""
from pathlib import Path
from shutil import which
from subprocess import run
from tempfile import TemporaryDirectory
from zipfile import ZIP_DEFLATED, ZipFile

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web"


def build():
    npm = which("npm.cmd") or which("npm")
    if not npm:
        raise SystemExit("Install Node.js and npm first.")
    for command in ("build", "build:itch", "check:itch", "build:crazygames", "check:crazygames"):
        run([npm, "run", command], cwd=WEB, check=True)
    for check in ("itch-auth-check", "crazygames-auth-check", "crazygames-invites-check"):
        run(["node", f"src/tools/{check}.mjs"], cwd=WEB, check=True)

    release = ROOT / "release"
    release.mkdir(exist_ok=True)
    with TemporaryDirectory(dir=release) as temp:
        for platform in ("itch", "crazygames"):
            folder = WEB / f"dist-{platform}"
            if not (folder / "index.html").is_file():
                raise ValueError(f"{platform} game entry point missing")
            with ZipFile(Path(temp) / f"{platform}.zip", "w", ZIP_DEFLATED) as archive:
                for path in sorted(folder.rglob("*")):
                    if path.is_symlink() or path.name == ".env" or path.name.startswith(".env."):
                        raise ValueError(f"Unexpected file in game build: {path}")
                    if path.is_file():
                        archive.write(path, path.relative_to(folder))
        for archive in Path(temp).glob("*.zip"):
            archive.replace(release / archive.name)


if __name__ == "__main__":
    build()
