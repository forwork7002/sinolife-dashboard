#!/usr/bin/env python3
"""EFIR · PREMIUM (final) — OBSIDIAN chassis + ZARB mint + agreed grafts.
Generates final-month.html, final-today.html, final-month-light.html and final-check.html
(verification fixtures: FAKT 1 read, ranks 15-25 incl. the 38-char name, a Legenda row,
all 14 medals on the real row surface, the longest name inside a record plaque)."""
import json, os, html, re, subprocess, datetime

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = json.load(open(os.path.join(HERE, 'board-data.json')))
ROWS, TEAMS = DATA['rows'], DATA['teams']
NNBSP, NBSP = ' ', ' '

# --------------------------------------------------------------------------
# TOKENS — the single source. Pre-mixed: nothing on the page calls color-mix().
# --------------------------------------------------------------------------
def _rgb(h):
    h = h.lstrip('#'); return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))
def _hex(c):
    return '#%02x%02x%02x' % tuple(max(0, min(255, round(v))) for v in c)
def mix(a, b, t):
    """a·(1−t) + b·t in sRGB — a design-time pre-mix, printed as a literal."""
    A, B = _rgb(a), _rgb(b); return _hex(tuple(A[i] * (1 - t) + B[i] * t for i in range(3)))
def rgba(h, a):
    r, g, b = _rgb(h); return f'rgba({r}, {g}, {b}, {a})'
def lum(h):
    def f(v):
        v /= 255; return v / 12.92 if v <= .03928 else ((v + .055) / 1.055) ** 2.4
    r, g, b = _rgb(h); return .2126 * f(r) + .7152 * f(g) + .0722 * f(b)
def contrast(a, b):
    la, lb = sorted((lum(a), lum(b)), reverse=True); return (la + .05) / (lb + .05)

