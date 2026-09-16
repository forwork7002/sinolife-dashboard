/**
 * EFIR belgilari — `<defs>` ichi, sahifaga BIR MARTA o'rnatiladi
 * (`MedalDefs`): `#ch` — gerbning bitta chevroni (`Crest` uni oltita
 * `<use>` bilan chizadi), `#m-*` — 14 medal kodi uchun 12 belgi (Oy oilasi
 * bitta `#m-month` diskini bo'lishadi, raqam `MedalMark` da <text>).
 * Faqat-fill: rang instance <svg> dan meros bo'ladi (`.medal`, `.crest .on`);
 * `class="cut"` — sirt rangidagi kesib olish (gravyura), ikkinchi rang emas.
 *
 * GENERATSIYA QILINGAN. Manba: docs/superpowers/specs/assets/2026-09-16-efir/efir.html
 * (birinchi <defs>). Qo'lda tahrirlamang — aktivni o'zgartirib, rejadagi
 * generatorni (2026-09-16-efir-taxta.md, 2-vazifa, 3-qadam) qayta ishga tushiring.
 */
export const EFIR_DEFS = `<path id="ch" d="M0 0H7L12 10L7 20H0L5 10Z"/>
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
<symbol id="m-cal" viewBox="0 0 24 24"><path d="M2 4.5h20v18H2z"/><path d="M6 1.5h3v6H6zM15 1.5h3v6h-3z"/><path class="cut" d="M5 11h3.2v3.2H5zM10.4 11h3.2v3.2h-3.2zM15.8 11H19v3.2h-3.2zM5 16.5h3.2v3.2H5zM10.4 16.5h3.2v3.2h-3.2z"/></symbol>`
