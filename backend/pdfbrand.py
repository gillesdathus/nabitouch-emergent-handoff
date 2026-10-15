"""Nabitouch-branded PDF documents (invoice, receipt, report) rendered with ReportLab."""
import io
from pathlib import Path

from reportlab.lib.colors import HexColor, white
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

ASSETS = Path(__file__).parent / "assets"
NAVY, BLUE, CYAN, TURQ, TEAL, INK, MUTE, LINE, ICE = (HexColor(c) for c in ("#0B2E8A", "#1565F0", "#12C9EF", "#14D8C4", "#0E9E9A", "#0B1B3F", "#4A5A7A", "#D6EAF3", "#F2FAFD"))
W, H = LETTER
M = 48

_fonts = {"r": "Helvetica", "m": "Helvetica-Bold", "b": "Helvetica-Bold"}
try:
    for key, name in (("r", "Poppins-Regular"), ("m", "Poppins-Medium"), ("b", "Poppins-SemiBold")):
        pdfmetrics.registerFont(TTFont(name, str(ASSETS / "fonts" / f"{name}.ttf")))
        _fonts[key] = name
except Exception:
    pass


def _business(settings):
    biz = (settings or {}).get("business") or {}
    clinic = (settings or {}).get("clinic") or {}
    return {
        "name": biz.get("legalName") or clinic.get("name") or "Nabitouch",
        "lines": [x for x in (biz.get("address") or clinic.get("address"), biz.get("phone") or clinic.get("phoneDisplay") or "+1 780-235-6508", biz.get("email") or clinic.get("email") or "info@nabitouch.com", f"GST {biz['gstNumber']}" if biz.get("gstNumber") else None) if x],
    }


def fit(text, font, size, width):
    if pdfmetrics.stringWidth(text, font, size) <= width:
        return text
    while text and pdfmetrics.stringWidth(text + "…", font, size) > width:
        text = text[:-1]
    return text + "…"