DARK = {
    'page': '#050609', 'chrome-rail': '#0b0d11', 'chrome-active': '#171b22', 'chrome-accent': '#4f7cff', 'chrome-on-accent': '#ffffff', 'chrome-ok': '#3fb37f',
    'efir-page-glow': 'rgba(116, 160, 224, .075)',
    'efir-panel': '#0c0f14', 'efir-panel-sheen': 'rgba(255, 255, 255, .03)',
    'efir-raised': '#141921', 'efir-raised-hi': '#1d232e', 'efir-sunken': '#07090c',
    'efir-ink': '#f2f5fa', 'efir-ink-name': '#d9dfe8', 'efir-ink-ctx': '#c2cad6', 'efir-ink-2': '#939db0', 'efir-ink-3': '#737e92', 'efir-ink-4': '#2f3743',
    'efir-hairline': 'rgba(255, 255, 255, .05)', 'efir-edge-hi': 'rgba(255, 255, 255, .095)', 'efir-edge-ring': 'rgba(255, 255, 255, .035)',
    'efir-shadow-panel': '0 30px 60px -30px rgba(0, 0, 0, .9)',
    'efir-shadow-seat': '0 24px 40px -22px rgba(0, 0, 0, .95), 0 2px 5px -1px rgba(0, 0, 0, .55)',
    'efir-seg-well': 'inset 0 1px 2px rgba(0, 0, 0, .35), inset 0 0 0 1px rgba(255, 255, 255, .035)',
    'efir-seg-on': 'inset 0 1px 0 rgba(255, 255, 255, .095), 0 1px 2px rgba(0, 0, 0, .35)',
    'efir-track': 'rgba(255, 255, 255, .09)', 'efir-stage-light': 'rgba(150, 185, 235, .07)',
    'efir-plate-well': '#07090c',
}
LIGHT = {
    'page': '#f6f7f9', 'chrome-rail': '#ffffff', 'chrome-active': '#eef0f4', 'chrome-accent': '#2f5fe0', 'chrome-on-accent': '#ffffff', 'chrome-ok': '#1f9d63',
    'efir-page-glow': 'rgba(255, 255, 255, .9)',
    'efir-panel': '#fbfcfe', 'efir-panel-sheen': 'rgba(255, 255, 255, 1)',
    'efir-raised': '#ffffff', 'efir-raised-hi': '#ffffff', 'efir-sunken': '#edf0f5',
    'efir-ink': '#0a0f17', 'efir-ink-name': '#1c2431', 'efir-ink-ctx': '#333d4c', 'efir-ink-2': '#556072', 'efir-ink-3': '#677285', 'efir-ink-4': '#ccd3de',
    'efir-hairline': 'rgba(12, 18, 28, .07)', 'efir-edge-hi': 'rgba(255, 255, 255, 1)', 'efir-edge-ring': 'rgba(12, 18, 28, .07)',
    'efir-shadow-panel': '0 30px 50px -34px rgba(24, 38, 66, .35), 0 1px 2px rgba(24, 38, 66, .08)',
    'efir-shadow-seat': '0 22px 36px -24px rgba(24, 38, 66, .5), 0 2px 5px -1px rgba(24, 38, 66, .14)',
    'efir-seg-well': 'inset 0 1px 2px rgba(12, 18, 28, .1), inset 0 0 0 1px rgba(12, 18, 28, .07)',
    'efir-seg-on': '0 1px 2px rgba(24, 38, 66, .2), inset 0 0 0 1px rgba(12, 18, 28, .07)',
    'efir-track': 'rgba(12, 18, 28, .1)', 'efir-stage-light': 'rgba(255, 255, 255, 0)',
    'efir-plate-well': '#10151d',
}
# level ramp — ONE set. Dark: dim → glowing (only 5-6 glow). Light: pale → navy. In both,
# a higher level has MORE contrast against the panel (asserted below and in efirCss.test.ts).
TIER = {
    'dark': ['#465268', '#4c6c94', '#3d8bcb', '#6cc3f2', '#b5e6fc', '#f2fbff'],
    'light': ['#b9c4d4', '#8aa1c2', '#4f88c6', '#1f70bf', '#124f97', '#0a2c61'],
}
METAL = {
    'dark': {
        'gold': ('#f9e8ae', '#dcb24a', '#8d6a1c', '#3a2b0b'), 'silver': ('#f4f7fb', '#b3bece', '#626d7c', '#252c36'),
        'bronze': ('#f5cba4', '#c98450', '#744525', '#301d0e'), 'steel': ('#b6c6d9', '#6c8096', '#364354', '#12181f'),
        'gilt': ('#efe3c2', '#bfa873'),
    },
    'light': {
        'gold': ('#f8e4a2', '#cf9f2a', '#7e5b0d', '#3f2d06'), 'silver': ('#f8fafc', '#a3aebe', '#55606e', '#272e38'),
        'bronze': ('#f3c79f', '#bb7640', '#693c1d', '#2e1a0b'), 'steel': ('#c9d5e3', '#71839a', '#3a4657', '#171d25'),
        'gilt': ('#f3e6bf', '#c4a862'),
    },
}
def theme_tokens(theme):
    t = dict(DARK if theme == 'dark' else LIGHT)
    dark = theme == 'dark'
    hi_mix, lo_mix = '#ffffff', '#000000'
    for i, c in enumerate(TIER[theme], 1):
        t[f'tier-{i}'] = c
        t[f'tier-{i}-hi'] = mix(c, hi_mix, .26)
        t[f'tier-{i}-lo'] = mix(c, lo_mix, .24 if i < 6 else .2)
        t[f'tier-{i}-wash'] = rgba(c, .16 if dark else .13)
    for m in ('gold', 'silver', 'bronze', 'steel'):
        hi, mid, lo, sh = METAL[theme][m]
        t[f'medal-{m}-hi'], t[f'medal-{m}'], t[f'medal-{m}-lo'], t[f'medal-{m}-sh'] = hi, mid, lo, sh
        # patina: a trace of the room's ice in the field's shadow; well: the dark floor a device stands on
        t[f'medal-{m}-patina'] = mix(sh, TIER[theme][2], .18) if m != 'steel' else mix(sh, TIER[theme][2], .1)
        t[f'medal-{m}-well'] = mix(sh, lo, .42)
    t['medal-gilt-hi'], t['medal-gilt'] = METAL[theme]['gilt']
    g, s, b = (METAL[theme][m][1] for m in ('gold', 'silver', 'bronze'))
    t['medal-gold-wash'], t['medal-silver-wash'], t['medal-bronze-wash'] = rgba(g, .09 if dark else .12), rgba(s, .09 if dark else .16), rgba(b, .09 if dark else .12)
    t['medal-gold-wash-p1'] = rgba(g, .15 if dark else .2)
    t['efir-p1-keyline'] = rgba(METAL[theme]['gold'][0 if dark else 1], .13 if dark else .34)
    t.update({
        'medal-key': 'rgba(0, 0, 0, .6)' if dark else 'rgba(12, 14, 18, .55)',
        'medal-cast': 'rgba(0, 0, 0, .45)' if dark else 'rgba(12, 14, 18, .2)',
        'medal-glint': 'rgba(255, 255, 255, .5)' if dark else 'rgba(255, 255, 255, .7)',
        'medal-edge': 'rgba(255, 255, 255, .5)' if dark else 'rgba(255, 255, 255, .62)',
        'sheen-hi': 'rgba(255, 255, 255, .28)' if dark else 'rgba(255, 255, 255, .26)',
        'sheen-lo': 'rgba(0, 0, 0, .3)' if dark else 'rgba(0, 0, 0, .22)',
        'sheen-none-hi': 'rgba(255, 255, 255, 0)', 'sheen-none-lo': 'rgba(0, 0, 0, 0)',
        'bloom': 'rgba(255, 255, 255, .12)' if dark else 'rgba(255, 255, 255, .11)',
        'ribbon-a': '#2c6aa2' if dark else '#2a6fb0', 'ribbon-shade': 'rgba(0, 0, 0, .34)' if dark else 'rgba(0, 0, 0, .3)',
        'recess-hi': 'rgba(255, 255, 255, .14)' if dark else '#ffffff',
        'recess-lo': 'rgba(0, 0, 0, .7)' if dark else 'rgba(12, 14, 18, .28)',
        'recess-none': 'rgba(0, 0, 0, 0)',
        'slot-field': '#0b0d11' if dark else '#e4e8ee', 'slot-dash': 'rgba(255, 255, 255, .16)' if dark else 'rgba(12, 14, 18, .26)',
        'slot-glyph': '#262d38' if dark else '#bfc7d2',
        'crest-plate': '#07090c' if dark else '#e7eaf0', 'crest-off': '#1b212b' if dark else '#dfe4ec',
        'crest-glint': 'rgba(255, 255, 255, .5)' if dark else 'rgba(255, 255, 255, .6)',
        'crest-shade': 'rgba(0, 0, 0, .4)' if dark else 'rgba(12, 14, 18, .3)',
        'halo-field-hi': '#262c37' if dark else '#2b323e', 'halo-field-lo': '#0b0e13' if dark else '#10141a',
    })
    return t

def token_css():
    out = []
    for theme, sel in (('dark', ':root'), ('light', ':root[data-theme="light"]')):
        t = theme_tokens(theme)
        out.append(sel + ' {\n' + '\n'.join(f'  --{k}: {v};' for k, v in t.items()) + '\n}')
    return '\n'.join(out)

