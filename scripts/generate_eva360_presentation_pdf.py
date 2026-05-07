#!/usr/bin/env python3
"""Generate the EVA360 institutional presentation as PDF (reportlab).

Same content/design language as the PPTX version, but native PDF.
Output: docs/presentaciones/EVA360-Presentacion-Institucional.pdf
"""
from __future__ import annotations

from pathlib import Path

from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import landscape
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas


# ---------------------------------------------------------------------------
# Brand palette
# ---------------------------------------------------------------------------
BG_BLACK = HexColor("#0B0B0F")
BG_PANEL = HexColor("#16161C")
BG_PANEL_ALT = HexColor("#0E0E13")
GOLD_PRIMARY = HexColor("#D4AF37")
GOLD_LIGHT = HexColor("#F4D87A")
GOLD_DARK = HexColor("#8C6E1F")
WHITE = HexColor("#FFFFFF")
TEXT_MUTED = HexColor("#C8C8CF")
TEXT_DIM = HexColor("#8A8A92")
LINE_GOLD = HexColor("#B8952A")

# 16:9 page size, 13.333 x 7.5 inches @ 72 dpi
PT_PER_IN = 72.0
PAGE_W = 13.333 * PT_PER_IN  # 960
PAGE_H = 7.5 * PT_PER_IN     # 540
PAGE_SIZE = (PAGE_W, PAGE_H)

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "docs" / "presentaciones"
OUT_DIR.mkdir(parents=True, exist_ok=True)
OUT_PDF = OUT_DIR / "EVA360-Presentacion-Institucional.pdf"

TOTAL_SLIDES = 14


def inches(v: float) -> float:
    return v * PT_PER_IN


# Convert 1 EMU coordinate space → points (no, we use inches directly)
# Y axis: reportlab origin is bottom-left. We'll convert top-based coords.
def y(top_in: float, h_in: float = 0.0) -> float:
    """Convert 'top' coordinate (inches from top) to reportlab y (bottom-up)."""
    return PAGE_H - inches(top_in) - inches(h_in)


# ---------------------------------------------------------------------------
# Drawing helpers
# ---------------------------------------------------------------------------
def fill_bg(c: canvas.Canvas, color=BG_BLACK):
    c.setFillColor(color)
    c.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)


def rect(c, left_in, top_in, w_in, h_in, fill=BG_PANEL, stroke=None):
    c.setFillColor(fill)
    if stroke is not None:
        c.setStrokeColor(stroke)
        c.setLineWidth(0.6)
        stroke_flag = 1
    else:
        stroke_flag = 0
    c.rect(inches(left_in), y(top_in, h_in), inches(w_in), inches(h_in), fill=1, stroke=stroke_flag)


def text(
    c,
    left_in,
    top_in,
    w_in,
    txt,
    *,
    size=12,
    bold=False,
    italic=False,
    color=WHITE,
    align="left",
):
    if bold and italic:
        font = "Helvetica-BoldOblique"
    elif bold:
        font = "Helvetica-Bold"
    elif italic:
        font = "Helvetica-Oblique"
    else:
        font = "Helvetica"
    c.setFont(font, size)
    c.setFillColor(color)
    # Approximate baseline: top + ~size*0.85
    baseline = y(top_in) - size * 0.95
    if align == "left":
        c.drawString(inches(left_in), baseline, txt)
    elif align == "center":
        c.drawCentredString(inches(left_in) + inches(w_in) / 2, baseline, txt)
    elif align == "right":
        c.drawRightString(inches(left_in) + inches(w_in), baseline, txt)


def text_wrapped(
    c,
    left_in,
    top_in,
    w_in,
    lines,
    *,
    size=11,
    color=TEXT_MUTED,
    line_spacing=1.4,
    bold=False,
    italic=False,
    bullet_color=GOLD_PRIMARY,
):
    """Draw multiple lines. Lines starting with '• ' get a gold round bullet."""
    font_normal = "Helvetica"
    font_bold = "Helvetica-Bold"
    font_italic = "Helvetica-Oblique"
    if bold:
        font_normal = font_bold
    if italic:
        font_normal = font_italic
    line_h = size * line_spacing
    current_top = top_in
    for line in lines:
        if line.startswith("• "):
            # bullet
            c.setFillColor(bullet_color)
            c.setFont("Helvetica-Bold", size)
            baseline = y(current_top) - size * 0.95
            c.drawString(inches(left_in), baseline, "●")
            # text
            c.setFillColor(color)
            c.setFont(font_normal, size)
            c.drawString(inches(left_in) + size * 0.9, baseline, line[2:])
        else:
            c.setFillColor(color)
            c.setFont(font_normal, size)
            baseline = y(current_top) - size * 0.95
            c.drawString(inches(left_in), baseline, line)
        current_top += line_h / PT_PER_IN


