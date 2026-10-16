"""Render the exact fixed test message locally. No environment files or provider requests."""
import hashlib
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from email_templates import email_test_message
from emailer import _assert_safe_email, plain_email


def main():
    subject, html = email_test_message()
    _assert_safe_email(subject, html)
    output = ROOT / "test_reports"
    output.mkdir(exist_ok=True)
    candidate = output / "resend-test-preview.html"
    previous = output / "resend-test-preview-before-correction.html"
    if candidate.exists() and candidate.read_bytes() != html.encode("utf-8"):
        if not previous.exists():
            previous.write_bytes(candidate.read_bytes())
    candidate.write_bytes(html.encode("utf-8"))
    (output / "resend-test-preview.txt").write_bytes(plain_email(html).encode("utf-8"))
    manifest = {
        "subject": subject, "sender": "Nabitouch <bookings@nabitouch.com>",
        "recipient": "info@nabitouch.com", "approval": "NOT APPROVED", "sent": False,
        "htmlSha256": hashlib.sha256(candidate.read_bytes()).hexdigest(),
        "html": candidate.name, "plainText": "resend-test-preview.txt",
    }
    (output / "resend-test-preview.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(json.dumps(manifest))


if __name__ == "__main__":
    main()
