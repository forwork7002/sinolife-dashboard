#!/usr/bin/env python3
"""Render check for the medal set. Reads medal-defs.html + medal.css, resolves the
custom-property cascade per instance exactly as the CSS would, substitutes the
token hex per theme (rsvg has no var()), pre-computes color-mix(in oklab …),
renders sheet-light/dark.png and the 3 m simulations."""
import re, math, pathlib, subprocess, html

A = pathlib.Path(__file__).parent
TOK = {
 "light": dict(surface="#ffffff", **{"surface-raised": "#ffffff", "surface-sunken": "#eef0f4",
        "ink-primary": "#0c0e12", "ink-secondary": "#4c525e", "ink-muted": "#636d79", "ink-on-series": "#ffffff",
        "border": "rgba(12,14,18,0.09)", "border-strong": "rgba(12,14,18,0.16)", "track": "#e8eaee",
        "seq-550": "#2b56db", "accent": "#3d6df4", "medal-gold": "#b3860e", "medal-silver": "#798294",
        "medal-bronze": "#a5663a", "series-2": "#ca4c07", "series-3": "#00897d", "series-6": "#528118", "series-7": "#8749fb"}),
 "dark": dict(surface="#101217", **{"surface-raised": "#1c2027", "surface-sunken": "#0b0d11",
        "ink-primary": "#f5f6f8", "ink-secondary": "#a8b0bd", "ink-muted": "#8891a0", "ink-on-series": "#ffffff",
        "border": "rgba(255,255,255,0.11)", "border-strong": "rgba(255,255,255,0.22)", "track": "#313845",
        "seq-550": "#7ca4ff", "accent": "#497bff", "medal-gold": "#e8c256", "medal-silver": "#bac4d3",
        "medal-bronze": "#d89a68", "series-2": "#d8591e", "series-3": "#32a89c", "series-6": "#55841d", "series-7": "#905eff"}),
}

# ---------- oklab color-mix ----------
def _lin(c): return c/12.92 if c <= 0.04045 else ((c+0.055)/1.055)**2.4
def _gam(c):
    c = max(0.0, min(1.0, c))
    return 12.92*c if c <= 0.0031308 else 1.055*c**(1/2.4)-0.055
def hex2oklab(h):
    r, g, b = (_lin(int(h[i:i+2], 16)/255) for i in (1, 3, 5))
    l = 0.4122214708*r+0.5363325363*g+0.0514459929*b
    m = 0.2119034982*r+0.6806995451*g+0.1073969566*b
    s = 0.0883024619*r+0.2817188376*g+0.6299787005*b
    l, m, s = (x**(1/3) for x in (l, m, s))
    return (0.2104542553*l+0.7936177850*m-0.0040720468*s,
            1.9779984951*l-2.4285922050*m+0.4505937099*s,
            0.0259040371*l+0.7827717662*m-0.8086757660*s)
def oklab2hex(L, a, b):
    l = (L+0.3963377774*a+0.2158037573*b)**3
    m = (L-0.1055613458*a-0.0638541728*b)**3
    s = (L-0.0894841775*a-1.2914855480*b)**3
    r = 4.0767416621*l-3.3077115913*m+0.2309699292*s
    g = -1.2684380046*l+2.6097574011*m-0.3413193965*s
    bb = -0.0041960863*l-0.7034186147*m+1.7076147010*s
    return "#%02x%02x%02x" % tuple(round(_gam(c)*255) for c in (r, g, bb))
def colormix(h, pct, other):
    o = "#ffffff" if other == "white" else "#000000"
    p = pct/100
    A_, B_ = hex2oklab(h), hex2oklab(o)
    return oklab2hex(*(p*x+(1-p)*y for x, y in zip(A_, B_)))

