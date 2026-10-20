"""Email/password JWT auth (httpOnly cookies, Bearer fallback). Roles: client, practitioner, owner, desk."""
import os
import uuid
import hashlib
import secrets
import base64
from html import escape
from datetime import datetime, timezone, timedelta
from urllib.parse import quote
from typing import Optional

import bcrypt
import jwt
from fastapi import APIRouter, Body, HTTPException, Request, Response
from pydantic import BaseModel, EmailStr, Field

from emailer import send_email
from devices import revoke_devices
from rbac import (
    effective_roles, has_role, has_strict_role, is_sysadmin, normalize_roles,
    primary_role, require_roles, workspaces_for, STAFF_ROLES,
)

ALG = "HS256"


def blocks_demo_account(user, production):
    """Production refuses leftover demo rows. Preview still allows them when DEMO_MODE is on."""
    return bool(production and user and user.get("demo") is True)
ACCESS_MIN, REFRESH_DAYS, MAX_FAILS, LOCK_MIN = 15, 7, 5, 15
NATIVE_REFRESH_DAYS = 30
NATIVE_HEADER = "x-nabitouch-client"
RESET_MIN, RESET_MAX_PER_WINDOW = 30, 3
MFA_REPLACE_PENDING_MIN = 15


def hash_pw(p):
    return bcrypt.hashpw(p.encode(), bcrypt.gensalt()).decode()


def check_pw(p, h):
    return bcrypt.checkpw(p.encode(), h.encode())


_TIMING_HASH = None


def timing_hash():
    global _TIMING_HASH
    if _TIMING_HASH is None:
        _TIMING_HASH = hash_pw("timing-equalizer")
    return _TIMING_HASH


def preview_local_reset():
    """A local preview does not deliver mail, so the reset finishes in the browser."""
    from config import email_provider, is_production
    return (not is_production()) and email_provider() in ("mock", "disabled")


def provisioning_uri(email, secret):
    """Standard TOTP link. SHA1, 6 digits, and 30 seconds match totp.py."""
    issuer = quote("Nabitouch", safe="")
    account = quote(str(email), safe="")
    return f"otpauth://totp/{issuer}:{account}?secret={secret}&issuer={issuer}&algorithm=SHA1&digits=6&period=30"


def token(uid, kind, sid, jti=None, native=False):
    exp = datetime.now(timezone.utc) + (timedelta(minutes=ACCESS_MIN) if kind == "access" else timedelta(days=NATIVE_REFRESH_DAYS if native else REFRESH_DAYS))
    payload = {"sub": uid, "type": kind, "sid": sid, "exp": exp}
    if jti:
        payload["jti"] = jti
    if native:
        payload["cl"] = "native"
    return jwt.encode(payload, os.environ["JWT_SECRET"], algorithm=ALG)


def _cookie_flags():
    from config import cookie_samesite, cookie_secure
    return cookie_secure(), cookie_samesite()


def write_auth_cookies(resp: Response, access, refresh, csrf):
    secure, samesite = _cookie_flags()
    resp.set_cookie("access_token", access, httponly=True, secure=secure, samesite=samesite, max_age=ACCESS_MIN * 60, path="/")
    resp.set_cookie("refresh_token", refresh, httponly=True, secure=secure, samesite=samesite, max_age=REFRESH_DAYS * 86400, path="/")
    resp.set_cookie("csrf_token", csrf, httponly=False, secure=secure, samesite=samesite, max_age=REFRESH_DAYS * 86400, path="/")


def clear_auth_cookies(resp: Response):
    secure, samesite = _cookie_flags()
    for name in ("access_token", "refresh_token", "csrf_token"):
        resp.delete_cookie(name, path="/", secure=secure, samesite=samesite)


def public(u):
    roles = normalize_roles(u.get("roles"), u.get("role"))
    body = {k: u.get(k) for k in ("id", "email", "name", "role", "subject", "preferredWorkspace", "status")}
    body["roles"] = roles
    body["role"] = u.get("role") or primary_role(roles)
    if is_sysadmin(u):
        body["capabilities"] = ["sysadmin"]
    return body


async def present(u, coll):
    """Session profile. Workspaces are presentation context derived from authorized roles."""
    body = public(u)
    spaces = workspaces_for(u)
    # Confirm practitioner subject still exists before offering that workspace.
    if "practitioner" in spaces and body.get("subject"):
        person = await coll("practitioners").find_one({"id": body["subject"]}, {"_id": 0, "id": 1})
        if not person:
            spaces = [s for s in spaces if s != "practitioner"]
    elif "practitioner" in spaces and not body.get("subject"):
        spaces = [s for s in spaces if s != "practitioner"]
    body["workspaces"] = spaces
    return body


class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8)
    firstName: str
    lastName: str
    phone: str = ""
    dob: str = ""
    marketingConsent: bool = False
    smsConsent: bool = False
    profile: dict = {}


class ForgotIn(BaseModel):
    email: EmailStr


class ResetIn(BaseModel):
    token: str
    password: str = Field(min_length=8)


def reset_email_html(name, link):
    """Email-safe password-reset body. Usable without images; shell branding comes from emailtpl.wrap."""
    brand = escape(os.environ.get("EMAIL_FROM_NAME") or "Nabitouch")
    safe_link = escape(link, quote=True)
    safe_link_text = escape(link)
    return (
        f'<p style="margin:0 0 16px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#0F2A3D">Hi {escape(name)},</p>'
        f'<p style="margin:0 0 16px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#0F2A3D">'
        f'We received a request to reset the password for your {brand} account. '
        f'This link works once and expires in {RESET_MIN} minutes.</p>'
        # Bulletproof table button (Outlook + Apple Mail).
        '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0">'
        '<tr><td align="center" bgcolor="#18A8F5" style="background-color:#18A8F5;border-radius:8px">'
        f'<a href="{safe_link}" style="display:inline-block;padding:14px 28px;font-family:Arial,Helvetica,sans-serif;'
        f'font-size:16px;font-weight:bold;color:#ffffff;text-decoration:none">Choose a new password</a>'
        '</td></tr></table>'
        '<p style="margin:0 0 8px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.55;color:#0F2A3D">'
        'If the button does not work, copy and paste this link into your browser:</p>'
        f'<p style="margin:0 0 20px;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.5;color:#0E5E8C;word-break:break-all">'
        f'{safe_link_text}</p>'
        '<p style="margin:0 0 16px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#0F2A3D">'
        'If you did not request this, you can ignore this email and your password will stay the same.</p>'
        f'<p style="margin:24px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;color:#6B8296">'
        f'Sent by {brand}. We never ask for your password or card details by email.</p>'
    )


class StaffIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8)
    name: str
    role: str
    roles: Optional[list] = None
    practitionerId: Optional[str] = None


class InviteIn(BaseModel):
    email: EmailStr
    name: str = Field(min_length=2, max_length=80)
    role: str
    roles: Optional[list] = None
    phone: Optional[str] = None
    practitionerId: Optional[str] = None
    preferredWorkspace: Optional[str] = None


