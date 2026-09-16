/**
 * Lavha va medal SVG belgilari — `<defs>` ichi, sahifaga BIR MARTA
 * o'rnatiladi (`MedalDefs`). Ranglar faqat `var(--…)` — ular
 * `globals.css` dagi LAVHA/MEDAL bo'limlaridan instance <svg> orqali
 * shadow daraxtga meros bo'ladi.
 *
 * GENERATSIYA QILINGAN. Manba: docs/superpowers/specs/assets/2026-09-16-daraja/
 * (lavha-defs.html, medal-defs.html). Qo'lda tahrirlamang — manbani
 * o'zgartirib, rejadagi generatorni qayta ishga tushiring.
 */
export const LAVHA_DEFS = `<symbol id="khatam" viewBox="0 0 24 24" overflow="visible"><path d="M12.0 0.0 L14.7 5.6 L20.5 3.5 L18.4 9.3 L24.0 12.0 L18.4 14.7 L20.5 20.5 L14.7 18.4 L12.0 24.0 L9.3 18.4 L3.5 20.5 L5.6 14.7 L0.0 12.0 L5.6 9.3 L3.5 3.5 L9.3 5.6 Z"/></symbol>
    
    <symbol id="lavha-stars-1" viewBox="0 0 16 16" overflow="visible"><use href="#khatam" x="0" y="0" width="16" height="16"/></symbol>
    <symbol id="lavha-stars-2" viewBox="0 0 36 16" overflow="visible"><use href="#khatam" x="0" y="0" width="16" height="16"/><use href="#khatam" x="20" y="0" width="16" height="16"/></symbol>
    <symbol id="lavha-stars-3" viewBox="0 0 56 16" overflow="visible"><use href="#khatam" x="0" y="0" width="16" height="16"/><use href="#khatam" x="20" y="0" width="16" height="16"/><use href="#khatam" x="40" y="0" width="16" height="16"/></symbol>
    
    <symbol id="lavha-plate-3x1" viewBox="0 0 78 26" overflow="visible"><path d="M5.2 1.0 L66.1 1.0 L77.0 13.0 L66.1 25.0 L5.2 25.0 L1.0 20.8 L1.0 5.2 Z" vector-effect="non-scaling-stroke"/></symbol>
    
    <symbol id="lavha-rim-3x1" viewBox="0 0 78 26" overflow="visible"><path d="M6.0 3.0 L65.2 3.0 L74.3 13.0 L65.2 23.0 L6.0 23.0 L3.0 20.0 L3.0 6.0 Z" vector-effect="non-scaling-stroke"/></symbol>
    
    <symbol id="lavha-plate-seat" viewBox="0 0 280 88" overflow="visible"><path d="M15.1 1.0 L242.0 1.0 L279.0 44.0 L242.0 87.0 L15.1 87.0 L1.0 72.9 L1.0 15.1 Z" vector-effect="non-scaling-stroke"/></symbol>
    
    <symbol id="lavha-rim-seat" viewBox="0 0 280 88" overflow="visible"><path d="M18.4 9.0 L238.3 9.0 L268.4 44.0 L238.3 79.0 L18.4 79.0 L9.0 69.6 L9.0 18.4 Z" vector-effect="non-scaling-stroke"/></symbol>
    
    <symbol id="lavha-hi-seat" viewBox="0 0 280 88" overflow="visible"><path d="M4.5 71.5 L4.5 16.5 L16.5 4.5 L240.4 4.5 L274.4 44.0" vector-effect="non-scaling-stroke"/></symbol>
    <symbol id="lavha-lo-seat" viewBox="0 0 280 88" overflow="visible"><path d="M274.4 44.0 L240.4 83.5 L16.5 83.5 L4.5 71.5" vector-effect="non-scaling-stroke"/></symbol>`

