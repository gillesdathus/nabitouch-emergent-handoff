"""CSRF helpers for cookie sessions. Kept import-light for unit tests."""
import os

import jwt

ALG = "HS256"


def session_payload_from_cookies(request):
    """Decode access or refresh. Invalid access must not prevent trying refresh."""
    for candidate in (request.cookies.get("access_token"), request.cookies.get("refresh_token")):
        if not candidate:
            continue
        try:
            return jwt.decode(candidate, os.environ["JWT_SECRET"], algorithms=[ALG])
        except jwt.ExpiredSignatureError:
            continue
        except jwt.InvalidTokenError:
            continue
    return None


def session_gone_response():
    from auth import clear_auth_cookies
    from starlette.responses import JSONResponse
    response = JSONResponse({"detail": "Session expired"}, status_code=401)
    clear_auth_cookies(response)
    return response
