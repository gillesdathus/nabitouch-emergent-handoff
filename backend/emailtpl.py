"""Tide/lagoon branded shell for every transactional email. Content stays in the caller; this adds the frame, contact and timezone notes."""
import os
from html import escape

TEMPLATE_VERSION = "tide-2026-06"
MARKER = "<!-- nabitouch-shell -->"


def wrap(inner_html, subject):
    if MARKER in inner_html:
        return inner_html
    brand = escape(os.environ.get("EMAIL_FROM_NAME") or "Nabitouch")
    support = escape((os.environ.get("SUPPORT_EMAIL") or "").strip())
    app = escape((os.environ.get("APP_URL") or "").rstrip("/"))
    contact = f'Questions? Email <a href="mailto:{support}" style="color:#0E7C86">{support}</a>' if support else "Questions? Message us in the app"
    open_app = f' · <a href="{app}/me" style="color:#0E7C86">Open your account</a>' if app else ""
    return (
        f'{MARKER}<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
        f'<meta name="color-scheme" content="light"><title>{escape(subject)}</title></head>'
        '<body style="margin:0;padding:0;background:#EEF6FA">'
        f'<div style="display:none;max-height:0;overflow:hidden;opacity:0">{escape(subject)}</div>'
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EEF6FA"><tr><td align="center" style="padding:24px 12px">'
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#FFFFFF;border-radius:24px;overflow:hidden;border:1px solid #DCEAF2">'
        '<tr><td style="background:#0B1B3F;background-image:linear-gradient(135deg,#0B1B3F 0%,#0E5E8C 55%,#14B8A6 100%);padding:28px 28px 24px">'
        f'<p style="margin:0;font-family:Georgia,\'Times New Roman\',serif;font-size:24px;letter-spacing:.5px;color:#FFFFFF">{brand}</p>'
        '<p style="margin:6px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#A7F3EC">Mobile massage &amp; wellness</p>'
        '</td></tr>'
        f'<tr><td style="padding:8px 4px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#0F2A3D">{inner_html}</td></tr>'
        '<tr><td style="padding:20px 28px 28px;border-top:1px solid #E3EEF4;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:#5B7385">'
        f'<p style="margin:0 0 6px">{contact}{open_app}</p>'
        '<p style="margin:0 0 6px">Times are shown in Edmonton time (Mountain Time).</p>'
        f'<p style="margin:0">{brand} never asks for your password or card details by email. Treatment notes are never sent by email.</p>'
        '</td></tr></table></td></tr></table></body></html>'
    )
