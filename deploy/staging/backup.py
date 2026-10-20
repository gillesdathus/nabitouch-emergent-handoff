"""Encrypted backup of the dedicated synthetic staging database only. No production access.

Run as root on the staging host. Keys stay in a separate private recovery directory.
No archive retention deletion, production restore or notification operation exists here.
"""
import hashlib
import json
import os
from pathlib import Path
import secrets
import stat
import re
import subprocess
from datetime import datetime, timezone
from urllib.parse import urlparse

BASE = Path("/etc/nabitouch-staging")
CONTAINER = "nabitouch-staging-mongo-1"


def run(args, *, data=None, timeout=120):
    result = subprocess.run(args, input=data, capture_output=True, timeout=timeout)
    if result.returncode:
        # Utility errors can include URIs. Deliberately do not log either stream.
        raise RuntimeError("Staging backup command failed: " + args[0])
    return result.stdout


def main():
    if os.geteuid() != 0:
        raise RuntimeError("Requires root for staging-only secret custody")
    os.umask(0o077)
    api = {}
    for line in (BASE / "api.env").read_text().splitlines():
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1); api[k] = v
    uri = urlparse(api.get("MONGO_URL", ""))
    if api.get("DB_NAME") != "nabitouch_staging" or uri.hostname != "mongo" or uri.path != "/nabitouch_staging":
        raise RuntimeError("Refusing non-staging Mongo destination")
    compose = dict(line.split("=", 1) for line in (BASE / "compose.env").read_text().splitlines()
                   if line and not line.startswith("#") and "=" in line)
    image = compose.get("STAGING_API_IMAGE", "")
    if not re.fullmatch(r"nabitouch-staging-api:[a-f0-9]{7,40}", image):
        raise RuntimeError("Refusing an unversioned or non-staging encryption image")
    container = json.loads(run(["docker", "inspect", CONTAINER]))[0]
    if container["Config"].get("Labels", {}).get("com.docker.compose.project") != "nabitouch-staging":
        raise RuntimeError("Refusing non-staging container")
    networks = set(container["NetworkSettings"]["Networks"])
    if networks != {"nabitouch-staging_data"}:
        raise RuntimeError("Unexpected database network attachment")
    if not any(m.get("Name") == "nabitouch-staging_staging-mongo" and m["Destination"] == "/data/db" for m in container["Mounts"]):
        raise RuntimeError("Unexpected database volume")
    backups = BASE / "backups"; backups.mkdir(mode=0o700, exist_ok=True)
    recovery = BASE / "recovery"; recovery.mkdir(mode=0o700, exist_ok=True)
    key = recovery / "backup-aes256.key"
    if not key.exists():
        with key.open("xb") as handle: handle.write(secrets.token_bytes(32))
    if key.is_symlink() or key.stat().st_size != 32 or stat.S_IMODE(key.stat().st_mode) != 0o600:
        raise RuntimeError("Invalid backup-key custody")
    field_key = recovery / "field-encryption-key"
    if not field_key.exists():
        with field_key.open("x") as handle: handle.write(api["FIELD_ENCRYPTION_KEY"])
    if field_key.read_text() != api["FIELD_ENCRYPTION_KEY"]:
        raise RuntimeError("Field-key rotation requires recovery review")
    stem = "synthetic-staging-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ-") + secrets.token_hex(4)
    config = "/tmp/" + stem + ".json"
    archive = "/tmp/" + stem + ".archive.gz"
    plain = backups / (stem + ".archive.gz")
    encrypted = backups / (stem + ".aes256gcm")
    try:
        # Generated filenames have no shell metacharacters; credentials are only stdin/file data.
        run(["docker", "exec", "-i", CONTAINER, "sh", "-c", "umask 077; cat > " + config], data=json.dumps({"uri": api["MONGO_URL"]}).encode())
        run(["docker", "exec", CONTAINER, "mongodump", "--config", config, "--db", "nabitouch_staging", "--archive=" + archive, "--gzip", "--quiet"])
        run(["docker", "cp", CONTAINER + ":" + archive, str(plain)])
        os.chmod(plain, 0o600)
        code = (
            "from pathlib import Path;import os;from cryptography.hazmat.primitives.ciphers.aead import AESGCM;"
            "os.umask(0o077);n=os.urandom(12);"
            f"p=Path('/backup/{plain.name}');"
            f"Path('/backup/{encrypted.name}').write_bytes(b'NBSTAGE1'+n+AESGCM(Path('/recovery/key').read_bytes()).encrypt(n,p.read_bytes(),b'NBSTAGE1'))"
        )
        run(["docker", "run", "--rm", "--network", "none", "--mount", f"type=bind,source={backups},target=/backup",
             "--mount", f"type=bind,source={key},target=/recovery/key,readonly", "--entrypoint", "python",
             image, "-c", code])
        digest = hashlib.sha256(encrypted.read_bytes()).hexdigest()
        manifest = {"archive": str(encrypted), "sha256": digest, "sourceDatabase": "nabitouch_staging",
                    "syntheticOnly": True, "encryption": "AES-256-GCM", "restoreVerified": False}
        (backups / (stem + ".manifest.json")).write_text(json.dumps(manifest, indent=2))
        # Only this run's temporary plaintext. Never remove databases, volumes or old backups.
        if plain.resolve().parent != backups.resolve():
            raise RuntimeError("Temporary archive path escaped staging")
        plain.unlink()
        print(json.dumps(manifest))
    finally:
        run(["docker", "exec", CONTAINER, "rm", "-f", "--", config, archive])


if __name__ == "__main__":
    main()
