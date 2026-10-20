#!/usr/bin/env python3
"""AES-256-GCM stream encrypt/decrypt for Gate A (OpenSSL enc no longer supports AEAD).

Format (compatible intent with Stage C ciphertext files):
  magic (8) = b'NTA1GCM1'
  salt (16)
  nonce (12)
  ciphertext+tag (rest)  # AESGCM.encrypt output
Key = PBKDF2-HMAC-SHA256(passphrase, salt, 200000, 32)
"""
from __future__ import annotations

import argparse
import os
import sys
from hashlib import pbkdf2_hmac

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

MAGIC = b"NTA1GCM1"
ITERATIONS = 200000


def derive(passphrase: str, salt: bytes) -> bytes:
    return pbkdf2_hmac("sha256", passphrase.encode("utf-8"), salt, ITERATIONS, dklen=32)


def encrypt(passphrase: str, plain: bytes) -> bytes:
    salt = os.urandom(16)
    nonce = os.urandom(12)
    key = derive(passphrase, salt)
    body = AESGCM(key).encrypt(nonce, plain, None)
    return MAGIC + salt + nonce + body


def decrypt(passphrase: str, blob: bytes) -> bytes:
    if not blob.startswith(MAGIC):
        raise SystemExit("Refusing: ciphertext magic mismatch")
    salt = blob[8:24]
    nonce = blob[24:36]
    body = blob[36:]
    key = derive(passphrase, salt)
    return AESGCM(key).decrypt(nonce, body, None)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=("encrypt", "decrypt"))
    parser.add_argument("--in", dest="inp", required=True)
    parser.add_argument("--out", dest="out", required=True)
    args = parser.parse_args()
    passphrase = os.environ.get("BACKUP_PASSPHRASE") or ""
    if not passphrase:
        raise SystemExit("Refusing: BACKUP_PASSPHRASE empty")
    data = open(args.inp, "rb").read()
    if args.mode == "encrypt":
        out = encrypt(passphrase, data)
    else:
        out = decrypt(passphrase, data)
    with open(args.out, "wb") as handle:
        handle.write(out)
    os.chmod(args.out, 0o600)


if __name__ == "__main__":
    main()
