"""Branded transactional email layouts. Delivery stays behind the existing outbox and its flags."""
from html import escape

TAGLINE = "Breathe. Feel. Heal. Anywhere."


def layout(brand, greeting, intro, rows=None, cta=None, footnote=""):
    table = "".join(
        f'<tr><td style="padding:7px 14px 7px 0;color:#4A5A7A;font-size:13px">{escape(str(k))}</td>'
        f'<td style="padding:7px 0;font-size:14px;font-weight:600;color:#0B1B3F;text-align:right">{escape(str(v))}</td></tr>'
        for k, v in (rows or [])
    )
    button = (f'<p style="margin:28px 0 8px"><a href="{escape(cta[1])}" style="background:linear-gradient(120deg,#0B2E8A,#1565F0 55%,#12C9EF);background-color:#1565F0;'
              f'color:#ffffff;padding:13px 26px;border-radius:999px;text-decoration:none;font-weight:600">{escape(cta[0])}</a></p>') if cta else ""
    return (
        '<table role="presentation" width="100%" style="background:#F5FBFC"><tr><td align="center" style="padding:28px 12px">'
        '<table role="presentation" width="560" style="max-width:560px;background:#ffffff;border-radius:24px;overflow:hidden;font-family:Poppins,Arial,sans-serif;color:#0B1B3F">'
        '<tr><td style="height:6px;background:linear-gradient(90deg,#0B2E8A,#1565F0,#12C9EF,#14D8C4,#7BC74D);background-color:#1565F0"></td></tr>'
        f'<tr><td style="padding:28px 28px 8px"><p style="font-size:22px;font-weight:700;margin:0;color:#0B2E8A">{escape(brand)}</p>'
        f'<p style="margin:4px 0 0;color:#0E9E9A;font-size:12px;letter-spacing:.12em;text-transform:uppercase">{TAGLINE}</p></td></tr>'
        f'<tr><td style="padding:12px 28px 28px"><p style="margin:0 0 6px">Hi {escape(greeting)},</p><p style="margin:0 0 18px;color:#4A5A7A">{escape(intro)}</p>'
        f'<table role="presentation" width="100%" style="border-top:1px dashed #D6EAF3;border-bottom:1px dashed #D6EAF3">{table}</table>{button}'
        f'<p style="font-size:11px;color:#6B8296;margin-top:24px">{escape(footnote)} We never ask for your password or full card number by email.</p></td></tr>'
        '</table></td></tr></table>'
    )


def invoice_email(brand, client, view, link):
    rows = [("Invoice", view.get("number") or ""), ("Service", view.get("service") or ""), ("Service date", view.get("serviceDate") or ""),
            ("Total", view["total"]["display"]), ("Outstanding", view["balance"]["display"])]
    return (f"Invoice {view.get('number') or ''} — {brand}",
            layout(brand, client, "Your Nabitouch invoice is ready. The PDF is available in your account.", rows, ("View and pay", link),
                   "Insurance amounts are counted only when received."))


def receipt_email(brand, client, view, link):
    rows = [("Invoice", view.get("number") or ""), ("Received", view["received"]["display"]), ("Balance remaining", view["balance"]["display"])]
    return (f"Payment receipt {view.get('number') or ''} — {brand}", layout(brand, client, "Thank you. Here is a summary of the confirmed payments on your invoice.", rows, ("Download receipt", link)))


def payment_link_email(brand, client, view, link):
    rows = [("Invoice", view.get("number") or ""), ("Amount due", view["balance"]["display"])]
    return (f"Pay invoice {view.get('number') or ''} — {brand}", layout(brand, client, "You can pay the remaining balance securely online.", rows, ("Pay now", link),
                                                                     "A payment counts only after Nabitouch receives confirmation from the payment provider."))


def invitation_email(brand, name, role, link):
    return (f"You're invited to {brand}", layout(brand, name, f"You've been invited to join Nabitouch as {role}. The link expires soon.", [], ("Accept invitation", link)))


def recovery_email(brand, name, link):
    return (f"Reset your {brand} password", layout(brand, name, "We received a request to reset your password. If it wasn't you, ignore this email.", [], ("Choose a new password", link)))


def booking_change_email(brand, client, title, rows, link):
    return (f"{title} — {brand}", layout(brand, client, f"{title}.", rows, ("View your visit", link)))
