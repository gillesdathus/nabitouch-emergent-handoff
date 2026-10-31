"""Synthetic demo data for the Nabitouch prototype. All people, policies and notes are fictional."""
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from availability import draft_schedule, launch_clinic, launch_policy, launch_practitioner
from pricing import launch_service_coverage, launch_welcome_offer
from rewards import launch_rewards
from package_program import launch_package_program
from config import is_production
from payments import with_settle, claim_eligible
from trial import launch_trial_service

TZ = ZoneInfo("America/Edmonton")


def S(slug, name, short, desc, benefits, goals, prices, img, mobile=True, clinic=True, prep=None):
    return {"id": slug, "slug": slug, "name": name, "short": short, "description": desc, "benefits": benefits,
            "goals": goals, "prices": prices, "img": img, "mobile": mobile, "clinic": clinic, "enabled": True,
            "prep": prep or ["Hydrate well before and after your session.",
                             "Clear a 2 × 3 m space — your practitioner brings the table, linens and oils.",
                             "Share any recent injuries, medications or health changes when you book."]}


SERVICES = [
    S("swedish", "Swedish Massage", "Long, flowing strokes to help you unwind.",
      "A gentle, full-body massage using long gliding strokes, kneading and light rhythmic movements. Ideal if you want to relax, de-stress or are new to massage.",
      ["May ease everyday muscle tension", "Can support relaxation and better rest", "Gentle introduction to massage therapy"],
      ["Stress relief", "Relaxation", "General wellness"], {"30": 70, "60": 120, "90": 165}, "/img/swedish.jpg"),
    S("deep-tissue", "Deep Tissue Massage", "Slower, focused pressure for stubborn tension.",
      "Targets deeper layers of muscle and connective tissue with slow, sustained pressure. Often chosen for chronic tightness in the back, neck and shoulders.",
      ["May help reduce chronic muscle tightness", "Can improve comfort with daily movement", "Focused work on problem areas"],
      ["Chronic tension", "Desk posture", "Muscle tightness"], {"30": 80, "60": 130, "90": 180}, "/img/deep.jpg"),
    S("sports", "Sports Massage", "Recovery-focused work for active bodies.",
      "Combines techniques like stretching, compression and targeted pressure to support training, recovery and mobility for runners, lifters and weekend athletes.",
      ["May support post-activity recovery", "Can help maintain flexibility", "Pre-event or recovery-focused options"],
      ["Training recovery", "Mobility", "Pre-event preparation"], {"30": 80, "60": 130, "90": 180}, "/img/sports.jpg"),
    S("prenatal", "Prenatal Massage", "Side-lying comfort for growing families.",
      "Adapted positioning and pillows keep you supported and comfortable. Focuses on areas that commonly carry extra load during pregnancy, such as the lower back and hips.",
      ["May ease lower-back and hip discomfort", "Can support relaxation and rest", "Positioned for comfort and safety"],
      ["Pregnancy comfort", "Relaxation", "Back & hip support"], {"60": 125, "90": 170}, "/img/prenatal.jpg",
      prep=["Please share your trimester and any guidance from your care provider.",
            "Wear comfortable clothing — we bring supportive bolsters.",
            "Hydrate before and after your session."]),
    S("hot-stone", "Hot Stone Massage", "Warm basalt stones melt the day away.",
      "Smooth heated stones are used alongside massage strokes to deliver deep, soothing warmth. A deeply calming experience for colder Edmonton days.",
      ["Warmth may help muscles relax", "Can promote a deep sense of calm", "Comforting option in colder months"],
      ["Relaxation", "Muscle warmth", "Stress relief"], {"60": 140, "90": 190}, "/img/hotstone.jpg"),
    S("hand-arm", "Hand & Arm Massage", "Relief for typing, crafting and gripping hands.",
      "Focused work on forearms, wrists and hands — popular with office workers, musicians and anyone who uses their hands all day.",
      ["May ease forearm and hand fatigue", "Can feel refreshing during busy workdays", "Great as an office add-on"],
      ["Desk work", "Hand fatigue", "Quick reset"], {"30": 55, "60": 95}, "/img/hand.jpg"),
    S("foot-reflexology", "Foot Massage & Reflexology", "Grounding pressure for tired feet.",
      "A soothing foot and lower-leg treatment using reflexology-inspired pressure techniques. Perfect after long shifts on your feet.",
      ["May relieve tired, achy feet", "Can feel deeply grounding and relaxing", "Seated or reclined options"],
      ["Tired feet", "Relaxation", "Long shifts"], {"30": 60, "60": 105}, "/img/foot.jpg"),
    S("scalp", "Scalp Massage", "A calming reset for busy minds.",
      "Gentle, rhythmic pressure across the scalp, neck and shoulders. A lovely add-on or stand-alone pause in your day.",
      ["May ease head and neck tension", "Can help you feel calm and refreshed", "No oils needed on request"],
      ["Stress relief", "Neck tension", "Quick reset"], {"30": 55, "60": 95}, "/img/scalp.jpg"),
    S("mobile", "Mobile Massage", "Your choice of therapy, wherever you are.",
      "Not sure which treatment fits? Book a mobile session and your practitioner will tailor the techniques to your goals — at home, the office, a hotel or an event.",
      ["Tailored to your goals on the day", "No commute before or after", "Professional equipment brought to you"],
      ["Convenience", "Tailored care", "Events & corporate"], {"30": 75, "60": 125, "90": 170}, "/img/mobile.jpg", clinic=False),
    S("senior", "Senior / Elderly Massage", "Gentle, patient care for older adults.",
      "Lighter pressure, flexible positioning (including seated) and unhurried pacing for older adults — in the comfort of their own home or residence.",
      ["May support comfort and circulation", "Can ease stiffness gently", "Seated or bed-side options"],
      ["Gentle comfort", "Mobility", "Companionship & calm"], {"30": 65, "60": 115}, "/img/senior.jpg"),
    # Standalone acquisition trial — not a flash discount, add-on, or paid regular service.
    launch_trial_service(),
]

