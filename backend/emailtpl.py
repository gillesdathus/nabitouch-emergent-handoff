"""Tide/lagoon branded shell for every transactional email. Content stays in the caller; this adds the frame, contact and timezone notes.

Email-client rules (Apple Mail / Gmail / Outlook):
- <!doctype html> must lead the document (no leading comment).
- Solid background colors only — no background-image / CSS gradients.
- No remote images, scripts, iframes, or external stylesheets.
- Table layout + inline CSS only.
"""
import os
from html import escape

TEMPLATE_VERSION = "tide-2026-10"
MARKER = "<!-- nabitouch-shell -->"


def wrap(inner_html, subject, *, delivery_test=False):
    if MARKER in inner_html:
        return inner_html
    brand = "Nabitouch" if delivery_test else escape(os.environ.get("EMAIL_FROM_NAME") or "Nabitouch")
    support = escape((os.environ.get("SUPPORT_EMAIL") or "").strip())
    app_raw = (os.environ.get("APP_URL") or "").rstrip("/")
    # Only emit https account links (email guardrail refuses http:// assets).
    app = escape(app_raw) if app_raw.lower().startswith("https://") else ""
    contact = f'Questions? Email <a href="mailto:{support}" style="color:#0E7C86">{support}</a>' if support else "Questions? Message us in the app"
    open_app = f' · <a href="{app}/me" style="color:#0E7C86">Open your account</a>' if app else ""
    footer = (
        '<p style="margin:0;font-weight:600;color:#0B1B3F">Nabitouch</p>'
        '<p style="margin:4px 0 0;color:#0E7C86">Breathe. Feel. Heal. Anywhere.</p>'
        if delivery_test else
        f'<p style="margin:0 0 6px">{contact}{open_app}</p>'
        '<p style="margin:0 0 6px">Times are shown in Edmonton time (Mountain Time).</p>'
        f'<p style="margin:0">{brand} never asks for your password or card details by email. Treatment notes are never sent by email.</p>'
    )
    # Doctype must come first. Marker lives in <head> so clients still detect a full HTML document.
    return (
        '<!doctype html><html lang="en"><head><meta charset="utf-8">'
        f'{MARKER}'
        '<meta name="viewport" content="width=device-width,initial-scale=1">'
        f'<meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light">'
        f'<title>{escape(subject)}</title></head>'
        '<body style="margin:0;padding:0;background-color:#EEF6FA">'
        # Preheader: keep text available to inbox previews without remote assets.
        f'<div style="display:none;font-size:1px;line-height:1px;max-height:0;overflow:hidden;opacity:0;color:transparent">{escape(subject)}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;</div>'
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#EEF6FA"><tr><td align="center" style="padding:24px 12px">'
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background-color:#FFFFFF;border:1px solid #DCEAF2">'
        # Solid navy header — no CSS gradients (Apple Mail / Outlook safe).
        '<tr><td bgcolor="#0B1B3F" style="background-color:#0B1B3F;padding:28px 28px 24px">'
        f'<p style="margin:0;font-family:Georgia,\'Times New Roman\',serif;font-size:24px;letter-spacing:.5px;color:#FFFFFF">{brand}</p>'
        '<p style="margin:6px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#A7F3EC">Mobile massage &amp; wellness</p>'
        '</td></tr>'
        f'<tr><td style="padding:28px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#0F2A3D">{inner_html}</td></tr>'
        '<tr><td style="padding:20px 28px 28px;border-top:1px solid #E3EEF4;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:#5B7385">'
        f'{footer}'
        '</td></tr></table></td></tr></table></body></html>'
    )