def gold_bar(c, left_in, top_in, w_in, h_in=0.05):
    rect(c, left_in, top_in, w_in, h_in, fill=GOLD_PRIMARY)


def slide_header(c, eyebrow: str, title: str, subtitle: str | None = None):
    text(c, 0.6, 0.42, 8, eyebrow.upper(), size=11, bold=True, color=GOLD_PRIMARY)
    text(c, 0.6, 0.7, 12, title, size=26, bold=True, color=WHITE)
    if subtitle:
        text(c, 0.6, 1.3, 12, subtitle, size=13, italic=True, color=TEXT_MUTED)
    gold_bar(c, 0.6, 1.78, 2.5)


def slide_footer(c, page_num: int):
    rect(c, 0, 7.18, 13.333, 0.04, fill=GOLD_DARK)
    text(c, 0.6, 7.28, 8, "EVA360 · Ascenda SpA · Confidencial", size=8, color=TEXT_DIM)
    text(c, 11.7, 7.28, 1.2, f"{page_num:02d} / {TOTAL_SLIDES:02d}", size=8, bold=True, color=GOLD_PRIMARY, align="right")


def card(c, left_in, top_in, w_in, h_in, title, body_lines, *, title_size=12, body_size=10):
    rect(c, left_in, top_in, w_in, h_in, fill=BG_PANEL, stroke=GOLD_DARK)
    rect(c, left_in, top_in, 0.07, h_in, fill=GOLD_PRIMARY)
    text(c, left_in + 0.22, top_in + 0.18, w_in - 0.4, title, size=title_size, bold=True, color=GOLD_LIGHT)
    text_wrapped(
        c,
        left_in + 0.22,
        top_in + 0.55,
        w_in - 0.4,
        body_lines,
        size=body_size,
        color=TEXT_MUTED,
        line_spacing=1.3,
    )


# ---------------------------------------------------------------------------
# Slides
# ---------------------------------------------------------------------------
c = canvas.Canvas(str(OUT_PDF), pagesize=PAGE_SIZE)
c.setTitle("EVA360 — Presentación Institucional")
c.setAuthor("Ascenda SpA")
c.setSubject("Gestión del desempeño con IA · Presentación para usuarios e inversionistas")


# ---- Slide 1: Cover ----
fill_bg(c, BG_BLACK)
heights = [0.5, 0.9, 1.4, 2.0, 2.7, 3.5, 4.4]
bar_w = 0.42
gap = 0.18
bar_left = 0.8
for i, h in enumerate(heights):
    is_top = i == len(heights) - 1
    rect(c, bar_left + i * (bar_w + gap), 6.0 - h, bar_w, h, fill=GOLD_PRIMARY if is_top else GOLD_DARK)

text(c, 6.0, 2.2, 7, "ASCENDA SPA · 2026", size=12, bold=True, color=GOLD_PRIMARY)
text(c, 6.0, 2.55, 7, "EVA360", size=78, bold=True, color=GOLD_LIGHT)
gold_bar(c, 6.05, 4.05, 3.5)
text(c, 6.0, 4.2, 7, "Gestión del desempeño con IA", size=22, bold=True, color=WHITE)
text(c, 6.0, 4.7, 7, "Una sola plataforma. Todo el ciclo de personas.", size=14, italic=True, color=TEXT_MUTED)
text(c, 6.0, 6.1, 7, "Presentación institucional · Nuevos usuarios + Inversionistas", size=10, color=TEXT_DIM)
text(c, 6.0, 6.45, 7, "ricardo@ascenda.cl  ·  ascenda.cl  ·  Santiago, Chile", size=11, bold=True, color=GOLD_PRIMARY)
c.showPage()


# ---- Slide 2: El problema ----
fill_bg(c, BG_BLACK)
slide_header(
    c,
    "01 · Contexto",
    "El problema que resolvemos",
    "Las empresas evalúan a sus personas mal, tarde y caro.",
)
text_wrapped(
    c,
    0.7,
    2.2,
    7.5,
    [
        "• 78% de los empleados desconfía de la evaluación tradicional (Gallup, 2024).",
        "• Procesos manuales en Excel y Forms generan sesgo, baja participación y datos no",
        "    accionables.",
        "• Soluciones enterprise (Workday, Lattice, Culture Amp) cuestan USD $20–50/empl./mes",
        "    — inalcanzables para pymes LATAM.",
        "• Resultado: rotación 25% mayor y planes de desarrollo (PDI) que nunca se ejecutan.",
        "• Líderes deciden a ciegas; RR.HH. invierte semanas armando reportes que nadie lee.",
    ],
    size=13,
    line_spacing=1.7,
)
card(
    c,
    8.5,
    2.1,
    4.3,
    4.5,
    "INSIGHT CLAVE",
    [
        "El problema no es la falta de",
        "herramientas.",
        "",
        "Es que las herramientas existentes",
        "no fueron diseñadas para empresas",
        "latinoamericanas de 50–500 empleados.",
        "",
        "EVA360 nació para ese vacío.",
    ],
    title_size=12,
    body_size=12,
)
slide_footer(c, 2)
c.showPage()


