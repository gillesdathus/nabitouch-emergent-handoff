#!/usr/bin/env python3
from pathlib import Path

assets = Path("/var/www/nabitouch-next/assets")
q = chr(34) + "cpr" + chr(34)
for path in sorted(assets.glob("Credentials-*.js")):
    text = path.read_text(encoding="utf-8", errors="ignore")
    print("OWNER", path.name, "CPR_LABEL", "CPR / First Aid" in text, "QUOTED_CPR", q in text)
hits = []
for path in assets.glob("*.js"):
    text = path.read_text(encoding="utf-8", errors="ignore")
    if "CPR / First Aid" in text and q in text:
        hits.append(path.name)
    if "pr-cred-kind" in text:
        print("PR_KIND", path.name, "CPR", "CPR / First Aid" in text, "QUOTED_CPR", q in text)
print("CPR_CHUNKS", hits)