PRACTITIONERS = [
    {"id": "p-maya", "name": "Maya Chen", "initials": "MC", "color": "#1565F0", "isOwner": False,
     "specialties": ["deep-tissue", "sports", "swedish"], "available": True,
     "licenseExpiry": "+40", "insuranceExpiry": "+210", "bio": "Loves helping desk workers and runners move comfortably.",
     "directBilling": True, "mobile": True, "base": {"lat": 53.5660, "lng": -113.5250}},
    {"id": "p-liam", "name": "Liam Fournier", "initials": "LF", "color": "#0E9E9A", "isOwner": False,
     "specialties": ["senior", "swedish", "hot-stone"], "available": True,
     "licenseExpiry": "+300", "insuranceExpiry": "+22", "bio": "Patient, gentle approach — great with older adults.",
     "directBilling": False, "mobile": True, "base": {"lat": 53.4900, "lng": -113.4500}},
    {"id": "p-priya", "name": "Priya Sandhu", "initials": "PS", "color": "#7BC74D", "isOwner": False,
     "specialties": ["prenatal", "foot-reflexology", "scalp"], "available": True,
     "licenseExpiry": "+150", "insuranceExpiry": "+180", "bio": "Calm, nurturing care for prenatal clients.",
     "directBilling": True, "mobile": True, "base": {"lat": 53.5000, "lng": -113.5600}},
    {"id": "p-jordan", "name": "Jordan Ellis", "initials": "JE", "color": "#0B2E8A", "isOwner": True,
     "specialties": ["deep-tissue", "prenatal", "hot-stone"], "available": True,
     "licenseExpiry": "+95", "insuranceExpiry": "+95", "bio": "Owner & practitioner (demo persona).",
     "directBilling": True, "mobile": True, "base": {"lat": 53.5461, "lng": -113.4938}},
]