def audit_tokens():
    """The test efirCss.test.ts must carry: contrast of --tier-N against the panel rises with N,
    in BOTH themes; label inks clear 4.5:1 on the panel."""
    rep = {}
    for theme in ('dark', 'light'):
        t = theme_tokens(theme)
        cs = [round(contrast(t[f'tier-{i}'], t['efir-panel']), 2) for i in range(1, 7)]
        assert all(b > a for a, b in zip(cs, cs[1:])), (theme, cs)
        inks = {k: round(contrast(t[k], t['efir-panel']), 2) for k in ('efir-ink', 'efir-ink-name', 'efir-ink-2', 'efir-ink-3')}
        assert inks['efir-ink-3'] >= 4.5 and inks['efir-ink-2'] >= 6, (theme, inks)
        rep[theme] = {'tier_contrast': cs, 'ink_contrast': inks}
    return rep

# --------------------------------------------------------------------------
# formatting
# --------------------------------------------------------------------------
def som(n):
    return f"{int(n):,}".replace(',', NNBSP)
def som_hero(n):
    """Hero money is the SAME string as every other figure: real U+202F groups, one text node.
    (The «tightened separator» graft was dropped: a negative letter-spacing on U+202F closes the
    group gap completely in Firefox — «319850000» — see premium-final-month-firefox.png, first pass.
    The figure's own −.022…−.034em tracking already tightens the gap, in every engine.)"""
    return som(n)
def pct(v):
    r = round(v * 10) / 10
    t = (f"{r:.1f}".rstrip('0').rstrip('.')).replace('.', ',')
    return f"{t}{NBSP}%"
def esc(s):
    return html.escape(s, quote=True)

def split_name(raw):
    """Presentation only. The portal code is the first ALL-DIGIT token of 2-4 digits, and only when
    at least one non-digit token remains («131 sotuvchi 131» → name «sotuvchi 131»? no: keep the
    rule honest — the FIRST code goes, later numbers stay in the name). «(stajor)» stays in the name."""
    toks = raw.split()
    idx = next((i for i, t in enumerate(toks) if re.fullmatch(r'\d{2,4}', t)), None)
    if idx is None or len(toks) == 1:
        return toks, None
    rest = toks[:idx] + toks[idx + 1:]
    if not any(not t.isdigit() for t in rest):
        return toks, None
    return rest, toks[idx]

WEEKDAYS = ['dushanba', 'seshanba', 'chorshanba', 'payshanba', 'juma', 'shanba', 'yakshanba']
MONTHS = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr']
TODAY = datetime.date(2026, 9, 17)
def date_long(d):
    return f'{d.day}-{MONTHS[d.month - 1]} {d.year}, {WEEKDAYS[d.weekday()]}'   # COMPUTED, never typed
def date_uz(iso):
    y, m, d = iso.split('-'); return f'{int(d)}-{MONTHS[int(m) - 1]}'

# --------------------------------------------------------------------------
# medals — ZARB: shape = family, metal = rarity. Order: honours first (server MEDAL_ORDER as is).
# --------------------------------------------------------------------------
NAMES = {
    'month-gold': 'Oy chempioni', 'month-silver': 'Kumush oy', 'month-bronze': 'Bronza oy',
    'year-champion': 'Yil chempioni', 'streak-fire': 'Olov seriyasi', 'streak-steady': 'Barqaror',
    'day-record': 'Kun rekordi', 'day-winner': 'Kun gʻolibi', 'conversion-master': 'Konversiya ustasi',
    'clean-month': 'Toza oy', 'jump': 'Sakrash', 'rookie': 'Yangi yulduz',
    'first-sale': 'Birinchi savdo', 'work-month': 'Ishchan oy',
}
# body metal, device metal
METAL_OF = {
    'year-champion': ('gold', 'gold'), 'month-gold': ('gold', 'gold'), 'month-silver': ('silver', 'silver'), 'month-bronze': ('bronze', 'bronze'),
    'day-record': ('gold', 'gold'), 'conversion-master': ('gold', 'gold'), 'streak-fire': ('gold', 'gold'),
    'streak-steady': ('steel', 'gilt'), 'day-winner': ('steel', 'gilt'), 'clean-month': ('steel', 'gilt'), 'jump': ('steel', 'gilt'), 'rookie': ('steel', 'gilt'),
    'first-sale': ('steel', 'steel'), 'work-month': ('steel', 'steel'),
}
# ONE order, server and client (sellerMedals.MEDAL_ORDER): the true-metal seven, then gilt, then steel.
ORDER = ['year-champion', 'month-gold', 'month-silver', 'month-bronze', 'streak-fire', 'conversion-master', 'day-record',
         'streak-steady', 'clean-month', 'jump', 'rookie', 'day-winner', 'work-month', 'first-sale']
RARE = set(ORDER[:7])
MONTH_FAMILY = {'month-gold', 'month-silver', 'month-bronze'}
PROVISIONAL_MONTH = '2026-08'   # closed month with orders still on the road → «hozircha»

