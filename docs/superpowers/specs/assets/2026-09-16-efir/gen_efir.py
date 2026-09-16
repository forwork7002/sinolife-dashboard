#!/usr/bin/env python3
"""EFIR — broadcast-stage mock of /sellers at 1920x1080, generated from board-data.json.

Reads `board-data.json` from THIS directory and writes the HTML mocks back into
it, so the script runs wherever the repository is checked out. It used to name a
scratchpad that no longer exists.

`board-data.json` is a 2026-09-16 PRODUCTION snapshot, built by joining the two
payloads the real screen reads — `GET /api/v1/analytics/sellers?preset=this_month`
(rows, teams, totals) with the same call under `?include=medals` (level, title,
delivered, levelFloor, nextAt, nextTitle, promotedOn, medals) — into:

    {period,
     rows:  [{rank, name, team, fakt2, fakt1, orders, wonOrders, conversion,
              level, title, delivered, levelFloor, nextAt, nextTitle,
              promotedOn, medals: [{code, count, at}]}],
     teams: [{rank, name, sellers, fakt2, fakt1, orders, conversion, share}],
     totals}

THE COMMITTED `efir.html` / `efir-light.html` ALREADY EMBED THAT SNAPSHOT, so
they are the mock of record and re-running this script is not needed to read
them. The file itself is not in the repository; rebuild it from production (or
from a `?preset=this_month` response saved by hand) before re-running.
"""
import json, html, os

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'board-data.json')
OUT = HERE + os.sep
d = json.load(open(SRC))
rows, teams, totals = d['rows'], d['teams'], d['totals']

NNBSP = ' '
def money(n):
    return f'{int(n):,}'.replace(',', NNBSP)
def pct(x):
    return f'{x:.1f}'.replace('.', ',').replace(',0', '') + NNBSP + '%'
def esc(s):
    return html.escape(str(s))
def initials(name):
    words = [w for w in name.split() if not w.isdigit()]
    return (words[0][0] + (words[-1][0] if len(words) > 1 else '')).upper()
def split_name(name):
    parts = name.split()
    if parts[0].isdigit():            # «268 Ozoda Yuldosheva»
        return parts[0] + ' ' + parts[1], ' '.join(parts[2:]) or ''
    return parts[0], ' '.join(parts[1:])

MEDAL_NAME = {
 'month-gold':'Oy chempioni','month-silver':'Kumush oy','month-bronze':'Bronza oy','year-champion':'Yil chempioni',
 'streak-fire':'Olov seriyasi','streak-steady':'Barqaror','day-record':'Kun rekordi','day-winner':'Kun gʻolibi',
 'conversion-master':'Konversiya ustasi','clean-month':'Toza oy','jump':'Sakrash','rookie':'Yangi yulduz',
 'first-sale':'Birinchi savdo','work-month':'Ishchan oy'}
MEDAL_ORDER = ['year-champion','month-gold','streak-fire','month-silver','month-bronze','streak-steady',
 'conversion-master','day-record','clean-month','jump','rookie','day-winner','work-month','first-sale']
RARE = {'year-champion','month-gold','month-silver','month-bronze','day-record','conversion-master','streak-fire'}
HIDE_IN_ROWS = {'first-sale'}   # held by 92 of 100 — a badge everyone has is not a badge

LEVELS = [(0,'Yangi',None),(1,'Yangi',1),(2,'Sotuvchi',10_000_000),(3,'Katta sotuvchi',30_000_000),
          (4,'Usta',100_000_000),(5,'Ustoz',300_000_000),(6,'Legenda',1_000_000_000)]
METAL = {1:'gold',2:'silver',3:'bronze'}