ADDR = {
    "sarah": {"label": "Home", "line": "10150 104 St NW, Edmonton, AB", "lat": 53.5435, "lng": -113.4990},
    "david": {"label": "Office", "line": "10020 100 St NW, Edmonton, AB", "lat": 53.5410, "lng": -113.4900},
    "elena": {"label": "Home", "line": "9620 83 Ave NW, Edmonton, AB", "lat": 53.5180, "lng": -113.4730},
    "marcus": {"label": "Home", "line": "11135 83 Ave NW, Edmonton, AB", "lat": 53.5190, "lng": -113.5170},
    "aisha": {"label": "Home", "line": "5320 Terwillegar Blvd NW, Edmonton, AB", "lat": 53.4620, "lng": -113.5850},
    "noah": {"label": "Hotel", "line": "10222 102 St NW, Edmonton, AB", "lat": 53.5445, "lng": -113.4935},
}


def zone_for(a):
    from math import radians, sin, cos, asin, sqrt
    lat1, lng1, lat2, lng2 = map(radians, [53.5461, -113.4938, a["lat"], a["lng"]])
    d = 2 * 6371 * asin(sqrt(sin((lat2 - lat1) / 2) ** 2 + cos(lat1) * cos(lat2) * sin((lng2 - lng1) / 2) ** 2))
    return "z-central" if d <= 6 else "z-inner" if d <= 14 else "z-outer" if d <= 25 else None


def client(cid, first, last, dob, addr, **kw):
    a = {**ADDR[addr], "id": f"ad-{addr}"}
    a["zoneId"] = zone_for(a)
    base = {"id": cid, "firstName": first, "lastName": last, "preferredName": "", "dob": dob,
            "email": f"{first.lower()}.demo@example.com", "phone": "780-555-01" + str(10 + len(first)),
            "language": "English", "contactMethod": "Text", "marketingConsent": False,
            "addresses": [a], "insurance": [], "favorites": [], "preferredPractitioners": [],
            "loyaltyPoints": 0, "onlineBookings": 1, "emergencyContact": "", "photo": None, "synthetic": True}
    return {**base, **kw}