def medal(code, size, count=1, seat=False):
    body, dev = METAL_OF[code]
    inner = ''
    if seat and code in MONTH_FAMILY and size >= 40:
        inner += f'<use href="#m-laurel-{body}"/>'
    inner += f'<use href="#m-{code}"/>'
    if seat and count > 1:
        ds = list(str(min(count, 99)))
        w = 15.0 if len(ds) == 1 else 19.8
        x0 = 31.8 - w
        glyphs = ['x'] + ds
        step, s = 4.9, .54
        gx = x0 + (w - len(glyphs) * step) / 2 + step / 2
        uses = ''
        for g in glyphs:
            sc = s * .78 if g == 'x' else s
            uses += f'<use href="#n{g}" transform="translate({gx:.2f} 26.7) scale({sc:.3f})"/>'
            gx += step
        inner += (f'<rect class="medal__plate-rim" x="{x0:.2f}" y="21.2" width="{w}" height="10.6" rx="2.6" fill="url(#mg-{body}-rim)"/>'
                  f'<rect class="medal__plate-well" x="{x0 + 1.1:.2f}" y="22.3" width="{w - 2.2:.2f}" height="8.4" rx="1.7"/>'
                  f'<g class="medal__count" data-dev="{dev}">{uses}</g>')
    label = NAMES[code] + (f' ×{count}' if count > 1 else '')
    return (f'<svg class="medal" data-medal="{code}" viewBox="0 0 32 32" width="{size}" height="{size}" role="img" aria-label="{label}">{inner}</svg>')

def sort_medals(ms, hide=()):
    return sorted([m for m in ms if m['code'] not in hide], key=lambda m: ORDER.index(m['code']))

def row_medals(ms, size=28):
    vis = sort_medals(ms, hide=('first-sale',))[:3]
    # row-reverse: slot 1 (rarest) sits next to the money, so honours form one vertical column
    return '<span class="rack">' + ''.join(medal(m['code'], size) for m in vis) + '</span>'

def seat_medals(ms, size, cap):
    vis = sort_medals(ms)
    if any(m['code'] in RARE or METAL_OF[m['code']][1] == 'gilt' for m in vis):
        vis = [m for m in vis if m['code'] not in ('first-sale', 'work-month')]
    vis = vis[:cap]
    return ''.join(medal(m['code'], size, m['count'], seat=True) for m in vis), (vis[0] if vis else None)

TITLES = {1: 'Yangi', 2: 'Sotuvchi', 3: 'Katta sotuvchi', 4: 'Usta', 5: 'Ustoz', 6: 'Legenda'}
def crest(level, h, plated=False):
    level = level or 0
    vw = 88 if level >= 6 else 72
    w = round(h * vw / 26, 2)
    label = f'{level}-daraja · {TITLES[level]}' if level else 'Hali darajasiz'
    plate = f'<use href="#crest-plate{"-6" if level >= 6 else ""}"/>' if plated else ''
    return (f'<svg class="crest" data-tier="{level}" viewBox="-3 -3 {vw} 26" width="{w}" height="{h}" role="img" aria-label="{label}">'
            f'{plate}<use href="#crest-{level}"/></svg>')

def halo(n, size, small=False, wreath=False):
    svg = f'<svg class="halo" viewBox="0 0 64 64" width="{size}" height="{size}" aria-hidden="true">'
    if wreath:
        svg += '<use href="#halo-laurel" x="-10" y="-10" width="84" height="84"/>'
    svg += f'<use href="#halo-{"sm-" if small else ""}{n}"/></svg>'
    return f'<span class="halo-box" style="width:{size}px;height:{size}px">{svg}</span>'

METALS = {1: 'gold', 2: 'silver', 3: 'bronze'}

# --------------------------------------------------------------------------
# components
# --------------------------------------------------------------------------
def fakt_words(read):
    return (('FAKT 2', 'FAKT 1', 'yetkazilgan') if read == 'fakt2' else ('FAKT 1', 'FAKT 2', 'tasdiqlangan'))

def medal_caption(top):
    if not top:
        return ''
    cnt = f' ×{top["count"]}' if top['count'] > 1 else ''
    when = date_uz(top['at'])
    if top['code'] in MONTH_FAMILY and top['at'].startswith(PROVISIONAL_MONTH):
        when = f'{MONTHS[int(top["at"][5:7]) - 1]} · hozircha'
    return f'<span class="seat__cap"><b>{NAMES[top["code"]]}{cnt}</b><i>{when}</i></span>'

def seat(r, place, read):
    rest, code = split_name(r['name'])
    l1, l2 = rest[0], ' '.join(rest[1:])
    hero, other = (r['fakt2'], r['fakt1']) if read == 'fakt2' else (r['fakt1'], r['fakt2'])
    hl, ol, hint = fakt_words(read)
    span = max(1, r['nextAt'] - r['levelFloor'])
    prog = max(.03, min(1, (r['delivered'] - r['levelFloor']) / span))
    left = max(0, r['nextAt'] - r['delivered'])
    rack, top = seat_medals(r['medals'], 48 if place == 1 else 40, 4 if place == 1 else 3)
    codetok = f'<span class="code">{code}</span>' if code else ''
    return f'''
<article class="seat seat--p{place}" data-tier="{r['level']}" data-metal="{METALS[place]}" aria-label="{place}-oʻrin">
  <span class="seat__band"></span>
  <div class="seat__id">
    {halo(place, 66 if place == 1 else 56, wreath=(place == 1))}
    <div class="seat__who">
      <h3 class="seat__name"><span>{esc(l1)}</span><span>{esc(l2)} {codetok}</span></h3>
      <p class="seat__meta">{crest(r['level'], 20 if place == 1 else 18, plated=True)}<b class="lvl">{TITLES[r['level']]}</b><span class="team">{esc(r['team'] or '')}</span></p>
    </div>
  </div>
  <p class="seat__money"><span class="num">{som_hero(hero)}</span></p>
  <p class="seat__fakt"><span><b>{hl}</b></span><span><b>{ol}</b> <em class="num">{som(other)}</em></span></p>
  <div class="seat__prog">
    <p class="seat__left"><span>{TITLES[r['level'] + 1]}ga</span> <em class="num">{som(left)}</em> <span>qoldi</span></p>
    <div class="meter"><i style="width:{prog * 100:.1f}%"></i></div>
    <p class="seat__life"><span>Avgustdan beri</span><span><em class="num">{som(r['delivered'])}</em> / <span class="num">{som(r['nextAt'])}</span></span></p>
  </div>
  <div class="seat__rack">{rack}{medal_caption(top)}</div>
</article>'''