# ---------------------------------------------------------------- SVG symbols
SYMBOLS = '''
<svg width="0" height="0" style="position:absolute" aria-hidden="true">
 <defs>
  <!-- pagon chevron: one cell of the crest -->
  <path id="ch" d="M0 0H7L12 10L7 20H0L5 10Z"/>
  <!-- medals, 24-unit box, fill-only; class="cut" is the knock-out in surface colour -->
  <symbol id="m-month" viewBox="0 0 24 24"><path d="M6 0h12l-3.2 7.5H9.2z"/><circle cx="12" cy="15" r="8.2"/></symbol>
  <symbol id="m-year" viewBox="0 0 24 24"><path d="M2 18L3.5 6l5.5 4.5L12 3l3 7.5L20.5 6 22 18z"/><path d="M3 19.5h18V23H3z"/></symbol>
  <symbol id="m-fire" viewBox="0 0 24 24"><path fill-rule="evenodd" d="M12 1c1.2 4.5 7 6.5 7 13a7 7 0 0 1-14 0c0-2.6 1.1-4.4 2.3-5.9.4 1.9 1.4 3 2.7 3.4C9.4 8 12.2 6 12 1zm0 11c-1.8 2-3 3.3-3 5a3 3 0 0 0 6 0c0-1.7-1.2-3-3-5z"/></symbol>
  <symbol id="m-steady" viewBox="0 0 24 24"><path d="M2 14h5.5v8H2zM9.3 9h5.5v13H9.3zM16.5 3H22v19h-5.5z"/></symbol>
  <symbol id="m-bolt" viewBox="0 0 24 24"><path d="M14 1L3 14h7.2L9 23l11-13.5h-7.2z"/></symbol>
  <symbol id="m-sun" viewBox="0 0 24 24"><path d="M4.5 16a7.5 7.5 0 0 1 15 0z"/><path d="M12 1.5l1.8 4.2h-3.6zM3.2 5.6l4 2.2-2.5 2.5zM20.8 5.6l-1.5 4.7-2.5-2.5zM1 13.5h4.6L4 16.4zM23 13.5L20 16.4l-1.6-2.9z"/><path d="M1.5 18h21v3h-21z"/></symbol>
  <symbol id="m-target" viewBox="0 0 24 24"><path fill-rule="evenodd" d="M12 1a11 11 0 1 0 0 22 11 11 0 0 0 0-22zm0 4.2a6.8 6.8 0 1 1 0 13.6 6.8 6.8 0 0 1 0-13.6zm0 3.6a3.2 3.2 0 1 0 0 6.4 3.2 3.2 0 0 0 0-6.4z"/></symbol>
  <symbol id="m-shield" viewBox="0 0 24 24"><path d="M12 1l9.5 3.2v7.3c0 5.6-3.9 9.9-9.5 11.5C6.4 21.4 2.5 17.1 2.5 11.5V4.2z"/><path class="cut" d="M6.3 12.4l2-2 2.4 2.4 5.2-5.3 2 2-7.2 7.3z"/></symbol>
  <symbol id="m-jump" viewBox="0 0 24 24"><path d="M12 1l9 10h-5.5v12h-7V11H3z"/></symbol>
  <symbol id="m-star" viewBox="0 0 24 24"><path d="M12 1l3.2 7.2 7.8.8-5.9 5.3 1.7 7.7L12 18l-6.8 4 1.7-7.7L1 9l7.8-.8z"/></symbol>
  <symbol id="m-sprout" viewBox="0 0 24 24"><path d="M10.7 23h2.6V12h-2.6z"/><path d="M12 12.5C12 7 8 3.5 2 3.5c0 5.5 4 9 10 9zM12 10.5c0-5 3.6-8 9-8 0 5-3.6 8-9 8z"/></symbol>
  <symbol id="m-cal" viewBox="0 0 24 24"><path d="M2 4.5h20v18H2z"/><path d="M6 1.5h3v6H6zM15 1.5h3v6h-3z"/><path class="cut" d="M5 11h3.2v3.2H5zM10.4 11h3.2v3.2h-3.2zM15.8 11H19v3.2h-3.2zM5 16.5h3.2v3.2H5zM10.4 16.5h3.2v3.2h-3.2z"/></symbol>
 </defs>
</svg>'''

MEDAL_SYM = {
 'month-gold':'m-month','month-silver':'m-month','month-bronze':'m-month','year-champion':'m-year',
 'streak-fire':'m-fire','streak-steady':'m-steady','day-record':'m-bolt','day-winner':'m-sun',
 'conversion-master':'m-target','clean-month':'m-shield','jump':'m-jump','rookie':'m-star',
 'first-sale':'m-sprout','work-month':'m-cal'}
