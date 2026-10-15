import os
import uuid
from datetime import datetime, timezone, timedelta

import pytest
from fastapi import HTTPException

from training import assert_training_database, seed_documents, training_database_name


def test_training_database_cannot_be_the_operational_database(monkeypatch):
    monkeypatch.setenv("DB_NAME", "nabitouch_prod")
    monkeypatch.delenv("APP_ENV", raising=False)
    with pytest.raises(HTTPException):
        training_database_name()
    monkeypatch.setenv("DB_NAME", "nabitouch_preview")
    monkeypatch.setenv("APP_ENV", "development")
    monkeypatch.delenv("TRAINING_DB_NAME", raising=False)
    assert training_database_name() == "nabitouch_preview_training"
    monkeypatch.setenv("TRAINING_DB_NAME", "nabitouch_preview")
    with pytest.raises(HTTPException):
        training_database_name()


def test_seed_records_are_fictional_and_marked():
    scenario = "trn-" + uuid.uuid4().hex[:10]
    seeded = seed_documents(scenario, (datetime.now(timezone.utc) + timedelta(days=7)).isoformat())
    flat = repr(seeded["collections"])
    assert "TRAINING ONLY — NOT A VALID INVOICE" in flat
    assert "TRAINING — NOT VALID" in flat
    assert "info@nabitouch.com" not in flat
    assert all(row.get("scenarioId") == scenario and row.get("training") is True for rows in seeded["collections"].values() for row in rows)
    assert {row["role"] for row in seeded["users"]} == {"practitioner", "client", "desk", "owner"}


class _Database:
    def __init__(self, name):
        self.name = name


def test_guard_refuses_the_operational_handle(monkeypatch):
    monkeypatch.setenv("DB_NAME", "nabitouch_preview")
    with pytest.raises(HTTPException):
        assert_training_database(_Database("nabitouch_preview"))
    assert assert_training_database(_Database("nabitouch_preview_training")).name.endswith("_training")


@pytest.mark.skipif(not os.environ.get("MONGO_URL"), reason="Mongo is not configured")
def test_training_payment_does_not_change_operational_appointments():
    from pymongo import MongoClient

    client = MongoClient(os.environ["MONGO_URL"], serverSelectionTimeoutMS=4000)
    operational = client[os.environ["DB_NAME"]]
    assert operational.name == "nabitouch_preview"
    before = operational.nt_appointments.count_documents({})
    training = assert_training_database(client["nabitouch_preview_training"])
    scenario = "trn-" + uuid.uuid4().hex[:10]
    expires = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
    seeded = seed_documents(scenario, expires)
    try:
        for name, rows in seeded["collections"].items():
            training[f"nt_{name}"].insert_many(rows)
        training.nt_appointments.update_one({"id": f"{scenario}-visit-open"}, {"$set": {"paymentStatus": "paid", "settle.clientPaid": 105}})
        assert operational.nt_appointments.count_documents({}) == before
        assert training.nt_appointments.count_documents({"scenarioId": scenario, "paymentStatus": "paid"}) == 2
        for name in training.list_collection_names():
            training[name].delete_many({"scenarioId": scenario})
        assert training.nt_appointments.count_documents({"scenarioId": scenario}) == 0
        assert operational.nt_appointments.count_documents({}) == before
    finally:
        for name in training.list_collection_names():
            training[name].delete_many({"scenarioId": scenario})
        client.close()