def row(r, read, rank=None, cls='', msize=28):
    rest, code = split_name(r['name'])
    hero, other = (r['fakt2'], r['fakt1']) if read == 'fakt2' else (r['fakt1'], r['fakt2'])
    codetok = f'<span class="code">{code}</span>' if code else ''
    lvl = r['level'] or 0
    return (f'<li class="row {cls}" data-tier="{lvl}"><span class="row__band"></span>'
            f'<span class="row__rank num">{rank if rank is not None else r["rank"]}</span>'
            f'{crest(lvl, 20)}'
            f'<span class="row__name"><span class="nm">{esc(" ".join(rest))}</span>{codetok}</span>'
            f'<span class="row__team">{esc(r["team"] or "")}</span>'
            f'{row_medals(r["medals"], msize)}'
            f'<span class="row__hero num">{som_hero(hero)}</span>'
            + (f'<span class="row__sec num">{som(other)}</span>' if other else '<span class="row__sec row__none">—</span>') +
            f'<span class="row__sec num">{r["orders"]}</span>'
            f'<span class="row__sec num">{pct(r["conversion"]) if r["conversion"] is not None else "—"}</span></li>')

def cols(read, extra_cls=''):
    h, o, _ = fakt_words(read)
    return (f'<div class="cols {extra_cls}"><span></span><span class="r">#</span><span>Daraja</span>'
            f'<span>Sotuvchi</span><span>Komanda</span><span class="r">Medallar</span>'
            f'<span class="r on">{h}</span><span class="r">{o}</span><span class="r">Buyurt.</span><span class="r">Konv.</span></div>')

def switch(read):
    a1, a2 = ('', ' is-on') if read == 'fakt2' else (' is-on', '')
    word = 'yetkazilgan pul' if read == 'fakt2' else 'tasdiqlangan pul'
    h = fakt_words(read)[0]
    return (f'<div class="pick"><span class="pick__hint"><b>{h}</b> — {word}</span>'
            f'<div class="seg" role="group" aria-label="Reyting qaysi fakt boʻyicha"><span class="seg__i{a1}">FAKT 1</span><span class="seg__i{a2}">FAKT 2</span></div></div>')

LADDER = [(1, 'Yangi', ''), (2, 'Sotuvchi', '10 mln'), (3, 'Katta sotuvchi', '30 mln'),
          (4, 'Usta', '100 mln'), (5, 'Ustoz', '300 mln'), (6, 'Legenda', '1 mlrd')]
def legend():
    cells = ''.join(f'<li>{crest(l, 15)}<b>{t}</b>' + (f'<i>{th}</i>' if th else '') + '</li>' for l, t, th in LADDER)
    return f'<ul class="legend" aria-label="Daraja legendasi">{cells}</ul>'

def sec(v):
    return f'<span class="trow__sec num">{v}</span>' if v is not None else '<span class="trow__sec trow__none">—</span>'

def team_row(t, rank, total, top, read, compact=False):
    hero, other = (t['fakt2'], t['fakt1']) if read == 'fakt2' else (t['fakt1'], t['fakt2'])
    share = hero / total * 100 if total else 0
    rk = halo(rank, 26 if compact else 30, small=True) if rank <= 3 else f'<span class="num">{rank}</span>'
    metal = f' data-metal="{METALS[rank]}"' if rank <= 3 else ''
    return (f'<li class="trow"{metal}>'
            f'<span class="trow__rank">{rk}</span>'
            f'<span class="trow__name"><span class="nm">{esc(t["name"])}</span><span class="cnt num">{t["sellers"]}</span></span>'
            f'<span class="trow__hero num">{som_hero(hero)}</span>'
            f'<span class="trow__sec num">{pct(share)}</span>'
            f'{sec(som(other) if other else None)}'
            f'<span class="trow__sec num">{t["orders"]}</span>'
            f'{sec(pct(t["conversion"]) if t["conversion"] is not None else None)}'
            f'<span class="trow__bar"><i style="width:{hero / top * 100:.1f}%"></i></span></li>')

def team_cols(read, extra=''):
    h, o, _ = fakt_words(read)
    return (f'<div class="tcols {extra}"><span class="r">#</span><span>Komanda · sotuvchi</span><span class="r on">{h}</span>'
            f'<span class="r">Ulush</span><span class="r">{o}</span><span class="r">Buyurt.</span><span class="r">Konv.</span></div>')

def ranked_teams(read):
    k = (lambda t: (-t['fakt2'], -t['fakt1'], t['name'])) if read == 'fakt2' else (lambda t: (-t['fakt1'], -t['fakt2'], t['name']))
    return sorted(TEAMS, key=k)
def ranked_rows(read):
    k = (lambda r: (-r['fakt2'], -r['fakt1'])) if read == 'fakt2' else (lambda r: (-r['fakt1'], -r['fakt2']))
    return sorted(ROWS, key=k)