def build_seed():
    now = datetime.now(TZ)
    today = now.date()

    def d(off):
        return (today + timedelta(days=off)).isoformat()

    def ago(mins):
        return (datetime.now(timezone.utc) - timedelta(minutes=mins)).isoformat()

    def exp(v):
        return d(int(v))

    practitioners = [{**p, "licenseExpiry": exp(p["licenseExpiry"]), "insuranceExpiry": exp(p["insuranceExpiry"]),
                      "bookable": False, "available": False, "onboardingStatus": "archived_demo"}
                     for p in PRACTITIONERS]
    # Sole designated therapist for booking paths (Checkpoint B/C). Historical demo rows keep prior ids.
    from availability import launch_practitioner
    nabitu = {
        **launch_practitioner(),
        "available": True,
        "bookable": True,
        "onboardingStatus": "approved",
        "specialties": ["deep-tissue", "swedish", "sports", "hot-stone", "prenatal", "foot-reflexology", "scalp", "senior", "mobile"],
        "licenseExpiry": exp("+400"),
        "insuranceExpiry": exp("+400"),
        "directBilling": True,
        "base": {"lat": 53.5461, "lng": -113.4938},
        "bio": "Designated NabiTouch therapist (demo).",
    }
    practitioners = [nabitu] + practitioners

    clients = [
        client("c-sarah", "Sarah", "Thompson", f"1990-{today.month:02d}-{min(today.day + 12, 28):02d}", "sarah",
               marketingConsent=True, favorites=["deep-tissue", "hot-stone"], preferredPractitioners=["p-nabitu-kahindo"],
               loyaltyPoints=340, onlineBookings=3, preferredName="Sarah",
               insurance=[{"id": "ins-sarah", "insurer": "Alberta Blue Cross", "policy": "DEMO-448120",
                           "memberId": "MBR-0093321", "holderName": "Sarah Thompson", "relationship": "Self",
                           "holderDob": "", "secondary": "", "status": "direct_billing_available"}]),
        client("c-david", "David", "Okoro", "1984-03-14", "david", favorites=["sports"],
               insurance=[{"id": "ins-david", "insurer": "Demo Health Plan Ltd.", "policy": "DHP-220045",
                           "memberId": "77120-04", "holderName": "Grace Okoro", "relationship": "Spouse",
                           "holderDob": "1986-07-02", "secondary": "", "status": "ready_for_verification",
                           "hasCardImage": True}]),
        client("c-elena", "Elena", "Rossi", "1946-11-30", "elena", language="Italian", contactMethod="Phone",
               emergencyContact="Marco Rossi (son) · 780-555-0177",
               insurance=[{"id": "ins-elena", "insurer": "Sample Benefits Co. (demo)", "policy": "", "memberId": "",
                           "holderName": "Elena Rossi", "relationship": "Self", "holderDob": "", "secondary": "",
                           "status": "info_required"}]),
        client("c-marcus", "Marcus", "Lee", "1993-06-08", "marcus", onlineBookings=2),
        client("c-aisha", "Aisha", "Rahman", "1995-01-19", "aisha", favorites=["prenatal"], contactMethod="Email"),
        client("c-noah", "Noah", "Martin", "1988-09-02", "noah"),
    ]
    caddr = {c["id"]: c["addresses"][0] for c in clients}
    zfee = {"z-central": 0, "z-inner": 15, "z-outer": 30, None: 0}
    svc = {s["slug"]: s for s in SERVICES}

    def pricing(slug, dur, cid, promo=False):
        base = svc[slug]["prices"][str(dur)]
        disc = round(min(base * 0.2, 40), 2) if promo else 0
        travel = zfee[caddr[cid]["zoneId"]]
        sub = base - disc + travel
        tax = round(sub * 0.05, 2)
        return {"base": base, "addons": 0, "addonList": [], "discount": disc, "promoId": "promo-welcome" if promo else None,
                "travel": travel, "tax": tax, "total": round(sub + tax, 2)}

    flow = ["requested", "assigned", "preparing", "en_route", "arrived", "in_session", "session_ended",
            "soap_pending", "soap_completed", "leaving", "completed", "processing", "closed"]

    def appt(aid, ref, cid, slug, dur, day, time, pid, status, pay="self", paystat="unpaid", loc="home",
             start_ago=None, promo=False, soap="none", goals=None, ins=None):
        idx = flow.index(status) if status in flow else 1
        path = flow[:idx + 1]
        if status == "no_show":
            path = ["requested", "assigned", "no_show"]
        mins = start_ago if start_ago is not None else 0
        events, ts = [], {}
        for i, st in enumerate(path):
            at = ago(mins + (len(path) - i) * 4) if start_ago is not None else f"{day}T08:00:00-06:00"
            if st == "in_session" and start_ago is not None:
                at = ago(start_ago)
            events.append({"status": st, "at": at, "actor": "seed"})
            ts[st] = at
        return {"id": aid, "ref": ref, "clientId": cid, "serviceSlug": slug, "duration": dur, "date": day,
                "time": time, "practitionerId": pid, "status": status, "locationType": loc,
                "address": {**caddr[cid], "notes": "Buzzer 1204, visitor parking at rear (demo)" if loc == "office" else ""},
                "events": events, "timestamps": ts, "pricing": pricing(slug, dur, cid, promo),
                "paymentMethod": pay, "paymentStatus": paystat, "insuranceId": ins,
                "preferences": {"goals": goals or ["Relaxation"], "pressure": "Medium", "focus": ["Back", "Shoulders"],
                                "notes": ""},
                "soapStatus": soap, "timer": {"pausedMs": 0}, "source": "online", "checkedIn": False,
                "feedback": None, "synthetic": True}

    appointments = [
        appt("a-090", "NT-1032", "c-sarah", "deep-tissue", 60, d(-21), "17:00", "p-maya", "closed", "insurance",
             "claim_accepted", soap="signed", goals=["Chronic tension"], ins="ins-sarah", promo=False),
        appt("a-091", "NT-1018", "c-sarah", "swedish", 60, d(-49), "18:00", "p-maya", "closed", "self", "paid",
             promo=True, soap="signed"),
        appt("a-092", "NT-1040", "c-david", "sports", 60, d(-14), "12:00", "p-maya", "closed", "insurance",
             "balance_due", soap="signed", ins="ins-david", loc="office"),
        appt("a-101", "NT-1051", "c-david", "sports", 60, d(0), "10:00", "p-maya", "assigned", "insurance",
             "verification_pending", loc="office", goals=["Training recovery", "Mobility"], ins="ins-david"),
        appt("a-102", "NT-1052", "c-elena", "senior", 60, d(0), "09:30", "p-liam", "in_session", "self", "unpaid",
             start_ago=22, goals=["Gentle comfort"]),
        appt("a-103", "NT-1049", "c-marcus", "swedish", 90, d(0), "08:00", "p-priya", "soap_pending", "self", "paid",
             start_ago=95, soap="draft"),
        appt("a-104", "NT-1053", "c-aisha", "prenatal", 60, d(0), "13:00", "p-jordan", "assigned", "self", "unpaid",
             goals=["Pregnancy comfort"]),
        appt("a-105", "NT-1054", "c-sarah", "hot-stone", 90, d(0), "17:30", "p-maya", "assigned", "insurance",
             "direct_billing_available", goals=["Relaxation", "Muscle warmth"], ins="ins-sarah"),
        appt("a-106", "NT-1055", "c-noah", "deep-tissue", 60, d(0), "11:30", "p-liam", "en_route", "self", "unpaid",
             loc="hotel", start_ago=-1),
        appt("a-107", "NT-1056", "c-marcus", "foot-reflexology", 30, d(1), "11:00", None, "requested", "self",
             "unpaid"),
        appt("a-108", "NT-1045", "c-noah", "swedish", 60, d(-1), "16:00", "p-priya", "no_show", "self", "unpaid",
             loc="hotel"),
        appt("a-109", "NT-1057", "c-aisha", "prenatal", 90, d(3), "10:00", "p-priya", "assigned", "self", "unpaid"),
        appt("a-111", "NT-1050", "c-sarah", "swedish", 60, d(-2), "18:00", "p-maya", "processing", "insurance",
             "claim_submitted", soap="signed", ins="ins-sarah", loc="clinic"),
        appt("a-112", "NT-1046", "c-marcus", "deep-tissue", 60, d(-6), "15:00", "p-liam", "processing", "insurance",
             "claim_declined", soap="signed"),
    ]
    gst = 0.05

    def claim(a, status, approved=0, ins_pay="none"):
        el = claim_eligible(a["pricing"], gst)
        a["claim"] = {"status": status, "eligible": el, "approved": el if approved == "full" else approved,
                      "insurerPayment": ins_pay, "insurerPaid": (el if approved == "full" else approved) if ins_pay == "confirmed" else 0,
                      "history": [{"action": status, "at": ago(600), "by": "seed"}]}

    def pay(a, provider, amount, status, mins):
        a.setdefault("payments", []).append({"id": f"pay-{a['id']}-{len(a['payments'])}", "provider": provider, "amount": amount,
                                              "status": status, "at": ago(mins), "intentId": f"pi_demo_{a['id'].replace('-', '')}{len(a['payments'])}" if provider == "stripe" else None,
                                              "receipt": f"RCPT-{a['id'][-3:]}{len(a['payments'])}" if status == "succeeded" else None,
                                              "failure": "card_declined (simulated)" if status == "failed" else None})
    by = {a["id"]: a for a in appointments}
    for a in appointments:
        a.setdefault("payments", [])
        a["claim"] = {"status": "none", "eligible": 0, "approved": 0, "insurerPayment": "none", "insurerPaid": 0, "history": []}
    claim(by["a-090"], "approved", "full", "confirmed")                       # full coverage → $0 balance
    claim(by["a-092"], "partially_approved", 85, "confirmed")                # partial: insurer paid $85
    pay(by["a-092"], "stripe", round(by["a-092"]["pricing"]["total"] - 85, 2), "failed", 900)  # failed card → retry
    claim(by["a-111"], "submitted")                                           # main scenario: awaiting insurer
    claim(by["a-112"], "declined")                                            # declined → client responsibility
    claim(by["a-101"], "verification_pending")
    claim(by["a-105"], "verification_pending")
    pay(by["a-091"], "stripe", by["a-091"]["pricing"]["total"], "succeeded", 70000)
    pay(by["a-103"], "cash", by["a-103"]["pricing"]["total"], "succeeded", 60)
    by["a-111"]["address"] = {"line": "[Clinic address — to be supplied]", "lat": 53.5461, "lng": -113.4938, "zoneId": None, "notes": ""}
    by["a-111"]["pricing"] = {**by["a-111"]["pricing"], "travel": 0, "tax": 6.0, "total": 126.0}
    by["a-111"]["claim"]["eligible"] = 126.0
    by["a-106"]["trip"] = {"to": {"lat": ADDR["noah"]["lat"], "lng": ADDR["noah"]["lng"]}, "startedAt": ago(0.5),
                           "sharing": False, "simulated": True, "location": "sample"}
    appointments = [with_settle(a) for a in appointments]
    for a in appointments:
        if a["id"] == "a-106":
            a["events"] = a["events"][:4]
            a["timestamps"] = {e["status"]: e["at"] for e in a["events"]}
        if a["status"] == "closed":
            a["feedback"] = None

    soap = [
        {"id": "soap-090", "appointmentId": "a-090", "clientId": "c-sarah", "practitionerId": "p-maya", "status": "signed",
         "signedAt": f"{d(-21)}T19:10:00-06:00", "signedBy": "Maya Chen",
         "S": {"chips": ["Low back tightness", "Desk work 8h+"], "pain": 6, "text": "Reports stiffness after long workdays (synthetic)."},
         "O": {"chips": ["Hypertonic upper trapezius", "Reduced lumbar flexion"], "areas": ["upper-back", "lower-back", "neck"], "text": ""},
         "A": {"chips": ["Responded well to treatment"], "text": "Tension reduced post-treatment per client report."},
         "P": {"chips": ["Rebook in 3 weeks", "Heat at home"], "text": "Continue focus on lumbar & trapezius."}},
        {"id": "soap-103", "appointmentId": "a-103", "clientId": "c-marcus", "practitionerId": "p-priya", "status": "draft",
         "S": {"chips": ["General stress"], "pain": 3, "text": ""}, "O": {"chips": [], "areas": ["upper-back"], "text": ""},
         "A": {"chips": [], "text": ""}, "P": {"chips": [], "text": ""}},
    ]
    plans = [
        {"id": "plan-sarah", "clientId": "c-sarah", "practitionerId": "p-maya", "title": "Desk-posture tension plan",
         "frequency": "Every 3 weeks", "sessionsTotal": 6, "sessionsDone": 3, "homeCare": ["Hourly posture breaks", "Warm compress 10 min"],
         "nextReview": d(30), "visibleToClient": True},
        {"id": "plan-david", "clientId": "c-david", "practitionerId": "p-maya", "title": "Marathon training recovery",
         "frequency": "Every 2 weeks", "sessionsTotal": 8, "sessionsDone": 2, "homeCare": ["Foam roll calves", "Hip flexor stretch"],
         "nextReview": d(21), "visibleToClient": True},
    ]
    promotions = [
        {"id": "promo-welcome", "code": "WELCOME20", "name": "First-booking welcome offer", "type": "percent",
         "value": 20, "maxDiscount": 40, "eligibility": "first_online", "start": d(-60), "end": d(365),
         "services": "all", "stackable": False, "redemptionLimit": 500, "redemptions": 37, "enabled": True,
         "approval": "approved", "appliesTo": "treatment"},
        {"id": "promo-birthday", "code": "BDAY15", "name": "Birthday month treat — $15 off", "type": "fixed",
         "value": 15, "maxDiscount": 15, "eligibility": "birthday_month", "start": d(-60), "end": d(365),
         "services": "all", "stackable": False, "redemptionLimit": None, "redemptions": 4, "enabled": True,
         "approval": "approved", "appliesTo": "treatment", "requiresMarketingConsent": True},
        {"id": "promo-referral", "code": "FRIEND10", "name": "Refer a friend — $10 each", "type": "fixed", "value": 10,
         "maxDiscount": 10, "eligibility": "referral", "start": d(-10), "end": d(180), "services": "all",
         "stackable": False, "redemptionLimit": 200, "redemptions": 0, "enabled": False,
         "approval": "pending", "appliesTo": "treatment"},
    ]
    zones = [
        {"id": "z-central", "name": "Central Edmonton", "radiusKm": 6, "fee": 0, "color": "#14D8C4", "enabled": True},
        {"id": "z-inner", "name": "Inner ring", "radiusKm": 14, "fee": 15, "color": "#18A8F5", "enabled": True},
        {"id": "z-outer", "name": "Outer ring & suburbs", "radiusKm": 25, "fee": 30, "color": "#1565F0", "enabled": True},
    ]
    giftcards = [
        {"id": "gc-1", "code": "NABI-GIFT-4821", "amount": 120, "balance": 120, "amountCents": 12000, "balanceCents": 12000, "version": 1, "purchaser": "Sarah Thompson",
         "recipient": "Emma T.", "status": "active", "issued": d(-5)},
        {"id": "gc-2", "code": "NABI-GIFT-1177", "amount": 75, "balance": 0, "amountCents": 7500, "balanceCents": 0, "version": 1, "purchaser": "Walk-in (demo)",
         "recipient": "Sarah Thompson", "status": "redeemed", "issued": d(-70)},
    ]
    templates = [
        {"id": "t-1", "name": "Booking confirmation", "channel": "SMS", "body": "Hi {name}, your {service} with Nabitouch is confirmed for {date} at {time}. Reply C to contact us."},
        {"id": "t-2", "name": "Parking & access", "channel": "SMS", "body": "Hi {name}, could you share buzzer / parking details for your visit at {time}? Thank you!"},
        {"id": "t-3", "name": "Pre-visit hydration tip", "channel": "Email", "body": "Hi {name}, a gentle reminder to drink water before your session and clear a 2×3 m space."},
        {"id": "t-4", "name": "Insurance details needed", "channel": "Email", "body": "Hi {name}, to request direct billing we need your plan and member ID. You can add them in your Nabitouch profile."},
    ]
    weeks = [3120, 3480, 3290, 3950, 4210, 3880, 4460, 4720]
    settings = [{"id": "app", "gst": gst, "cashEnabled": True,
                 "receptionPerms": {"viewLocations": True, "viewEta": True, "viewAddresses": True, "assign": True,
                                    "createBooking": True, "viewInsuranceStatus": True, "viewInsuranceDocs": False,
                                    "managePayments": True, "viewHistory": True, "clinical": False, "manageAvailability": False,
                                    "eclaimsView": True, "eclaimsSubmit": True, "eclaimsReconcile": True,
                                    "eclaimsViewSensitive": False, "eclaimsManage": False},
                 "clinic": {"enabled": False, "address": "", "mobileEnabled": True, "name": "Nabitouch"},
                 "scheduling": {"setupMin": 10, "cleanupMin": 15, "travelBufferMin": 10, "leadMin": 90, "enforceAdjacentTravel": False},
                 "addons": [{"id": "aroma", "name": "Aromatherapy oils", "price": 15},
                            {"id": "warm-stone", "name": "Warm stone add-on", "price": 20},
                            {"id": "scalp-finish", "name": "10-min scalp finish", "price": 15}],
                 "rewards": launch_rewards(),
                 "packageProgram": launch_package_program(),
                 "center": {"lat": 53.5461, "lng": -113.4938},
                 "serviceCoverage": launch_service_coverage(),
                 "revenueTrend": [{"week": f"W{i + 1}", "revenue": v} for i, v in enumerate(weeks)]}]
    audit = [{"id": f"au-{i}", "at": ago(200 - i * 30), "actor": a, "action": m, "appointmentId": x}
             for i, (a, m, x) in enumerate([
                 ("Reception · Demo", "NT-1053 assigned to Jordan Ellis", "a-104"),
                 ("Owner · Demo", "Promotion WELCOME20 cap set to $40", None),
                 ("Maya Chen", "NT-1032 SOAP note signed", "a-090"),
                 ("Reception · Demo", "Insurance card received for David Okoro", None),
             ])]
    if is_production():
        for appt in appointments:
            trip = appt.get("trip")
            if trip:
                trip["sharing"] = False
                trip.pop("sharingSource", None)
    return {"services": SERVICES, "practitioners": practitioners, "clients": clients, "appointments": appointments,
            "soap": soap, "plans": plans, "promotions": promotions, "zones": zones, "giftcards": giftcards,
            "audit": audit, "templates": templates, "settings": settings,
            "schedules": [demo_schedule(person["id"]) for person in practitioners]}