class Doc:
    def __init__(self, title, settings):
        self.buf = io.BytesIO()
        self.c = canvas.Canvas(self.buf, pagesize=LETTER, pageCompression=1)
        self.c.setTitle(title)
        self.c.setAuthor("Nabitouch")
        self.biz = _business(settings)
        self.title = title
        self.page = 1
        self.y = 0
        self._header()

    def font(self, kind, size, color=INK):
        self.c.setFont(_fonts[kind], size)
        self.c.setFillColor(color)

    def _header(self):
        c = self.c
        steps = [NAVY, BLUE, CYAN, TURQ]
        band = W / len(steps)
        for i, col in enumerate(steps):
            c.setFillColor(col)
            c.rect(i * band, H - 6, band + 1, 6, stroke=0, fill=1)
        try:
            c.drawImage(ImageReader(str(ASSETS / "logo-full.png")), M, H - 92, width=96, height=66, mask="auto", preserveAspectRatio=True)
        except Exception:
            self.font("b", 18, NAVY)
            c.drawString(M, H - 60, "Nabitouch")
        self.font("b", 20, INK)
        c.drawRightString(W - M, H - 52, self.title)
        self.font("r", 8.5, MUTE)
        y = H - 66
        for line in [self.biz["name"], *self.biz["lines"]]:
            c.drawRightString(W - M, y, str(line)[:80])
            y -= 11
        self.y = min(y, H - 110) - 14

    def footer(self):
        c = self.c
        c.setStrokeColor(LINE)
        c.line(M, 52, W - M, 52)
        self.font("r", 7.5, MUTE)
        c.drawString(M, 40, "Breathe. Feel. Heal. Anywhere.  ·  This document contains no clinical notes.")
        c.drawRightString(W - M, 40, f"Page {self.page}")

    def need(self, height):
        if self.y - height < 72:
            self.footer()
            self.c.showPage()
            self.page += 1
            self._header()

    def hero(self, label, value, chips):
        self.need(78)
        c = self.c
        c.setFillColor(ICE)
        c.roundRect(M, self.y - 66, W - 2 * M, 66, 14, stroke=0, fill=1)
        self.font("r", 9, MUTE)
        c.drawString(M + 18, self.y - 22, label)
        self.font("b", 22, NAVY)
        c.drawString(M + 18, self.y - 50, value)
        x = W - M - 18
        for text, tone in reversed(chips):
            self.font("m", 8.5, white)
            width = pdfmetrics.stringWidth(text, _fonts["m"], 8.5) + 18
            c.setFillColor(tone)
            c.roundRect(x - width, self.y - 42, width, 18, 9, stroke=0, fill=1)
            self.font("m", 8.5, white)
            c.drawCentredString(x - width / 2, self.y - 36, text)
            x -= width + 6
        self.y -= 86

    def facts(self, pairs, cols=3):
        col_w = (W - 2 * M) / cols
        for i in range(0, len(pairs), cols):
            self.need(34)
            for j, (k, v) in enumerate(pairs[i:i + cols]):
                x = M + j * col_w
                self.font("r", 7.5, MUTE)
                self.c.drawString(x, self.y, k.upper())
                self.font("m", 10, INK)
                self.c.drawString(x, self.y - 13, str(v or "—")[:44])
            self.y -= 32
        self.y -= 4

    def section(self, title):
        self.need(30)
        self.font("b", 9, TEAL)
        self.c.drawString(M, self.y, title.upper())
        self.y -= 8
        self.c.setStrokeColor(LINE)
        self.c.line(M, self.y, W - M, self.y)
        self.y -= 16

    def table(self, headers, rows, widths, align=None):
        numeric = lambda i: headers[i] in ("Qty", "Visits") or any(str(r[i]).lstrip("-").startswith("$") for r in rows[:8])
        align = align or ["r" if numeric(i) else "l" for i in range(len(headers))]
        total = sum(widths)
        xs, x = [], M
        for w in widths:
            xs.append(x)
            x += (W - 2 * M) * w / total
        def draw(cells, kind, color):
            self.font(kind, 8.5, color)
            for i, cell in enumerate(cells):
                end = xs[i + 1] - 8 if i + 1 < len(xs) else W - M
                if align[i] == "r":
                    self.c.drawRightString(end, self.y, str(cell))
                else:
                    self.c.drawString(xs[i], self.y, fit(str(cell), _fonts[kind], 8.5, end - xs[i]))
        self.need(20)
        draw(headers, "m", MUTE)
        self.y -= 14
        for n, row in enumerate(rows):
            self.need(18)
            if n % 2 == 0:
                self.c.setFillColor(ICE)
                self.c.rect(M - 4, self.y - 5, W - 2 * M + 8, 16, stroke=0, fill=1)
            draw(row, "r", INK)
            self.y -= 16
        self.y -= 8

    def totals(self, pairs):
        for label, value, strong in pairs:
            self.need(18)
            self.font("b" if strong else "r", 11 if strong else 9.5, INK if strong else MUTE)
            self.c.drawString(W - M - 230, self.y, label)
            self.c.drawRightString(W - M, self.y, value)
            self.y -= 17 if strong else 15
        self.y -= 6

    def note(self, text):
        self.need(16)
        self.font("r", 8, MUTE)
        self.c.drawString(M, self.y, text[:130])
        self.y -= 13

    def bytes(self):
        self.footer()
        self.c.save()
        return self.buf.getvalue()


STATE_LABEL = {"issued": "Issued", "partially_paid": "Partly paid", "paid": "Paid in full", "voided": "Voided", "draft": "Draft"}


def _money(cents):
    cents = int(cents or 0)
    sign = "-" if cents < 0 else ""
    cents = abs(cents)
    return f"{sign}${cents // 100:,}.{cents % 100:02d}"


