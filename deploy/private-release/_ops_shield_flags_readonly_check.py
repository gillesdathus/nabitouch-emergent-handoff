#!/usr/bin/env python3
"""Read-only Security Shield flag check (Slice H).

Asserts production health reports Shield features off/unset.
Does not flip flags, deploy, or mutate data.

Usage (from an ops host with loopback access):
  python3 deploy/private-release/_ops_shield_flags_readonly_check.py
  PROD_HEALTH_URL=http://127.0.0.1:8011/api/health python3 ...
"""
from __future__ import annotations

import json
import os
import sys
import urllib.request

PROD_URL = os.environ.get("PROD_HEALTH_URL", "http://127.0.0.1:8011/api/health")
KEYS = (
    "securityShieldFleet",
    "securityShieldDocs",
    "securityShieldArrivalCode",
    "securityShieldExpiryEnforcement",
    "securityShieldSafetySampling",
    "documentUploads",
)


def main() -> int:
    with urllib.request.urlopen(PROD_URL, timeout=15) as resp:
        body = json.loads(resp.read().decode())
    for key in KEYS:
        value = body.get(key)
        print(f"prod_{key}={value}")
        if value not in (False, None):
            print(f"FAIL: {key} must be false/unset on production", file=sys.stderr)
            return 1
    print("PROD_SHIELD_OFF_OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