def jami(read, ctx=False, today=None):
    h, o, _ = fakt_words(read)
    key, okey = ('fakt2', 'fakt1') if read == 'fakt2' else ('fakt1', 'fakt2')
    total, other = sum(t[key] for t in TEAMS), sum(t[okey] for t in TEAMS)
    teamless = [r for r in ROWS if not r['team']]
    tl = sum(r[key] for r in teamless)
    every = sum(r[key] for r in ROWS)
    assert total + tl == every, 'the plaque must reconcile on screen'
    if ctx:
        return (f'<footer class="jami jami--ctx"><div class="jami__l"><p class="jami__k">Bugun jami · {h}</p><p class="jami__v num">{som_hero(today)}</p></div>'
                f'<dl class="jami__r"><dt class="sum">Shu oy · {len(TEAMS)} komanda jami · {h}</dt><dd class="num">{som(total)}</dd>'
                f'<dt>Komandasiz · {len(teamless)} sotuvchi</dt><dd class="num">{som(tl)}</dd></dl></footer>')
    return (f'<footer class="jami"><div class="jami__l"><p class="jami__k">{len(TEAMS)} komanda jami · {h}</p><p class="jami__v num">{som_hero(total)}</p>'
            f'<p class="jami__o"><b>{o}</b><span class="num">{som(other)}</span></p></div>'
            f'<dl class="jami__r"><dt>Komandasiz · {len(teamless)} sotuvchi</dt><dd class="num">{som(tl)}</dd>'
            f'<dt class="sum">Barcha sotuvchilar</dt><dd class="num">{som(every)}</dd>'
            f'<dd class="jami__note">Ulush {len(TEAMS)} komanda jamidan hisoblanadi</dd></dl></footer>')

# --------------------------------------------------------------------------
# chrome
# --------------------------------------------------------------------------
NAV = [('Tahlil', ['Mijoz qaytishi', 'Mijozlar va qoʻngʻiroqlar', 'Savdo dinamikasi', 'Yalpi marja']),
       ('Bajarish', ['Tasdiqlash navbati', 'Logistika natijasi', 'Joʻnatish nuqtalari']),
       ('Jamoa', ['KPI rejalari', 'Sotuvchilar reytingi', 'Sotuvchilar oyligi', 'Kadrlar tuzilmasi']),
       ('Marketing', ['Reklama samarasi'])]
def chrome():
    nav = ''
    for g, items in NAV:
        nav += f'<p class="rail__g">{g}</p>'
        for it in items:
            on = ' is-on' if it == 'Sotuvchilar reytingi' else ''
            nav += f'<span class="rail__i{on}"><i></i>{it}</span>'
    return f'''
<aside class="rail"><div class="rail__brand"><span class="rail__logo">S</span><span><b>SinoLife</b><small>Savdo tahlili</small></span></div>
{nav}<span class="rail__sep"></span><span class="rail__i"><i></i>Foydalanuvchilar</span>
<div class="rail__me"><span class="rail__av">A</span>Administrator</div></aside>
<header class="top"><span class="chip"><i></i>Bitrix24 <small>· hozirgina</small></span>
<span class="top__r"><span class="top__s">Qidiruv <kbd>Ctrl</kbd><kbd>K</kbd></span><i class="dot"></i><i class="dot"></i><i class="dot"></i></span></header>'''

def plaque(code, label, name, amount, note, tag=''):
    rest, idc = split_name(name)
    codetok = f'<span class="code">{idc}</span>' if idc else ''
    tagtok = f'<span class="tag">{tag}</span>' if tag else ''
    return (f'<div class="plaque">{medal(code, 32)}<div class="plaque__t"><p class="plaque__k">{label}{tagtok}<i>{note}</i></p>'
            f'<p class="plaque__v"><span class="nm">{esc(" ".join(rest))}</span>{codetok}<b class="num">{som(amount)}</b></p></div></div>')

def record_wall(long_name=False):
    second = 'Raxmatullayeva 253 Ruxshona Tolib qizi' if long_name else '154 Marjona Xayrullayeva'
    return ('<div class="wall" aria-label="Har oyning eng yaxshi sotuvchisi">'
            + plaque('month-gold', 'Sentabr yetakchisi', 'Shahtiyarovna 197 Marjona', 79600000, '57 ta yetkazilgan')
            + plaque('day-record', 'Avgust 2026 rekordi', second, 128550000, '74 ta yetkazilgan', tag='hozircha')
            + '</div>')

def period(active):
    items = ''.join(f'<span class="seg__i{" is-on" if p == active else ""}">{p}</span>' for p in ('Bugun', 'Kecha', 'Shu oy'))
    return f'<div class="period"><div class="seg">{items}</div><span class="seg"><span class="seg__i">Sana</span></span></div>'

FOOT = ('<footer class="foot"><p><span><b>Konv.</b> = yetkazilgan ÷ (yetkazilgan + barcha bekor)</span>'
        '<span><b>Buyurt.</b> = FAKT 1 buyurtmalari</span>'
        '<span><b>Daraja</b> — avgustdan beri yetkazilgan pul boʻyicha</span>'
        '<span><b>hozircha</b> — avgustdan 191 buyurtma yoʻlda: rekord va avgust medallari oʻzgarishi mumkin</span></p>'
        '<p class="credit">Developed by Yusuf</p></footer>')

# --------------------------------------------------------------------------
# pages
# --------------------------------------------------------------------------
def sellers_panel(read, rows_from=3, rows_to=17, extra_rows=''):
    ranked = ranked_rows(read)
    s = ranked[:3]
    seats = seat(s[1], 2, read) + seat(s[0], 1, read) + seat(s[2], 3, read)
    rows = ''.join(row(r, read, rank=i + 1) for i, r in enumerate(ranked) if rows_from <= i < rows_to)
    return f'''
  <section class="panel panel--sellers">
    <header class="phead"><h2>Sotuvchilar</h2><span class="phead__n"><b class="num">{len(ROWS)}</b> sotuvchi</span>{switch(read)}</header>
    <div class="seats">{seats}</div>
    {cols(read)}
    <ol class="list">{extra_rows}{rows}</ol>
    {legend()}
  </section>'''

