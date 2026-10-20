"""Ephemeral tracking state in Redis.

One latest fix per appointment, a short event ring, and appointment-scoped guest
capabilities. Nothing here is a location history. Keys expire on their own.
"""
import hashlib
import json
import os
import secrets

import redis.asyncio as redis

PREFIX = "nt:trk:"
FIX_TTL = 120
EVENT_TTL = 900
CAP_TTL = 7200
EVENT_LIMIT = 200
# Opt-in safety breadcrumbs (not continuous tracking). Short ring, short TTL.
HISTORY_TTL = 7200
HISTORY_LIMIT = 24

_COMPARE = """
local key = KEYS[1]
local seq = tonumber(ARGV[1])
local body = ARGV[2]
local ttl = tonumber(ARGV[3])
local cur = redis.call('HGET', key, 'seq')
if cur and seq <= tonumber(cur) then
  return cur
end
redis.call('HSET', key, 'seq', seq, 'body', body)
redis.call('EXPIRE', key, ttl)
return 'ok'
"""

_pool = None


class TrackingUnavailable(Exception):
    pass


def redis_url():
    return os.environ.get("REDIS_URL") or ""


def client():
    global _pool
    url = redis_url()
    if not url:
        raise TrackingUnavailable("Tracking storage is not configured")
    if _pool is None:
        _pool = redis.from_url(url, decode_responses=True)
    return _pool


def _fix_key(aid):
    return f"{PREFIX}fix:{aid}"


def _loads(raw):
    if not raw:
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return None


async def read_fix(aid):
    try:
        raw = await client().hget(_fix_key(aid), "body")
    except redis.RedisError as exc:
        raise TrackingUnavailable("Tracking storage is unavailable") from exc
    return _loads(raw)


async def accept_fix(aid, seq, body, ttl=FIX_TTL):
    """Store one latest fix only when seq is strictly newer. Returns last seq on reject."""
    try:
        result = await client().eval(_COMPARE, 1, _fix_key(aid), str(int(seq)), json.dumps(body), str(int(ttl)))
    except redis.RedisError as exc:
        raise TrackingUnavailable("Tracking storage is unavailable") from exc
    if result == "ok":
        return None
    return int(result)


async def force_set(aid, body, ttl=FIX_TTL):
    seq = int(body.get("seq") or 0)
    try:
        pipe = client().pipeline()
        pipe.hset(_fix_key(aid), mapping={"seq": str(seq), "body": json.dumps(body)})
        pipe.expire(_fix_key(aid), int(ttl))
        await pipe.execute()
    except redis.RedisError as exc:
        raise TrackingUnavailable("Tracking storage is unavailable") from exc


async def touch(aid, ttl=FIX_TTL):
    try:
        return bool(await client().expire(_fix_key(aid), int(ttl)))
    except redis.RedisError as exc:
        raise TrackingUnavailable("Tracking storage is unavailable") from exc


async def drop_session(aid):
    try:
        await client().delete(_fix_key(aid), f"{PREFIX}hist:{aid}")
    except redis.RedisError as exc:
        raise TrackingUnavailable("Tracking storage is unavailable") from exc


async def append_safety_sample(aid, sample: dict, *, limit=HISTORY_LIMIT, ttl=HISTORY_TTL):
    """Store a coarse breadcrumb for authorized safety reconstruction. Not a full trip log."""
    key = f"{PREFIX}hist:{aid}"
    try:
        r = client()
        pipe = r.pipeline()
        pipe.lpush(key, json.dumps(sample))
        pipe.ltrim(key, 0, int(limit) - 1)
        pipe.expire(key, int(ttl))
        await pipe.execute()
    except redis.RedisError as exc:
        raise TrackingUnavailable("Tracking storage is unavailable") from exc


async def read_safety_samples(aid, limit=HISTORY_LIMIT):
    try:
        raw = await client().lrange(f"{PREFIX}hist:{aid}", 0, int(limit) - 1)
    except redis.RedisError as exc:
        raise TrackingUnavailable("Tracking storage is unavailable") from exc
    out = []
    for item in raw:
        row = _loads(item)
        if row:
            out.append(row)
    out.reverse()
    return out


async def publish_event(event: dict):
    """Append one short-lived event. Coordinates are not stored in the ring."""
    payload = dict(event.get("payload") or {})
    payload.pop("lat", None)
    payload.pop("lng", None)
    payload.pop("route", None)
    stored = {**event, "payload": payload}
    try:
        r = client()
        cursor = await r.incr(f"{PREFIX}ev:seq")
        stored["cursor"] = int(cursor)
        pipe = r.pipeline()
        pipe.lpush(f"{PREFIX}ev", json.dumps(stored))
        pipe.ltrim(f"{PREFIX}ev", 0, EVENT_LIMIT - 1)
        pipe.expire(f"{PREFIX}ev", EVENT_TTL)
        pipe.expire(f"{PREFIX}ev:seq", EVENT_TTL)
        await pipe.execute()
        await r.publish(f"{PREFIX}ch:{event.get('appointmentId')}", json.dumps({"cursor": stored["cursor"], "type": event.get("type")}))
    except redis.RedisError as exc:
        raise TrackingUnavailable("Tracking storage is unavailable") from exc
    return stored["cursor"]