# ---- Slide 3: Qué es EVA360 ----
fill_bg(c, BG_BLACK)
slide_header(
    c,
    "02 · Solución",
    "Qué es EVA360",
    "Una plataforma SaaS B2B integral. Reemplaza Excel + 4 herramientas separadas.",
)
modules = [
    ("Evaluaciones 360°", "Configurables por cargo, área y nivel."),
    ("OKRs y objetivos", "Con seguimiento, calibración y check-ins."),
    ("Feedback continuo", "1-on-1 estructurados + agendas IA."),
    ("PDI personalizados", "Generados con IA según perfil y brechas."),
    ("Encuestas de clima", "Mood check-ins de 10 segundos por semana."),
    ("Reconocimientos", "Badges, kudos y reconocimiento social."),
    ("Insights con IA", "Riesgo de fuga + brechas + DEI."),
    ("Calibración + 9-box", "Analytics de equipo y rotación."),
    ("Reclutamiento + ATS", "Postulantes integrados al ciclo."),
]
cols = 3
card_w = 4.05
card_h = 1.35
gap_x = 0.15
gap_y = 0.18
start_x = 0.6
start_y = 2.05
for idx, (mod_title, mod_body) in enumerate(modules):
    r = idx // cols
    col = idx % cols
    left = start_x + col * (card_w + gap_x)
    top = start_y + r * (card_h + gap_y)
    rect(c, left, top, card_w, card_h, fill=BG_PANEL, stroke=GOLD_DARK)
    rect(c, left, top, card_w, 0.06, fill=GOLD_PRIMARY)
    text(c, left + 0.2, top + 0.22, card_w - 0.3, mod_title, size=13, bold=True, color=GOLD_LIGHT)
    text(c, left + 0.2, top + 0.65, card_w - 0.3, mod_body, size=10, color=TEXT_MUTED)
slide_footer(c, 3)
c.showPage()


# ---- Slide 4: Producto operativo hoy ----
fill_bg(c, BG_BLACK)
slide_header(
    c,
    "03 · Producto",
    "Lo que ya está funcionando hoy",
    "EVA360 no es una promesa: es producto operativo en producción.",
)
metrics = [
    ("39", "Controllers backend", "NestJS 11"),
    ("30+", "Páginas UI activas", "Next.js 14"),
    ("78", "Entidades de dominio", "PostgreSQL + RLS"),
    ("100%", "Multi-tenant aislado", "Row-Level Security"),
]
mw = 2.95
mh = 1.7
for i, (num, label, sub) in enumerate(metrics):
    left = 0.6 + i * (mw + 0.1)
    top = 2.05
    rect(c, left, top, mw, mh, fill=BG_PANEL, stroke=GOLD_DARK)
    text(c, left, top + 0.5, mw, num, size=42, bold=True, color=GOLD_PRIMARY, align="center")
    text(c, left, top + 1.2, mw, label, size=12, bold=True, color=WHITE, align="center")
    text(c, left, top + 1.45, mw, sub, size=9, italic=True, color=TEXT_DIM, align="center")

text(c, 0.6, 4.05, 12, "Capacidades en producción", size=14, bold=True, color=GOLD_LIGHT)
text_wrapped(
    c,
    0.7,
    4.5,
    6.0,
    [
        "• Integración productiva con Anthropic Claude SDK",
        "• PWA instalable + Push notifications nativas",
        "• 2FA + JWT + auditoría cross-tenant",
        "• Suscripciones IA con Stripe + MercadoPago",
    ],
    size=11,
    line_spacing=1.7,
)
text_wrapped(
    c,
    7.1,
    4.5,
    6.0,
    [
        "• Documentación legal (T&C, DPA, SLA, NDA, Privacidad)",
        "• Multi-tenant con RLS validado",
        "• Observabilidad con Sentry + métricas internas",
        "• Demo público: eva360.ascenda.cl/demo",
    ],
    size=11,
    line_spacing=1.7,
)
slide_footer(c, 4)
c.showPage()


