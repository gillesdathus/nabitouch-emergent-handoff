"""Redacted repository checks; no credential values or file contents are printed."""
import importlib.util
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]


def git(*args):
    return subprocess.check_output(["git", *args], cwd=ROOT, text=True).splitlines()


def main():
    names = git("ls-files")
    sensitive = re.compile(r"(^|/)(\.env(?:\..*)?|test_credentials\.md|google-services\.json|GoogleService-Info\.plist)$|\.(pem|key|p12|pfx|archive|gz)$|service-account.*\.json$|firebase-admin.*\.json$")
    forbidden = [name for name in names if sensitive.search(name) and not name.endswith(".example")]
    if forbidden:
        raise SystemExit(f"FAIL: {len(forbidden)} tracked secret/data files (values withheld)")
    spec = importlib.util.spec_from_file_location("production_validator", ROOT / "deploy/validate-production-secrets.py")
    validator = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(validator)
    if not validator.git_is_clean(str(ROOT)):
        raise SystemExit("FAIL: production secret-file/content exclusions")
    # Scanner patterns intentionally avoid printing matching content.
    pattern = r"sk_(live|test)_[A-Za-z0-9]{20,}|rk_(live|test)_[A-Za-z0-9]{20,}|AIza[A-Za-z0-9_-]{30,}|-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----"
    matches = 0
    revisions = git("rev-list", "--all")
    for revision in revisions:
        result = subprocess.run(["git", "grep", "-I", "-l", "-E", pattern, revision, "--"], cwd=ROOT, text=True, capture_output=True)
        if result.returncode not in (0, 1):
            raise SystemExit("FAIL: history scan could not complete")
        matches += len(result.stdout.splitlines())
    if matches:
        raise SystemExit(f"FAIL: {matches} possible credential-bearing revision/file pairs; inspect securely")
    history = git("log", "--all", "--format=%H", "--", "_milestone1_preserved/memory/test_credentials.md")
    print(f"PASS: tracked secret-file exclusions and limited token history scan ({len(revisions)} revisions)")
    if history:
        print(f"WARNING: historical credential document exposure remains in {len(history)} commits; reused credentials need rotation review. History was not rewritten.")


if __name__ == "__main__":
    main()