class WorkspaceIn(BaseModel):
    workspace: str


class StaffRolesIn(BaseModel):
    roles: list
    preferredWorkspace: Optional[str] = None
    status: Optional[str] = None
    practitionerId: Optional[str] = None


class InviteAccept(BaseModel):
    token: str = Field(min_length=20)
    password: str = Field(min_length=8)


def build_auth(db, coll, add_audit):
    users, attempts, resets, sessions = db["nt_users"], db["nt_login_attempts"], db["nt_password_resets"], db["nt_sessions"]
    r = APIRouter(prefix="/api/auth")

    async def live_session(sid):
        if not sid:
            return None
        row = await sessions.find_one({"sid": sid, "revoked": False}, {"_id": 0})
        if not row or row.get("expiresAt", "") < datetime.now(timezone.utc).isoformat():
            return None
        return row

    async def open_session(uid, mfa=False):
        sid, csrf, jti = secrets.token_urlsafe(24), secrets.token_urlsafe(24), secrets.token_urlsafe(16)
        now = datetime.now(timezone.utc)
        row = {"sid": sid, "userId": uid, "csrf": csrf, "refreshJti": jti, "revoked": False,
               "createdAt": now.isoformat(), "expiresAt": (now + timedelta(days=REFRESH_DAYS)).isoformat()}
        if mfa:
            row["mfaAt"] = now.isoformat()
        await sessions.insert_one(row)
        return sid, csrf, jti

    def apply_session(response, uid, sid, csrf, jti):
        write_auth_cookies(response, token(uid, "access", sid), token(uid, "refresh", sid, jti), csrf)

    async def user_from(request: Request) -> Optional[dict]:
        tok = request.cookies.get("access_token")
        h = request.headers.get("Authorization", "")
        if h.startswith("Bearer "):
            tok = h[7:]
        if not tok:
            return None
        try:
            p = jwt.decode(tok, os.environ["JWT_SECRET"], algorithms=[ALG])
        except jwt.InvalidTokenError:
            return None
        if p.get("aud") == "training":
            return None
        if p.get("cl") == "native" and not (h.startswith("Bearer ") and is_native(request)):
            return None
        row = await live_session(p.get("sid"))
        if row and bool(row.get("native")) != (p.get("cl") == "native"):
            return None
        if p.get("type") != "access" or not row:
            return None
        user = await users.find_one({"id": p["sub"]}, {"_id": 0, "password_hash": 0})
        from config import is_production
        if blocks_demo_account(user, is_production()):
            return None
        if user and set(effective_roles(user)) & set(STAFF_ROLES) and await mfa_enforcement() and not row.get("mfaAt"):
            return None
        if user:
            user["sid"] = p["sid"]
            # Keep roles normalized on the request-scoped user document.
            user["roles"] = normalize_roles(user.get("roles"), user.get("role"))
        return user

    async def require(request: Request, *roles) -> dict:
        u = await user_from(request)
        if not u:
            raise HTTPException(401, "Not authenticated")
        if roles:
            require_roles(u, *roles)
        return u

    async def seed():
        from config import demo_mode, is_production
        await users.create_index("email", unique=True)
        await attempts.create_index("identifier")
        await sessions.create_index("sid", unique=True)
        owner_email = os.environ["OWNER_EMAIL"].lower()
        if not await users.find_one({"email": owner_email}):
            owner_id = str(uuid.uuid4())
            if demo_mode():
                await users.insert_one({"id": owner_id, "email": owner_email, "password_hash": hash_pw(os.environ["OWNER_PASSWORD"]),
                                        "name": "Jordan Ellis (Owner)", "role": "owner", "subject": "p-jordan", "demo": False,
                                        "createdAt": datetime.now(timezone.utc).isoformat()})
            else:
                await users.insert_one({"id": owner_id, "email": owner_email, "password_hash": hash_pw(os.environ["OWNER_PASSWORD"]),
                                        "name": "Nabitouch Owner", "role": "owner", "subject": owner_id, "demo": False,
                                        "createdAt": datetime.now(timezone.utc).isoformat()})
        if is_production() or not demo_mode():
            return
        demo_pw = hash_pw(os.environ["DEMO_PASSWORD"])
        demos = [("sarah.demo@example.com", "Sarah Thompson", "client", "c-sarah"),
                 ("maya.demo@example.com", "Maya Chen", "practitioner", "p-maya"),
                 ("liam.demo@example.com", "Liam Fournier", "practitioner", "p-liam"),
                 ("priya.demo@example.com", "Priya Sandhu", "practitioner", "p-priya"),
                 ("reception.demo@example.com", "Reception (demo)", "desk", None)]
        for email, name, role, subject in demos:
            if not await users.find_one({"email": email}):
                await users.insert_one({"id": str(uuid.uuid4()), "email": email, "password_hash": demo_pw, "name": name, "role": role,
                                        "subject": subject, "demo": True, "createdAt": datetime.now(timezone.utc).isoformat()})

    def is_native(request):
        return request.headers.get(NATIVE_HEADER, "").strip().lower() == "native"

    async def password_user(body):
        email = str(body.get("email", "")).strip().lower()
        ident = f"email:{email}"
        rec = await attempts.find_one({"identifier": ident})
        if rec and rec.get("count", 0) >= MAX_FAILS and rec.get("lockedUntil", "") > datetime.now(timezone.utc).isoformat():
            raise HTTPException(429, "Too many attempts — try again in 15 minutes")
        u = await users.find_one({"email": email})
        from config import is_production
        if blocks_demo_account(u, is_production()):
            u = None
        hashed = u["password_hash"] if u else timing_hash()
        if not u or not check_pw(str(body.get("password", "")), hashed):
            cnt = (rec or {}).get("count", 0) + 1
            await attempts.update_one({"identifier": ident}, {"$set": {"count": cnt, "lockedUntil": (datetime.now(timezone.utc) + timedelta(minutes=LOCK_MIN)).isoformat()}}, upsert=True)
            raise HTTPException(401, "Invalid email or password")
        await attempts.delete_one({"identifier": ident})
        return u

    async def native_pair(u, mfa, device):
        sid, _csrf, jti = await open_session(u["id"], mfa=mfa)
        expires = (datetime.now(timezone.utc) + timedelta(days=NATIVE_REFRESH_DAYS)).isoformat()
        await sessions.update_one({"sid": sid}, {"$set": {"native": True, "device": str(device or "")[:60], "expiresAt": expires}})
        return {"accessToken": token(u["id"], "access", sid, native=True), "refreshToken": token(u["id"], "refresh", sid, jti, native=True),
                "tokenType": "Bearer", "expiresIn": ACCESS_MIN * 60, "user": await present(u, coll)}

    def require_native(request):
        if not is_native(request):
            raise HTTPException(400, "Native sign-in needs the X-Nabitouch-Client: native header")

    @r.post("/native/login")
    async def native_login(request: Request, body: dict = Body(...)):
        """Bearer session for the Capacitor app. Same password, lockout and MFA rules as the web sign-in."""
        require_native(request)
        u = await password_user(body)
        enrolled = await db["nt_mfa"].find_one({"userId": u["id"], "enabled": True})
        privileged = bool(set(effective_roles(u)) & set(STAFF_ROLES))
        if privileged and enrolled:
            return {"mfaRequired": True, "challenge": _challenge_for(u, "mfa-native")}
        if privileged and await mfa_enforcement():
            raise HTTPException(403, "Turn on your authenticator in the web app first, then sign in here")
        out = await native_pair(u, False, body.get("device"))
        await add_audit(u.get("name") or u["role"], "Native app signed in", None)
        return out

    @r.post("/native/mfa/verify")
    async def native_mfa(request: Request, body: dict = Body(...)):
        require_native(request)
        user = await verified_mfa_user(body, "mfa-native")
        out = await native_pair(user, True, body.get("device"))
        await add_audit(user.get("name") or user["role"], "Native app signed in with authenticator", None)
        return out

    def native_claim(raw, kind):
        try:
            p = jwt.decode(str(raw or ""), os.environ["JWT_SECRET"], algorithms=[ALG])
        except jwt.InvalidTokenError:
            raise HTTPException(401, "Session expired")
        if p.get("cl") != "native" or p.get("type") != kind or not p.get("sid"):
            raise HTTPException(401, "Session expired")
        return p

    @r.post("/native/refresh")
    async def native_refresh(request: Request, body: dict = Body(...)):
        """Rotating refresh. Reusing an old refresh token revokes the whole session."""
        require_native(request)
        p = native_claim(body.get("refreshToken"), "refresh")
        row = await live_session(p["sid"])
        if not row or not row.get("native") or row.get("userId") != p["sub"]:
            raise HTTPException(401, "Session expired")
        if row.get("refreshJti") != p.get("jti"):
            await sessions.update_one({"sid": p["sid"]}, {"$set": {"revoked": True, "revokedReason": "refresh_reuse"}})
            await revoke_devices(db, "refresh_reuse", session_id=p["sid"])
            raise HTTPException(401, "Session expired")
        account = await users.find_one({"id": p["sub"]}, {"_id": 0, "password_hash": 0})
        from config import is_production
        if not account or blocks_demo_account(account, is_production()):
            raise HTTPException(401, "Session expired")
        if bool(set(effective_roles(account)) & set(STAFF_ROLES)) and await mfa_enforcement() and not row.get("mfaAt"):
            raise HTTPException(401, "Sign in with your authenticator")
        jti = secrets.token_urlsafe(16)
        expires = (datetime.now(timezone.utc) + timedelta(days=NATIVE_REFRESH_DAYS)).isoformat()
        swapped = await sessions.update_one({"sid": p["sid"], "refreshJti": p["jti"]}, {"$set": {"refreshJti": jti, "expiresAt": expires}})
        if not swapped.modified_count:
            raise HTTPException(401, "Session expired")
        return {"accessToken": token(p["sub"], "access", p["sid"], native=True), "refreshToken": token(p["sub"], "refresh", p["sid"], jti, native=True),
                "tokenType": "Bearer", "expiresIn": ACCESS_MIN * 60}

    @r.post("/native/logout")
    async def native_logout(request: Request, body: dict = Body(default={})):
        require_native(request)
        raw = (body or {}).get("refreshToken") or request.headers.get("Authorization", "")[7:]
        try:
            p = jwt.decode(str(raw or ""), os.environ["JWT_SECRET"], algorithms=[ALG], options={"verify_exp": False})
            if p.get("cl") == "native":
                await sessions.update_one({"sid": p.get("sid"), "native": True}, {"$set": {"revoked": True}})
                await revoke_devices(db, "signed_out", session_id=p.get("sid"))
        except jwt.InvalidTokenError:
            pass
        return {"ok": True}

    @r.post("/login")
    async def login(request: Request, response: Response, body: dict = Body(...)):
        u = await password_user(body)
        enrolled = await db["nt_mfa"].find_one({"userId": u["id"], "enabled": True})
        privileged = bool(set(effective_roles(u)) & set(STAFF_ROLES))
        if privileged and (enrolled or await mfa_enforcement()):
            # A password check is not a session. Drop any previous cookies so the
            # authenticator request is not rejected as a stale cookie session.
            clear_auth_cookies(response)
        if privileged and enrolled:
            return {"mfaRequired": True, "challenge": _challenge_for(u, "mfa")}
        if privileged and await mfa_enforcement():
            return {"mfaRequired": True, "enrollmentRequired": True, "challenge": _challenge_for(u, "mfa-enroll")}
        sid, csrf, jti = await open_session(u["id"])
        apply_session(response, u["id"], sid, csrf, jti)
        return await present(u, coll)

    @r.post("/register")
    async def register(body: RegisterIn, response: Response):
        email = body.email.lower()
        if await users.find_one({"email": email}):
            raise HTTPException(409, "An account with this email already exists — please sign in")
        cid = f"c-{uuid.uuid4().hex[:8]}"
        profile = dict(body.profile or {})
        from config import profile_photos_enabled
        if not profile_photos_enabled():
            profile.pop("photo", None)
        client = {"addresses": [], "insurance": [], "favorites": [], "preferredPractitioners": [], "language": "English",
                  "contactMethod": "Text", "preferredName": "", "emergencyContact": "", "photo": None, **profile,
                  "id": cid, "firstName": body.firstName, "lastName": body.lastName, "email": email, "phone": body.phone, "dob": body.dob,
                  "marketingConsent": body.marketingConsent, "smsConsent": body.smsConsent, "hasProfile": True, "loyaltyPoints": 0, "onlineBookings": 0,
                  "createdAt": datetime.now(timezone.utc).isoformat()}
        await coll("clients").insert_one(dict(client))
        u = {"id": str(uuid.uuid4()), "email": email, "password_hash": hash_pw(body.password), "name": f"{body.firstName} {body.lastName}",
             "role": "client", "subject": cid, "createdAt": client["createdAt"]}
        await users.insert_one(dict(u))
        sid, csrf, jti = await open_session(u["id"])
        apply_session(response, u["id"], sid, csrf, jti)
        return await present(u, coll)

    @r.post("/forgot-password")
    async def forgot_password(body: ForgotIn):
        email = body.email.lower()
        ok = {"ok": True, "message": "If an account exists for that email, a reset link is on its way."}
        u = await users.find_one({"email": email})
        if not u:
            return ok
        now = datetime.now(timezone.utc)
        since = (now - timedelta(minutes=15)).isoformat()
        if await resets.count_documents({"userId": u["id"], "createdAt": {"$gt": since}}) >= RESET_MAX_PER_WINDOW:
            if preview_local_reset():
                return {"ok": True, "message": "Wait a few minutes, then request the reset again.", "previewRetry": True}
            return ok
        raw = secrets.token_urlsafe(32)
        await resets.insert_one({"tokenHash": hashlib.sha256(raw.encode()).hexdigest(), "userId": u["id"], "used": False,
                                 "createdAt": now.isoformat(), "expiresAt": (now + timedelta(minutes=RESET_MIN)).isoformat()})
        if preview_local_reset():
            return {"ok": True, "message": "Choose a new password for this preview account.", "previewResetToken": raw}
        link = f"{os.environ['APP_URL'].rstrip('/')}/reset-password?token={raw}"
        try:
            await send_email(to=email, subject=f"Reset your {os.environ['EMAIL_FROM_NAME']} password", html=reset_email_html(u.get("name") or "there", link))
        except HTTPException:
            # Never reveal account existence when the mail provider rejects delivery.
            return ok
        return ok

    @r.post("/reset-password")
    async def reset_password(body: ResetIn):
        rec = await resets.find_one({"tokenHash": hashlib.sha256(body.token.encode()).hexdigest()})
        if not rec or rec["used"] or rec["expiresAt"] < datetime.now(timezone.utc).isoformat():
            raise HTTPException(400, "This reset link is invalid or has expired — please request a new one")
        u = await users.find_one({"id": rec["userId"]})
        if not u:
            raise HTTPException(400, "This reset link is invalid or has expired — please request a new one")
        await users.update_one({"id": u["id"]}, {"$set": {"password_hash": hash_pw(body.password)}})
        await resets.update_many({"userId": u["id"]}, {"$set": {"used": True}})
        await attempts.delete_one({"identifier": f"email:{u['email']}"})
        await sessions.update_many({"userId": u["id"], "revoked": False}, {"$set": {"revoked": True}})
        await revoke_devices(db, "password_reset", user_id=u["id"])
        await add_audit(u.get("name") or u["email"], "Password reset via email link")
        return {"ok": True}

    @r.post("/refresh")
    async def refresh(request: Request, response: Response):
        try:
            p = jwt.decode(request.cookies.get("refresh_token", ""), os.environ["JWT_SECRET"], algorithms=[ALG])
            assert p.get("type") == "refresh" and p.get("sid") and p.get("jti")
        except Exception:
            raise HTTPException(401, "Session expired")
        row = await live_session(p["sid"])
        if not row or row.get("refreshJti") != p["jti"] or row.get("userId") != p["sub"]:
            raise HTTPException(401, "Session expired")
        account = await users.find_one({"id": p["sub"]}, {"_id": 1, "role": 1, "demo": 1})
        from config import is_production
        if not account or blocks_demo_account(account, is_production()):
            raise HTTPException(401, "Session expired")
        if bool(set(effective_roles(account)) & set(STAFF_ROLES)) and await mfa_enforcement() and not row.get("mfaAt"):
            raise HTTPException(401, "Sign in with your authenticator")
        jti = secrets.token_urlsafe(16)
        expires = (datetime.now(timezone.utc) + timedelta(days=REFRESH_DAYS)).isoformat()
        await sessions.update_one({"sid": p["sid"]}, {"$set": {"refreshJti": jti, "expiresAt": expires}})
        apply_session(response, p["sub"], p["sid"], row["csrf"], jti)
        return {"ok": True}

    @r.post("/logout")
    async def logout(request: Request, response: Response):
        raw = request.cookies.get("access_token") or request.cookies.get("refresh_token")
        if raw:
            try:
                p = jwt.decode(raw, os.environ["JWT_SECRET"], algorithms=[ALG])
                await sessions.update_one({"sid": p.get("sid")}, {"$set": {"revoked": True}})
                await revoke_devices(db, "signed_out", session_id=p.get("sid"))
            except jwt.InvalidTokenError:
                pass
        clear_auth_cookies(response)
        return {"ok": True}

    @r.get("/me")
    async def me(request: Request):
        return await present(await require(request), coll)

    @r.get("/config")
    async def config():
        from config import demo_mode
        return {"demoMode": demo_mode()}

    async def mfa_enforcement():
        row = await db["nt_settings"].find_one({"id": "app"}, {"mfaEnforcePrivileged": 1})
        return bool(row and row.get("mfaEnforcePrivileged"))

    def _challenge_for(user, kind):
        return jwt.encode({"sub": user["id"], "type": kind, "exp": datetime.now(timezone.utc) + timedelta(minutes=5)}, os.environ["JWT_SECRET"], algorithm=ALG)

    async def _challenge_user(body, expected):
        try:
            claim = jwt.decode(str((body or {}).get("challenge") or ""), os.environ["JWT_SECRET"], algorithms=[ALG])
        except jwt.InvalidTokenError:
            return None
        if claim.get("type") != expected:
            return None
        user = await users.find_one({"id": claim["sub"]})
        from config import is_production
        return None if blocks_demo_account(user, is_production()) else user

    def _recovery_hash(code):
        return hashlib.sha256(str(code).strip().lower().encode()).hexdigest()

    async def _mfa_locked(user_id):
        ident = f"mfa:{user_id}"
        rec = await attempts.find_one({"identifier": ident})
        if rec and rec.get("count", 0) >= MAX_FAILS and rec.get("lockedUntil", "") > datetime.now(timezone.utc).isoformat():
            raise HTTPException(429, "Too many authenticator attempts — try again in 15 minutes")
        return ident, rec

    async def _mfa_fail(ident, rec):
        cnt = (rec or {}).get("count", 0) + 1
        await attempts.update_one({"identifier": ident}, {"$set": {"count": cnt, "lockedUntil": (datetime.now(timezone.utc) + timedelta(minutes=LOCK_MIN)).isoformat()}}, upsert=True)

    @r.post("/mfa/enroll")
    async def mfa_enroll(request: Request, response: Response):
        body = {}
        if request.headers.get("content-type", "").startswith("application/json"):
            body = await request.json()
        if body and body.get("challenge"):
            user = await _challenge_user(body, "mfa-enroll")
            if not user or not (set(effective_roles(user)) & set(STAFF_ROLES)):
                raise HTTPException(401, "Sign in again")
        else:
            user = await require(request, "owner", "practitioner", "desk")
        if await db["nt_mfa"].find_one({"userId": user["id"], "enabled": True}):
            raise HTTPException(409, "Authenticator is already on")
        secret = base64.b32encode(secrets.token_bytes(20)).decode().rstrip("=")
        codes = [secrets.token_hex(4) for _ in range(8)]
        await db["nt_mfa"].update_one({"userId": user["id"]}, {"$set": {
            "userId": user["id"], "secret": secret, "enabled": False, "lastCounter": -1,
            "recoveryHashes": [_recovery_hash(code) for code in codes],
        }}, upsert=True)
        await add_audit(user.get("name") or user["role"], "Authenticator enrollment started", None)
        response.headers["Cache-Control"] = "no-store"
        response.headers["Pragma"] = "no-cache"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["X-Content-Type-Options"] = "nosniff"
        return {"secret": secret, "otpauth": provisioning_uri(user["email"], secret), "recoveryCodes": codes}

    @r.post("/mfa/confirm")
    async def mfa_confirm(request: Request, response: Response, body: dict = Body(...)):
        from totp import matching_counter
        via_challenge = bool(body.get("challenge"))
        if via_challenge:
            user = await _challenge_user(body, "mfa-enroll")
            if not user or not (set(effective_roles(user)) & set(STAFF_ROLES)):
                raise HTTPException(401, "Sign in again")
        else:
            user = await require(request, "owner", "practitioner", "desk")
        row = await db["nt_mfa"].find_one({"userId": user["id"], "enabled": False})
        counter = matching_counter(row["secret"], body.get("code")) if row else None
        if counter is None:
            raise HTTPException(400, "That authenticator code was not accepted")
        await db["nt_mfa"].update_one({"userId": user["id"]}, {"$set": {"enabled": True, "lastCounter": counter if via_challenge else row.get("lastCounter", -1)}})
        await add_audit(user.get("name") or user["role"], "Authenticator turned on", None)
        if via_challenge:
            sid, csrf, jti = await open_session(user["id"], mfa=True)
            apply_session(response, user["id"], sid, csrf, jti)
            return await present(user, coll)
        return {"enabled": True}

    @r.post("/mfa/verify")
    async def mfa_verify(response: Response, body: dict = Body(...)):
        user = await verified_mfa_user(body, "mfa")
        sid, csrf, jti = await open_session(user["id"], mfa=True)
        apply_session(response, user["id"], sid, csrf, jti)
        await add_audit(user.get("name") or user["role"], "Authenticator accepted", None)
        return await present(user, coll)

    async def verified_mfa_user(body, expected):
        from totp import matching_counter
        try:
            claim = jwt.decode(str(body.get("challenge") or ""), os.environ["JWT_SECRET"], algorithms=[ALG])
        except jwt.InvalidTokenError:
            raise HTTPException(401, "Sign in again")
        if claim.get("type") != expected:
            raise HTTPException(401, "Sign in again")
        user = await users.find_one({"id": claim["sub"]})
        from config import is_production
        if blocks_demo_account(user, is_production()):
            raise HTTPException(401, "Sign in again")
        row = await db["nt_mfa"].find_one({"userId": claim["sub"], "enabled": True}) if user else None
        if not user or not row:
            raise HTTPException(401, "Sign in again")
        ident, rec = await _mfa_locked(user["id"])
        code = str(body.get("code") or "").strip()
        counter = matching_counter(row["secret"], code)
        recovery = _recovery_hash(code)
        used_recovery = recovery in (row.get("recoveryHashes") or [])
        if counter is None and not used_recovery:
            await _mfa_fail(ident, rec)
            raise HTTPException(401, "That authenticator code was not accepted")
        if counter is not None and counter <= int(row.get("lastCounter") or -1):
            await _mfa_fail(ident, rec)
            raise HTTPException(401, "That authenticator code was already used")
        update = {"$set": {"lastCounter": counter if counter is not None else row.get("lastCounter", -1)}}
        if used_recovery:
            update["$pull"] = {"recoveryHashes": recovery}
        await db["nt_mfa"].update_one({"userId": user["id"]}, update)
        await attempts.delete_one({"identifier": ident})
        return user

    def _pending_replace_active(row):
        if not row or not row.get("pendingSecret"):
            return False
        created = row.get("pendingCreatedAt") or ""
        if not created:
            return False
        try:
            started = datetime.fromisoformat(created.replace("Z", "+00:00"))
        except ValueError:
            return False
        if started.tzinfo is None:
            started = started.replace(tzinfo=timezone.utc)
        return started + timedelta(minutes=MFA_REPLACE_PENDING_MIN) > datetime.now(timezone.utc)

    async def _session_row(user):
        return await live_session(user.get("sid")) if user.get("sid") else None

    async def _require_staff_mfa_session(request: Request):
        """Privileged actions that change authenticators need an MFA-marked session when enforcement is on."""
        user = await require(request, "owner", "practitioner", "desk")
        row = await _session_row(user)
        if await mfa_enforcement() and not (row and row.get("mfaAt")):
            raise HTTPException(403, "Confirm your authenticator before this action")
        return user, row

    async def _consume_current_mfa_code(user, row, code):
        from totp import matching_counter
        cleaned = str(code or "").strip()
        ident, rec = await _mfa_locked(user["id"])
        counter = matching_counter(row["secret"], cleaned)
        recovery = _recovery_hash(cleaned)
        used_recovery = recovery in (row.get("recoveryHashes") or [])
        if counter is None and not used_recovery:
            await _mfa_fail(ident, rec)
            raise HTTPException(401, "That authenticator code was not accepted")
        if counter is not None and counter <= int(row.get("lastCounter") or -1):
            await _mfa_fail(ident, rec)
            raise HTTPException(401, "That authenticator code was already used")
        update = {"$set": {"lastCounter": counter if counter is not None else row.get("lastCounter", -1)}}
        if used_recovery:
            update["$pull"] = {"recoveryHashes": recovery}
        await db["nt_mfa"].update_one({"userId": user["id"]}, update)
        await attempts.delete_one({"identifier": ident})
        return await db["nt_mfa"].find_one({"userId": user["id"], "enabled": True})

    def _no_store(response: Response):
        response.headers["Cache-Control"] = "no-store"
        response.headers["Pragma"] = "no-cache"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["X-Content-Type-Options"] = "nosniff"

    @r.get("/security")
    async def security_status(request: Request):
        user = await require(request)
        session = await _session_row(user)
        mfa = await db["nt_mfa"].find_one({"userId": user["id"]}, {"_id": 0})
        enabled = bool(mfa and mfa.get("enabled"))
        pending = _pending_replace_active(mfa) if mfa else False
        if mfa and mfa.get("pendingSecret") and not pending:
            await db["nt_mfa"].update_one(
                {"userId": user["id"]},
                {"$unset": {"pendingSecret": "", "pendingRecoveryHashes": "", "pendingCreatedAt": ""}},
            )
        active = await sessions.count_documents({"userId": user["id"], "revoked": False})
        return {
            "email": user.get("email"),
            "role": user.get("role"),
            "mfaEnabled": enabled,
            "mfaEnforced": await mfa_enforcement() if bool(set(effective_roles(user)) & set(STAFF_ROLES)) else False,
            "recoveryCodesRemaining": len((mfa or {}).get("recoveryHashes") or []) if enabled else 0,
            "replacePending": pending,
            "sessionMfaVerified": bool(session and session.get("mfaAt")),
            "activeSessions": active,
            "passwordResetPath": "/forgot-password",
        }

    @r.post("/change-password")
    async def change_password(request: Request, body: dict = Body(...)):
        user = await require(request)
        if bool(set(effective_roles(user)) & set(STAFF_ROLES)) and await mfa_enforcement():
            session = await _session_row(user)
            if not (session and session.get("mfaAt")):
                raise HTTPException(403, "Confirm your authenticator before this action")
        current = str(body.get("currentPassword") or "")
        new = str(body.get("newPassword") or "")
        if len(new) < 8:
            raise HTTPException(400, "Choose a password with at least 8 characters")
        account = await users.find_one({"id": user["id"]})
        if not account or not check_pw(current, account.get("password_hash") or ""):
            raise HTTPException(401, "Current password was not accepted")
        await users.update_one({"id": user["id"]}, {"$set": {"password_hash": hash_pw(new)}})
        await sessions.update_many(
            {"userId": user["id"], "revoked": False, "sid": {"$ne": user.get("sid")}},
            {"$set": {"revoked": True, "revokedReason": "password_changed"}},
        )
        await revoke_devices(db, "password_changed", user_id=user["id"])
        await add_audit(user.get("name") or user["email"], "Password changed", None)
        return {"ok": True}

    @r.post("/sessions/revoke-others")
    async def revoke_other_sessions(request: Request):
        user = await require(request)
        if bool(set(effective_roles(user)) & set(STAFF_ROLES)) and await mfa_enforcement():
            session = await _session_row(user)
            if not (session and session.get("mfaAt")):
                raise HTTPException(403, "Confirm your authenticator before this action")
        result = await sessions.update_many(
            {"userId": user["id"], "revoked": False, "sid": {"$ne": user.get("sid")}},
            {"$set": {"revoked": True, "revokedReason": "signed_out_elsewhere"}},
        )
        await add_audit(user.get("name") or user["email"], "Other sessions revoked", None)
        return {"ok": True, "revoked": int(result.modified_count)}

    @r.post("/mfa/replace/start")
    async def mfa_replace_start(request: Request, response: Response, body: dict = Body(...)):
        """Begin authenticator replacement. Current MFA stays active until confirm."""
        user, _session = await _require_staff_mfa_session(request)
        row = await db["nt_mfa"].find_one({"userId": user["id"], "enabled": True})
        if not row:
            raise HTTPException(400, "Turn on an authenticator before replacing it")
        row = await _consume_current_mfa_code(user, row, body.get("code"))
        secret = base64.b32encode(secrets.token_bytes(20)).decode().rstrip("=")
        codes = [secrets.token_hex(4) for _ in range(8)]
        await db["nt_mfa"].update_one({"userId": user["id"]}, {"$set": {
            "pendingSecret": secret,
            "pendingRecoveryHashes": [_recovery_hash(code) for code in codes],
            "pendingCreatedAt": datetime.now(timezone.utc).isoformat(),
        }})
        await add_audit(user.get("name") or user["role"], "Authenticator replacement started", None)
        _no_store(response)
        return {"secret": secret, "otpauth": provisioning_uri(user["email"], secret), "recoveryCodes": codes}

    @r.post("/mfa/replace/confirm")
    async def mfa_replace_confirm(request: Request, response: Response, body: dict = Body(...)):
        from totp import matching_counter
        user, _session = await _require_staff_mfa_session(request)
        row = await db["nt_mfa"].find_one({"userId": user["id"], "enabled": True})
        if not row or not _pending_replace_active(row):
            raise HTTPException(400, "Authenticator replacement is not in progress or has expired")
        counter = matching_counter(row["pendingSecret"], body.get("code"))
        if counter is None:
            raise HTTPException(400, "That authenticator code was not accepted")
        await db["nt_mfa"].update_one({"userId": user["id"]}, {
            "$set": {
                "secret": row["pendingSecret"],
                "recoveryHashes": row.get("pendingRecoveryHashes") or [],
                "lastCounter": counter,
                "enabled": True,
            },
            "$unset": {"pendingSecret": "", "pendingRecoveryHashes": "", "pendingCreatedAt": ""},
        })
        await add_audit(user.get("name") or user["role"], "Authenticator replaced", None)
        _no_store(response)
        return {"enabled": True, "replaced": True}

    @r.post("/mfa/replace/cancel")
    async def mfa_replace_cancel(request: Request):
        user, _session = await _require_staff_mfa_session(request)
        await db["nt_mfa"].update_one(
            {"userId": user["id"]},
            {"$unset": {"pendingSecret": "", "pendingRecoveryHashes": "", "pendingCreatedAt": ""}},
        )
        await add_audit(user.get("name") or user["role"], "Authenticator replacement cancelled", None)
        return {"ok": True, "replacePending": False}

    @r.post("/mfa/recovery/regenerate")
    async def mfa_recovery_regenerate(request: Request, response: Response, body: dict = Body(...)):
        user, _session = await _require_staff_mfa_session(request)
        row = await db["nt_mfa"].find_one({"userId": user["id"], "enabled": True})
        if not row:
            raise HTTPException(400, "Turn on an authenticator before regenerating recovery codes")
        if _pending_replace_active(row):
            raise HTTPException(409, "Finish or cancel authenticator replacement first")
        await _consume_current_mfa_code(user, row, body.get("code"))
        codes = [secrets.token_hex(4) for _ in range(8)]
        await db["nt_mfa"].update_one({"userId": user["id"]}, {"$set": {
            "recoveryHashes": [_recovery_hash(code) for code in codes],
        }})
        await add_audit(user.get("name") or user["role"], "Recovery codes regenerated", None)
        _no_store(response)
        return {"recoveryCodes": codes}

    @r.post("/mfa/disable")
    async def mfa_disable(request: Request, body: dict = Body(...)):
        from totp import matching_counter
        user = await require(request, "owner", "practitioner", "desk")
        row = await db["nt_mfa"].find_one({"userId": user["id"], "enabled": True})
        if not row:
            return {"enabled": False}
        if await mfa_enforcement():
            raise HTTPException(
                409,
                "Staff authenticator is required. Replace your authenticator instead of turning it off.",
            )
        code = str(body.get("code") or "").strip()
        counter = matching_counter(row["secret"], code)
        recovery = _recovery_hash(code)
        if counter is None and recovery not in (row.get("recoveryHashes") or []):
            raise HTTPException(401, "That authenticator code was not accepted")
        if counter is not None and counter <= int(row.get("lastCounter") or -1):
            raise HTTPException(401, "That authenticator code was already used")
        await db["nt_mfa"].delete_one({"userId": user["id"]})
        await sessions.update_many({"userId": user["id"], "revoked": False}, {"$set": {"revoked": True}})
        await revoke_devices(db, "mfa_disabled", user_id=user["id"])
        await add_audit(user.get("name") or user["role"], "Authenticator turned off", None)
        return {"enabled": False}

    @r.post("/demo-login")
    async def demo_login(response: Response, body: dict = Body(...)):
        """Preview-only quick sign-in. Refused in production and whenever DEMO_MODE is off."""
        from config import demo_mode
        if not demo_mode():
            raise HTTPException(404, "Not available")
        role = body.get("role")
        q = {"role": role, "demo": True} if role != "owner" else {"role": "owner", "demo": False}
        if role == "practitioner" and body.get("subject"):
            q["subject"] = body["subject"]
        u = await users.find_one(q)
        if not u:
            raise HTTPException(404, "No demo account")
        if bool(set(effective_roles(u)) & set(STAFF_ROLES)) and await mfa_enforcement():
            enrolled = await db["nt_mfa"].find_one({"userId": u["id"], "enabled": True})
            if not enrolled:
                raise HTTPException(403, "Enroll an authenticator before this staff sign-in")
            clear_auth_cookies(response)
            return {"mfaRequired": True, "challenge": _challenge_for(u, "mfa")}
        sid, csrf, jti = await open_session(u["id"])
        apply_session(response, u["id"], sid, csrf, jti)
        return await present(u, coll)

    @r.post("/workspace")
    async def set_workspace(request: Request, body: WorkspaceIn):
        """Remember preferred presentation workspace. Does not grant roles."""
        user = await require(request)
        spaces = workspaces_for(user)
        if body.workspace not in spaces:
            raise HTTPException(403, "That workspace is not authorized for your account")
        await users.update_one({"id": user["id"]}, {"$set": {"preferredWorkspace": body.workspace}})
        user["preferredWorkspace"] = body.workspace
        await add_audit(user.get("name") or user["email"], f"Preferred workspace set to {body.workspace}", None)
        return await present(user, coll)

    @r.get("/staff")
    async def staff(request: Request):
        await require(request, "owner")
        rows = await users.find(
            {"$or": [{"role": {"$in": list(STAFF_ROLES)}}, {"roles": {"$in": list(STAFF_ROLES)}}]},
            {"_id": 0, "password_hash": 0},
        ).to_list(200)
        for row in rows:
            row["roles"] = normalize_roles(row.get("roles"), row.get("role"))
        return rows

    @r.post("/staff")
    async def create_staff(request: Request, body: StaffIn):
        owner = await require(request, "owner")
        roles = normalize_roles(body.roles, body.role)
        if not roles or any(role not in STAFF_ROLES for role in roles):
            raise HTTPException(400, "Choose owner, manager, practitioner, or reception roles")
        if "owner" in roles and not has_strict_role(owner, "owner"):
            raise HTTPException(403, "Only an owner can grant the owner role")
        email = body.email.lower()
        if "practitioner" in roles:
            from onboarding import acceptable_login
            if not acceptable_login(email, owner.get("email")):
                raise HTTPException(400, "Use a practitioner email that is separate from the owner account")
        if await users.find_one({"email": email}):
            raise HTTPException(409, "Email already in use")
        subject = None
        if "practitioner" in roles:
            subject = body.practitionerId or f"p-{uuid.uuid4().hex[:6]}"
            if not await coll("practitioners").find_one({"id": subject}):
                initials = "".join(w[0] for w in body.name.split()[:2]).upper()
                await coll("practitioners").insert_one({"id": subject, "name": body.name, "initials": initials, "color": "#18A8F5", "isOwner": False,
                                                        "specialties": [], "available": False, "onboardingStatus": "draft", "bookable": False,
                                                        "licenseExpiry": "", "insuranceExpiry": "", "bio": "", "directBilling": False, "mobile": True})
                from availability import draft_schedule
                await db.nt_schedules.insert_one(draft_schedule(subject))
        primary = primary_role(roles)
        preferred = "practitioner" if primary == "practitioner" else ("desk" if primary == "desk" else "owner")
        u = {"id": str(uuid.uuid4()), "email": email, "password_hash": hash_pw(body.password), "name": body.name, "role": primary,
             "roles": roles, "subject": subject, "preferredWorkspace": preferred, "status": "active",
             "createdAt": datetime.now(timezone.utc).isoformat()}
        await users.insert_one(dict(u))
        await add_audit(owner["name"], f"Staff account created: {body.name} ({','.join(roles)})")
        return await present(u, coll)

    async def _issue_invite(owner, *, email, name, roles, phone, practitioner_id, preferred):
        subject = None
        if "practitioner" in roles:
            subject = practitioner_id or f"p-{uuid.uuid4().hex[:8]}"
            if not await coll("practitioners").find_one({"id": subject}):
                initials = "".join(part[0] for part in name.split()[:2]).upper() or "NT"
                await coll("practitioners").insert_one({
                    "id": subject, "name": name, "initials": initials, "color": "#18A8F5", "isOwner": False,
                    "specialties": [], "available": False, "bookable": False, "onboardingStatus": "invited",
                    "licenseExpiry": "", "insuranceExpiry": "", "bio": "", "phone": (phone or "").strip(),
                    "email": email, "directBilling": False, "mobile": True, "demo": False, "origin": "invited",
                })
                from availability import draft_schedule
                await db.nt_schedules.insert_one(draft_schedule(subject))
        now = datetime.now(timezone.utc)
        raw = secrets.token_urlsafe(32)
        secret = secrets.token_urlsafe(32)
        user_id = str(uuid.uuid4())
        primary = primary_role(roles)
        preferred_ws = preferred if preferred in ("owner", "practitioner", "desk") else (
            "practitioner" if primary == "practitioner" else ("desk" if primary == "desk" else "owner")
        )
        await users.insert_one({
            "id": user_id, "email": email, "password_hash": hash_pw(secret), "name": name, "role": primary,
            "roles": roles, "subject": subject, "preferredWorkspace": preferred_ws, "status": "invited",
            "createdAt": now.isoformat(), "invitePending": True,
        })
        invite = {
            "id": "inv-" + uuid.uuid4().hex[:10],
            "tokenHash": hashlib.sha256(raw.encode()).hexdigest(), "userId": user_id, "used": False, "revoked": False,
            "roles": roles, "email": email, "createdAt": now.isoformat(),
            "expiresAt": (now + timedelta(hours=72)).isoformat(),
        }
        await db.nt_staff_invites.insert_one(invite)
        await add_audit(owner["name"], f"Staff invitation created: {name} ({','.join(roles)})")
        result = {"invited": True, "delivery": "not_sent", "role": primary, "roles": roles, "email": email, "inviteId": invite["id"]}
        if preview_local_reset():
            result["delivery"] = "preview_link"
            result["previewInviteToken"] = raw
            result["message"] = "Email delivery is not configured. Copy this single-use link. It expires in 72 hours."
            return result
        link = f"{os.environ['APP_URL'].rstrip('/')}/join?token={raw}"
        try:
            await send_email(to=email, subject="Your Nabitouch staff invitation", html=f"<p>You have been invited to Nabitouch. This link expires in 72 hours.</p><p><a href=\"{escape(link)}\">Accept invitation</a></p>")
        except Exception as exc:
            raise HTTPException(503, "The invitation was saved, but email delivery failed. Ask for the preview link only on this computer.") from exc
        result["delivery"] = "email"
        result["message"] = "Invitation email sent."
        return result

    @r.post("/staff/invite")
    async def invite_staff(request: Request, body: InviteIn):
        owner = await require(request, "owner")
        roles = normalize_roles(body.roles, body.role)
        if not roles or any(role not in STAFF_ROLES for role in roles):
            raise HTTPException(400, "Choose owner, manager, practitioner, or reception roles")
        if "owner" in roles and not has_strict_role(owner, "owner"):
            raise HTTPException(403, "Only an owner can grant the owner role")
        email = body.email.lower()
        if "practitioner" in roles:
            from onboarding import acceptable_login
            if not acceptable_login(email, owner.get("email")):
                raise HTTPException(400, "Use a practitioner email that is separate from the owner account")
        if await users.find_one({"email": email}):
            raise HTTPException(409, "Email already in use")
        return await _issue_invite(
            owner, email=email, name=body.name, roles=roles, phone=body.phone,
            practitioner_id=body.practitionerId, preferred=body.preferredWorkspace,
        )

    @r.post("/staff/invites/{invite_id}/resend")
    async def resend_invite(invite_id: str, request: Request):
        """Rotate the single-use token for an existing invited account. Does not create a duplicate user."""
        owner = await require(request, "owner")
        invite = await db.nt_staff_invites.find_one({"id": invite_id})
        if not invite or invite.get("used") or invite.get("revoked"):
            raise HTTPException(404, "Invitation not found")
        account = await users.find_one({"id": invite["userId"]})
        if not account or account.get("status") not in ("invited", "active") or not account.get("invitePending", True):
            if not account or account.get("status") == "revoked":
                raise HTTPException(404, "Invitation not found")
            if not account.get("invitePending") and account.get("status") == "active":
                raise HTTPException(409, "This invitation was already accepted")
        now = datetime.now(timezone.utc)
        await db.nt_staff_invites.update_one(
            {"id": invite_id},
            {"$set": {"revoked": True, "revokedAt": now.isoformat()}},
        )
        raw = secrets.token_urlsafe(32)
        roles = normalize_roles(invite.get("roles") or account.get("roles"), account.get("role"))
        fresh = {
            "id": "inv-" + uuid.uuid4().hex[:10],
            "tokenHash": hashlib.sha256(raw.encode()).hexdigest(),
            "userId": account["id"],
            "used": False,
            "revoked": False,
            "roles": roles,
            "email": account["email"],
            "createdAt": now.isoformat(),
            "expiresAt": (now + timedelta(hours=72)).isoformat(),
        }
        await db.nt_staff_invites.insert_one(fresh)
        await users.update_one({"id": account["id"]}, {"$set": {"status": "invited", "invitePending": True}})
        await add_audit(owner["name"], f"Staff invitation resent: {account.get('email')}")
        result = {
            "invited": True, "delivery": "not_sent", "role": account.get("role") or primary_role(roles),
            "roles": roles, "email": account["email"], "inviteId": fresh["id"],
        }
        if preview_local_reset():
            result["delivery"] = "preview_link"
            result["previewInviteToken"] = raw
            result["message"] = "Email delivery is not configured. Copy this single-use link. It expires in 72 hours."
            return result
        link = f"{os.environ['APP_URL'].rstrip('/')}/join?token={raw}"
        try:
            await send_email(
                to=account["email"],
                subject="Your Nabitouch staff invitation",
                html=f"<p>You have been invited to Nabitouch. This link expires in 72 hours.</p><p><a href=\"{escape(link)}\">Accept invitation</a></p>",
            )
        except Exception as exc:
            raise HTTPException(503, "The invitation was saved, but email delivery failed. Ask for the preview link only on this computer.") from exc
        result["delivery"] = "email"
        result["message"] = "Invitation email sent."
        return result

    @r.post("/staff/invites/{invite_id}/revoke")
    async def revoke_invite(invite_id: str, request: Request):
        owner = await require(request, "owner")
        invite = await db.nt_staff_invites.find_one({"id": invite_id})
        if not invite or invite.get("used"):
            raise HTTPException(404, "Invitation not found")
        await db.nt_staff_invites.update_one({"id": invite_id}, {"$set": {"revoked": True, "revokedAt": datetime.now(timezone.utc).isoformat()}})
        await users.update_one({"id": invite["userId"], "invitePending": True}, {"$set": {"status": "revoked"}})
        await add_audit(owner["name"], f"Staff invitation revoked: {invite.get('email') or invite_id}")
        return {"ok": True, "revoked": True}

    @r.patch("/staff/{user_id}")
    async def patch_staff(user_id: str, request: Request, body: StaffRolesIn):
        owner = await require(request, "owner")
        account = await users.find_one({"id": user_id})
        if not account:
            raise HTTPException(404, "Staff account not found")
        roles = normalize_roles(body.roles, account.get("role"))
        if not roles or any(role not in STAFF_ROLES for role in roles):
            raise HTTPException(400, "Choose owner, manager, practitioner, or reception roles")
        if "owner" in roles and not has_strict_role(owner, "owner"):
            raise HTTPException(403, "Only an owner can grant the owner role")
        if is_sysadmin(account) and "owner" not in effective_roles(owner):
            raise HTTPException(403, "Protected system administrator accounts require an owner")
        patch = {"roles": roles, "role": primary_role(roles)}
        if body.preferredWorkspace:
            patch["preferredWorkspace"] = body.preferredWorkspace
        if body.status in ("active", "suspended"):
            patch["status"] = body.status
            if body.status == "suspended":
                await sessions.update_many({"userId": user_id, "revoked": False}, {"$set": {"revoked": True, "revokedReason": "suspended"}})
        if body.practitionerId is not None:
            patch["subject"] = body.practitionerId or None
        await users.update_one({"id": user_id}, {"$set": patch})
        await add_audit(owner["name"], f"Staff roles updated: {account.get('email')} → {','.join(roles)}")
        updated = await users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})
        return await present(updated, coll)

    @r.post("/staff/{user_id}/revoke-sessions")
    async def revoke_staff_sessions(user_id: str, request: Request):
        owner = await require(request, "owner")
        account = await users.find_one({"id": user_id}, {"_id": 0, "email": 1, "name": 1})
        if not account:
            raise HTTPException(404, "Staff account not found")
        result = await sessions.update_many({"userId": user_id, "revoked": False}, {"$set": {"revoked": True, "revokedReason": "admin_revoke"}})
        await add_audit(owner["name"], f"Sessions revoked for {account.get('email')}")
        return {"ok": True, "revoked": int(result.modified_count)}

    @r.post("/invite/accept")
    async def accept_invite(body: InviteAccept):
        rec = await db.nt_staff_invites.find_one({"tokenHash": hashlib.sha256(body.token.encode()).hexdigest()})
        if not rec or rec.get("used") or rec.get("revoked") or rec.get("expiresAt", "") < datetime.now(timezone.utc).isoformat():
            raise HTTPException(400, "This invitation is invalid or has expired")
        updated = await users.update_one(
            {"id": rec["userId"]},
            {"$set": {"password_hash": hash_pw(body.password), "invitePending": False, "status": "active"}},
        )
        if updated.matched_count != 1:
            raise HTTPException(400, "This invitation is invalid or has expired")
        await db.nt_staff_invites.update_one({"_id": rec["_id"]}, {"$set": {"used": True}})
        return {"ok": True, "message": "Password saved. Sign in, then enroll your authenticator before the workspace opens."}

    return r, user_from, require, seed