# ---- Slide 5: Personas ----
fill_bg(c, BG_BLACK)
slide_header(
    c,
    "04 · Usuarios",
    "Diseñado para tres audiencias",
    "Una experiencia diferente por rol, sobre una sola plataforma.",
)
personas = [
    (
        "EL COLABORADOR",
        [
            "• Dashboard personal: evaluaciones,",
            "    objetivos y PDI.",
            "• Mood check-ins de 10 segundos",
            "    por semana.",
            "• Reconocimientos públicos para",
            "    celebrar logros.",
            "• Notificaciones inteligentes — sin spam.",
        ],
    ),
    (
        "EL LÍDER",
        [
            "• Vista 360° del equipo: desempeño,",
            "    riesgo, atrasos.",
            "• Streaks de liderazgo: hábitos sanos",
            "    gamificados.",
            "• 1-on-1 con agenda automática",
            "    + notas IA.",
            "• Calibración asistida con 9-box.",
        ],
    ),
    (
        "RECURSOS HUMANOS",
        [
            "• Ciclos lanzados en minutos,",
            "    no semanas.",
            "• Plantillas configurables por cargo",
            "    y nivel.",
            "• Insights agregados: brechas, DEI,",
            "    rotación, NPS.",
            "• Auditoría completa de cada calificación.",
        ],
    ),
]
pw = 4.0
ph = 4.5
for i, (title_t, lines) in enumerate(personas):
    left = 0.6 + i * (pw + 0.15)
    top = 2.05
    rect(c, left, top, pw, ph, fill=BG_PANEL, stroke=GOLD_DARK)
    rect(c, left, top, pw, 0.5, fill=GOLD_PRIMARY)
    text(c, left, top + 0.13, pw, title_t, size=12, bold=True, color=BG_BLACK, align="center")
    text_wrapped(
        c,
        left + 0.25,
        top + 0.85,
        pw - 0.4,
        lines,
        size=11,
        line_spacing=1.6,
    )
slide_footer(c, 5)
c.showPage()


# ---- Slide 6: IA con Claude ----
fill_bg(c, BG_BLACK)
slide_header(
    c,
    "05 · Diferencial técnico",
    "IA con Claude — embebida, no pegada",
    "La IA está en los flujos críticos del negocio, no en un chatbot lateral.",
)
ia_uses = [
    ("Análisis de feedback", "Convierte texto libre en competencias accionables."),
    ("PDI personalizado", "Genera planes de desarrollo desde fortalezas y brechas."),
    ("Riesgo de fuga", "Alertas tempranas con señales de mood + desempeño."),
    ("Resúmenes ejecutivos", "Cierre de ciclo en una página, automático."),
    ("Sugerencias OKR", "Objetivos alineados con la estrategia organizacional."),
    ("Análisis DEI", "Detección de sesgo en evaluaciones y promociones."),
]
for i, (t_t, b) in enumerate(ia_uses):
    r = i // 2
    col = i % 2
    left = 0.6 + col * 6.2
    top = 2.1 + r * 1.35
    rect(c, left, top, 6.0, 1.2, fill=BG_PANEL, stroke=GOLD_DARK)
    rect(c, left, top, 0.06, 1.2, fill=GOLD_PRIMARY)
    text(c, left + 0.25, top + 0.2, 5.6, t_t, size=13, bold=True, color=GOLD_LIGHT)
    text(c, left + 0.25, top + 0.6, 5.6, b, size=10, color=TEXT_MUTED)

text(
    c,
    0.6,
    6.55,
    12,
    "Modelo de costos: créditos IA por uso. El cliente paga solo lo que consume.",
    size=12,
    italic=True,
    color=GOLD_PRIMARY,
)
slide_footer(c, 6)
c.showPage()


# ---- Slide 7: Arquitectura ----
fill_bg(c, BG_BLACK)
slide_header(
    c,
    "06 · Arquitectura",
    "Stack moderno + seguridad enterprise",
    "Multi-tenant real con aislamiento a nivel base de datos.",
)
stack_rows = [
    ("Frontend", "Next.js 14 + React + TypeScript", "PWA, SEO, performance"),
    ("Backend", "NestJS 11 + TypeORM", "API REST documentada"),
    ("Base de datos", "PostgreSQL + Row-Level Security", "Aislamiento multi-tenant"),
    ("IA", "Anthropic Claude SDK", "No entrena con datos del cliente"),
    ("Pagos", "Stripe + MercadoPago", "Chile + LATAM listo"),
    ("Auth", "JWT + 2FA + SSO (roadmap)", "Compatible Azure AD / Okta"),
    ("Observabilidad", "Sentry + métricas internas", "SLA medible"),
    ("Cumplimiento", "DPA + Privacidad + RLS", "GDPR-ready"),
]
header_y_top = 2.05
row_h = 0.5
table_left = 0.6
col_w = [2.4, 5.0, 5.0]
hdrs = ["CAPA", "STACK", "GARANTÍA"]

