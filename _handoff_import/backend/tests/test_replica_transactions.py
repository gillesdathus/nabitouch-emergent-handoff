"""Prove a replica set commits ledger and invoice writes together, and drops both when the transaction aborts."""
import asyncio
import os
import uuid

import pytest
from motor.motor_asyncio import AsyncIOMotorClient


def _replica_url():
    """Use an explicit replica, or the local validation replica. Never the production database."""
    explicit = os.environ.get("REPLICA_MONGO_URL", "").strip()
    if explicit:
        if "nabitouch_prod" in explicit or os.environ.get("APP_ENV", "").strip().lower() == "production":
            pytest.skip("replica transaction tests stay off the production database")
        return explicit
    if os.environ.get("APP_ENV", "").strip().lower() == "production":
        return "mongodb://nt-rb-rs:27017"
    mongo = os.environ.get("MONGO_URL", "").strip()
    if mongo and "replicaSet=" in mongo and "nabitouch_prod" not in mongo:
        return mongo
    return "mongodb://nt-rb-rs:27017"


def test_replica_set_transaction_is_atomic():
    url = _replica_url()
    name = "nabitouch_rs_probe_" + uuid.uuid4().hex[:8]

    async def run():
        client = AsyncIOMotorClient(url, serverSelectionTimeoutMS=2000)
        try:
            hello = await client.admin.command("hello")
        except Exception as exc:
            client.close()
            return "unavailable", str(exc)
        if not hello.get("setName"):
            client.close()
            return "standalone", hello.get("setName")
        db = client[name]
        try:
            async with await client.start_session() as session:
                try:
                    async with session.start_transaction():
                        await db.nt_ledger.insert_one({"id": "led-abort", "amountCents": 100}, session=session)
                        await db.nt_invoices.insert_one({"id": "inv-abort", "balanceCents": 0}, session=session)
                        raise RuntimeError("abort")
                except RuntimeError:
                    pass
            assert await db.nt_ledger.count_documents({"id": "led-abort"}) == 0
            assert await db.nt_invoices.count_documents({"id": "inv-abort"}) == 0
            async with await client.start_session() as session:
                async with session.start_transaction():
                    await db.nt_ledger.insert_one({"id": "led-ok", "amountCents": 100}, session=session)
                    await db.nt_invoices.insert_one({"id": "inv-ok", "balanceCents": 0}, session=session)
            assert await db.nt_ledger.count_documents({"id": "led-ok"}) == 1
            assert await db.nt_invoices.count_documents({"id": "inv-ok"}) == 1
        finally:
            await client.drop_database(name)
            client.close()
        return "ok", hello.get("setName")

    status, detail = asyncio.run(run())
    if status == "unavailable":
        pytest.skip("replica set is not running: " + detail)
    assert status == "ok", detail


def _url():
    return _replica_url()


async def _open():
    client = AsyncIOMotorClient(_url(), serverSelectionTimeoutMS=2000)
    try:
        hello = await client.admin.command("hello")
    except Exception as exc:
        client.close()
        pytest.skip("replica set is not running: " + str(exc))
    if not hello.get("setName"):
        client.close()
        pytest.skip("MongoDB is standalone")
    name = "nabitouch_rs_" + uuid.uuid4().hex[:8]
    database = client[name]
    await database.nt_ledger.create_index("idempotencyKey", unique=True)
    return client, database, hello["setName"]


def test_replica_set_version_conflict_and_idempotent_retry():
    async def run():
        client, database, _set_name = await _open()
        try:
            await database.nt_invoices.insert_one({"id": "inv-1", "version": 1, "balanceCents": 1000})
            async with await client.start_session() as session:
                async with session.start_transaction():
                    updated = await database.nt_invoices.find_one_and_update(
                        {"id": "inv-1", "version": 1},
                        {"$inc": {"version": 1}, "$set": {"balanceCents": 700}},
                        session=session,
                    )
                    await database.nt_ledger.insert_one({"id": "led-1", "invoiceId": "inv-1", "idempotencyKey": "pay-1", "amountCents": 300}, session=session)
                    assert updated["version"] == 1
            async with await client.start_session() as session:
                try:
                    async with session.start_transaction():
                        missed = await database.nt_invoices.find_one_and_update(
                            {"id": "inv-1", "version": 1},
                            {"$inc": {"version": 1}},
                            session=session,
                        )
                        if not missed:
                            raise RuntimeError("conflict")
                        await database.nt_ledger.insert_one({"id": "led-stale", "idempotencyKey": "pay-stale", "amountCents": 1}, session=session)
                except RuntimeError:
                    pass
            assert await database.nt_ledger.count_documents({"id": "led-stale"}) == 0
            assert (await database.nt_invoices.find_one({"id": "inv-1"}))["version"] == 2
            async with await client.start_session() as session:
                try:
                    async with session.start_transaction():
                        await database.nt_ledger.insert_one({"id": "led-dup", "idempotencyKey": "pay-1", "amountCents": 300}, session=session)
                        await database.nt_invoices.update_one({"id": "inv-1"}, {"$inc": {"balanceCents": -300}}, session=session)
                except Exception:
                    pass
            invoice = await database.nt_invoices.find_one({"id": "inv-1"})
            assert invoice["balanceCents"] == 700
            assert await database.nt_ledger.count_documents({"idempotencyKey": "pay-1"}) == 1
        finally:
            await client.drop_database(database.name)
            client.close()
    asyncio.run(run())