def build_launch_seed():
    """Catalogue, zones, and unpublished business settings. One inactive practitioner and no clients."""
    full = build_seed()
    settings = dict(full["settings"][0])
    settings.pop("revenueTrend", None)
    settings["cashEnabled"] = True
    settings["mfaEnforcePrivileged"] = False
    settings["clinic"] = launch_clinic()
    settings["cancellationPolicy"] = launch_policy()
    settings["scheduling"] = {"setupMin": 10, "cleanupMin": 15, "travelBufferMin": 10, "leadMin": 90, "enforceAdjacentTravel": True}
    settings["recovery"] = {"exclusiveMinutes": 20, "holdMinutes": 3, "maxExclusiveAttempts": 5, "broadcastLimit": 25}
    settings["rewards"] = launch_rewards()
    settings["packageProgram"] = launch_package_program()
    settings["cancellationFee"] = {
        "enabled": False, "noShowEnabled": False, "automaticCollection": False, "noticeHours": None,
        "fixedFee": None, "percentFee": None, "noShowFee": None, "maxFee": None,
        "waiverRequiresOwner": True, "effectiveOn": None, "published": False,
        "text": settings["cancellationPolicy"]["text"],
    }
    settings["receptionPerms"] = {**(settings.get("receptionPerms") or {}), "manageAvailability": False}
    practitioner = launch_practitioner()
    return {
        "services": full["services"],
        "practitioners": [practitioner],
        "clients": [],
        "appointments": [],
        "soap": [],
        "plans": [],
        "promotions": [launch_welcome_offer()],
        "zones": full["zones"],
        "giftcards": [],
        "audit": [],
        "templates": full["templates"],
        "settings": [settings],
        "schedules": [draft_schedule(practitioner["id"])],
    }


def demo_schedule(practitioner_id):
    return {
        "id": f"sch-{practitioner_id}",
        "practitionerId": practitioner_id,
        "timezone": "America/Edmonton",
        "status": "approved",
        "acceptingBookings": True,
        "weekly": [{"weekday": day, "start": "09:00", "end": "20:00"} for day in range(7)],
        "exceptions": [],
    }