x = table_left
for i, h in enumerate(hdrs):
    rect(c, x, header_y_top, col_w[i], row_h, fill=GOLD_DARK)
    text(c, x + 0.2, header_y_top + 0.16, col_w[i], h, size=11, bold=True, color=BG_BLACK)
    x += col_w[i]

for r, row in enumerate(stack_rows):
    top = header_y_top + (r + 1) * row_h
    fill = BG_PANEL if r % 2 == 0 else BG_PANEL_ALT
    x = table_left
    for i, cell in enumerate(row):
        rect(c, x, top, col_w[i], row_h, fill=fill, stroke=GOLD_DARK)
        is_first = i == 0
        text(
            c,
            x + 0.2,
            top + 0.17,
            col_w[i],
            cell,
            size=10,
            bold=is_first,
            color=GOLD_LIGHT if is_first else TEXT_MUTED,
        )
        x += col_w[i]
slide_footer(c, 7)
c.showPage()


# ---- Slide 8: Mercado ----
fill_bg(c, BG_BLACK)
slide_header(
    c,
    "07 · Mercado",
    "Oportunidad: HR Tech LATAM",
    "Mercado creciendo a 17% CAGR, con clara brecha en mid-market.",
)
tam_blocks = [
    ("TAM", "USD $4.8B", "HR Tech LATAM (2025)", "Gartner / Statista"),
    ("SAM", "USD $620M", "SaaS desempeño LATAM", "mid-market · Mordor"),
    ("SOM", "USD $18M", "Chile + México + Colombia", "3 años · bottom-up"),
]
for i, (label, num, l1, l2) in enumerate(tam_blocks):
    left = 0.6 + i * 4.15
    top = 2.1
    rect(c, left, top, 3.95, 2.4, fill=BG_PANEL, stroke=GOLD_DARK)
    rect(c, left, top, 3.95, 0.45, fill=GOLD_PRIMARY)
    text(c, left, top + 0.13, 3.95, label, size=14, bold=True, color=BG_BLACK, align="center")
    text(c, left, top + 0.85, 3.95, num, size=34, bold=True, color=GOLD_LIGHT, align="center")
    text(c, left, top + 1.65, 3.95, l1, size=11, color=TEXT_MUTED, align="center")
    text(c, left, top + 1.95, 3.95, l2, size=10, italic=True, color=TEXT_DIM, align="center")

text(c, 0.6, 4.85, 12, "Cliente ideal (ICP)", size=14, bold=True, color=GOLD_LIGHT)
text_wrapped(
    c,
    0.7,
    5.3,
    12,
    [
        "• 50–500 empleados · sectores servicios, retail, fintech, salud privada.",
        "• Geografía: Chile, México, Colombia, Perú.",
        "• Pain validado: ya intentaron Excel/Forms y fracasaron.",
        "• Trigger comercial: nueva regulación laboral (Ley 40 horas, NCh 3262 en Chile).",
    ],
    size=11,
    line_spacing=1.6,
)
slide_footer(c, 8)
c.showPage()


# ---- Slide 9: Competencia ----
fill_bg(c, BG_BLACK)
slide_header(
    c,
    "08 · Competencia",
    "Posicionamiento competitivo",
    "Precio LATAM, IA nativa, multi-tenant moderno.",
)
comp_rows = [
    ("Lattice (US)", "USD $11", "Limitada", "No", "No"),
    ("Culture Amp (AU)", "USD $14", "No", "No", "No"),
    ("Bamboo HR", "USD $9", "No", "No", "Parcial"),
    ("Buk (CL)", "UF 0.4 + extras", "No", "Sí", "Sí"),
    ("Rankmi (CL)", "A consultar", "Limitada", "Sí", "Sí"),
    ("EVA360", "CLP $1.500–4.000", "Claude nativa", "Sí (RLS)", "es / en / pt"),
]
header_y_top = 2.0
row_h = 0.42
table_left = 0.6
col_w = [2.8, 2.5, 2.2, 2.5, 2.1]
hdrs = ["COMPETIDOR", "PRECIO/EMPL./MES", "IA", "MULTI-TENANT LATAM", "IDIOMA"]

x = table_left
for i, h in enumerate(hdrs):
    rect(c, x, header_y_top, col_w[i], row_h, fill=GOLD_DARK)
    text(c, x + 0.15, header_y_top + 0.12, col_w[i], h, size=10, bold=True, color=BG_BLACK)
    x += col_w[i]

