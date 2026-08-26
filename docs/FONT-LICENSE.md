# Bundled font

`src/app/fonts/InterVariable.woff2` is a subset of **Inter v4.1** by Rasmus
Andersson, licensed under the SIL Open Font License 1.1.

- Upstream: https://github.com/rsms/inter
- Licence: https://github.com/rsms/inter/blob/master/LICENSE.txt

The OFL permits redistribution, modification and bundling with an application,
including subsetting — which is what was done here. It does **not** permit
selling the font on its own, and the reserved font name rules mean a modified
copy must not be distributed under the name "Inter". Ours is a subset rather
than a modification of the outlines, and it is served as part of an
application, so both conditions are met.

## What the subset contains

Regenerated with `fontTools.subset` from the upstream `InterVariable.woff2`:

| | |
|---|---|
| Latin | U+0000–024F |
| Modifier letters | U+02B0–02FF — `ʻ` in *oʻzbek*, *gʻoya* |
| Combining marks | U+0300–036F |
| Cyrillic | U+0400–04FF — the portal's stage names are Russian |
| Punctuation, currency, symbols | U+2000–206F, U+20A0–20BF, U+2100–214F |
| Arrows, minus, box drawing | U+2190–21BB, U+2212, U+2500–25FF |

Both variable axes are preserved — `wght` 100–900 and `opsz` 14–32 — so one
file serves body text and display headings. 197 KB, from 352 KB.