# ---------- css cascade ----------
css = re.sub(r"/\*.*?\*/", "", (A/"medal.css").read_text(), flags=re.S)
RULES = []
for i, m in enumerate(re.finditer(r"([^{}]+)\{([^{}]*)\}", css)):
    decls = {}
    for d in m.group(2).split(";"):
        if ":" in d:
            k, v = d.split(":", 1); decls[k.strip().lstrip("-")] = v.strip()
    for sel in m.group(1).split(","):
        toks = re.findall(r'\.[\w-]+|\[[\w-]+="[^"]*"\]', sel.strip())
        RULES.append((len(toks), i, toks, decls))
def cascade(classes, attrs):
    out = {}
    for spec, order, toks, decls in sorted(RULES, key=lambda r: (r[0], r[1])):
        ok = True
        for t in toks:
            if t.startswith("."):
                ok &= t[1:] in classes
            else:
                k, v = re.match(r'\[([\w-]+)="([^"]*)"\]', t).groups()
                ok &= attrs.get(k) == v
        if ok: out.update(decls)
    return out

VAR = re.compile(r"var\(--([\w-]+)(?:\s*,\s*([^()]*))?\)")
MIX = re.compile(r"color-mix\(in oklab,\s*(#[0-9a-f]{6})\s+(\d+)%\s*,\s*(white|black)\)")
def resolve(text, vars_, theme):
    t = TOK[theme]
    def sub(m):
        n, fb = m.group(1), m.group(2)
        if n in vars_: return vars_[n]
        if n in t: return t[n]
        if fb is not None: return fb.strip()
        raise KeyError(n)
    for _ in range(8):
        new = VAR.sub(sub, text)
        if new == text: break
        text = new
    text = MIX.sub(lambda m: colormix(m.group(1), int(m.group(2)), m.group(3)), text)
    assert "var(" not in text and "color-mix" not in text, text[:200]
    return text

# ---------- defs ----------
defs = (A/"medal-defs.html").read_text()
inner = re.search(r"<defs>(.*)</defs>", defs, re.S).group(1)
SYM = {m.group(1): m.group(2) for m in re.finditer(r'<symbol id="([\w-]+)"[^>]*>(.*?)</symbol>', inner, re.S)}
SHARED = re.sub(r"<symbol.*?</symbol>", "", inner, flags=re.S)
SHARED = re.sub(r"<!--.*?-->", "", SHARED, flags=re.S)

SIZES = {"row": 33, "seat": 44, "speaking": 64}
BARE = {"row": 26.4, "seat": 35.2, "speaking": 51.2}
def inst(code, size, x, y, theme, bare=False):
    classes = {"medal", f"medal--{size}"} | ({"medal--bare"} if bare else set())
    v = cascade(classes, {"data-medal": code})
    body = resolve(SYM[f"medal-{code}"], v, theme)
    if bare:
        s = BARE[size]/32; return f'<g transform="translate({x} {y}) scale({s:.4f}) translate(0 -8)">{body}</g>'
    s = SIZES[size]/40
    return f'<g transform="translate({x} {y}) scale({s:.4f})">{body}</g>'
def width(size, bare): return BARE[size] if bare else SIZES[size]*0.8

NAMES = [("month-gold", "Oy chempioni"), ("month-silver", "Kumush oy"), ("month-bronze", "Bronza oy"),
         ("year-champion", "Yil chempioni"), ("streak-fire", "Olov seriyasi"), ("streak-steady", "Barqaror"),
         ("day-record", "Kun rekordi"), ("day-winner", "Kun gʻolibi"), ("conversion-master", "Konversiya ustasi"),
         ("clean-month", "Toza oy"), ("jump", "Sakrash"), ("rookie", "Yangi yulduz"), ("first-sale", "Birinchi savdo"),
         ("work-month", "Ishchan oy"), ("locked", "Qulflangan")]
FONT = 'font-family="Inter, DejaVu Sans, sans-serif"'

