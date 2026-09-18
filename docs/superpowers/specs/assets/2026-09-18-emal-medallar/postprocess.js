/* eslint-disable */
/**
 * SAYQAL · item 1 — emoji → BoardIcon, re-cut to the medal hand.  Runnable as-is in page.evaluate(<this file's text>).
 *
 * Same rewrite as the POLISH pass: every emoji already sits in its own <span aria-hidden>; the span keeps its place,
 * gets class "bi bi--<name>" and one inline <svg>. `.bi` keeps the emoji's advance (1.27em) so nothing reflows.
 * Harmonised with the medals: round caps, ONE stroke weight per box (1.7 in the 16 box, 1.5 in the 20 box — the medals'
 * 2u/32 at the sizes the icons render), the crown is the SAME drawing as the year champion's (gen-defs.js CROWN_*),
 * the flame is the medal's own flame outline with its enamel heart, the rosette is the rank disc in miniature.
 * No filter anywhere. In React this is one component: <BoardIcon name="target" /> → <span aria-hidden className="bi bi--target"><svg …/></span>
 */
(() => {
  const S = (vb, body, sw) =>
    `<svg viewBox="0 0 ${vb}" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" focusable="false">${body}</svg>`

  const ICONS = {
    /* 🏆 — a cup: bowl, two handles, stem, plinth. Heading disc (sellers), record marquee, phone tab. */
    trophy: S('20 20',
      '<path d="M6.2 3h7.6v4.3a3.8 3.8 0 0 1-7.6 0z"/>' +
      '<path d="M6.2 4.6H3.6v1a2.9 2.9 0 0 0 2.9 2.9M13.8 4.6h2.6v1a2.9 2.9 0 0 1-2.9 2.9"/>' +
      '<path d="M10 11.1v3.1M7.4 14.2h5.2l.8 2.8H6.6z"/>', 1.5),
    /* 🛡️ — a heraldic shield, parted per pale. Heading disc (teams), phone tab. */
    shield: S('20 20',
      '<path d="M10 2.7v14.6C6.6 15.9 4.2 13 4.2 9.4V4.8z" fill="currentColor" fill-opacity=".2" stroke="none"/>' +
      '<path d="M10 2.7l5.8 2.1v4.6c0 3.6-2.4 6.5-5.8 7.9-3.4-1.4-5.8-4.3-5.8-7.9V4.8z"/>' +
      '<path d="M10 2.7v14.6" stroke-opacity=".55" stroke-width="1.1"/>', 1.5),
    /* 🥇🥈🥉 — the award rosette: ring + bull (the rank disc in miniature) with two tails; colour = the seat's --metal. */
    medal: S('16 16',
      '<path d="M4.5 1.4h2.6l.9 2.2.9-2.2h2.6L9.4 6H6.6z" fill="currentColor" fill-opacity=".38" stroke-width="1.1"/>' +
      '<circle cx="8" cy="10.3" r="4.1"/>' +
      '<circle cx="8" cy="10.3" r="1.35" fill="currentColor" stroke="none"/>', 1.5),
    /* 🚀 — «oldinda»: a double chevron, the insignia way of saying «ahead». Champion's chip only. */
    lead: S('16 16', '<path d="M3.8 8.1 8 4.1l4.2 4M3.8 12.3 8 8.3l4.2 4"/>', 1.7),
    /* 🎯 — the chase: ring + bull in the chase bar's own blue (dimmed to the text's ink on secondary rows). */
    target: S('16 16',
      '<circle cx="8" cy="8" r="6.2"/><circle cx="8" cy="8" r="3" stroke-opacity=".8"/>' +
      '<circle cx="8" cy="8" r="1.1" fill="currentColor" stroke="none"/>', 1.5),
    /* 🔥 — «… bilan teng»: the MEDAL's flame (streak-fire outline + enamel heart), mapped from the 32 box into the 16 box. */
    flame: S('16 16',
      '<g transform="translate(-3.52 -3.45) scale(.72)">' +
      '<path d="M16.3 6.6C16.9 10.4 22.6 12.6 22.6 18.3C22.6 22.4 19.7 25.2 16 25.2C12.3 25.2 9.4 22.4 9.4 18.6C9.4 15.9 10.8 14 12.2 12.6C12.5 14.4 13.2 15.4 14.3 15.9C13.9 12.6 14.7 9 16.3 6.6Z" stroke-width="2.1"/>' +
      '<path d="M16 18.2C16.9 19.4 18.5 20.2 18.5 21.7C18.5 23 17.4 23.8 16 23.8C14.6 23.8 13.5 23 13.5 21.7C13.5 20.3 15.1 19.5 16 18.2Z" fill="currentColor" fill-opacity=".85" stroke="none"/>' +
      '</g>', 1.5),
    /* 👑 — the champion's crown: the year champion's crown, struck in the medals' gold, upright, seated on the ring. */
    crown:
      '<svg viewBox="0 0 28 20" focusable="false">' +
      '<path d="M5 15.3 2.9 6.2l6 4.2L14 3.2l5.1 7.2 6-4.2L23 15.3z" fill="url(#bi-crown-g)" stroke="var(--bi-crown-edge)" stroke-width=".9" stroke-linejoin="round"/>' +
      '<path d="M5.8 13.2h16.4" stroke="var(--bi-crown-hi)" stroke-opacity=".5" stroke-width=".8" stroke-linecap="round"/>' +
      '<rect x="4.7" y="16.2" width="18.6" height="2.6" rx="1.2" fill="url(#bi-crown-g)" stroke="var(--bi-crown-edge)" stroke-width=".9"/>' +
      '</svg>',
  }

  /* emoji (variation selector stripped) → icon name */
  const MAP = { '🏆': 'trophy', '🛡': 'shield', '🥇': 'medal', '🥈': 'medal', '🥉': 'medal', '👑': 'crown', '🚀': 'lead', '🎯': 'target', '🔥': 'flame' }

  /* one shared gradient for the crown — in the app it goes into <MedalDefs /> (ids stay unique on the page) */
  if (!document.querySelector('svg.bi-defs')) {
    const holder = document.createElement('div')
    holder.innerHTML =
      '<svg class="bi-defs" width="0" height="0" aria-hidden="true" focusable="false" style="position:absolute"><defs>' +
      '<linearGradient id="bi-crown-g" x1=".18" y1=".02" x2=".82" y2=".98">' +
      '<stop offset="0" style="stop-color:var(--bi-crown-hi)"/><stop offset=".5" style="stop-color:var(--bi-crown)"/><stop offset="1" style="stop-color:var(--bi-crown-lo)"/>' +
      '</linearGradient></defs></svg>'
    document.body.insertBefore(holder.firstChild, document.body.firstChild)
  }

  let n = 0
  for (const el of document.querySelectorAll('span')) {
    if (el.children.length) continue
    const key = el.textContent.trim().replace(/️/g, '')
    const name = MAP[key]
    if (!name) continue
    el.classList.add('bi', 'bi--' + name)
    el.setAttribute('aria-hidden', 'true')
    el.innerHTML = ICONS[name]
    if (name === 'target') {
      // a row whose chase line is secondary ink keeps its target in that ink — the medals stay the only jewel in the row
      const host = el.parentElement
      const c = host && host.getAttribute('style')
      if (c && /ink-(secondary|muted)/.test(c)) el.classList.add('bi--dim')
    }
    if (name === 'crown') el.style.transform = '' // centring is done by margin in CSS (see polish.css); `.rise` would wipe an inline transform anyway
    n++
  }
  return n
})()