MONTH_NUM = {'month-gold':'1','month-silver':'2','month-bronze':'3'}

def medal_svg(code, size, count=1, with_count=False):
    sym = MEDAL_SYM[code]
    rare = ' rare' if code in RARE else ''
    num = MONTH_NUM.get(code)
    inner = f'<use href="#{sym}"/>'
    if num:
        inner += f'<text class="cut num" x="12" y="18.6" text-anchor="middle">{num}</text>'
    title = MEDAL_NAME[code] + (f' ×{count}' if count > 1 else '')
    s = f'<svg class="medal{rare}" width="{size}" height="{size}" viewBox="0 0 24 24" role="img"><title>{esc(title)}</title>{inner}</svg>'
    if with_count and count > 1:
        s = f'<span class="mc">{s}<b>×{count}</b></span>'
    return s

def crest(level, cls='crest'):
    level = level or 0
    cells = ''.join(f'<use href="#ch" x="{i*11}" class="{"on" if i < level else "off"}"/>' for i in range(6))
    crown = '<path class="crown" d="M56 -7l2.5-4 2.5 3 2.5-3 2.5 4z"/>' if level >= 6 else ''
    return f'<svg class="{cls} t{level}" viewBox="0 -1 66 22" aria-label="{level}-daraja">{cells}{crown}</svg>'

def sorted_medals(ms, hide=()):
    ms = [m for m in ms if m['code'] not in hide]
    return sorted(ms, key=lambda m: MEDAL_ORDER.index(m['code']))

# ---------------------------------------------------------------- seat
def seat(r):
    rank = r['rank']; metal = METAL[rank]
    l1, l2 = split_name(r['name'])
    lvl = r['level'] or 0
    floor, nxt = r['levelFloor'], r['nextAt']
    prog = (r['delivered'] - floor) / (nxt - floor) if nxt else 1
    prog = max(0.03, min(1, prog))
    left = nxt - r['delivered']
    meds = ''.join(medal_svg(m['code'], 24, m['count'], True) for m in sorted_medals(r['medals']))
    team = esc(r['team']) if r['team'] else 'komandasiz'
    return f'''
   <article class="seat s{rank} t{lvl}" aria-label="{rank}-oʻrin">
    <div class="seat-top">
     <span class="halo {metal}">{rank}</span>
     <div class="who">
      <h3 class="nm"><span>{esc(l1)}</span><span>{esc(l2)}</span></h3>
      <p class="sub"><span class="team">{team}</span>{crest(lvl, 'crest lg')}<span class="lv">{esc(r['title'])}</span></p>
     </div>
    </div>
    <div class="fig">
     <span class="f2">{money(r['fakt2'])}</span>
     <p><span class="f2c">FAKT 2</span><span class="f1">FAKT 1 <b>{money(r['fakt1'])}</b></span></p>
    </div>
    <div class="prog">
     <div class="bar"><i style="width:{prog*100:.1f}%"></i></div>
     <p><span>{esc(r['nextTitle'])}ga <b>{money(left)}</b> qoldi</span></p>
    </div>
    <div class="meds">{meds}</div>
   </article>'''

# ---------------------------------------------------------------- row
def row(r):
    lvl = r['level'] or 0
    meds = sorted_medals(r['medals'], HIDE_IN_ROWS)
    shown = ''.join(medal_svg(m['code'], 24, m['count']) for m in meds[:3])
    more = f'<span class="more">+{len(meds)-3}</span>' if len(meds) > 3 else ''
    team = f'<span class="team">{esc(r["team"])}</span>' if r['team'] else ''
    return f'''
    <li class="row t{lvl}">
     <span class="band"></span>
     <span class="rk">{r['rank']}</span>
     {crest(lvl)}
     <span class="nm">{esc(r['name'])}{team}</span>
     <span class="rm">{shown}{more}</span>
     <span class="f2">{money(r['fakt2'])}</span>
     <span class="f1">{money(r['fakt1'])}</span>
     <span class="od">{r['orders']}</span>
     <span class="cv">{pct(r['conversion'])}</span>
    </li>'''

