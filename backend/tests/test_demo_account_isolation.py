"""Existing demo sessions cannot survive promotion to production."""
import asyncio
import os
import uuid

import httpx
import pytest
from fastapi import FastAPI, Request
from motor.motor_asyncio import AsyncIOMotorClient

import config
from auth import build_auth, hash_pw


@pytest.mark.parametrize("native", [False, True])
def test_production_refuses_demo_login_access_and_refresh(monkeypatch, native):
    async def run():
        assert os.environ["DB_NAME"].startswith("nabitouch_qa_codex_")
        mongo = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = mongo["nabitouch_qa_codex_auth_" + uuid.uuid4().hex]
        async def audit(*args, **kwargs):
            pass
        router, user_from, require, seed = build_auth(db, lambda name: db["nt_" + name], audit)
        app = FastAPI()
        app.include_router(router)
        @app.get("/probe")
        async def probe(request: Request):
            await require(request)
            return {"ok": True}
        password = uuid.uuid4().hex
        for demo in (True, False):
            email = ("demo" if demo else "real") + "@example.com"
            await db.nt_users.insert_one({"id": uuid.uuid4().hex, "email": email,
                "password_hash": hash_pw(password), "name": "QA", "role": "client", "demo": demo})
            monkeypatch.setattr(config, "is_production", lambda: False)
            headers = {"X-Nabitouch-Client": "native"} if native else {}
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test", headers=headers) as client:
                login_url = "/api/auth/native/login" if native else "/api/auth/login"
                body = {"email": email, "password": password}
                signed = await client.post(login_url, json=body)
                assert signed.status_code == 200
                if native:
                    client.headers["Authorization"] = "Bearer " + signed.json()["accessToken"]
                assert (await client.get("/probe")).status_code == 200
                monkeypatch.setattr(config, "is_production", lambda: True)
                expected = 401 if demo else 200
                assert (await client.get("/probe")).status_code == expected
                if native:
                    refresh = await client.post("/api/auth/native/refresh", json={"refreshToken": signed.json()["refreshToken"]})
                else:
                    refresh = await client.post("/api/auth/refresh")
                assert refresh.status_code == expected
                assert (await client.post(login_url, json=body)).status_code == expected
        mongo.close()
    asyncio.run(run())