def pill(x, y, n, t, h=15):
    w = h*1.55
    return (f'<rect x="{x:.1f}" y="{y:.1f}" width="{w:.1f}" height="{h}" rx="{h/2}" fill="{t["ink-primary"]}" stroke="{t["surface-raised"]}" stroke-width="1.5"/>'
            f'<text x="{x+w/2:.1f}" y="{y+h/2+0.5:.1f}" dominant-baseline="central" text-anchor="middle" {FONT} font-weight="700" font-size="{h*0.72:.1f}" fill="{t["surface"]}">×{n}</text>')

def sheet(theme):
    t = TOK[theme]
    W, H = 1180, 780
    o = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">',
         f'<defs>{resolve(SHARED, {}, theme)}</defs>',
         f'<rect width="{W}" height="{H}" fill="{t["surface"]}"/>']
    lab = lambda x, y, s: o.append(f'<text x="{x}" y="{y}" {FONT} font-size="12" font-weight="600" letter-spacing="1" fill="{t["ink-muted"]}">{s}</text>')
    # --- A: speaking 64 on the raised card
    lab(24, 26, "SPEAKING · 64 PX")
    o.append(f'<rect x="20" y="36" width="1140" height="126" rx="12" fill="{t["surface-raised"]}" stroke="{t["border"]}"/>')
    for i, (code, name) in enumerate(NAMES):
        cx = 24 + 38 + i*75.5
        o.append(inst(code, "speaking", cx-25.6, 48, theme))
        parts = name.split(" ")
        for j, p in enumerate(parts):
            o.append(f'<text x="{cx}" y="{128+j*14}" text-anchor="middle" {FONT} font-size="12" fill="{t["ink-secondary"]}">{html.escape(p)}</text>')
    # --- B: seat 44 rail (podium seat card) + full set
    lab(24, 190, "SEAT · 44 PX — podium seat rail")
    o.append(f'<rect x="20" y="200" width="560" height="96" rx="12" fill="{t["surface-raised"]}" stroke="{t["medal-gold"]}" stroke-width="2"/>')
    o.append(f'<text x="40" y="232" {FONT} font-size="22" font-weight="700" fill="{t["ink-primary"]}">Dilnoza Karimova</text>')
    o.append(f'<text x="40" y="254" {FONT} font-size="15" fill="{t["ink-secondary"]}">126 950 000 soʻm · sentabr</text>')
    rail = [("month-gold", 3), ("year-champion", None), ("streak-fire", None), ("conversion-master", None), ("day-record", None), ("locked", None)]
    for j, (code, n) in enumerate(rail):
        x = 300 + j*46
        o.append(inst(code, "seat", x, 226, theme))
        if n: o.append(pill(x+22, 220, n, t, 15))
    o.append(f'<rect x="600" y="200" width="560" height="96" rx="12" fill="{t["surface-sunken"]}"/>')
    o.append(f'<text x="620" y="232" {FONT} font-size="22" font-weight="700" fill="{t["ink-primary"]}">Sardor Toshpulatov</text>')
    o.append(f'<text x="620" y="254" {FONT} font-size="15" fill="{t["ink-secondary"]}">98 400 000 soʻm · sentabr</text>')
    rail = [("month-silver", None), ("streak-steady", 2), ("day-winner", None), ("clean-month", None), ("rookie", None), ("work-month", None)]
    for j, (code, n) in enumerate(rail):
        x = 880 + j*46
        o.append(inst(code, "seat", x, 226, theme))
        if n: o.append(pill(x+22, 220, n, t, 15))
    for i, (code, _) in enumerate(NAMES):
        o.append(inst(code, "seat", 24 + i*48, 312, theme))
    lab(24 + 15*48 + 12, 340, "all 15, seat")
    # --- C: rows 26px — ribbon variant (left) vs bare variant (right)
    lab(24, 392, "ROW · 33 PX with ribbon tab (23 px disc)")
    lab(620, 392, "ROW · 26 PX bare disc (same 23 px disc, client choice)")
    names = ["Madina Yusupova", "Jasur Ergashev", "Nilufar Sattorova", "Bobur Mirzayev", "Aziz Rahimov", "Kamola Nazarova", "Sherzod Umarov"]
    cabs = [[("month-gold", 2), ("year-champion", None), ("streak-fire", None), ("conversion-master", None)],
            [("month-silver", None), ("day-record", None), ("clean-month", None), ("locked", None)],
            [("month-bronze", None), ("streak-steady", 3), ("jump", None)],
            [("first-sale", None), ("work-month", None), ("locked", None), ("locked", None)],
            [("day-winner", None), ("rookie", None)],
            [("month-gold", None), ("month-silver", 2), ("month-bronze", None), ("year-champion", None)],
            [("locked", None), ("locked", None), ("locked", None)]]
    money = ["61 200 000", "55 900 000", "48 300 000", "44 850 000", "25 120 000", "19 700 000", "9 400 000"]
    for i, nm in enumerate(names):
        y = 404 + i*46
        for x0 in (20, 616):
            bare = x0 == 616
            o.append(f'<rect x="{x0}" y="{y}" width="544" height="44" rx="6" fill="{t["surface-raised"] if i % 2 else t["surface"]}"/>')
            o.append(f'<line x1="{x0}" y1="{y+44}" x2="{x0+544}" y2="{y+44}" stroke="{t["border"]}"/>')
            o.append(f'<text x="{x0+34}" y="{y+22}" dominant-baseline="central" text-anchor="end" {FONT} font-size="16" fill="{t["ink-muted"]}">{i+4}</text>')
            o.append(f'<text x="{x0+50}" y="{y+22}" dominant-baseline="central" {FONT} font-weight="600" font-size="17" fill="{t["ink-primary"]}">{nm}</text>')
            mx = x0 + 232
            pitch = 33
            for j, (code, n) in enumerate(cabs[i]):
                x = mx + j*pitch
                o.append(inst(code, "row", x, y + (5.5 if not bare else 8.8), theme, bare=bare))
                if n: o.append(pill(x+width("row", bare)-11, y+3, n, t, 13))
            if len(cabs[i]) < 4 and i not in (6,):
                o.append(f'<text x="{mx + 4*pitch + 4}" y="{y+22}" dominant-baseline="central" {FONT} font-size="14" fill="{t["ink-muted"]}">+{i+1}</text>')
            o.append(f'<text x="{x0+528}" y="{y+22}" dominant-baseline="central" text-anchor="end" {FONT} font-weight="600" font-size="17" fill="{t["ink-primary"]}">{money[i]}</text>')
    o.append("</svg>")
    return "\n".join(o)