def test_replica_set_service_write_and_audit_are_atomic():
    """A catalogue write and its audit commit together. A failed audit leaves no service row."""
    async def run():
        from fastapi import HTTPException

        from catalog import commit_with_audit

        client, database, _set_name = await _open()
        try:
            audit = {"id": "aud-svc-ok", "entity": "service", "entityId": "svc-ok", "action": "Service created: Probe"}

            async def write(session):
                await database.nt_services.insert_one({"id": "svc-ok", "slug": "svc-ok", "name": "Probe"}, session=session)
                return {"id": "svc-ok"}

            await commit_with_audit(database, write, audit)
            assert await database.nt_services.count_documents({"id": "svc-ok"}) == 1
            assert await database.nt_audit.count_documents({"id": "aud-svc-ok"}) == 1

            async def fail(session):
                await database.nt_services.insert_one({"id": "svc-abort", "slug": "svc-abort", "name": "Abort"}, session=session)
                raise RuntimeError("abort")

            try:
                await commit_with_audit(
                    database,
                    fail,
                    {"id": "aud-svc-abort", "entity": "service", "entityId": "svc-abort", "action": "Service created: Abort"},
                )
            except RuntimeError:
                pass
            assert await database.nt_services.count_documents({"id": "svc-abort"}) == 0
            assert await database.nt_audit.count_documents({"id": "aud-svc-abort"}) == 0

            await database.nt_audit.create_index("id", unique=True, name="audit_id_unique")
            await database.nt_audit.insert_one({"id": "aud-svc-conflict", "entity": "service", "entityId": "preexisting"})

            async def audited(session):
                await database.nt_services.insert_one(
                    {"id": "svc-audit-fail", "slug": "svc-audit-fail", "name": "Audit Fail"},
                    session=session,
                )
                return {"id": "svc-audit-fail"}

            with pytest.raises(HTTPException) as caught:
                await commit_with_audit(
                    database,
                    audited,
                    {"id": "aud-svc-conflict", "entity": "service", "entityId": "svc-audit-fail", "action": "Service created: Audit Fail"},
                )
            assert caught.value.status_code == 409
            assert await database.nt_services.count_documents({"id": "svc-audit-fail"}) == 0
            kept = await database.nt_audit.find_one({"id": "aud-svc-conflict"})
            assert kept["entityId"] == "preexisting"
            assert await database.nt_services.count_documents({"id": "svc-ok"}) == 1
        finally:
            await client.drop_database(database.name)
            client.close()

    asyncio.run(run())


def test_replica_set_concurrent_payments_and_notification_abort():
    async def run():
        client, database, _set_name = await _open()
        try:
            await database.nt_invoices.insert_one({"id": "inv-race", "version": 1, "balanceCents": 500})

            async def pay(mark):
                local = AsyncIOMotorClient(_url(), serverSelectionTimeoutMS=2000)
                try:
                    db = local[database.name]
                    async with await local.start_session() as session:
                        async with session.start_transaction():
                            await db.nt_ledger.insert_one({"id": "led-" + mark, "idempotencyKey": "race-same", "amountCents": 100}, session=session)
                            await db.nt_invoices.update_one({"id": "inv-race"}, {"$inc": {"balanceCents": -100}}, session=session)
                    return "ok"
                except Exception:
                    return "conflict"
                finally:
                    local.close()

            results = await asyncio.gather(pay("a"), pay("b"))
            assert results.count("ok") == 1
            assert results.count("conflict") == 1
            assert await database.nt_ledger.count_documents({}) == 1
            assert (await database.nt_invoices.find_one({"id": "inv-race"}))["balanceCents"] == 400
            async with await client.start_session() as session:
                try:
                    async with session.start_transaction():
                        await database.nt_ledger.insert_one({"id": "led-note", "idempotencyKey": "note-1", "amountCents": 50}, session=session)
                        await database.nt_notifications.insert_one({"id": "ntf-abort", "status": "pending", "ref": "NT-1"}, session=session)
                        raise RuntimeError("crash")
                except RuntimeError:
                    pass
            assert await database.nt_notifications.count_documents({"id": "ntf-abort"}) == 0
            assert await database.nt_ledger.count_documents({"id": "led-note"}) == 0
        finally:
            await client.drop_database(database.name)
            client.close()
    asyncio.run(run())