export const MEDAL_DEFS = `<path id="m-tab" d="M6 0H26V10L16 5L6 10Z"/>
    <path id="m-tab-stripes" d="M8.6 0H10.6V7.7L8.6 8.7ZM21.4 0H23.4V8.7L21.4 7.7Z"/>
    <circle id="m-ring" cx="16" cy="24" r="16"/>
    <circle id="m-disc" cx="16" cy="24" r="14"/>
    <circle id="m-rim" cx="16" cy="24" r="12.3" fill="none" stroke-width="1.2" stroke-opacity=".5"/>
    
    <path id="m-leaf" d="M0 -2.9C1.5 -1.5 1.7 1 0 2.3C-1.7 1 -1.5 -1.5 0 -2.9Z"/>

    
    <linearGradient id="m-sheen-gold" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" style="stop-color:color-mix(in oklab, var(--medal-gold) 55%, white)"/>
      <stop offset=".5" style="stop-color:var(--medal-gold)"/>
      <stop offset="1" style="stop-color:color-mix(in oklab, var(--medal-gold) 70%, black)"/>
    </linearGradient>
    <linearGradient id="m-sheen-silver" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" style="stop-color:color-mix(in oklab, var(--medal-silver) 55%, white)"/>
      <stop offset=".5" style="stop-color:var(--medal-silver)"/>
      <stop offset="1" style="stop-color:color-mix(in oklab, var(--medal-silver) 70%, black)"/>
    </linearGradient>
    <linearGradient id="m-sheen-bronze" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" style="stop-color:color-mix(in oklab, var(--medal-bronze) 55%, white)"/>
      <stop offset=".5" style="stop-color:var(--medal-bronze)"/>
      <stop offset="1" style="stop-color:color-mix(in oklab, var(--medal-bronze) 70%, black)"/>
    </linearGradient>
    <linearGradient id="m-sheen-series-2" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" style="stop-color:color-mix(in oklab, var(--series-2) 70%, white)"/>
      <stop offset=".5" style="stop-color:var(--series-2)"/>
      <stop offset="1" style="stop-color:color-mix(in oklab, var(--series-2) 76%, black)"/>
    </linearGradient>
    <linearGradient id="m-sheen-series-3" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" style="stop-color:color-mix(in oklab, var(--series-3) 70%, white)"/>
      <stop offset=".5" style="stop-color:var(--series-3)"/>
      <stop offset="1" style="stop-color:color-mix(in oklab, var(--series-3) 76%, black)"/>
    </linearGradient>
    <linearGradient id="m-sheen-series-6" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" style="stop-color:color-mix(in oklab, var(--series-6) 70%, white)"/>
      <stop offset=".5" style="stop-color:var(--series-6)"/>
      <stop offset="1" style="stop-color:color-mix(in oklab, var(--series-6) 76%, black)"/>
    </linearGradient>
    <linearGradient id="m-sheen-series-7" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" style="stop-color:color-mix(in oklab, var(--series-7) 70%, white)"/>
      <stop offset=".5" style="stop-color:var(--series-7)"/>
      <stop offset="1" style="stop-color:color-mix(in oklab, var(--series-7) 76%, black)"/>
    </linearGradient>

    
    <symbol id="medal-month-gold" overflow="visible">
      <use href="#m-tab" style="fill:var(--m-field);opacity:var(--m-tab,1)"/>
      <g style="opacity:var(--m-tab,1)"><g style="opacity:var(--m-detail,0)">
        <use href="#m-tab" fill="url(#m-sheen-gold)"/>
        <use href="#m-tab-stripes" fill-opacity=".28" style="fill:var(--m-glyph)"/>
      </g></g>
      <use href="#m-ring" style="fill:var(--m-ring)"/>
      <use href="#m-disc" style="fill:var(--m-field)"/>
      <use href="#m-disc" fill="url(#m-sheen-gold)" style="opacity:var(--m-detail,0)"/>
      <use href="#m-rim" style="stroke:var(--m-glyph);opacity:var(--m-detail,0)"/>
      <g transform="translate(6.4 14.4) scale(.8)" fill="none" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round">
        <path d="M8 8L12 4V20M8 20H16" transform="translate(.6 .6)" style="stroke:var(--m-engrave-hi);opacity:var(--m-detail,0)"/>
        <path d="M8 8L12 4V20M8 20H16" style="stroke:var(--m-glyph)"/>
      </g>
    </symbol>

    <symbol id="medal-month-silver" overflow="visible">
      <use href="#m-tab" style="fill:var(--m-field);opacity:var(--m-tab,1)"/>
      <g style="opacity:var(--m-tab,1)"><g style="opacity:var(--m-detail,0)">
        <use href="#m-tab" fill="url(#m-sheen-silver)"/>
        <use href="#m-tab-stripes" fill-opacity=".28" style="fill:var(--m-glyph)"/>
      </g></g>
      <use href="#m-ring" style="fill:var(--m-ring)"/>
      <use href="#m-disc" style="fill:var(--m-field)"/>
      <use href="#m-disc" fill="url(#m-sheen-silver)" style="opacity:var(--m-detail,0)"/>
      <use href="#m-rim" style="stroke:var(--m-glyph);opacity:var(--m-detail,0)"/>
      <g transform="translate(6.4 14.4) scale(.8)" fill="none" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round">
        <path d="M7.6 8.4C7.6 5.6 9.6 4 12 4C14.6 4 16.6 5.7 16.6 8.2C16.6 12.6 8.4 14.2 7.4 20H16.8" transform="translate(.6 .6)" style="stroke:var(--m-engrave-hi);opacity:var(--m-detail,0)"/>
        <path d="M7.6 8.4C7.6 5.6 9.6 4 12 4C14.6 4 16.6 5.7 16.6 8.2C16.6 12.6 8.4 14.2 7.4 20H16.8" style="stroke:var(--m-glyph)"/>
      </g>
    </symbol>

    <symbol id="medal-month-bronze" overflow="visible">
      <use href="#m-tab" style="fill:var(--m-field);opacity:var(--m-tab,1)"/>
      <g style="opacity:var(--m-tab,1)"><g style="opacity:var(--m-detail,0)">
        <use href="#m-tab" fill="url(#m-sheen-bronze)"/>
        <use href="#m-tab-stripes" fill-opacity=".28" style="fill:var(--m-glyph)"/>
      </g></g>
      <use href="#m-ring" style="fill:var(--m-ring)"/>
      <use href="#m-disc" style="fill:var(--m-field)"/>
      <use href="#m-disc" fill="url(#m-sheen-bronze)" style="opacity:var(--m-detail,0)"/>
      <use href="#m-rim" style="stroke:var(--m-glyph);opacity:var(--m-detail,0)"/>
      <g transform="translate(6.4 14.4) scale(.8)" fill="none" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round">
        <path d="M7.6 7.4C8.4 5.2 10.2 4 12.2 4C14.8 4 16.6 5.6 16.6 7.8C16.6 10.2 14.8 11.8 12.2 12H10.8M12.2 12C15.2 12.2 17 13.8 17 16.2C17 18.6 15 20 12.2 20C10 20 8.2 18.9 7.4 17.2" transform="translate(.6 .6)" style="stroke:var(--m-engrave-hi);opacity:var(--m-detail,0)"/>
        <path d="M7.6 7.4C8.4 5.2 10.2 4 12.2 4C14.8 4 16.6 5.6 16.6 7.8C16.6 10.2 14.8 11.8 12.2 12H10.8M12.2 12C15.2 12.2 17 13.8 17 16.2C17 18.6 15 20 12.2 20C10 20 8.2 18.9 7.4 17.2" style="stroke:var(--m-glyph)"/>
      </g>
    </symbol>

    <symbol id="medal-year-champion" overflow="visible">
      
      <g style="fill:var(--m-field);opacity:var(--m-detail,0)">
        <use href="#m-leaf" transform="rotate(172.5 16 24) translate(16 6.6) rotate(-62)"/>
        <use href="#m-leaf" transform="rotate(157.5 16 24) translate(16 6.6) rotate(-62)"/>
        <use href="#m-leaf" transform="rotate(142.5 16 24) translate(16 6.6) rotate(-62)"/>
        <use href="#m-leaf" transform="rotate(127.5 16 24) translate(16 6.6) rotate(-62)"/>
        <use href="#m-leaf" transform="rotate(112.5 16 24) translate(16 6.6) rotate(-62)"/>
        <use href="#m-leaf" transform="rotate(97.5 16 24) translate(16 6.6) rotate(-62)"/>
        <use href="#m-leaf" transform="rotate(82.5 16 24) translate(16 6.6) rotate(-62)"/>
        <use href="#m-leaf" transform="rotate(67.5 16 24) translate(16 6.6) rotate(-62)"/>
        <use href="#m-leaf" transform="rotate(52.5 16 24) translate(16 6.6) rotate(-62)"/>
        <use href="#m-leaf" transform="rotate(-172.5 16 24) translate(16 6.6) rotate(62)"/>
        <use href="#m-leaf" transform="rotate(-157.5 16 24) translate(16 6.6) rotate(62)"/>
        <use href="#m-leaf" transform="rotate(-142.5 16 24) translate(16 6.6) rotate(62)"/>
        <use href="#m-leaf" transform="rotate(-127.5 16 24) translate(16 6.6) rotate(62)"/>
        <use href="#m-leaf" transform="rotate(-112.5 16 24) translate(16 6.6) rotate(62)"/>
        <use href="#m-leaf" transform="rotate(-97.5 16 24) translate(16 6.6) rotate(62)"/>
        <use href="#m-leaf" transform="rotate(-82.5 16 24) translate(16 6.6) rotate(62)"/>
        <use href="#m-leaf" transform="rotate(-67.5 16 24) translate(16 6.6) rotate(62)"/>
        <use href="#m-leaf" transform="rotate(-52.5 16 24) translate(16 6.6) rotate(62)"/>
      </g>
      <path d="M6 10.25A17 17 0 1 0 26 10.25" fill="none" stroke-width="1.5" stroke-linecap="round" style="stroke:var(--m-field);opacity:var(--m-flat,1)"/>
      <use href="#m-tab" style="fill:var(--m-field);opacity:var(--m-tab,1)"/>
      <g style="opacity:var(--m-tab,1)"><g style="opacity:var(--m-detail,0)">
        <use href="#m-tab" fill="url(#m-sheen-gold)"/>
        <use href="#m-tab-stripes" fill-opacity=".28" style="fill:var(--m-glyph)"/>
      </g></g>
      <use href="#m-ring" style="fill:var(--m-ring)"/>
      <use href="#m-disc" style="fill:var(--m-field)"/>
      <use href="#m-disc" fill="url(#m-sheen-gold)" style="opacity:var(--m-detail,0)"/>
      <use href="#m-rim" style="stroke:var(--m-glyph);opacity:var(--m-detail,0)"/>
      <g transform="translate(6.4 14.4) scale(.8)">
        <g transform="translate(.6 .6)" style="fill:var(--m-engrave-hi);opacity:var(--m-detail,0)">
          <path d="M3 15.5V4.5L8 10L12 2.5L16 10L21 4.5V15.5Z"/><rect x="3" y="18.7" width="18" height="3.3" rx="1"/>
        </g>
        <g style="fill:var(--m-glyph)">
          <path d="M3 15.5V4.5L8 10L12 2.5L16 10L21 4.5V15.5Z"/><rect x="3" y="18.7" width="18" height="3.3" rx="1"/>
        </g>
      </g>
    </symbol>

    
    <symbol id="medal-streak-fire" overflow="visible">
      <use href="#m-tab" style="fill:var(--m-field);opacity:var(--m-tab,1)"/>
      <g style="opacity:var(--m-tab,1)"><g style="opacity:var(--m-detail,0)">
        <use href="#m-tab" fill="url(#m-sheen-series-2)"/>
        <use href="#m-tab-stripes" fill-opacity=".28" style="fill:var(--m-glyph)"/>
      </g></g>
      <use href="#m-ring" style="fill:var(--m-ring)"/>
      <use href="#m-disc" style="fill:var(--m-field)"/>
      <use href="#m-disc" fill="url(#m-sheen-series-2)" style="opacity:var(--m-detail,0)"/>
      <use href="#m-rim" style="stroke:var(--m-glyph);opacity:var(--m-detail,0)"/>
      <g transform="translate(6.4 14.4) scale(.8)">
        <path d="M12.2 1.8C12.4 6.5 5.3 9.6 5.3 15.6A6.7 6.7 0 0 0 18.7 15.6C18.7 12.4 17 10.6 15.9 8C15.4 10.7 14 11.6 13.4 11.6C13.4 8.3 12.6 5.6 12.2 1.8Z" style="fill:var(--m-glyph)"/>
        <path d="M12 14.2C10.7 16.1 9.7 17.3 9.7 18.6A2.3 2.3 0 0 0 14.3 18.6C14.3 17.3 13.3 16.1 12 14.2Z" style="fill:var(--m-field);opacity:var(--m-detail,0)"/>
      </g>
    </symbol>

    <symbol id="medal-streak-steady" overflow="visible">
      <use href="#m-tab" style="fill:var(--m-field);opacity:var(--m-tab,1)"/>
      <g style="opacity:var(--m-tab,1)"><g style="opacity:var(--m-detail,0)">
        <use href="#m-tab" fill="url(#m-sheen-series-2)"/>
        <use href="#m-tab-stripes" fill-opacity=".28" style="fill:var(--m-glyph)"/>
      </g></g>
      <use href="#m-ring" style="fill:var(--m-ring)"/>
      <use href="#m-disc" style="fill:var(--m-field)"/>
      <use href="#m-disc" fill="url(#m-sheen-series-2)" style="opacity:var(--m-detail,0)"/>
      <use href="#m-rim" style="stroke:var(--m-glyph);opacity:var(--m-detail,0)"/>
      <g transform="translate(6.4 14.4) scale(.8)">
        
        <path d="M2.6 21V15.4H8.6V9.4H14.6V3.4H21.4V21Z" style="fill:var(--m-glyph)"/>
      </g>
    </symbol>

    
    <symbol id="medal-day-record" overflow="visible">
      <use href="#m-tab" style="fill:var(--m-field);opacity:var(--m-tab,1)"/>
      <g style="opacity:var(--m-tab,1)"><g style="opacity:var(--m-detail,0)">
        <use href="#m-tab" fill="url(#m-sheen-series-7)"/>
        <use href="#m-tab-stripes" fill-opacity=".28" style="fill:var(--m-glyph)"/>
      </g></g>
      <use href="#m-ring" style="fill:var(--m-ring)"/>
      <use href="#m-disc" style="fill:var(--m-field)"/>
      <use href="#m-disc" fill="url(#m-sheen-series-7)" style="opacity:var(--m-detail,0)"/>
      <use href="#m-rim" style="stroke:var(--m-glyph);opacity:var(--m-detail,0)"/>
      <g transform="translate(6.4 14.4) scale(.8)">
        <path d="M14.6 1.5L4 13.6H10.4L9.2 22.5L20 10.4H13.6Z" style="fill:var(--m-glyph)"/>
      </g>
    </symbol>

    <symbol id="medal-day-winner" overflow="visible">
      <use href="#m-tab" style="fill:var(--m-field);opacity:var(--m-tab,1)"/>
      <g style="opacity:var(--m-tab,1)"><g style="opacity:var(--m-detail,0)">
        <use href="#m-tab" fill="url(#m-sheen-series-7)"/>
        <use href="#m-tab-stripes" fill-opacity=".28" style="fill:var(--m-glyph)"/>
      </g></g>
      <use href="#m-ring" style="fill:var(--m-ring)"/>
      <use href="#m-disc" style="fill:var(--m-field)"/>
      <use href="#m-disc" fill="url(#m-sheen-series-7)" style="opacity:var(--m-detail,0)"/>
      <use href="#m-rim" style="stroke:var(--m-glyph);opacity:var(--m-detail,0)"/>
      <g transform="translate(6.4 14.4) scale(.8)" style="color:var(--m-glyph)">
        
        <path d="M4.8 16.4A7.2 7.2 0 0 1 19.2 16.4Z" fill="currentColor"/>
        <rect x="5.4" y="19.4" width="13.2" height="3.2" rx="1.6" fill="currentColor"/>
        <path d="M12 6V2.2M17.4 8.6L20.2 5.8M6.6 8.6L3.8 5.8" fill="none" stroke="currentColor" stroke-width="3.6" stroke-linecap="round"/>
      </g>
    </symbol>

    
    <symbol id="medal-conversion-master" overflow="visible">
      <use href="#m-tab" style="fill:var(--m-field);opacity:var(--m-tab,1)"/>
      <g style="opacity:var(--m-tab,1)"><g style="opacity:var(--m-detail,0)">
        <use href="#m-tab" fill="url(#m-sheen-series-3)"/>
        <use href="#m-tab-stripes" fill-opacity=".28" style="fill:var(--m-glyph)"/>
      </g></g>
      <use href="#m-ring" style="fill:var(--m-ring)"/>
      <use href="#m-disc" style="fill:var(--m-field)"/>
      <use href="#m-disc" fill="url(#m-sheen-series-3)" style="opacity:var(--m-detail,0)"/>
      <use href="#m-rim" style="stroke:var(--m-glyph);opacity:var(--m-detail,0)"/>
      <g transform="translate(6.4 14.4) scale(.8)" style="color:var(--m-glyph)">
        <circle cx="12" cy="12" r="8.2" fill="none" stroke="currentColor" stroke-width="3.2"/>
        <circle cx="12" cy="12" r="3.5" fill="currentColor"/>
      </g>
    </symbol>

    <symbol id="medal-clean-month" overflow="visible">
      <use href="#m-tab" style="fill:var(--m-field);opacity:var(--m-tab,1)"/>
      <g style="opacity:var(--m-tab,1)"><g style="opacity:var(--m-detail,0)">
        <use href="#m-tab" fill="url(#m-sheen-series-3)"/>
        <use href="#m-tab-stripes" fill-opacity=".28" style="fill:var(--m-glyph)"/>
      </g></g>
      <use href="#m-ring" style="fill:var(--m-ring)"/>
      <use href="#m-disc" style="fill:var(--m-field)"/>
      <use href="#m-disc" fill="url(#m-sheen-series-3)" style="opacity:var(--m-detail,0)"/>
      <use href="#m-rim" style="stroke:var(--m-glyph);opacity:var(--m-detail,0)"/>
      <g transform="translate(6.4 14.4) scale(.8)">
        <path d="M4.6 12.8L9.8 18L19.6 6.4" fill="none" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" style="stroke:var(--m-glyph)"/>
      </g>
    </symbol>

    
    <symbol id="medal-jump" overflow="visible">
      <use href="#m-tab" style="fill:var(--m-field);opacity:var(--m-tab,1)"/>
      <g style="opacity:var(--m-tab,1)"><g style="opacity:var(--m-detail,0)">
        <use href="#m-tab" fill="url(#m-sheen-series-6)"/>
        <use href="#m-tab-stripes" fill-opacity=".28" style="fill:var(--m-glyph)"/>
      </g></g>
      <use href="#m-ring" style="fill:var(--m-ring)"/>
      <use href="#m-disc" style="fill:var(--m-field)"/>
      <use href="#m-disc" fill="url(#m-sheen-series-6)" style="opacity:var(--m-detail,0)"/>
      <use href="#m-rim" style="stroke:var(--m-glyph);opacity:var(--m-detail,0)"/>
      <g transform="translate(6.4 14.4) scale(.8)">
        <path d="M3.6 19.8L10.2 13.2L13.8 16.8L20.6 10M14.4 9.8H20.6V16" fill="none" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round" style="stroke:var(--m-glyph)"/>
      </g>
    </symbol>

    <symbol id="medal-rookie" overflow="visible">
      <use href="#m-tab" style="fill:var(--m-field);opacity:var(--m-tab,1)"/>
      <g style="opacity:var(--m-tab,1)"><g style="opacity:var(--m-detail,0)">
        <use href="#m-tab" fill="url(#m-sheen-series-6)"/>
        <use href="#m-tab-stripes" fill-opacity=".28" style="fill:var(--m-glyph)"/>
      </g></g>
      <use href="#m-ring" style="fill:var(--m-ring)"/>
      <use href="#m-disc" style="fill:var(--m-field)"/>
      <use href="#m-disc" fill="url(#m-sheen-series-6)" style="opacity:var(--m-detail,0)"/>
      <use href="#m-rim" style="stroke:var(--m-glyph);opacity:var(--m-detail,0)"/>
      
      <g transform="translate(6.4 14.4) scale(.8) rotate(45 12 12)" style="fill:var(--m-glyph)">
        <path fill-rule="evenodd" d="M12 1.6C14.7 1.6 16.2 6.2 16.2 11.4V16.6H7.8V11.4C7.8 6.2 9.3 1.6 12 1.6ZM12 7.3A2.25 2.25 0 1 0 12 11.8A2.25 2.25 0 1 0 12 7.3Z"/>
        <path d="M7.8 11.2L4.2 15.6V19.2L7.8 17.2ZM16.2 11.2L19.8 15.6V19.2L16.2 17.2Z"/>
        <path d="M9.6 18.4H14.4L12 23Z"/>
      </g>
    </symbol>

    <symbol id="medal-first-sale" overflow="visible">
      <use href="#m-tab" style="fill:var(--m-field);opacity:var(--m-tab,1)"/>
      <g style="opacity:var(--m-tab,1)"><g style="opacity:var(--m-detail,0)">
        <use href="#m-tab" fill="url(#m-sheen-series-6)"/>
        <use href="#m-tab-stripes" fill-opacity=".28" style="fill:var(--m-glyph)"/>
      </g></g>
      <use href="#m-ring" style="fill:var(--m-ring)"/>
      <use href="#m-disc" style="fill:var(--m-field)"/>
      <use href="#m-disc" fill="url(#m-sheen-series-6)" style="opacity:var(--m-detail,0)"/>
      <use href="#m-rim" style="stroke:var(--m-glyph);opacity:var(--m-detail,0)"/>
      
      <g transform="translate(6.4 14.4) scale(.8)" style="color:var(--m-glyph)">
        <path d="M12.2 22.4C12.2 18.4 12.4 13.4 13.2 7.6" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"/>
        <path d="M12 16C9.2 18.6 3.6 18 2 13.6C3.4 10.2 8.8 10.4 12 16Z" fill="currentColor"/>
        <path d="M12.8 10.2C15.6 12.8 21.2 12.2 22.8 7.8C21.4 4.4 16 4.6 12.8 10.2Z" fill="currentColor"/>
      </g>
    </symbol>

    <symbol id="medal-work-month" overflow="visible">
      <use href="#m-tab" style="fill:var(--m-field);opacity:var(--m-tab,1)"/>
      <g style="opacity:var(--m-tab,1)"><g style="opacity:var(--m-detail,0)">
        <use href="#m-tab" fill="url(#m-sheen-series-6)"/>
        <use href="#m-tab-stripes" fill-opacity=".28" style="fill:var(--m-glyph)"/>
      </g></g>
      <use href="#m-ring" style="fill:var(--m-ring)"/>
      <use href="#m-disc" style="fill:var(--m-field)"/>
      <use href="#m-disc" fill="url(#m-sheen-series-6)" style="opacity:var(--m-detail,0)"/>
      <use href="#m-rim" style="stroke:var(--m-glyph);opacity:var(--m-detail,0)"/>
      <g transform="translate(6.4 14.4) scale(.8)" style="fill:var(--m-glyph)">
        <rect x="2.8" y="2.8" width="5.2" height="5.2" rx="1.3"/><rect x="9.4" y="2.8" width="5.2" height="5.2" rx="1.3"/><rect x="16" y="2.8" width="5.2" height="5.2" rx="1.3"/>
        <rect x="2.8" y="9.4" width="5.2" height="5.2" rx="1.3"/><rect x="9.4" y="9.4" width="5.2" height="5.2" rx="1.3"/><rect x="16" y="9.4" width="5.2" height="5.2" rx="1.3"/>
        <rect x="2.8" y="16" width="5.2" height="5.2" rx="1.3"/><rect x="9.4" y="16" width="5.2" height="5.2" rx="1.3"/><rect x="16" y="16" width="5.2" height="5.2" rx="1.3"/>
      </g>
    </symbol>

    
    <symbol id="medal-locked" overflow="visible">
      <use href="#m-tab" fill="none" stroke-width="1.5" stroke-linejoin="round" stroke-dasharray="2.6 2.1" style="stroke:var(--m-field);opacity:var(--m-tab,1)"/>
      <circle cx="16" cy="24" r="13.25" fill="none" stroke-width="1.5" stroke-dasharray="2.6 2.1" style="stroke:var(--m-field)"/>
    </symbol>`
