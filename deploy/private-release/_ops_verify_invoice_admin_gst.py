#!/usr/bin/env python3
"""Post-deploy verification for invoice admin + optional GST hotfix."""
import json
import pathlib
import re
import subprocess
import sys
import urllib.request

ROOT = pathlib.Path("/var/www/nabitouch-next")
OPENAPI = pathlib.Path("/tmp/openapi-invoice.json")


def main():
    urllib.request.urlretrieve("http://127.0.0.1:8011/openapi.json", OPENAPI)
    paths = json.load(OPENAPI.open(encoding="utf-8"))["paths"]
    need = (
        "/api/invoices/{iid}",
        "/api/invoices/{iid}/void",
        "/api/invoices/{iid}/waive",
        "/api/invoices/{iid}/adjustments",
    )
    for path in need:
        if path not in paths:
            raise SystemExit(f"missing openapi path: {path}")
    methods = paths["/api/invoices/{iid}"]
    if "patch" not in methods or "delete" not in methods:
        raise SystemExit(f"draft edit/discard methods missing: {sorted(methods)}")
    if "post" not in paths["/api/invoices/{iid}/void"]:
        raise SystemExit("void route missing")
    if "post" not in paths["/api/invoices/{iid}/waive"]:
        raise SystemExit("waive route missing")
    print("openapi-invoice-admin-ok")

    index = (ROOT / "index.html").read_text(encoding="utf-8")
    match = re.search(r"/assets/index-[^\"' ]+\.js", index)
    if not match:
        raise SystemExit("bundle missing from index.html")
    bundle = match.group(0)
    print("bundle=" + bundle)

    markers = ("staff-void-open", "staff-waive-open", "staff-discard-draft", "Charge GST", "inv-charge-gst")
    found = {m: False for m in markers}
    for path in (ROOT / "assets").glob("*.js"):
        text = path.read_text(encoding="utf-8", errors="ignore")
        for marker in markers:
            if marker in text:
                found[marker] = True
    missing = [m for m, ok in found.items() if not ok]
    if missing:
        raise SystemExit(f"frontend markers missing: {missing}")
    print("markers-ok")

    label = subprocess.check_output(
        ["docker", "inspect", "nt-next-api", "--format", "{{index .Config.Labels \"nabitouch.source_sha\"}} {{index .Config.Labels \"nabitouch.hotfix\"}}"],
        text=True,
    ).strip()
    print("api-labels=" + label)
    if "e3efd28191b06c09505365a4a57166ea3e4a3f79" not in label and "e3efd28" not in label:
        # full sha preferred; accept short if docker truncates somehow
        raise SystemExit(f"unexpected api source label: {label}")
    if "invoice-admin-gst" not in label:
        raise SystemExit(f"unexpected hotfix label: {label}")

    with urllib.request.urlopen("https://nabitouch.com/api/health", timeout=15) as resp:
        health = json.load(resp)
    assert health.get("mongo") == "ok" and health.get("documentUploads") is False
    print("public-health-ok", health.get("status"))
    print("VERIFY_OK")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"VERIFY_FAIL: {exc}", file=sys.stderr)
        raise
