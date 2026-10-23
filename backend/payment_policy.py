"""Amount due now, from the server booking total. Default is no upfront payment required."""
from decimal import Decimal, ROUND_HALF_UP

# Owner-facing modes. `choice` remains accepted for settings saved before `none` existed.
MODES = ("none", "deposit", "full", "choice")
DEPOSIT_TYPES = ("percent", "fixed")
CHOICES = ("none", "full", "deposit", "cash")


def _cents(value):
    return int((Decimal(str(value)) * Decimal(100)).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def closed_policy():
    """Missing config defaults to no upfront payment. Cash stays off until the owner enables it."""
    return {"mode": "none", "depositType": "percent", "depositPercent": 0, "depositCents": 0, "cashAccepted": False}


def preview_policy():
    """Preview defaults match production: no upfront payment until the owner configures one."""
    return {"mode": "none", "depositType": "percent", "depositPercent": 25, "depositCents": 0, "cashAccepted": True}


def resolve_payment_policy(raw, *, production, explicit=False):
    if not explicit or not isinstance(raw, dict) or not raw:
        return closed_policy() if production else preview_policy()
    mode = raw.get("mode") or "none"
    if mode not in MODES:
        raise ValueError("Choose no upfront payment, a deposit, or full payment")
    deposit_type = raw.get("depositType") or "percent"
    if deposit_type not in DEPOSIT_TYPES:
        raise ValueError("A deposit is a percentage or a fixed amount")
    try:
        percent = int(raw.get("depositPercent") or 0)
        fixed = int(raw.get("depositCents") or 0)
    except (TypeError, ValueError) as exc:
        raise ValueError("Deposit values must be whole numbers") from exc
    if percent < 0 or percent > 100:
        raise ValueError("Deposit percent must be between 0 and 100")
    if fixed < 0:
        raise ValueError("Deposit amount cannot be negative")
    if mode == "deposit":
        if deposit_type == "fixed" and fixed <= 0:
            raise ValueError("Deposit amount must be greater than zero")
        if deposit_type == "percent" and percent <= 0:
            raise ValueError("Deposit percent must be greater than zero")
    cash = bool(raw.get("cashAccepted")) if "cashAccepted" in raw else False
    return {"mode": mode, "depositType": deposit_type, "depositPercent": percent, "depositCents": fixed, "cashAccepted": cash}


def deposit_cents(total_cents, policy):
    total = int(total_cents)
    if total < 0:
        raise ValueError("Booking total cannot be negative")
    if policy.get("depositType") == "fixed":
        amount = int(policy.get("depositCents") or 0)
    else:
        percent = Decimal(int(policy.get("depositPercent") or 0))
        amount = int((Decimal(total) * percent / Decimal(100)).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
    if amount > total:
        raise ValueError("Deposit is greater than the booking total")
    return amount


def due_for_booking(total_dollars, policy, fields):
    """Amount due for the price that will be stored. Insurance does not collect a card amount."""
    fields = fields or {}
    if fields.get("paymentMethod") == "insurance":
        return None
    mode = (policy or {}).get("mode") or "none"
    choice = fields.get("payNow") if fields.get("payNow") in CHOICES else ("cash" if fields.get("selfMethod") == "cash" else None)
    if choice is None and mode == "none":
        choice = "none"
    if not choice:
        return None
    return settlement(total_dollars, policy, choice)


def settlement(total_dollars, policy, choice):
    """Payable now, after the full total exists. Cash and none are not prepayments."""
    total = _cents(total_dollars)
    selected = choice if choice in CHOICES else None
    mode = policy.get("mode") or "none"
    if selected is None:
        if mode == "none":
            selected = "none"
        elif mode in ("deposit", "choice") and int(policy.get("depositPercent") or policy.get("depositCents") or 0):
            selected = "deposit"
        else:
            selected = "full"
    if selected == "none":
        if mode not in ("none", "choice"):
            raise ValueError("This booking requires an online payment")
        return {
            "totalCents": total,
            "dueNowCents": 0,
            "remainingCents": total,
            "paidCents": 0,
            "refundedCents": 0,
            "choice": "none",
            "mode": mode,
            "status": "unpaid",
            "prepaid": False,
        }
    if selected == "cash":
        if not policy.get("cashAccepted"):
            raise ValueError("Cash is not accepted for this booking")
        due = 0
        status = "unpaid"
    elif selected == "full":
        if mode == "deposit":
            raise ValueError("This booking requires the deposit")
        # Under mode none this is an optional online payment, not a booking gate.
        due = total
        status = "payment_required" if due else "paid"
    else:
        if mode == "full":
            raise ValueError("This booking requires full payment")
        if mode == "none":
            raise ValueError("No deposit is required for this booking")
        due = deposit_cents(total, policy)
        status = "deposit_pending" if due < total else "payment_required"
    return {
        "totalCents": total,
        "dueNowCents": due,
        "remainingCents": total - due,
        "paidCents": 0,
        "refundedCents": 0,
        "choice": selected,
        "mode": mode,
        "status": status,
        # Never mark prepaid from intent alone — only verified receipts update paymentDue.paidCents.
        "prepaid": False,
    }


def required_payment_cents(visit):
    """Amount that must be verified before the booking's required payment is satisfied."""
    visit = visit or {}
    due = visit.get("paymentDue") if isinstance(visit.get("paymentDue"), dict) else {}
    pay_now = visit.get("payNow") or due.get("choice")
    if pay_now in ("none", "cash") or pay_now is None:
        return 0
    stored = due.get("dueNowCents")
    if type(stored) is int and stored >= 0:
        return stored
    return 0


def required_payment_satisfied(visit):
    """True only when verified receipts cover the required amount. Never inferred from intent alone."""
    required = required_payment_cents(visit)
    if required <= 0:
        return True
    due = visit.get("paymentDue") if isinstance(visit.get("paymentDue"), dict) else {}
    paid = int(due.get("paidCents") or 0)
    refunded = int(due.get("refundedCents") or 0)
    return max(0, paid - refunded) >= required


def authorized_checkout_cents(visit, balance_cents, received_cents=0, requested_cents=None):
    """Card amount for this attempt. A saved deposit or full payment wins over the outstanding balance and over a client number."""
    balance = int(balance_cents)
    received = int(received_cents or 0)
    if balance <= 0:
        raise ValueError("Amount must be within the outstanding balance")
    visit = visit or {}
    due = visit.get("paymentDue") if isinstance(visit.get("paymentDue"), dict) else {}
    pay_now = visit.get("payNow")
    stored = due.get("dueNowCents")
    if pay_now in ("full", "deposit") and type(stored) is int and stored > 0:
        still_due = stored - received
        authorized = min(balance, still_due) if still_due > 0 else balance
    elif pay_now == "deposit":
        raise ValueError("This visit has no saved deposit amount")
    elif requested_cents is None:
        authorized = balance
    else:
        authorized = requested_cents
    if type(authorized) is not int or authorized <= 0 or authorized > balance:
        raise ValueError("Amount must be within the outstanding balance")
    if requested_cents is not None and pay_now in ("full", "deposit") and requested_cents != authorized:
        raise ValueError("That amount is not the amount due")
    return authorized


def gift_redemption_cents(visit, balance_cents, received_cents, card_balance_cents, requested_cents=None):
    """Gift-card amount for this attempt. The cap is the amount still due, the card balance, and the invoice balance."""
    payable = authorized_checkout_cents(visit, balance_cents, received_cents)
    available = int(card_balance_cents)
    if available <= 0:
        raise ValueError("This gift card has no balance")
    maximum = min(payable, available, int(balance_cents))
    if maximum <= 0:
        raise ValueError("Nothing is payable on this invoice")
    if requested_cents is None:
        return maximum
    if type(requested_cents) is not int or requested_cents <= 0 or requested_cents > maximum:
        raise ValueError("Amount must be within the amount due and the gift-card balance")
    return requested_cents


def manual_settlement_cents(visit, balance_cents, received_cents, requested_cents=None):
    """Staff-confirmed cash or e-Transfer. A partial amount is allowed. It cannot pass the amount still due."""
    payable = authorized_checkout_cents(visit, balance_cents, received_cents)
    if requested_cents is None:
        return payable
    if type(requested_cents) is not int or requested_cents <= 0:
        raise ValueError("Amount must be a positive number of cents")
    if requested_cents > int(balance_cents):
        raise ValueError("That payment is more than the outstanding balance")
    if requested_cents > payable:
        raise ValueError("That amount is more than the amount due")
    return requested_cents


def allowed_online_amounts(balance_cents, policy, received_cents=0):
    """The customer pays the amount due, then later the remainder. Never more than the balance."""
    balance = int(balance_cents)
    received = int(received_cents or 0)
    if balance <= 0:
        return set()
    if received > 0:
        return {balance}
    mode = policy.get("mode") or "none"
    amounts = set()
    if mode in ("full", "choice", "none"):
        amounts.add(balance)
    if mode in ("deposit", "choice"):
        try:
            deposit = deposit_cents(balance + received, policy)
        except ValueError:
            deposit = 0
        if 0 < deposit <= balance:
            amounts.add(deposit)
    return amounts


def checkout_event_action(status, amount_total, expected_cents):
    """A duplicate event settles once. A late success after expiry can still be reconciled."""
    if amount_total != expected_cents:
        return "reject"
    if status == "paid":
        return "duplicate"
    if status in ("pending", "expired"):
        return "settle"
    return "ignore"


CHECKOUT_HOLD_MINUTES = 30


def review_after_expiry(pay_now, received_cents):
    """An expired card checkout stays on the calendar for the owner. The time is not released."""
    if pay_now in ("full", "deposit") and int(received_cents or 0) <= 0:
        return "payment_failed"
    return None


def due_after_payment(total_cents, received_cents, refunded_cents=0):
    """Collected amount and the balance that is still owed. The balance cannot go below zero."""
    total = max(0, int(total_cents))
    received = max(0, int(received_cents))
    refunded = max(0, int(refunded_cents))
    remaining = max(0, total - received)
    if refunded and received <= 0:
        status = "refunded"
    elif refunded and remaining > 0:
        status = "partially_refunded"
    elif remaining <= 0 and total > 0:
        status = "paid"
    elif received > 0:
        status = "partially_paid"
    else:
        status = "unpaid"
    return {"paidCents": received, "remainingCents": remaining, "refundedCents": refunded, "status": status, "prepaid": False}


def collection_status(total_cents, received_cents, refunded_cents):
    """Invoice collection, separate from an insurer decision."""
    total = int(total_cents)
    received = int(received_cents)
    refunded = int(refunded_cents)
    if refunded > 0 and received <= 0:
        return "refunded"
    if refunded > 0 and received < total:
        return "partially_refunded"
    if total > 0 and received >= total:
        return "paid"
    if received > 0:
        return "partially_paid"
    return "unpaid"