def teams_panel(read):
    rt = ranked_teams(read)
    key = 'fakt2' if read == 'fakt2' else 'fakt1'
    total, top = sum(t[key] for t in rt), rt[0][key]
    trs = ''.join(team_row(t, i + 1, total, top, read) for i, t in enumerate(rt))
    return f'''
  <section class="panel panel--teams">
    <header class="phead"><h2>Komandalar</h2><span class="phead__n"><b class="num">{len(TEAMS)}</b> komanda</span>{switch(read)}</header>
    {team_cols(read)}
    <ol class="tlist" style="--trow-h:{max(40, min(52, 700 // len(rt)))}px">{trs}</ol>
    {jami(read)}
  </section>'''

def page_month(read='fakt2', **kw):
    wall = record_wall(kw.pop('long_name', False))
    return f'''
<section class="hdr"><div class="hdr__t"><h1>Sotuvchilar reytingi</h1><p>1–17 sentabr 2026</p></div>{wall}{period('Shu oy')}</section>
<main class="board">{sellers_panel(read, **kw)}{teams_panel(read)}</main>{FOOT}'''

TODAY_LEADER = {'rank': 1, 'name': 'Содиков Мурод', 'team': 'Kompaniya', 'fakt2': 0, 'fakt1': 1600000, 'orders': 1,
                'level': 2, 'delivered': 18200000, 'levelFloor': 10000000, 'nextAt': 30000000,
                'medals': [{'code': 'first-sale', 'count': 1, 'at': '2026-08-14'}]}

def stage(r):
    rest, code = split_name(r['name'])
    span = r['nextAt'] - r['levelFloor']
    prog = (r['delivered'] - r['levelFloor']) / span
    left = r['nextAt'] - r['delivered']
    rack, top = seat_medals(r['medals'], 40, 4)
    return f'''
<article class="stage" data-tier="{r['level']}" data-metal="gold" aria-label="1-oʻrin">
  <span class="seat__band"></span>
  {halo(1, 84, wreath=True)}
  <div class="stage__who"><h3 class="stage__name">{esc(' '.join(rest))}</h3>
    <p class="seat__meta">{crest(r['level'], 20, plated=True)}<b class="lvl">{TITLES[r['level']]}</b><span class="team">{esc(r['team'])}</span></p>
    <div class="seat__prog stage__prog">
      <p class="seat__left"><span>{TITLES[r['level'] + 1]}ga</span> <em class="num">{som(left)}</em> <span>qoldi</span></p>
      <div class="meter"><i style="width:{prog * 100:.1f}%"></i></div>
      <p class="seat__life"><span>Avgustdan beri yetkazilgan</span><span><em class="num">{som(r['delivered'])}</em> / <span class="num">{som(r['nextAt'])}</span></span></p>
    </div></div>
  <div class="stage__money"><p class="seat__money"><span class="num">{som_hero(r['fakt1'])}</span></p>
    <p class="stage__fakt"><span><b>FAKT 1</b>tasdiqlangan · 1 buyurtma</span><span><b>FAKT 2</b>hali yoʻq — yetkazish kutilmoqda</span></p>
    <div class="stage__rack">{rack}{medal_caption(top)}</div></div>
</article>'''

def queue_row(r, n):
    rest, code = split_name(r['name'])
    codetok = f'<span class="code">{code}</span>' if code else ''
    return (f'<li class="row row--queue" data-tier="{r["level"]}"><span class="row__band"></span><span class="row__rank"></span>'
            f'{crest(r["level"], 20)}<span class="row__name"><span class="nm">{esc(" ".join(rest))}</span>{codetok}</span>'
            f'<span class="row__team">{esc(r["team"])}</span>{row_medals(r["medals"])}'
            f'<span class="row__wait"><b class="num">{n}</b> buyurtma tasdiq navbatida</span></li>')

def page_today():
    read = 'fakt1'            # nobody has delivered yet today → the board resolves to FAKT 1, and the context FOLLOWS it
    by = {r['name']: r for r in ROWS}
    q = [by['Yusupova 139 Mahliyo'], by['Ravshanov 158 Asilbek']]
    month = ranked_rows(read)
    month_rows = ''.join(row(r, read, rank=i + 1, cls='row--ctx', msize=26) for i, r in enumerate(month[:11]))
    rt = ranked_teams(read)
    total, top = sum(t['fakt1'] for t in rt), rt[0]['fakt1']
    trs = ''.join(team_row(t, i + 1, total, top, read, compact=True) for i, t in enumerate(rt))
    today_team = {'name': 'Kompaniya', 'sellers': 1, 'fakt2': 0, 'fakt1': 1600000, 'orders': 1, 'conversion': None}
    t_html = team_row(today_team, 1, 1600000, 1600000, read)
    ctx_note = f'1–17 sentabr · {fakt_words(read)[0]} boʻyicha'
    return f'''
<section class="hdr"><div class="hdr__t"><h1>Sotuvchilar reytingi</h1><p>{date_long(TODAY)} · bugun</p></div>{record_wall()}{period('Bugun')}</section>
<main class="board board--sparse">
  <section class="panel panel--sellers">
    <header class="phead"><h2>Sotuvchilar</h2><span class="phead__n">bugun <b class="num">1</b> sotuvchi savdo qildi · <b class="num">2</b> tasi tasdiq kutmoqda</span>{switch(read)}</header>
    <div class="seats seats--stage">{stage(TODAY_LEADER)}</div>
    <div class="group"><h4>Tasdiq kutilmoqda</h4><span>buyurtma bor, pul hali tasdiqlanmagan — tasdiqlangach reytingga kiradi</span></div>
    <ol class="list list--queue">{queue_row(q[0], 1)}{queue_row(q[1], 1)}</ol>
    <div class="group"><h4>Shu oy yetakchilari</h4><span>{ctx_note}</span><em>bugungi reytingga kirmaydi</em></div>
    {cols(read, 'cols--ctx')}
    <ol class="list list--ctx">{month_rows}</ol>
    {legend()}
  </section>
  <section class="panel panel--teams">
    <header class="phead"><h2>Komandalar</h2><span class="phead__n">bugun <b class="num">1</b> komanda savdo qildi</span>{switch(read)}</header>
    {team_cols(read)}
    <ol class="tlist tlist--today">{t_html}</ol>
    <p class="quiet">Hali savdosiz:&nbsp;<b>Azizbek</b>,&nbsp;<b>Lola</b>&nbsp;— navbatda 1 tadan buyurtma</p>
    <div class="group"><h4>Shu oy komandalari</h4><span>{ctx_note}</span><em>bugungi reytingga kirmaydi</em></div>
    {team_cols(read, 'tcols--ctx')}
    <ol class="tlist tlist--ctx">{trs}</ol>
    {jami(read, ctx=True, today=1600000)}
  </section>
</main>{FOOT}'''