for r, row in enumerate(comp_rows):
    top = header_y_top + (r + 1) * row_h
    is_eva = row[0] == "EVA360"
    fill = GOLD_DARK if is_eva else (BG_PANEL if r % 2 == 0 else BG_PANEL_ALT)
    x = table_left
    for i, cell in enumerate(row):
        rect(c, x, top, col_w[i], row_h, fill=fill, stroke=GOLD_DARK)
        bold = is_eva or i == 0
        color = BG_BLACK if is_eva else (GOLD_LIGHT if i == 0 else TEXT_MUTED)
        text(c, x + 0.15, top + 0.12, col_w[i], cell, size=10, bold=bold, color=color)
        x += col_w[i]

text(c, 0.6, 5.3, 12, "Tres ventajas defendibles", size=14, bold=True, color=GOLD_LIGHT)
text_wrapped(
    c,
    0.7,
    5.75,
    12,
    [
        "• Precio 3–5x menor que competidores US, ajustado al poder de compra LATAM.",
        "• IA generativa nativa (no add-on caro): insights automáticos en feedback y PDI.",
        "• Stack moderno + multi-tenant que escala sin rehacer la arquitectura.",
    ],
    size=11,
    line_spacing=1.55,
)
slide_footer(c, 9)
c.showPage()


# ---- Slide 10: Modelo de negocio ----
fill_bg(c, BG_BLACK)
slide_header(
    c,
    "09 · Negocio",
    "Modelo de negocio",
    "SaaS B2B con planes mensuales/anuales por número de empleados.",
)
plans = [
    ("Starter", "Hasta 50", "$200.000", "$2.4M ARR", False),
    ("Growth", "Hasta 200", "$800.000", "$9.6M ARR", False),
    ("Business", "Hasta 500", "$2.000.000", "$24M ARR", True),
    ("Enterprise", "500+", "Custom (UF)", "$50M+ ARR", False),
]
pw = 2.95
ph = 2.4
for i, (name, emp, price, arr, hl) in enumerate(plans):
    left = 0.6 + i * (pw + 0.1)
    top = 2.0
    fill = GOLD_DARK if hl else BG_PANEL
    stroke = GOLD_PRIMARY if hl else GOLD_DARK
    rect(c, left, top, pw, ph, fill=fill, stroke=stroke)
    text(c, left, top + 0.3, pw, name.upper(), size=13, bold=True, color=BG_BLACK if hl else GOLD_LIGHT, align="center")
    text(c, left, top + 0.7, pw, emp, size=10, color=BG_BLACK if hl else TEXT_DIM, align="center")
    text(c, left, top + 1.15, pw, price, size=21, bold=True, color=BG_BLACK if hl else GOLD_LIGHT, align="center")
    text(c, left, top + 1.6, pw, "CLP / mes", size=9, color=BG_BLACK if hl else TEXT_DIM, align="center")
    text(c, left, top + 1.9, pw, arr, size=11, bold=True, color=BG_BLACK if hl else GOLD_PRIMARY, align="center")

text(c, 0.6, 4.7, 12, "Unit economics objetivo · mes 18", size=14, bold=True, color=GOLD_LIGHT)
ue = [
    ("CAC", "$800.000"),
    ("LTV", "$14.000.000"),
    ("LTV/CAC", "17.5x"),
    ("Payback", "4 meses"),
    ("Gross margin", "78%"),
]
uw = 2.4
for i, (k, v) in enumerate(ue):
    left = 0.6 + i * (uw + 0.1)
    top = 5.2
    rect(c, left, top, uw, 1.4, fill=BG_PANEL, stroke=GOLD_DARK)
    text(c, left, top + 0.3, uw, k, size=11, bold=True, color=GOLD_PRIMARY, align="center")
    text(c, left, top + 0.75, uw, v, size=20, bold=True, color=WHITE, align="center")
slide_footer(c, 10)
c.showPage()


# ---- Slide 11: Tracción ----
fill_bg(c, BG_BLACK)
slide_header(
    c,
    "10 · Tracción",
    "Estado actual y próximos hitos",
    "Producto listo. Comercial en aceleración.",
)
text(c, 0.6, 2.05, 6, "PRODUCTO", size=12, bold=True, color=GOLD_PRIMARY)
text_wrapped(
    c,
    0.7,
    2.5,
    6.0,
    [
        "• Plataforma operativa: 39 controllers + 30 páginas UI.",
        "• 78 entidades de dominio modeladas.",
        "• Integración productiva con Anthropic Claude.",
        "• Documentación legal completa.",
        "• PWA + push + 2FA + auditoría.",
        "• Multi-tenant con RLS validado.",
    ],
    size=11,
    line_spacing=1.7,
)
text(c, 7.0, 2.05, 6, "COMERCIAL · ACTUALIZAR AL PRESENTAR", size=12, bold=True, color=GOLD_PRIMARY)
text_wrapped(
    c,
    7.1,
    2.5,
    6.0,
    [
        "• [N] tenants demo activos",
        "• [N] clientes pagados (pilots o suscripción)",
        "• [MRR] CLP MRR",
        "• [N] leads en pipeline desde landing pública",
        "• [N] integraciones con partners",
    ],
    size=11,
    line_spacing=1.7,
)
rect(c, 0.6, 5.7, 12.13, 1.3, fill=BG_PANEL, stroke=GOLD_DARK)
rect(c, 0.6, 5.7, 0.06, 1.3, fill=GOLD_PRIMARY)
text(c, 0.85, 5.9, 11.5, "PRÓXIMOS 12 MESES", size=12, bold=True, color=GOLD_LIGHT)
text(
    c,
    0.85,
    6.35,
    11.5,
    "SSO SAML + SCIM  ·  Slack + Teams  ·  ISO 27001 (Etapa 1)  ·  Expansión piloto México",
    size=13,
    bold=True,
    color=WHITE,
)
slide_footer(c, 11)
c.showPage()


