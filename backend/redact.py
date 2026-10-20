"""Strip precise coordinates and tracking secrets from log records."""
import logging
import re

_COORD = re.compile(r'("(?:lat|lng|latitude|longitude)"\s*:\s*)-?\d+(?:\.\d+)?', re.IGNORECASE)
_SECRET = re.compile(r'((?:token|nt_track|capability)["\s:=]+)[A-Za-z0-9_\-]{12,}', re.IGNORECASE)
_MAPBOX_URL = re.compile(r'https://api\.mapbox\.com/[^\s"\'<>]+', re.IGNORECASE)


class RedactLogFilter(logging.Filter):
    def filter(self, record):
        if record.name == "uvicorn.access":
            return True
        if record.args:
            record.msg = record.getMessage()
            record.args = ()
        if isinstance(record.msg, str):
            record.msg = _MAPBOX_URL.sub("https://api.mapbox.com/[redacted]", record.msg)
            record.msg = _SECRET.sub(r"\1[redacted]", _COORD.sub(r"\1[redacted]", record.msg))
        return True


class AccessPathRedact(logging.Filter):
    """Uvicorn access lines must not keep a guest capability that was placed in a path."""

    def filter(self, record):
        args = record.args
        if isinstance(args, tuple) and len(args) >= 3 and isinstance(args[2], str) and args[2].startswith("/api/geo/"):
            redacted = list(args)
            redacted[2] = args[2].split("?", 1)[0]
            record.args = tuple(redacted)
            return True
        if isinstance(args, tuple) and len(args) >= 3 and isinstance(args[2], str) and "/tracking/guest/" in args[2]:
            path = args[2].split("?", 1)[0]
            if path.rstrip("/").endswith("/guest") or path.rstrip("/").endswith("/guest/open") or path.rstrip("/").endswith("/guest/session") or path.rstrip("/").endswith("/guest/stream"):
                return True
            redacted = list(args)
            redacted[2] = "/api/tracking/guest/[redacted]"
            record.args = tuple(redacted)
        return True
