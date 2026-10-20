"""Nabitouch Live — tracking service boundary (Phase 1).

Interfaces (Protocols) + mock implementations. Production swaps: LocationProvider → native background SDK,
RouteProvider/ETAService → Mapbox Directions/Matrix (server-side secret token), RealtimeTransport → Socket.IO/WebSocket
with Redis adapter, LocationStore → Redis latest-fix cache (TTL), GeofenceService → PostGIS.
Precise coordinates are kept in memory only (latest fix per active trip) — no GPS history is persisted.
"""
import math
import os
import time
import uuid
import logging
import httpx
from collections import deque
from datetime import datetime, timezone
from typing import Optional, Protocol

from fastapi import APIRouter, Body, HTTPException, Request
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

from config import cookie_samesite, cookie_secure, is_production
from tracking_store import (
    TrackingUnavailable, accept_fix, allow_rate, cache_drop, cache_get, cache_set,
    clear_all, drop_session, force_set, issue_capability, lookup_browser, lookup_capability,
    open_guest_browser, poll_events, publish_event, read_fix, redact_location_events, revoke_capabilities,
    subscribe, touch,
)

EVENT_VERSION = 1
EVENT_TYPES = ["trip.started", "location.updated", "eta.updated", "trip.delayed", "practitioner.arrived", "tracking.paused",
               "tracking.resumed", "tracking.stopped", "session.started", "session.ended", "practitioner.departed", "visit.completed"]
TRANSITION_EVENTS = {"en_route": "trip.started", "arrived": "practitioner.arrived", "in_session": "session.started",
                     "session_ended": "session.ended", "leaving": "practitioner.departed", "completed": "visit.completed",
                     "cancelled": "tracking.stopped", "no_show": "tracking.stopped", "interrupted": "tracking.paused", "delayed": "trip.delayed"}