def team_row(t):
    metal = METAL.get(t['rank'], '')
    return f'''
    <li class="trow" style="--share:{t['share']/teams[0]['share']:.3f}">
     <span class="rk {metal}">{t['rank']}</span>
     <span class="nm">{esc(t['name'])}</span>
     <span class="cnt">{t['sellers']}</span>
     <span class="f2">{money(t['fakt2'])}</span>
     <span class="sh">{pct(t['share'])}</span>
     <span class="f1">{money(t['fakt1'])}</span>
     <span class="od">{t['orders']}</span>
     <span class="cv">{pct(t['conversion'])}</span>
    </li>'''

legend = ''.join(
    f'<span class="lg">{crest(l, "crest sm")}<b>{t}</b>{"<i>"+money(th)+"</i>" if th and l>1 else ""}</span>'
    for l, t, th in LEVELS[1:])

# ---------------------------------------------------------------- CSS
CSS = r'''
/* ============ EFIR palette — portable as :root tokens ============ */
:root{
  /* stage */
  --stage:#070a10; --surface:#0d1118; --raised:#131822; --line:rgba(255,255,255,.08); --line-2:rgba(255,255,255,.14);
  --ink:#f5f6f8; --ink-2:#aab3c0; --ink-3:#7b8595; --track:rgba(255,255,255,.11);
  /* one metal — podium halos, medals, record labels */
  --gold:#e8c256; --silver:#bac4d3; --bronze:#d89a68;
  /* one accent — the level ramp, ordered by lightness 1→6; same order in both themes */
  --t1:#3f4a5c; --t2:#506480; --t3:#3e8fc4; --t4:#7fd0ff; --t5:#bde8ff; --t6:#f2fbff;
  --cut:var(--raised);
  --r:10px;
  /* three information sizes and one caption size */
  --xl:44px; --l:24px; --m:16px; --s:13px;
  color-scheme:dark;
}
:root[data-theme="light"]{
  --stage:#e9ebef; --surface:#f6f7f9; --raised:#ffffff; --line:rgba(12,14,18,.09); --line-2:rgba(12,14,18,.16);
  --ink:#0c0e12; --ink-2:#4c525e; --ink-3:#636d79; --track:#e1e4e9;
  --gold:#b3860e; --silver:#798294; --bronze:#a5663a;
  --t1:#3a4557; --t2:#4a6085; --t3:#2b86c2; --t4:#2bb1ee; --t5:#8ed3f5; --t6:#c9ecff;
  color-scheme:light;
}
.t0{--tier:transparent} .t1{--tier:var(--t1)} .t2{--tier:var(--t2)} .t3{--tier:var(--t3)} .t4{--tier:var(--t4)} .t5{--tier:var(--t5)} .t6{--tier:var(--t6)}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:1920px;height:1080px;overflow:hidden;background:var(--stage);color:var(--ink);
  font-family:Inter,system-ui,sans-serif;font-feature-settings:"tnum" 1,"cv11" 1;-webkit-font-smoothing:antialiased}
b{font-weight:600}
svg .on{fill:var(--tier)} svg .off{fill:var(--track)} svg .crown{fill:var(--gold)}
.medal{fill:var(--gold);flex:none} .medal .cut{fill:var(--cut)} .medal .num{font-weight:800;font-size:11px}
.crest{width:60px;height:20px;flex:none;overflow:visible}
.crest.lg{width:78px;height:26px}
.crest.sm{width:42px;height:14px}
.gold{color:var(--gold)} .silver{color:var(--silver)} .bronze{color:var(--bronze)}

/* ============ app chrome ============ */
.rail{position:absolute;left:0;top:0;width:40px;height:1080px;background:var(--surface);border-right:1px solid var(--line)}
.rail i{display:block;width:16px;height:16px;border-radius:4px;margin:12px auto 0;background:var(--track)}
.rail i.logo{background:var(--ink);border-radius:5px;margin-top:8px;margin-bottom:22px}
.top{position:absolute;left:40px;top:0;width:1880px;height:32px;display:flex;align-items:center;padding:0 24px;gap:14px;
  font-size:var(--s);color:var(--ink-3);border-bottom:1px solid var(--line)}
.top .pill{border:1px solid var(--line-2);border-radius:999px;padding:2px 10px}
.top .sp{flex:1}

/* ============ page header ============ */
.hdr{position:absolute;left:40px;top:32px;width:1880px;height:62px;display:flex;align-items:center;padding:0 24px;gap:32px}
.hdr h1{font-size:var(--l);font-weight:600;letter-spacing:-.01em;line-height:1.1}
.hdr .per{display:block;font-size:var(--m);font-weight:400;color:var(--ink-3);margin-top:2px}
.wall{flex:1;display:flex;gap:28px;justify-content:center;font-size:var(--m);color:var(--ink-2);white-space:nowrap}
.wall .rec{display:flex;align-items:baseline;gap:10px}
.wall .rec+.rec{border-left:1px solid var(--line-2);padding-left:28px}
.wall .k{color:var(--gold);font-size:var(--s);font-weight:600}
.wall .n{color:var(--ink);font-weight:600}
.wall .v{font-weight:600;color:var(--ink)}
.periods{display:flex;gap:2px;background:var(--surface);border:1px solid var(--line);border-radius:var(--r);padding:3px}
.periods span{font-size:var(--s);color:var(--ink-2);padding:6px 12px;border-radius:7px}
.periods span.on{background:var(--ink);color:var(--stage);font-weight:600}

/* ============ columns ============ */
.col{position:absolute;top:94px;height:970px;background:var(--surface);border:1px solid var(--line);border-radius:12px;
  display:flex;flex-direction:column;overflow:hidden}
.col.sellers{left:64px;width:1112px}
.col.teams{left:1200px;width:696px}
.chead{display:flex;align-items:center;gap:14px;height:40px;padding:0 16px 0 20px;flex:none}
.chead h2{font-size:var(--l);font-weight:600;letter-spacing:-.01em}
.chead .cnt{font-size:var(--m);color:var(--ink-3)}
.chead .sp{flex:1}
.sw{display:flex;border:1px solid var(--line-2);border-radius:var(--r);padding:2px;gap:2px}
.sw span{font-size:var(--s);font-weight:600;color:var(--ink-2);padding:4px 12px;border-radius:7px;letter-spacing:.02em}
.sw span.on{background:var(--ink);color:var(--stage)}

/* ============ podium: 2-1-3, hierarchy by mass ============ */
.podium{display:flex;align-items:flex-end;justify-content:center;gap:12px;padding:0 6px 4px;flex:none}
.seat{position:relative;flex:none;background:var(--raised);border-radius:var(--r);padding:12px 14px 12px 24px;border:1px solid var(--line);
  display:flex;flex-direction:column;gap:6px;overflow:hidden}
.seat::before{content:"";position:absolute;left:0;top:0;bottom:0;width:10px;background:var(--tier)}
.seat.s2,.seat.s3{width:308px}
.seat.s1{width:456px;padding:12px 16px 12px 24px}
.seat-top{display:flex;align-items:center;gap:12px}
.halo{flex:none;width:64px;height:64px;border-radius:50%;display:grid;place-items:center;font-size:32px;font-weight:700;letter-spacing:-.04em;
  background:var(--surface);box-shadow:0 0 0 3px currentColor,0 0 0 8px color-mix(in oklab,currentColor 14%,transparent)}
.s1 .halo{width:80px;height:80px;font-size:var(--xl)}
.s1 .seat-top{gap:14px}
.who{min-width:0}
.who .nm{font-size:22px;font-weight:600;line-height:1.14;letter-spacing:-.01em;display:flex;flex-direction:column;color:var(--ink)}
.s1 .who .nm{font-size:var(--l)}
.who .sub{display:flex;align-items:center;gap:8px;margin-top:6px;font-size:var(--m);color:var(--ink-3)}
.who .sub .team{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:120px}
.who .sub .lv{font-weight:600;color:var(--tier);white-space:nowrap}
.fig .f2{display:block;font-size:var(--xl);font-weight:700;letter-spacing:-.03em;line-height:1;color:var(--ink)}
.fig p{display:flex;justify-content:space-between;align-items:baseline;gap:12px;margin-top:5px;white-space:nowrap}
.fig .f2c{font-size:var(--s);color:var(--ink-3)}
.fig .f1{font-size:var(--m);color:var(--ink-2)} .fig .f1 b{color:var(--ink)}
.prog .bar{height:10px;border-radius:5px;background:var(--track);overflow:hidden}
.prog .bar i{display:block;height:100%;background:var(--tier);border-radius:5px}
.prog p{display:flex;justify-content:space-between;align-items:baseline;gap:12px;margin-top:6px;font-size:var(--m);color:var(--ink-2);white-space:nowrap}
.prog p b{color:var(--ink)}
.prog p .to{color:var(--ink-3);font-size:var(--s)}
.meds{display:flex;align-items:center;gap:12px;min-height:24px}
.mc{display:inline-flex;align-items:center;gap:4px} .mc b{font-size:var(--s);color:var(--ink-2)}

/* ============ list: the timing tower ============ */
.cols,.row{display:grid;grid-template-columns:10px 52px 70px 1fr 84px 160px 146px 60px 68px;align-items:center;padding-right:16px}
.cols{height:24px;font-size:var(--s);color:var(--ink-3);flex:none;border-bottom:1px solid var(--line)}
.cols span{white-space:nowrap} .cols .r{text-align:right;padding-left:8px}
.list{flex:1;overflow:hidden;list-style:none}
.row{height:50px;border-bottom:1px solid var(--line)}
.row .band{align-self:stretch;background:var(--tier)}
.row.t0 .band{background:transparent;box-shadow:inset 2px 0 0 var(--t1)}
.row .rk{font-size:var(--l);font-weight:600;color:var(--ink);text-align:center;letter-spacing:-.02em}
.row .crest{margin-left:6px}
.row .nm{font-size:var(--l);font-weight:600;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;letter-spacing:-.01em;padding-left:12px}
.row .nm .team{font-size:var(--m);font-weight:400;color:var(--ink-3);margin-left:14px}
.row .rm{display:flex;align-items:center;gap:6px;overflow:visible}
.row .rm .more{font-size:var(--s);color:var(--ink-3)}
.row .f2{font-size:var(--l);font-weight:700;text-align:right;color:var(--ink);letter-spacing:-.02em}
.row .f1{font-size:var(--m);text-align:right;color:var(--ink-2)}
.row .od,.row .cv{font-size:var(--m);text-align:right;color:var(--ink-3)}
.foot{flex:none;display:flex;align-items:center;gap:14px;height:28px;padding:0 16px;
  border-top:1px solid var(--line);font-size:var(--s);color:var(--ink-3);white-space:nowrap;overflow:hidden}
.foot .lg{display:inline-flex;align-items:center;gap:7px}
.foot .lg b{color:var(--ink-2);font-weight:600} .foot .lg i{font-style:normal}

/* ============ teams ============ */
.tcols,.trow{display:grid;grid-template-columns:36px 1fr 40px 146px 58px 104px 48px 58px;column-gap:8px;align-items:center;padding-right:12px}
.tcols{height:24px;font-size:var(--s);color:var(--ink-3);border-bottom:1px solid var(--line);flex:none}
.tcols span{white-space:nowrap} .tcols .r{text-align:right}
.tlist{list-style:none;flex:1}
.trow{position:relative;height:62px;border-bottom:1px solid var(--line)}
.trow::after{content:"";position:absolute;left:44px;bottom:-1px;height:2px;width:calc((100% - 56px) * var(--share));background:var(--ink-3);opacity:.4}
.trow .rk{font-size:var(--l);font-weight:600;text-align:center;color:var(--ink-3)}
.trow .rk.gold{color:var(--gold);font-weight:700} .trow .rk.silver{color:var(--silver);font-weight:700} .trow .rk.bronze{color:var(--bronze);font-weight:700}
.trow .nm{font-size:var(--l);font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding-left:2px;color:var(--ink)}
.trow .cnt{font-size:var(--m);text-align:right;color:var(--ink-3)}
.trow .f2{font-size:var(--l);font-weight:700;text-align:right;letter-spacing:-.02em;color:var(--ink)}
.trow .sh{font-size:var(--m);text-align:right;color:var(--ink-3)}
.trow .f1{font-size:var(--m);text-align:right;color:var(--ink-2)}
.trow .od,.trow .cv{font-size:var(--m);text-align:right;color:var(--ink-3)}
.tfoot{flex:none;height:28px;display:flex;align-items:center;padding:0 20px;font-size:var(--s);color:var(--ink-3);border-top:1px solid var(--line)}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
'''

