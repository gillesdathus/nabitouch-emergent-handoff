"""Quarantine decision for uploaded insurance and clinical files."""
import os
import socket


class ScannerUnavailable(Exception):
    pass


def signature_ok(data):
    blob = bytes(data or b"")
    return blob.startswith(b"%PDF") or blob.startswith(b"\xff\xd8\xff") or blob.startswith(b"\x89PNG\r\n\x1a\n")


def clamav_instream(data, host, port, timeout=3):
    """Return True when clamd reports the stream is clean. Connection failure stays in quarantine."""
    try:
        with socket.create_connection((host, int(port)), timeout=timeout) as sock:
            sock.sendall(b"zINSTREAM\0")
            view = memoryview(bytes(data))
            for start in range(0, len(view), 65536):
                part = view[start:start + 65536]
                sock.sendall(len(part).to_bytes(4, "big") + part.tobytes())
            sock.sendall((0).to_bytes(4, "big"))
            reply = b""
            while b"\0" not in reply and len(reply) < 256:
                piece = sock.recv(256)
                if not piece:
                    break
                reply += piece
    except OSError as exc:
        raise ScannerUnavailable("scanner unreachable") from exc
    text = reply.split(b"\0", 1)[0].decode("utf-8", "replace").strip()
    if text.endswith("OK"):
        return True
    if "FOUND" in text:
        return False
    raise ScannerUnavailable("scanner reply was not understood")


def assess(data):
    """Return signature-checked, clean, infected, or rejected. Raise ScannerUnavailable when clamd is down."""
    if not signature_ok(data):
        return "rejected"
    host = (os.environ.get("CLAMAV_HOST") or "").strip()
    if not host:
        return "signature-checked"
    port = os.environ.get("CLAMAV_PORT") or "3310"
    if clamav_instream(data, host, port):
        return "clean"
    return "infected"