STALE_SEC, MAX_ACCURACY_M, MAX_SKEW_SEC = 30, 150, 120
ETA_REFRESH_SEC = 300  # Approved live-ETA cadence: recalculate Mapbox at most every five minutes.
ETA_MANUAL_REFRESH_SEC = 60  # Client "Refresh ETA" rate limit per appointment.
COMPLETED = {"in_session", "session_ended", "leaving", "completed", "processing", "closed", "soap_pending", "soap_completed"}
PRIVACY_HEADERS = {"Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "Pragma": "no-cache", "X-Content-Type-Options": "nosniff"}


def trip_sharing(appt):
    """Sharing is on only for an en-route trip the assigned practitioner started."""
    trip = appt.get("trip") or {}
    if appt.get("status") != "en_route" or not trip.get("sharing"):
        return False
    if trip.get("simulated") and trip.get("sharingSource") != "practitioner":
        return False
    if is_production() and trip.get("sharingSource") != "practitioner":
        return False
    return True


def now_iso():
    return datetime.now(timezone.utc).isoformat()


# ---------- Contracts ----------
class LocationFix(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    accuracy: float = Field(ge=0, description="metres, 68% radius")
    seq: int = Field(ge=0, description="monotonic per tracking session")
    recordedAt: str = Field(description="device timestamp ISO-8601")
    speed: Optional[float] = None
    heading: Optional[float] = None
    approximate: bool = False
    source: str = Field(default="simulated", pattern="^(gps|simulated)$")


class AuthContext(BaseModel):
    role: str  # client | practitioner | owner | desk
    subject: Optional[str] = None  # client id / practitioner id


class TrackingEvent(BaseModel):
    id: str
    type: str
    version: int = EVENT_VERSION
    appointmentId: str
    practitionerId: Optional[str]
    serverTime: str
    payload: dict = {}
    audience: list = []  # roles/subjects allowed to receive (enforced by transport)


# ---------- Interfaces ----------
class RouteProvider(Protocol):
    def route(self, origin: dict, dest: dict) -> dict: ...


class ETAService(Protocol):
    def eta(self, position: dict, dest: dict) -> dict: ...


class RealtimeTransport(Protocol):
    def publish(self, event: TrackingEvent) -> None: ...
    def poll(self, auth: AuthContext, since: int, can_see) -> list: ...


class LocationStore(Protocol):
    def put(self, appt_id: str, fix: dict) -> None: ...
    def get(self, appt_id: str) -> Optional[dict]: ...
    def drop(self, appt_id: str) -> None: ...


class NotificationService(Protocol):
    def notify(self, audience: str, title: str, body: str) -> None: ...


# ---------- Mock implementations ----------
def haversine_km(a, b):
    la1, lo1, la2, lo2 = map(math.radians, [a["lat"], a["lng"], b["lat"], b["lng"]])
    return 2 * 6371 * math.asin(math.sqrt(math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2))


class MockRouteProvider:
    """Straight-line × road factor. Production: Mapbox Directions (driving-traffic) called server-side."""
    def route(self, origin, dest):
        km = round(haversine_km(origin, dest) * 1.3, 2)
        return {"distanceKm": km, "durationMin": round(4 + km * 1.9, 1), "provider": "mock"}


class MockETAService:
    def __init__(self, routes: RouteProvider):
        self.routes = routes

    def eta(self, position, dest):
        r = self.routes.route(position, dest)
        return {"etaMin": max(0, math.ceil(r["durationMin"] if r["distanceKm"] > 0.05 else 0)), "remainingKm": r["distanceKm"], "provider": r["provider"]}


class InMemoryLocationStore:
    def __init__(self):
        self._d = {}

    def put(self, appt_id, fix):
        self._d[appt_id] = fix

    def get(self, appt_id):
        return self._d.get(appt_id)

    def drop(self, appt_id):
        self._d.pop(appt_id, None)


class InMemoryTransport:
    """Ring buffer + polling. Production: authenticated Socket.IO rooms per appointment, filtered server-side."""
    def __init__(self, size=500):
        self.buf = deque(maxlen=size)
        self.cursor = 0

    def publish(self, event):
        self.cursor += 1
        self.buf.append((self.cursor, event))

    def poll(self, auth, since, can_see):
        return [{"cursor": c, **e.model_dump()} for c, e in self.buf if c > since and can_see(auth, e)]


class LogNotificationService:
    def __init__(self):
        self.sent = deque(maxlen=50)

    def notify(self, audience, title, body):
        self.sent.append({"audience": audience, "title": title, "body": body, "at": now_iso(), "simulated": True})


class MapboxDirections:
    """Mapbox directions, cached per trip (refresh every ETA_REFRESH_SEC).

    driving-traffic is preferred. If traffic data is missing, driving is used and labeled as a road
    estimate. A straight-line estimate is the last resort. None of these are a confirmed arrival.
    Multiple client viewers share one Redis cache so open tabs do not multiply Directions calls.
    """
    URL = "https://api.mapbox.com/directions/v5/mapbox/{profile}/{a};{b}"

    def __init__(self):
        self._cache = {}
        self._blocked_until = 0

    def _estimate(self, position, dest, provider="estimated"):
        eta = ETA.eta(position, dest)
        eta["provider"] = provider
        eta["confirmed"] = False
        eta["updatedAt"] = now_iso()
        return eta, None

    async def _fetch(self, profile, position, dest, token):
        if time.time() < self._blocked_until:
            raise RuntimeError("directions temporarily unavailable")
        async with httpx.AsyncClient(timeout=6) as client:
            response = await client.get(
                self.URL.format(profile=profile, a=f"{position['lng']},{position['lat']}", b=f"{dest['lng']},{dest['lat']}"),
                params={"access_token": token, "geometries": "geojson", "overview": "full"})
        if response.status_code in (401, 403, 429):
            self._blocked_until = time.time() + 60
            raise RuntimeError("directions unavailable")
        response.raise_for_status()
        routes = response.json().get("routes") or []
        if not routes:
            raise RuntimeError("directions empty")
        return routes[0]

    async def eta(self, aid, position, dest, force=False):
        token = os.environ.get("MAPBOX_TOKEN")
        cached = await cache_get(aid) or self._cache.get(aid)
        # Reuse the last Mapbox snapshot for five minutes so GPS heartbeats do not burn Directions quota.
        if (
            not force
            and cached
            and cached.get("dest") == dest
            and time.time() - cached["ts"] < ETA_REFRESH_SEC
        ):
            elapsed = (time.time() - cached["ts"]) / 60
            eta = dict(cached["eta"])
            eta["etaMin"] = max(0, math.ceil(cached["durMin"] - elapsed)) if eta.get("remainingKm", 0) > 0.05 else 0
            eta["confirmed"] = False
            eta["updatedAt"] = cached.get("updatedAt") or eta.get("updatedAt")
            eta["cached"] = True
            return eta, cached.get("route")
        if not token:
            return self._estimate(position, dest)
        route_doc, provider = None, None
        for profile, label in (("driving-traffic", "mapbox-traffic"), ("driving", "mapbox")):
            try:
                route_doc = await self._fetch(profile, position, dest, token)
                provider = label
                break
            except Exception:
                logging.getLogger(__name__).warning("Mapbox %s directions unavailable, trying fallback", profile)
        if not route_doc:
            return self._estimate(position, dest)
        km, dur = round(route_doc["distance"] / 1000, 2), route_doc["duration"] / 60
        updated = now_iso()
        eta = {
            "etaMin": max(0, math.ceil(dur)) if km > 0.05 else 0,
            "remainingKm": km,
            "provider": provider,
            "confirmed": False,
            "updatedAt": updated,
            "cached": False,
        }
        route = [{"lat": lat, "lng": lng} for lng, lat in route_doc["geometry"]["coordinates"]]
        saved = {"ts": time.time(), "from": position, "dest": dict(dest), "durMin": dur, "eta": eta, "route": route, "updatedAt": updated}
        self._cache[aid] = saved
        await cache_set(aid, saved, ttl=ETA_REFRESH_SEC + 30)
        return eta, route

    async def drop(self, aid):
        self._cache.pop(aid, None)
        await cache_drop(aid)


async def open_sharing_session(aid: str, practitioner_id: Optional[str]):
    """Open the Redis tracking slot when travel begins. Does not invent a GPS fix."""
    try:
        current = await read_fix(aid)
        same = current and current.get("practitionerId") == practitioner_id and "lat" in current
        if not same:
            await force_set(aid, {
                "seq": 0,
                "paused": False,
                "practitionerId": practitioner_id,
                "receivedTs": time.time(),
                "serverTime": now_iso(),
                "sharing": True,
            })
        else:
            await touch(aid)
    except TrackingUnavailable:
        logging.getLogger(__name__).warning("Tracking storage unavailable while opening sharing for %s", aid)


ROUTES = MockRouteProvider()
ETA = MockETAService(ROUTES)
DIRECTIONS = MapboxDirections()
STORE = InMemoryLocationStore()
BUS = InMemoryTransport()
NOTIFY = LogNotificationService()


# ---------- Authorization ----------
def parse_auth(header: Optional[str]) -> AuthContext:
    """DEMO ONLY: 'role:subject' header. Production: verify short-lived JWT (appointment-scoped tracking token)."""
    if not header:
        raise HTTPException(401, "Missing authorization context")
    role, _, subject = header.partition(":")
    if role not in ("client", "practitioner", "owner", "desk"):
        raise HTTPException(401, "Unknown role")
    return AuthContext(role=role, subject=subject or None)


class LocationAuthorizationService:
    def __init__(self, perms_loader):
        self.perms = perms_loader

    async def can_view(self, auth: AuthContext, appt: dict, field: str = "location") -> bool:
        if auth.role == "owner":
            return True
        if auth.role == "client":
            return appt.get("clientId") == auth.subject and appt.get("status") == "en_route"
        if auth.role == "practitioner":
            return appt.get("practitionerId") == auth.subject
        if auth.role == "desk":
            p = await self.perms()
            return bool(p.get({"location": "viewLocations", "eta": "viewEta"}[field]))
        return False


def build_tracking_router(coll, add_audit, user_from):
    r = APIRouter(prefix="/api/tracking")

    async def auth_of(request: Request) -> AuthContext:
        u = await user_from(request)
        if not u:
            raise HTTPException(401, "Not authenticated")
        return AuthContext(role=u["role"], subject=u.get("subject"))

    async def perms():
        s = await coll("settings").find_one({"id": "app"}, {"_id": 0}) or {}
        return s.get("receptionPerms", {})

    authz = LocationAuthorizationService(perms)

    async def load(aid):
        a = await coll("appointments").find_one({"id": aid}, {"_id": 0})
        if not a:
            raise HTTPException(404, "Appointment not found")
        return a

    def assigned(auth, appt):
        return auth.role in ("practitioner", "owner") and appt.get("practitionerId") == auth.subject

    async def emit(t, appt, payload=None, audience=None):
        event = TrackingEvent(id=str(uuid.uuid4()), type=t, appointmentId=appt["id"], practitionerId=appt.get("practitionerId"),
                              serverTime=now_iso(), payload=payload or {}, audience=audience or ["owner", "desk", f"client:{appt.get('clientId')}", f"practitioner:{appt.get('practitionerId')}"])
        try:
            await publish_event(event.model_dump())
        except TrackingUnavailable as exc:
            raise HTTPException(503, "Tracking is temporarily unavailable") from exc
        return event

    def phase_of(appt, fix):
        status = appt.get("status")
        if status == "arrived":
            return "arrived"
        if status in COMPLETED:
            return "completed"
        if status == "interrupted":
            return "paused"
        if status in ("cancelled", "no_show"):
            return "ended"
        sharing = trip_sharing(appt)
        trip = appt.get("trip") or {}
        if status == "en_route" and not sharing:
            return "stopped" if trip.get("endedAt") else "unavailable"
        if not sharing:
            return "unavailable"
        if not fix:
            return "expired"
        if fix.get("paused"):
            return "paused"
        if "lat" not in fix:
            return "unavailable"
        age = time.time() - float(fix.get("receivedTs") or 0)
        if age > STALE_SEC:
            return "stale"
        return "live"

    def view(appt, fix, include_pos=True, include_eta=True):
        fresh = fix if fix and "lat" in fix else None
        age = time.time() - fresh["receivedTs"] if fresh else None
        sharing = trip_sharing(appt)
        paused = bool(fix and fix.get("paused"))
        phase = phase_of(appt, fix)
        out = {"appointmentId": appt["id"], "status": appt["status"], "sharing": sharing, "phase": phase,
               "lastFixAt": fresh["serverTime"] if fresh else None, "ageSec": round(age, 1) if age is not None else None,
               "stale": phase == "stale", "approximate": fresh.get("approximate") if fresh else None,
               "source": fresh.get("source") if fresh else None, "confirmedArrival": False}
        show_pos = include_pos and fresh and phase in ("live", "stale") and not paused
        dest = (appt.get("trip") or {}).get("to") or {}
        if not dest.get("lat") or not dest.get("lng"):
            addr = appt.get("address") or {}
            if addr.get("lat") is not None and addr.get("lng") is not None:
                dest = {"lat": addr["lat"], "lng": addr["lng"]}
        if dest.get("lat") is not None and dest.get("lng") is not None and (show_pos or sharing):
            out["destination"] = {"lat": dest["lat"], "lng": dest["lng"]}
        if show_pos:
            out["position"] = {"lat": fresh["lat"], "lng": fresh["lng"], "accuracy": fresh["accuracy"]}
            if fresh.get("route"):
                out["route"] = fresh["route"]
        # Live ETA only while driving with a real fix — never invent an arrival time.
        if fresh and include_eta and fresh.get("eta") and phase in ("live", "stale") and not paused:
            eta = dict(fresh["eta"])
            eta["confirmed"] = False
            out["eta"] = eta
        return out

    async def current_fix(appt):
        if appt.get("status") != "en_route":
            return None
        try:
            return await read_fix(appt["id"])
        except TrackingUnavailable as exc:
            raise HTTPException(503, "Tracking is temporarily unavailable") from exc

    async def session_view(auth, appt):
        loc = await authz.can_view(auth, appt, "location")
        eta_ok = await authz.can_view(auth, appt, "eta")
        if not loc and not eta_ok:
            raise HTTPException(403, "Not authorised for this tracking session")
        return view(appt, await current_fix(appt), loc, eta_ok)

    @r.post("/sessions/{aid}/start")
    async def start(aid: str, request: Request):
        auth = await auth_of(request)
        appt = await load(aid)
        if not assigned(auth, appt):
            raise HTTPException(403, "Practitioner is not assigned to this appointment")
        if appt["status"] != "en_route":
            raise HTTPException(409, "Location sharing is only available while travelling to this visit")
        try:
            if not await allow_rate(f"start:{auth.subject}", 20):
                raise HTTPException(429, "Too many tracking requests")
            await open_sharing_session(aid, appt.get("practitionerId"))
        except TrackingUnavailable as exc:
            raise HTTPException(503, "Tracking is temporarily unavailable") from exc
        trip = {**(appt.get("trip") or {}), "sharing": True, "sharingSource": "practitioner"}
        trip.pop("endedAt", None)
        await coll("appointments").update_one({"id": aid}, {"$set": {"trip": trip}})
        await add_audit(auth.subject or auth.role, f"{appt['ref']} location sharing started", aid)
        await emit("tracking.resumed", appt, {})
        return {"ok": True, "sharing": True}

    @r.post("/sessions/{aid}/eta/refresh")
    async def refresh_eta(aid: str, request: Request):
        """Manual ETA refresh. Rate-limited. Uses the latest GPS fix only — never invents an arrival."""
        auth = await auth_of(request)
        appt = await load(aid)
        await session_view(auth, appt)
        if appt.get("status") != "en_route" or not trip_sharing(appt):
            raise HTTPException(409, "Live ETA is only available while the practitioner is travelling")
        try:
            if not await allow_rate(f"eta-refresh:{aid}", 1, window=ETA_MANUAL_REFRESH_SEC):
                raise HTTPException(429, "ETA was refreshed recently. Try again in a minute.")
        except TrackingUnavailable as exc:
            raise HTTPException(503, "Tracking is temporarily unavailable") from exc
        fix = await current_fix(appt)
        dest = (appt.get("trip") or {}).get("to")
        if not fix or "lat" not in fix or not dest:
            return {"ok": False, "reason": "gps_unavailable", "eta": None}
        pos = {"lat": fix["lat"], "lng": fix["lng"]}
        eta, route = await DIRECTIONS.eta(aid, pos, dest, force=True)
        eta["confirmed"] = False
        updated = {**fix, "eta": eta, "route": route, "serverTime": now_iso(), "receivedTs": fix.get("receivedTs") or time.time()}
        try:
            await force_set(aid, updated)
        except TrackingUnavailable as exc:
            raise HTTPException(503, "Tracking is temporarily unavailable") from exc
        await emit("eta.updated", appt, {"etaMin": eta.get("etaMin"), "remainingKm": eta.get("remainingKm"), "provider": eta.get("provider"), "confirmed": False})
        return {"ok": True, "eta": eta}

    @r.post("/sessions/{aid}/stop")
    async def stop(aid: str, request: Request):
        auth = await auth_of(request)
        appt = await load(aid)
        if not assigned(auth, appt):
            raise HTTPException(403, "Practitioner is not assigned to this appointment")
        trip = {**(appt.get("trip") or {}), "sharing": False, "endedAt": now_iso()}
        await coll("appointments").update_one({"id": aid}, {"$set": {"trip": trip}})
        try:
            await drop_session(aid)
            await DIRECTIONS.drop(aid)
            await redact_location_events(aid)
        except TrackingUnavailable as exc:
            raise HTTPException(503, "Tracking is temporarily unavailable") from exc
        await add_audit(auth.subject or auth.role, f"{appt['ref']} location sharing stopped", aid)
        await emit("tracking.stopped", {**appt, "trip": trip}, {})
        return {"ok": True, "sharing": False}

    @r.post("/sessions/{aid}/pause")
    async def pause(aid: str, request: Request):
        return await _pause(aid, request, True)

    @r.post("/sessions/{aid}/resume")
    async def resume(aid: str, request: Request):
        return await _pause(aid, request, False)

    async def _pause(aid, request, paused):
        auth = await auth_of(request)
        appt = await load(aid)
        if not assigned(auth, appt) or not trip_sharing(appt):
            raise HTTPException(409, "No active authorised trip — tracking not allowed")
        try:
            current = await read_fix(aid)
            if not current:
                raise HTTPException(409, "Tracking session expired")
            current["paused"] = paused
            await force_set(aid, current)
        except TrackingUnavailable as exc:
            raise HTTPException(503, "Tracking is temporarily unavailable") from exc
        await emit("tracking.paused" if paused else "tracking.resumed", appt, {})
        return {"ok": True, "paused": paused}

    @r.post("/sessions/{aid}/heartbeat")
    async def heartbeat(aid: str, request: Request):
        auth = await auth_of(request)
        appt = await load(aid)
        if not assigned(auth, appt):
            raise HTTPException(403, "Practitioner is not assigned to this appointment")
        try:
            alive = await touch(aid)
        except TrackingUnavailable as exc:
            raise HTTPException(503, "Tracking is temporarily unavailable") from exc
        return {"ok": True, "alive": alive}

    @r.post("/sessions/{aid}/locations")
    async def ingest(aid: str, fix: LocationFix, request: Request):
        auth = await auth_of(request)
        appt = await load(aid)
        if not assigned(auth, appt):
            raise HTTPException(403, "Practitioner is not assigned to this appointment")
        if not trip_sharing(appt):
            try:
                await drop_session(aid)
                await DIRECTIONS.drop(aid)
            except TrackingUnavailable as exc:
                raise HTTPException(503, "Tracking is temporarily unavailable") from exc
            raise HTTPException(409, "No active authorised trip — tracking not allowed")
        try:
            if not await allow_rate(f"fix:{aid}", 40):
                raise HTTPException(429, "Too many location updates")
            current = await read_fix(aid)
        except TrackingUnavailable as exc:
            raise HTTPException(503, "Tracking is temporarily unavailable") from exc
        if current and current.get("paused"):
            return {"accepted": False, "reason": "paused"}
        if current and current.get("practitionerId") and current["practitionerId"] != appt.get("practitionerId"):
            raise HTTPException(403, "Practitioner is not assigned to this appointment")
        try:
            rec = datetime.fromisoformat(fix.recordedAt.replace("Z", "+00:00"))
        except ValueError:
            raise HTTPException(422, "Invalid recordedAt")
        skew = abs((datetime.now(timezone.utc) - rec).total_seconds())
        if current and "lat" in current and fix.seq <= current.get("seq", 0):
            return {"accepted": False, "reason": "out_of_order", "lastSeq": current.get("seq")}
        if skew > MAX_SKEW_SEC:
            return {"accepted": False, "reason": "stale_fix", "skewSec": round(skew)}
        if fix.accuracy > MAX_ACCURACY_M and not fix.approximate:
            return {"accepted": False, "reason": "poor_accuracy", "accuracy": fix.accuracy}
        trial = ((await coll("settings").find_one({"id": "app"}, {"_id": 0, "liveGpsPractitionerId": 1})) or {}).get("liveGpsPractitionerId")
        if trial and trial == appt.get("practitionerId") and fix.source != "gps":
            return {"accepted": False, "reason": "live_gps_required"}
        pos = {"lat": fix.lat, "lng": fix.lng}
        eta, route = (await DIRECTIONS.eta(aid, pos, appt["trip"]["to"])) if fix.source == "gps" else (ETA.eta(pos, appt["trip"]["to"]), None)
        eta["confirmed"] = False
        rec_fix = {**fix.model_dump(), "serverTime": now_iso(), "receivedTs": time.time(), "eta": eta, "route": route,
                   "paused": False, "practitionerId": appt.get("practitionerId"), "sharing": True}
        try:
            rejected = await accept_fix(aid, fix.seq, rec_fix)
        except TrackingUnavailable as exc:
            raise HTTPException(503, "Tracking is temporarily unavailable") from exc
        if rejected is not None:
            return {"accepted": False, "reason": "out_of_order", "lastSeq": rejected}
        await emit("location.updated", appt, {"accuracy": fix.accuracy, "seq": fix.seq})
        await emit("eta.updated", appt, {"etaMin": eta.get("etaMin"), "remainingKm": eta.get("remainingKm"), "provider": eta.get("provider"), "confirmed": False})
        return {"accepted": True, "eta": eta}

    @r.get("/sessions/{aid}")
    async def get_session(aid: str, request: Request):
        auth = await auth_of(request)
        return await session_view(auth, await load(aid))

    @r.get("/sessions/{aid}/stream")
    async def stream(aid: str, request: Request):
        auth = await auth_of(request)
        appt = await load(aid)
        await session_view(auth, appt)

        async def gen():
            pubsub = None
            try:
                pubsub = await subscribe(aid)
                yield _sse(await session_view(auth, await load(aid)))
                while True:
                    if await request.is_disconnected():
                        break
                    message = await pubsub.get_message(ignore_subscribe_messages=True, timeout=15)
                    user = await user_from(request)
                    if not user:
                        yield _sse({"phase": "ended", "sharing": False, "confirmedArrival": False})
                        break
                    fresh = await load(aid)
                    if fresh.get("practitionerId") != appt.get("practitionerId") or fresh.get("status") in ("cancelled", "no_show", "arrived"):
                        yield _sse(view(fresh, None, False, False))
                        break
                    try:
                        yield _sse(await session_view(AuthContext(role=user["role"], subject=user.get("subject")), fresh))
                    except HTTPException:
                        yield _sse({"phase": "ended", "sharing": False, "confirmedArrival": False})
                        break
                    if message is None:
                        yield ": heartbeat\n\n"
            finally:
                if pubsub is not None:
                    await pubsub.unsubscribe()
                    await pubsub.aclose()

        return StreamingResponse(gen(), media_type="text/event-stream", headers={**PRIVACY_HEADERS, "X-Accel-Buffering": "no"})

    @r.get("/active")
    async def active(request: Request):
        auth = await auth_of(request)
        if auth.role not in ("owner", "desk"):
            raise HTTPException(403, "Dispatch view is staff-only")
        out = []
        offduty = {p["id"] for p in await coll("practitioners").find({"available": False}, {"_id": 0, "id": 1}).to_list(100)}
        for appt in await coll("appointments").find({"status": "en_route"}, {"_id": 0}).to_list(200):
            if appt.get("practitionerId") in offduty:
                continue
            loc, eta_ok = await authz.can_view(auth, appt, "location"), await authz.can_view(auth, appt, "eta")
            if loc or eta_ok:
                out.append(view(appt, await current_fix(appt), loc, eta_ok))
        return out

    @r.get("/events")
    async def events(request: Request, since: int = 0):
        auth = await auth_of(request)
        p = await perms()

        def can_see(a, event):
            if a.role == "owner":
                return True
            if a.role == "desk":
                return event.get("type") not in ("location.updated",) or bool(p.get("viewLocations"))
            return f"{a.role}:{a.subject}" in (event.get("audience") or [])

        try:
            cursor, found = await poll_events(since)
        except TrackingUnavailable as exc:
            raise HTTPException(503, "Tracking is temporarily unavailable") from exc
        return {"cursor": cursor, "events": [event for event in found if can_see(auth, event)]}

    def _guest_limit(request):
        host = request.client.host if request.client else "unknown"
        return allow_rate(f"guest:{host}", 30)

    async def _guest_view(raw):
        try:
            browser = await lookup_browser(raw)
        except TrackingUnavailable as exc:
            raise HTTPException(503, "Tracking is temporarily unavailable") from exc
        if not browser:
            raise HTTPException(401, "Tracking link expired")
        appt = await load(browser["appointmentId"])
        return view(appt, await current_fix(appt), True, True)

    @r.post("/guest/open")
    async def guest_open(request: Request, body: dict = Body(...)):
        token = body.get("token") if isinstance(body, dict) else None
        if not isinstance(token, str) or not token:
            raise HTTPException(401, "Tracking link expired")
        try:
            if not await _guest_limit(request):
                raise HTTPException(429, "Too many tracking requests")
            raw = await open_guest_browser(token)
        except TrackingUnavailable as exc:
            raise HTTPException(503, "Tracking is temporarily unavailable") from exc
        if not raw:
            raise HTTPException(401, "Tracking link expired")
        payload = await _guest_view(raw)
        response = JSONResponse(payload, headers=PRIVACY_HEADERS)
        response.set_cookie("nt_track", raw, httponly=True, secure=cookie_secure(), samesite=cookie_samesite(), max_age=1800, path="/api/tracking")
        return response

    @r.get("/guest/session")
    async def guest_cookie_session(request: Request):
        try:
            if not await _guest_limit(request):
                raise HTTPException(429, "Too many tracking requests")
        except TrackingUnavailable as exc:
            raise HTTPException(503, "Tracking is temporarily unavailable") from exc
        return await _guest_view(request.cookies.get("nt_track"))

    @r.get("/guest/stream")
    async def guest_stream(request: Request):
        try:
            browser = await lookup_browser(request.cookies.get("nt_track"))
        except TrackingUnavailable as exc:
            raise HTTPException(503, "Tracking is temporarily unavailable") from exc
        if not browser:
            raise HTTPException(401, "Tracking link expired")

        async def gen():
            pubsub = None
            try:
                pubsub = await subscribe(browser["appointmentId"])
                while True:
                    if await request.is_disconnected():
                        break
                    try:
                        fresh = await lookup_browser(request.cookies.get("nt_track"))
                    except TrackingUnavailable:
                        yield _sse({"phase": "unavailable", "sharing": False, "confirmedArrival": False})
                        break
                    if not fresh:
                        yield _sse({"phase": "expired", "sharing": False, "confirmedArrival": False})
                        break
                    appt = await load(fresh["appointmentId"])
                    yield _sse(view(appt, await current_fix(appt), True, True))
                    await pubsub.get_message(ignore_subscribe_messages=True, timeout=15)
                    yield ": heartbeat\n\n"
            finally:
                if pubsub is not None:
                    await pubsub.unsubscribe()
                    await pubsub.aclose()

        return StreamingResponse(gen(), media_type="text/event-stream", headers={**PRIVACY_HEADERS, "X-Accel-Buffering": "no"})

    @r.get("/contracts")
    async def contracts():
        return {"version": EVENT_VERSION, "eventTypes": EVENT_TYPES, "locationFix": LocationFix.model_json_schema(),
                "event": TrackingEvent.model_json_schema(), "transport": "sse",
                "rules": {"staleSec": STALE_SEC, "maxAccuracyM": MAX_ACCURACY_M, "maxSkewSec": MAX_SKEW_SEC,
                          "fixTtlSec": 120, "capabilityTtlSec": 7200, "targetIntervalSec": [5, 10], "confirmedArrival": False}}

    return r


def _sse(payload):
    return f"data: {json_dumps(payload)}\n\n"


def json_dumps(payload):
    import json
    return json.dumps(payload)


async def issue_guest_capability(aid):
    try:
        token = await issue_capability(aid)
    except TrackingUnavailable:
        return None
    return {"token": token, "expiresInSec": 7200}


async def end_tracking(aid):
    await drop_session(aid)
    await DIRECTIONS.drop(aid)
    await redact_location_events(aid)
    await revoke_capabilities(aid)


async def clear_runtime():
    await clear_all()
    DIRECTIONS._cache.clear()
    NOTIFY.sent.clear()


async def on_transition(appt: dict, to: str, extra: Optional[dict] = None):
    """Called by the single lifecycle (server.apply_transition) — no second state model."""
    t = TRANSITION_EVENTS.get(to)
    try:
        if to == "en_route" or to not in ("en_route", "delayed"):
            await drop_session(appt["id"])
            await DIRECTIONS.drop(appt["id"])
            await redact_location_events(appt["id"])
        if to in ("arrived", "cancelled", "no_show", "interrupted"):
            await revoke_capabilities(appt["id"])
        if t:
            event = TrackingEvent(id=str(uuid.uuid4()), type=t, appointmentId=appt["id"], practitionerId=appt.get("practitionerId"),
                                  serverTime=now_iso(), payload=extra or {}, audience=["owner", "desk", f"client:{appt.get('clientId')}", f"practitioner:{appt.get('practitionerId')}"])
            await publish_event(event.model_dump())
    except TrackingUnavailable:
        logging.getLogger(__name__).warning("Tracking storage unavailable during an appointment transition")
    if to == "arrived":
        NOTIFY.notify(f"client:{appt.get('clientId')}", "Your practitioner has arrived", "Location sharing has stopped.")
