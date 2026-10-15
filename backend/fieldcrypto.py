"""Field encryption for clinical and insurance values.

The key lives only in FIELD_ENCRYPTION_KEY (32 bytes, url-safe base64).
A previous key in FIELD_ENCRYPTION_KEY_PREVIOUS can still decrypt during rotation.
Neither key is stored in MongoDB or the repository.
"""
import base64
import os

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

PREFIX = "ntenc1:"
_FIELD_AAD = b"nabitouch-field"
_FILE_AAD = b"nabitouch-file"
CLEAR_KEYS = {
    "id", "appointmentId", "clientId", "practitionerId", "status", "updatedAt",
    "signedAt", "signedBy", "version", "at", "authorId", "authorName",
}


def _decode_key(raw):
    if not raw:
        return None
    try:
        key = base64.urlsafe_b64decode(raw)
    except Exception as exc:
        raise RuntimeError("FIELD_ENCRYPTION_KEY is not valid base64") from exc
    if len(key) != 32:
        raise RuntimeError("FIELD_ENCRYPTION_KEY must decode to 32 bytes")
    return key


def current_key():
    return _decode_key(os.environ.get("FIELD_ENCRYPTION_KEY") or "")


def _keys():
    keys = []
    current = current_key()
    if current:
        keys.append(current)
    previous = _decode_key(os.environ.get("FIELD_ENCRYPTION_KEY_PREVIOUS") or "")
    if previous:
        keys.append(previous)
    return keys


def seal(value):
    if not isinstance(value, str) or value == "" or value.startswith(PREFIX):
        return value
    key = current_key()
    if not key:
        return value
    nonce = os.urandom(12)
    token = nonce + AESGCM(key).encrypt(nonce, value.encode(), _FIELD_AAD)
    return PREFIX + base64.urlsafe_b64encode(token).decode()


def open_text(value):
    if not isinstance(value, str) or not value.startswith(PREFIX):
        return value
    keys = _keys()
    if not keys:
        raise RuntimeError("Encrypted field cannot be read without FIELD_ENCRYPTION_KEY")
    raw = base64.urlsafe_b64decode(value[len(PREFIX):])
    nonce, token = raw[:12], raw[12:]
    for key in keys:
        try:
            return AESGCM(key).decrypt(nonce, token, _FIELD_AAD).decode()
        except Exception:
            continue
    raise RuntimeError("Encrypted field could not be opened")


def seal_tree(value):
    if isinstance(value, str):
        return seal(value)
    if isinstance(value, list):
        return [seal_tree(item) for item in value]
    if isinstance(value, dict):
        return {key: item if key in CLEAR_KEYS else seal_tree(item) for key, item in value.items()}
    return value


def open_tree(value):
    if isinstance(value, str):
        return open_text(value)
    if isinstance(value, list):
        return [open_tree(item) for item in value]
    if isinstance(value, dict):
        return {key: item if key in CLEAR_KEYS else open_tree(item) for key, item in value.items()}
    return value


def seal_insurance(items):
    sealed = []
    for item in items or []:
        if not isinstance(item, dict):
            continue
        copy = dict(item)
        for key in ("memberId", "policy"):
            if key in copy and isinstance(copy[key], str):
                copy[key] = seal(copy[key])
        sealed.append(copy)
    return sealed


def open_insurance(items):
    opened = []
    for item in items or []:
        if not isinstance(item, dict):
            continue
        copy = dict(item)
        for key in ("memberId", "policy"):
            if key in copy:
                copy[key] = open_text(copy[key])
        opened.append(copy)
    return opened


def seal_bytes(data):
    blob = bytes(data or b"")
    if blob.startswith(PREFIX.encode()) or not current_key():
        return blob
    nonce = os.urandom(12)
    token = nonce + AESGCM(current_key()).encrypt(nonce, blob, _FILE_AAD)
    return PREFIX.encode() + base64.urlsafe_b64encode(token)


def open_bytes(data):
    blob = bytes(data or b"")
    marker = PREFIX.encode()
    if not blob.startswith(marker):
        return blob
    keys = _keys()
    if not keys:
        raise RuntimeError("Encrypted file cannot be read without FIELD_ENCRYPTION_KEY")
    raw = base64.urlsafe_b64decode(blob[len(marker):])
    nonce, token = raw[:12], raw[12:]
    for key in keys:
        try:
            return AESGCM(key).decrypt(nonce, token, _FILE_AAD)
        except Exception:
            continue
    raise RuntimeError("Encrypted file could not be opened")