def invoice_pdf(view, settings):
    d = Doc("Invoice", settings)
    tone = TEAL if view["state"] == "paid" else HexColor("#B45309") if view.get("overdue") else BLUE
    d.hero("Outstanding balance" if view["state"] != "paid" else "Paid in full", view["balance"]["display"] + " CAD",
           [(view.get("number") or "DRAFT", NAVY), (("Overdue" if view.get("overdue") else STATE_LABEL.get(view["state"], view["state"])), tone)])
    d.facts([("Billed to", view.get("clientName")), ("Practitioner", view.get("practitionerName")), ("Service", f"{view.get('service') or ''} · {view.get('duration') or ''} min"),
             ("Service date", view.get("serviceDate")), ("Issue date", (view.get("issueDate") or "")[:10]), ("Due date", (view.get("dueDate") or "")[:10])])
    d.section("Items")
    d.table(["Description", "Qty", "Amount"], [[l.get("description", ""), l.get("quantity", 1), _money(l.get("netCents"))] for l in view.get("lines") or []], [6, 1, 2])
    d.totals([("GST", view["tax"]["display"], False), ("Invoice total", view["total"]["display"], True), ("Insurance received", view["insuranceReceived"]["display"], False),
              ("Client payments", view["clientPaid"]["display"], False), ("Refunded", view["refunded"]["display"], False), ("Outstanding balance", view["balance"]["display"], True)])
    if view["expectedInsurance"]["cents"]:
        d.note(f"Insurance approved or expected and not yet received: {view['expectedInsurance']['display']}. It is not counted as paid.")
    pays = [p for p in view.get("payments") or [] if p["type"] in ("client_payment", "insurance_receipt", "refund", "reversal")]
    if pays:
        d.section("Payments")
        d.table(["Date", "Type", "Method", "Amount"], [[(p.get("at") or "")[:10], p["type"].replace("_", " "), p.get("method") or "", p["amount"]["display"]] for p in pays], [2, 3, 2, 2])
    d.note("Unpaid amounts are never shown as paid. Questions? Reply to your invoice email or contact Nabitouch.")
    return d.bytes()


def receipt_pdf(view, settings):
    d = Doc("Receipt", settings)
    paid = view["received"]["cents"] - view["refunded"]["cents"]
    d.hero("Total received", _money(paid) + " CAD", [(view.get("number") or "", NAVY), ("Receipt", TEAL)])
    d.facts([("Received from", view.get("clientName")), ("Practitioner", view.get("practitionerName")), ("Service", f"{view.get('service') or ''} · {view.get('duration') or ''} min"),
             ("Service date", view.get("serviceDate")), ("Invoice total", view["total"]["display"]), ("Balance remaining", view["balance"]["display"])])
    rows = [p for p in view.get("payments") or [] if p["type"] in ("client_payment", "insurance_receipt", "refund", "reversal")]
    d.section("Confirmed payments")
    d.table(["Date", "Payer", "Method", "Reference", "Amount"], [[(p.get("at") or "")[:10], "Insurer" if p["type"] == "insurance_receipt" else ("Refund" if p["type"] in ("refund", "reversal") else "Client"), p.get("method") or "", (p.get("reference") or "")[:18], p["amount"]["display"]] for p in rows], [2, 2, 2, 3, 2])
    d.note("Only payments confirmed by Nabitouch appear on this receipt. Reported e-Transfers and pending insurance are excluded.")
    return d.bytes()


def report_pdf(title, period, kpis, sections, settings):
    d = Doc(title, settings)
    d.hero(f"{kpis[0][0]}  ·  {period}" if kpis else period, kpis[0][1] if kpis else "", [])
    d.facts(kpis[1:] if len(kpis) > 1 else [], cols=4)
    for name, headers, rows, widths in sections:
        d.section(name)
        if rows:
            d.table(headers, rows, widths)
        else:
            d.note("No records in this period.")
    d.note("All figures come from Nabitouch ledger records. Insurance is counted only when received.")
    return d.bytes()