def page_check():
    """Verification only: FAKT 1 read; list scrolled to ranks 15-25 (the 38-char name is rank 20 on FAKT 2);
    fixture rows carrying a Legenda crest and the five medal codes production does not hold yet;
    the longest real name inside a record plaque."""
    fx = [
        {'name': 'FIXTURE 901 Legenda Sinov', 'team': 'Shohjaxon', 'fakt2': 912345000, 'fakt1': 987654000, 'orders': 412, 'conversion': 88.4, 'level': 6,
         'medals': [{'code': 'year-champion', 'count': 1, 'at': '2026-01-01'}, {'code': 'streak-fire', 'count': 1, 'at': '2026-09-01'}, {'code': 'month-gold', 'count': 3, 'at': '2026-08-01'}]},
        {'name': 'FIXTURE 902 Ustoz Sinov', 'team': 'Kompaniya', 'fakt2': 301000000, 'fakt1': 355000000, 'orders': 210, 'conversion': 80, 'level': 5,
         'medals': [{'code': 'conversion-master', 'count': 1, 'at': '2026-09-01'}, {'code': 'streak-steady', 'count': 1, 'at': '2026-09-01'}, {'code': 'jump', 'count': 1, 'at': '2026-09-01'}]},
        {'name': 'FIXTURE 903 Yangi Sinov', 'team': 'Sadriddin', 'fakt2': 4200000, 'fakt1': 6100000, 'orders': 5, 'conversion': 60, 'level': 1,
         'medals': [{'code': 'rookie', 'count': 1, 'at': '2026-09-01'}, {'code': 'day-record', 'count': 1, 'at': '2026-09-01'}, {'code': 'month-bronze', 'count': 1, 'at': '2026-08-01'}]},
        {'name': 'FIXTURE 904 Darajasiz Sinov', 'team': '', 'fakt2': 0, 'fakt1': 900000, 'orders': 1, 'conversion': None, 'level': 0,
         'medals': [{'code': 'month-silver', 'count': 1, 'at': '2026-08-01'}, {'code': 'clean-month', 'count': 1, 'at': '2026-08-01'}, {'code': 'day-winner', 'count': 1, 'at': '2026-08-01'}]},
    ]
    extra = ''.join(row(r, 'fakt1', rank='fx') for r in fx)
    return page_month('fakt1', rows_from=16, rows_to=23, extra_rows=extra, long_name=True)

# --------------------------------------------------------------------------
subprocess.run(['node', os.path.join(HERE, 'gen-final-defs.js')], check=True)
DEFS = re.search(r'<svg[^>]*>(.*)</svg>', open(os.path.join(HERE, 'final-defs.svg.html')).read(), re.S).group(1)
CSS = open(os.path.join(HERE, 'final.css')).read().replace('/*TOKENS*/', token_css())

def doc(body, theme, title):
    return f'''<!doctype html>
<html lang="uz" data-theme="{theme}">
<head><meta charset="utf-8"><title>{title}</title>
<meta name="viewport" content="width=1920">
<style>
{CSS}
</style></head>
<body>
<svg class="defs" width="0" height="0" aria-hidden="true" focusable="false">{DEFS}</svg>
{chrome()}
<div class="page">{body}</div>
</body></html>'''

out = {
    'final-month.html': doc(page_month(), 'dark', 'EFIR premium — Shu oy'),
    'final-today.html': doc(page_today(), 'dark', 'EFIR premium — Bugun'),
    'final-month-light.html': doc(page_month(), 'light', 'EFIR premium — Shu oy (yorugʻ)'),
    'final-check.html': doc(page_check(), 'dark', 'EFIR premium — tekshiruv (FAKT 1, fixture)'),
    'final-check-light.html': doc(page_check(), 'light', 'EFIR premium — tekshiruv (yorugʻ)'),
}
for name, text in out.items():
    assert 'color-mix' not in text and 'filter:' not in text and 'clip-path' not in text, name
    open(os.path.join(HERE, name), 'w').write(text)
    print(name, len(text))
open(os.path.join(HERE, 'final-tokens.css'), 'w').write(token_css() + '\n')
print(json.dumps(audit_tokens()))