def page(theme):
    top3 = {r['rank']: r for r in rows[:3]}
    podium = seat(top3[2]) + seat(top3[1]) + seat(top3[3])
    lst = ''.join(row(r) for r in rows[3:34])
    tl = ''.join(team_row(t) for t in teams)
    aug = 'Avgust 2026 rekordi'
    return f'''<!doctype html>
<html lang="uz" data-theme="{theme}">
<head>
<meta charset="utf-8">
<title>Sotuvchilar reytingi — EFIR</title>
<meta name="viewport" content="width=1920">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap" rel="stylesheet">
<style>{CSS}</style>
</head>
<body>
{SYMBOLS}
<nav class="rail" aria-label="Menyu"><i class="logo"></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></nav>
<div class="top"><span class="pill">Bitrix24, sinx xatosi, 5 soat oldin</span><span class="sp"></span><span>Qidiruv</span><span class="pill">Ctrl K</span></div>

<header class="hdr">
 <h1>Sotuvchilar reytingi<span class="per">1–16 sen 2026</span></h1>
 <div class="wall" aria-label="Har oyning eng yaxshi sotuvchisi">
  <span class="rec"><span class="k">Sentabr yetakchisi</span><span class="n">Shahtiyarovna 197 Marjona</span><span class="v">79{NNBSP}600{NNBSP}000</span><span>57 ta yetkazilgan</span></span>
  <span class="rec"><span class="k">{aug}</span><span class="n">154 Marjona Xayrullayeva</span><span class="v">128{NNBSP}550{NNBSP}000</span><span>74 ta yetkazilgan</span></span>
 </div>
 <div class="periods" role="group" aria-label="Davr"><span>Bugun</span><span>Kecha</span><span class="on">Shu oy</span><span>Sana</span></div>
</header>

<section class="col sellers" aria-label="Sotuvchilar">
 <div class="chead"><h2>Sotuvchilar</h2><span class="cnt">{totals['sellers']} sotuvchi</span><span class="sp"></span>
  <div class="sw" role="group" aria-label="Fakt"><span>FAKT 1</span><span class="on">FAKT 2</span></div></div>
 <div class="podium">{podium}</div>
 <div class="cols"><span></span><span style="text-align:center">#</span><span>Daraja</span><span style="padding-left:12px">Sotuvchi</span><span>Medallar</span><span class="r">FAKT 2, yetkazilgan</span><span class="r">FAKT 1, tasdiqlangan</span><span class="r">Buyurtma</span><span class="r">Konv.</span></div>
 <ol class="list" start="4">{lst}
 </ol>
 <div class="foot">{legend}</div>
</section>

<section class="col teams" aria-label="Komandalar">
 <div class="chead"><h2>Komandalar</h2><span class="cnt">{totals['teams']} komanda</span><span class="sp"></span>
  <div class="sw" role="group" aria-label="Fakt"><span>FAKT 1</span><span class="on">FAKT 2</span></div></div>
 <div class="tcols"><span style="text-align:center">#</span><span style="padding-left:2px">Komanda (ROP)</span><span class="r">Sotuvchi</span><span class="r">FAKT 2, yetkazilgan</span><span class="r">Ulush</span><span class="r">FAKT 1</span><span class="r">Buyurtma</span><span class="r">Konv.</span></div>
 <ol class="tlist">{tl}
 </ol>
 <div class="tfoot">7 sotuvchi komandasiz, ulushlar ularsiz</div>
</section>
</body>
</html>'''

for theme, fn in (('dark', 'efir.html'), ('dark', 'efir-dark.html'), ('light', 'efir-light.html')):
    out = page(theme)
    open(OUT + fn, 'w').write(out)
    print(fn, len(out.encode()), 'bytes')