async def poll_events(since: int):
    try:
        raw = await client().lrange(f"{PREFIX}ev", 0, EVENT_LIMIT - 1)
        seq = await client().get(f"{PREFIX}ev:seq")
    except redis.RedisError as exc:
        raise TrackingUnavailable("Tracking storage is unavailable") from exc
    events = []
    for item in raw:
        ev = _loads(item)
        if ev and int(ev.get("cursor") or 0) > since:
            events.append(ev)
    events.sort(key=lambda ev: ev["cursor"])
    return int(seq or 0), events


async def redact_location_events(aid):
    try:
        r = client()
        raw = await r.lrange(f"{PREFIX}ev", 0, EVENT_LIMIT - 1)
        kept = []
        for item in raw:
            ev = _loads(item) or {}
            if ev.get("appointmentId") == aid and ev.get("type") in ("location.updated", "eta.updated"):
                continue
            kept.append(item)
        pipe = r.pipeline()
        pipe.delete(f"{PREFIX}ev")
        if kept:
            pipe.rpush(f"{PREFIX}ev", *reversed(kept))
            pipe.expire(f"{PREFIX}ev", EVENT_TTL)
        await pipe.execute()
    except redis.RedisError as exc:
        raise TrackingUnavailable("Tracking storage is unavailable") from exc


async def issue_capability(aid, ttl=CAP_TTL):
    token = secrets.token_urlsafe(32)
    digest = hashlib.sha256(token.encode()).hexdigest()
    try:
        r = client()
        await r.set(f"{PREFIX}cap:{digest}", json.dumps({"appointmentId": aid}), ex=int(ttl))
        await r.sadd(f"{PREFIX}caps:{aid}", digest)
        await r.expire(f"{PREFIX}caps:{aid}", int(ttl))
    except redis.RedisError as exc:
        raise TrackingUnavailable("Tracking storage is unavailable") from exc
    return token


async def lookup_capability(token):
    if not token or len(token) > 200:
        return None
    digest = hashlib.sha256(token.encode()).hexdigest()
    try:
        raw = await client().get(f"{PREFIX}cap:{digest}")
    except redis.RedisError as exc:
        raise TrackingUnavailable("Tracking storage is unavailable") from exc
    return _loads(raw)


async def revoke_capabilities(aid):
    try:
        r = client()
        members = await r.smembers(f"{PREFIX}caps:{aid}")
        browsers = await r.smembers(f"{PREFIX}gss:{aid}")
        keys = [f"{PREFIX}cap:{item}" for item in members]
        keys.extend(f"{PREFIX}gs:{item}" for item in browsers)
        keys.extend((f"{PREFIX}caps:{aid}", f"{PREFIX}gss:{aid}"))
        if keys:
            await r.delete(*keys)
    except redis.RedisError as exc:
        raise TrackingUnavailable("Tracking storage is unavailable") from exc


async def open_guest_browser(token, ttl=1800):
    """Trade a capability for a browser session. The capability token is not the cookie value."""
    cap = await lookup_capability(token)
    if not cap:
        return None
    raw = secrets.token_urlsafe(32)
    digest = hashlib.sha256(raw.encode()).hexdigest()
    capability = hashlib.sha256(token.encode()).hexdigest()
    aid = cap["appointmentId"]
    try:
        r = client()
        await r.set(f"{PREFIX}gs:{digest}", json.dumps({"appointmentId": aid, "capability": capability}), ex=int(ttl))
        await r.sadd(f"{PREFIX}gss:{aid}", digest)
        await r.expire(f"{PREFIX}gss:{aid}", CAP_TTL)
    except redis.RedisError as exc:
        raise TrackingUnavailable("Tracking storage is unavailable") from exc
    return raw


async def lookup_browser(raw):
    if not raw or len(raw) > 200:
        return None
    digest = hashlib.sha256(raw.encode()).hexdigest()
    key = f"{PREFIX}gs:{digest}"
    try:
        r = client()
        data = _loads(await r.get(key))
        if not data:
            return None
        if not await r.exists(f"{PREFIX}cap:{data.get('capability')}"):
            await r.delete(key)
            return None
    except redis.RedisError as exc:
        raise TrackingUnavailable("Tracking storage is unavailable") from exc
    return data


async def allow_rate(bucket, limit, window=60):
    key = f"{PREFIX}rl:{bucket}"
    try:
        r = client()
        count = await r.incr(key)
        if count == 1:
            await r.expire(key, window)
    except redis.RedisError as exc:
        raise TrackingUnavailable("Tracking storage is unavailable") from exc
    return count <= limit


async def cache_get(aid):
    try:
        return _loads(await client().get(f"{PREFIX}eta:{aid}"))
    except (redis.RedisError, TrackingUnavailable):
        return None


async def cache_set(aid, value, ttl=45):
    try:
        await client().set(f"{PREFIX}eta:{aid}", json.dumps(value), ex=int(ttl))
    except (redis.RedisError, TrackingUnavailable, TypeError):
        return


async def cache_drop(aid):
    try:
        await client().delete(f"{PREFIX}eta:{aid}")
    except (redis.RedisError, TrackingUnavailable):
        return


async def subscribe(aid):
    pubsub = client().pubsub()
    await pubsub.subscribe(f"{PREFIX}ch:{aid}")
    return pubsub


async def clear_all():
    """Drop ephemeral tracking keys. Used by the demo reset, never by a location archive."""
    try:
        r = client()
        keys = [key async for key in r.scan_iter(f"{PREFIX}*")]
        if keys:
            await r.delete(*keys)
    except redis.RedisError as exc:
        raise TrackingUnavailable("Tracking storage is unavailable") from exc
