"""TOTP (RFC 6238) using the standard library. Codes are six digits and change every 30 seconds."""
import hashlib
import hmac
import struct
import time
import base64


def _key(secret):
    padded = secret.strip().upper()
    padded += "=" * ((8 - len(padded) % 8) % 8)
    return base64.b32decode(padded, casefold=True)


def totp(secret, for_time=None, step=30, digits=6):
    counter = int((time.time() if for_time is None else for_time) // step)
    digest = hmac.new(_key(secret), struct.pack(">Q", counter), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    binary = struct.unpack(">I", digest[offset:offset + 4])[0] & 0x7FFFFFFF
    return str(binary % (10 ** digits)).zfill(digits)


def matching_counter(secret, code, window=1):
    cleaned = "".join(ch for ch in str(code or "") if ch.isdigit())
    if len(cleaned) != 6:
        return None
    now = int(time.time() // 30)
    for offset in range(-window, window + 1):
        candidate = now + offset
        if hmac.compare_digest(totp(secret, for_time=candidate * 30), cleaned):
            return candidate
    return None
