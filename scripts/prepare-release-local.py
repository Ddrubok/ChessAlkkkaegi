"""Prepare all four release artifacts in a configured local checkout (Python 3.11+)."""
import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import ssl
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web"
ANDROID = WEB / "android"


def prepare(destination, expected_signer):
    gradle = (ANDROID / "app/build.gradle").read_text(encoding="utf-8")
    version = re.search(r'^\s*versionName\s+"([^"]+)"', gradle, re.M)[1]
    notes = ROOT / "store-assets" / f"release-notes-{version}-multilingual.txt"
    signing_properties = Path(os.environ.get("CHESS_ANDROID_SIGNING_PROPERTIES", ANDROID / "keystore.properties"))
    if not notes.is_file() or not signing_properties.is_file():
        raise SystemExit("Release notes and Android release signing configuration are required.")
    if destination.exists():
        raise SystemExit(f"Release destination already exists: {destination}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    head = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
    subprocess.run([sys.executable, ROOT / "scripts/release-web.py"], check=True)
    subprocess.run([shutil.which("node"), "node_modules/@capacitor/cli/bin/capacitor", "sync", "android"], cwd=WEB, check=True)
    wrapper = ANDROID / ("gradlew.bat" if os.name == "nt" else "gradlew")
    subprocess.run([wrapper, ":app:bundleRelease", "--console=plain"], cwd=ANDROID, check=True)
    bundle = ANDROID / "app/build/outputs/bundle/release/app-release.aab"
    java_bin = Path(os.environ["JAVA_HOME"]) / "bin"
    suffix = ".exe" if os.name == "nt" else ""
    verification = subprocess.check_output([java_bin / ("jarsigner"+suffix), "-J-Duser.language=en", "-J-Duser.country=US", "-verify", bundle], text=True, errors="replace")
    if "jar verified." not in verification:
        raise ValueError("Android upload signature missing")
    cert = subprocess.check_output([java_bin / ("keytool"+suffix), "-printcert", "-jarfile", bundle, "-rfc"])
    block = re.search(rb"-----BEGIN CERTIFICATE-----.*?-----END CERTIFICATE-----", cert, re.S)
    signer = hashlib.sha256(ssl.PEM_cert_to_DER_cert(block[0].decode("ascii"))).hexdigest()
    if signer != expected_signer.replace(":", "").lower():
        raise ValueError("Android upload certificate differs from the expected certificate")

    with tempfile.TemporaryDirectory(dir=destination.parent) as temp:
        output = Path(temp) / destination.name
        output.mkdir()
        for name in ("crazygames.zip", "itch.zip"):
            shutil.copy2(ROOT / "release" / name, output / name)
        shutil.copy2(bundle, output / "app-release.aab")
        with tarfile.open(output / "artifact.tar", "w") as pages:
            for entry in sorted((WEB / "dist").rglob("*")):
                if entry.is_file():
                    pages.add(entry, arcname=entry.relative_to(WEB / "dist"), recursive=False)
        subprocess.run([sys.executable, ROOT / "scripts/verify-release.py", output, "--commit", head], check=True)
        shutil.copy2(notes, output / notes.name)
        full_notes = ROOT / "store-assets" / f"patch-notes-{version}.md"
        if full_notes.is_file():
            shutil.copy2(full_notes, output / full_notes.name)
        manifest_path = output / "manifest.json"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        manifest["androidUploadCertificateSha256"] = signer
        manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
        output.rename(destination)
    print(f"Prepared release {version} in {destination}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("destination", type=Path)
    parser.add_argument("--signer-sha256", required=True, help="SHA-256 of the existing Android upload certificate")
    args = parser.parse_args()
    prepare(args.destination.resolve(), args.signer_sha256)