# ---- Slide 12: Roadmap ----
fill_bg(c, BG_BLACK)
slide_header(
    c,
    "11 · Roadmap",
    "Roadmap a 12 meses",
    "8 hitos verificables · KPI de cierre: 15+ clientes, MRR USD $8.000+, NPS 80.",
)
roadmap_rows = [
    ("Q1", "SSO SAML + SCIM enterprise", "Compatible Azure AD, Okta, Google Workspace"),
    ("Q2", "Integraciones Slack + Teams", "App publicada en Slack Marketplace"),
    ("Q1–Q2", "Landing + SEO + content", "5 case studies + 1.000 sesiones/mes"),
    ("Q2–Q3", "Outbound + ABM mid-market", "10 demos calificadas/mes + 3 pilots"),
    ("Q3", "ISO 27001 (Etapa 1)", "Auditoría inicial completada"),
    ("Q3–Q4", "Expansión México", "2 clientes en CDMX cerrados"),
    ("Q4", "App nativa iOS / Android", "App Store + Play Store"),
    ("Q4", "API pública + Marketplace", "3 integraciones de partners activas"),
]
header_y_top = 2.0
row_h = 0.45
table_left = 0.6
col_w = [1.5, 4.5, 6.6]
hdrs = ["TRIMESTRE", "HITO", "RESULTADO VERIFICABLE"]

x = table_left
for i, h in enumerate(hdrs):
    rect(c, x, header_y_top, col_w[i], row_h, fill=GOLD_DARK)
    text(c, x + 0.15, header_y_top + 0.13, col_w[i], h, size=10, bold=True, color=BG_BLACK)
    x += col_w[i]

for r, (q, hito, res) in enumerate(roadmap_rows):
    top = header_y_top + (r + 1) * row_h
    fill = BG_PANEL if r % 2 == 0 else BG_PANEL_ALT
    x = table_left
    for i, cell in enumerate([q, hito, res]):
        rect(c, x, top, col_w[i], row_h, fill=fill, stroke=GOLD_DARK)
        if i == 0:
            color = GOLD_PRIMARY
            bold = True
        elif i == 1:
            color = GOLD_LIGHT
            bold = True
        else:
            color = TEXT_MUTED
            bold = False
        text(c, x + 0.15, top + 0.13, col_w[i], cell, size=10, bold=bold, color=color)
        x += col_w[i]
slide_footer(c, 12)
c.showPage()


# ---- Slide 13: Equipo ----
fill_bg(c, BG_BLACK)
slide_header(
    c,
    "12 · Equipo",
    "Quiénes lo construimos",
    "Experiencia técnica enterprise + conocimiento del mercado HR LATAM.",
)
team = [
    (
        "Ricardo Ascenda",
        "Founder · CEO · CTO",
        ["Líder técnico y producto. Diseñó la", "arquitectura multi-tenant y la", "integración IA. Visión HR LATAM."],
        "RA",
    ),
    (
        "Backend Engineer",
        "NestJS · TypeORM · PostgreSQL",
        ["Responsable de API, ciclos de", "evaluación, motor de objetivos y", "auditoría cross-tenant."],
        "BE",
    ),
    (
        "Full-stack Engineer",
        "Next.js · React · TypeScript",
        ["Responsable de UI, PWA, dashboards", "de líder y RR.HH., experiencia", "mobile."],
        "FS",
    ),
]
tw = 4.0
th = 3.0
for i, (name, role, bio_lines, initials) in enumerate(team):
    left = 0.6 + i * (tw + 0.15)
    top = 2.05
    rect(c, left, top, tw, th, fill=BG_PANEL, stroke=GOLD_DARK)
    # Avatar circle
    cx = inches(left) + inches(tw) / 2
    cy = y(top + 0.8)
    c.setFillColor(GOLD_PRIMARY)
    c.setStrokeColor(GOLD_LIGHT)
    c.setLineWidth(1.2)
    c.circle(cx, cy, inches(0.5), fill=1, stroke=1)
    # initials
    c.setFillColor(BG_BLACK)
    c.setFont("Helvetica-Bold", 26)
    c.drawCentredString(cx, cy - 9, initials)

    text(c, left, top + 1.5, tw, name, size=14, bold=True, color=WHITE, align="center")
    text(c, left, top + 1.85, tw, role, size=10, bold=True, color=GOLD_PRIMARY, align="center")
    for j, line in enumerate(bio_lines):
        text(c, left, top + 2.3 + j * 0.22, tw, line, size=10, color=TEXT_MUTED, align="center")