for th in ("light", "dark"):
    svg = A/f"medal-sheet-{th}.svg"; svg.write_text(sheet(th))
    subprocess.run(["rsvg-convert", "-o", str(A/f"medal-sheet-{th}.png"), str(svg)], check=True)
    subprocess.run(["magick", str(A/f"medal-sheet-{th}.png"), "-resize", "33.3%", "-filter", "point", "-resize", "300%", str(A/f"medal-sheet-{th}-3m.png")], check=True)
    print(th, "ok")

# ---------- preview tokens for medal-usage.html (render-check only; the app supplies the real tokens) ----------
def tokens_css():
    def block(th): return "\n".join(f"  --{k}: {v};" for k, v in TOK[th].items())
    return ("/* preview-tokens.css — GENERATED by render.py for the usage page only. The app's globals.css owns the real tokens. */\n"
            f":root {{\n{block('light')}\n  --font-sans: Inter, system-ui, sans-serif;\n}}\n"
            f"@media (prefers-color-scheme: dark) {{ :root:not([data-theme=\"light\"]) {{\n{block('dark')}\n}} }}\n"
            f":root[data-theme=\"dark\"] {{\n{block('dark')}\n}}\n")
(A/"preview-tokens.css").write_text(tokens_css())
print("preview-tokens.css ok")
