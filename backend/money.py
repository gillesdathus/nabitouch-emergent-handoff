"""Exact money conversion. Authoritative amounts are integer cents."""
from decimal import Decimal, ROUND_HALF_UP


def to_cents(value):
    return int((Decimal(str(value)) * Decimal(100)).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def dollars(cents):
    return float(Decimal(int(cents)) / Decimal(100))