rect(c, 0.6, 5.4, 12.13, 1.5, fill=BG_PANEL, stroke=GOLD_DARK)
rect(c, 0.6, 5.4, 0.06, 1.5, fill=GOLD_PRIMARY)
text(c, 0.85, 5.6, 11.5, "POR QUÉ SOMOS LOS INDICADOS", size=12, bold=True, color=GOLD_LIGHT)
text(
    c,
    0.85,
    6.05,
    11.5,
    "Ya construimos lo difícil — multi-tenant, IA integrada y ciclos completos de evaluación.",
    size=11,
    italic=True,
    color=TEXT_MUTED,
)
text(
    c,
    0.85,
    6.35,
    11.5,
    "Ahora aceleramos go-to-market regional con una plataforma diseñada para LATAM.",
    size=11,
    italic=True,
    color=TEXT_MUTED,
)
slide_footer(c, 13)
c.showPage()


# ---- Slide 14: Cierre ----
fill_bg(c, BG_BLACK)
rect(c, 0, 0, 13.333, 0.15, fill=GOLD_PRIMARY)
text(c, 0.6, 0.5, 12, "13 · CIERRE", size=12, bold=True, color=GOLD_PRIMARY)
text(c, 0.6, 0.95, 12, "EVA360 ya existe. Funciona. Lo difícil está hecho.", size=28, bold=True, color=GOLD_LIGHT)
gold_bar(c, 0.6, 1.85, 3.5)

rect(c, 0.6, 2.2, 6.0, 2.6, fill=BG_PANEL, stroke=GOLD_DARK)
rect(c, 0.6, 2.2, 0.08, 2.6, fill=GOLD_PRIMARY)
text(c, 0.85, 2.45, 5.5, "PARA NUEVOS USUARIOS", size=12, bold=True, color=GOLD_PRIMARY)
text_wrapped(
    c,
    0.85,
    2.95,
    5.5,
    [
        "Empieza a evaluar a tu equipo de forma justa,",
        "rápida y con datos accionables.",
        "",
        "Demo gratuita en 15 minutos.",
        "Onboarding asistido en menos de una semana.",
    ],
    size=12,
    line_spacing=1.5,
)
text(c, 0.85, 4.4, 5.5, "→ eva360.ascenda.cl/demo", size=13, bold=True, color=GOLD_LIGHT)

rect(c, 6.85, 2.2, 6.0, 2.6, fill=BG_PANEL, stroke=GOLD_DARK)
rect(c, 6.85, 2.2, 0.08, 2.6, fill=GOLD_PRIMARY)
text(c, 7.1, 2.45, 5.5, "PARA INVERSIONISTAS", size=12, bold=True, color=GOLD_PRIMARY)
text_wrapped(
    c,
    7.1,
    2.95,
    5.5,
    [
        "Levantamos capital semilla para acelerar",
        "go-to-market en Chile + México y consolidar",
        "tracción regional en 18 meses.",
        "",
        "Producto listo. Mercado validado.",
    ],
    size=12,
    line_spacing=1.5,
)
text(c, 7.1, 4.4, 5.5, "→ ricardo@ascenda.cl", size=13, bold=True, color=GOLD_LIGHT)

rect(c, 0.6, 5.2, 12.13, 1.5, fill=GOLD_DARK)
text(
    c,
    0.6,
    5.55,
    12.13,
    "Build nos da el combustible para pasar de MVP demostrable a negocio sostenible.",
    size=14,
    italic=True,
    color=BG_BLACK,
    align="center",
)
text(
    c,
    0.6,
    6.15,
    12.13,
    "ricardo@ascenda.cl   ·   ascenda.cl   ·   eva360.ascenda.cl   ·   Santiago, Chile",
    size=13,
    bold=True,
    color=BG_BLACK,
    align="center",
)
slide_footer(c, 14)
c.showPage()


c.save()
print(f"PDF generado: {OUT_PDF}")
print(f"Tamaño: {OUT_PDF.stat().st_size / 1024:.1f} KB · Slides: {TOTAL_SLIDES}")
