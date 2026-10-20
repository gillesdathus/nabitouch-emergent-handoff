"""Run over SSH stdin on the intended Linux host. Metadata only; no writes or database access.

Never prints container environment values, database records, logs or webhook payloads.
This inventory is evidence for an operator review, NOT automatic deployment approval.
"""
import hashlib
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
from datetime import datetime, timezone
from urllib.parse import urlparse


def command(args):
    result = subprocess.run(args, capture_output=True, text=True, timeout=30)
    if result.returncode:
        raise RuntimeError("Read-only metadata command failed: " + args[0])
    return result.stdout


def audit():
    disk = shutil.disk_usage("/")
    mem = dict(line.split(":", 1) for line in Path("/proc/meminfo").read_text().splitlines())
    report = {
        "observedAtUtc": datetime.now(timezone.utc).isoformat(),
        "hostname": socket.gethostname(), "cpus": os.cpu_count(), "loadAverage": os.getloadavg(),
        "availableMemoryMiB": int(mem["MemAvailable"].split()[0]) // 1024,
        "swapMiB": int(mem["SwapTotal"].split()[0]) // 1024,
        "diskFreeGiB": round(disk.free / 1024**3, 1),
    }
    rows = [json.loads(line) for line in command(["docker", "ps", "--format", "{{json .}}"]).splitlines()]
    report["runningContainerCount"] = len(rows)
    report["nabitouchContainers"] = []
    for row in rows:
        if not row["Names"].startswith(("nt-next-", "nabitouch_", "nabitouch-staging-")):
            continue
        detail = json.loads(command(["docker", "inspect", row["Names"]]))[0]
        env = dict(item.split("=", 1) for item in detail["Config"].get("Env", []) if "=" in item)
        report["nabitouchContainers"].append({
            "name": row["Names"], "id": detail["Id"], "imageId": detail["Image"],
            "startedAt": detail["State"]["StartedAt"], "status": row["Status"],
            "ports": detail["NetworkSettings"].get("Ports"),
            "networks": list(detail["NetworkSettings"]["Networks"]),
            "mounts": [{k: m.get(k) for k in ("Type", "Name", "Source", "Destination", "RW")} for m in detail["Mounts"]],
            "applicationEnvironment": env.get("APP_ENV"), "databaseName": env.get("DB_NAME"),
            "mongoHost": urlparse(env.get("MONGO_URL", "")).hostname,
            "resendSigningSecretConfigured": bool(env.get("RESEND_WEBHOOK_SECRET")),
        })
    nginx = subprocess.run(["nginx", "-T"], capture_output=True, text=True, timeout=30)
    report["nginxConfigurationValid"] = nginx.returncode == 0
    report["nginxConfigurationSha256"] = hashlib.sha256(nginx.stdout.encode()).hexdigest()
    report["nabitouchHostnamesInNginx"] = [line.strip() for line in nginx.stdout.splitlines()
        if line.strip().startswith("server_name ") and "nabitouch.com" in line]
    report["stagingDns"] = {}
    for host in ("staging.nabitouch.com", "api-staging.nabitouch.com"):
        try:
            report["stagingDns"][host] = sorted({item[4][0] for item in socket.getaddrinfo(host, 443)})
        except socket.gaierror:
            report["stagingDns"][host] = []
    report["stagingPortListening"] = any(line.split()[3].rsplit(":", 1)[-1] == "18081"
        for line in command(["ss", "-H", "-ltn"]).splitlines())
    report["stagingDirectoriesExist"] = {p: Path(p).exists() for p in ("/opt/nabitouch-staging", "/etc/nabitouch-staging")}
    report["backupDirectoriesExist"] = {p: Path(p).exists() for p in ("/opt/backups", "/root/backups", "/var/backups/nabitouch")}
    report["productionCredentialPermissions"] = []
    for name in ("/opt/nt-next/backend", "/opt/nt-next/backend/.env", "/opt/nt-next/backend/.nt-m1.env"):
        p = Path(name)
        if p.exists():
            st = p.stat()
            mode = st.st_mode & 0o777
            report["productionCredentialPermissions"].append({
                "path": name, "mode": oct(mode), "uid": st.st_uid, "gid": st.st_gid,
                "worldWritable": bool(mode & 0o002),
                "worldReadableSecretFile": p.is_file() and bool(mode & 0o004),
            })
    # Existence does not verify backup ownership, contents, encryption or restoration.
    return report


if __name__ == "__main__":
    print(json.dumps(audit(), indent=2))
