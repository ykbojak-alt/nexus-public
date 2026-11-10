# Bundled fonts — provenance (W4-09 asset traceability)

All files are **SIL OFL 1.1** — license text in `OFL.txt` (same directory,
per OFL §2 "stand-alone text files"). Files are redistributed **unmodified**,
so Reserved Font Names do not apply (OFL §3 restricts only derivative works).

Source: `@fontsource` 5.3.0 woff2 files, pinned, fetched from jsDelivr
(fonts were not subset or rebuilt — served as distributed upstream).

## Families

| Family | Files | Copyright / RFN | Upstream source |
| --- | --- | --- | --- |
| Inter Tight | 4 woff2 (variable, wght 100–900) | The Inter Project Authors | `github.com/rsms/inter-tight` |
| IBM Plex Mono | 8 woff2 (300, 400) | IBM Corp. · RFN "Plex" | `github.com/IBM/plex` |
| Playfair Display | 3 woff2 (variable, wght 300–900) | Playfair Display Project Authors · RFN "Playfair Display" | `github.com/clauseggers/Playfair-Display` |

## File manifest (sha256)

| File | sha256 |
| --- | --- |
| ibm-plex-mono-cyrillic-300-normal.woff2 | `4cadd515f7e69b84af2247ebfba34dd40d7aa9fddce147d6e783ee6993d07c74` |
| ibm-plex-mono-cyrillic-400-normal.woff2 | `7635422bd10ddbbcb0e0caa1154b928298f5c8319b8c00b30978d4395f4783ce` |
| ibm-plex-mono-cyrillic-ext-300-normal.woff2 | `c129280f7831f0e528f327ee4496a7dd097a71a0d659d382ba4d579713eeaf0d` |
| ibm-plex-mono-cyrillic-ext-400-normal.woff2 | `f8c22ec1804bd6966b70f43ac7c327025645b4c09597117fca2a5a6c750106fe` |
| ibm-plex-mono-latin-300-normal.woff2 | `d2ce22595d55a52b0c63f837515729bd97706bfa1b833816509f13d93daa59b5` |
| ibm-plex-mono-latin-400-normal.woff2 | `08949f728dc52d528e69b1667d15c89a5686a4ee9a296ff90983985f99c380f7` |
| ibm-plex-mono-latin-ext-300-normal.woff2 | `40a4c5fb57ace858d7d9f7da764a9104a75976c88fc27f8e957d717e6189938d` |
| ibm-plex-mono-latin-ext-400-normal.woff2 | `6bc0f226a5b7884a8170e3f62c63d7675609d4631bdc5931b5cdab81821f00eb` |
| inter-tight-cyrillic-ext-wght-normal.woff2 | `9bba92a871106008d89cc9734c218a3660b92ff647bdfb6879bf0440fba002c0` |
| inter-tight-cyrillic-wght-normal.woff2 | `3937173d62f238179ca073aee632d53ebc088967ac841bf213211be05720881a` |
| inter-tight-latin-ext-wght-normal.woff2 | `fd9beddaaec644945809da574cf1caf342073c7e4b46a2ea5bd136c8cf1a9eca` |
| inter-tight-latin-wght-normal.woff2 | `77fefe8ca19b9f69b5284832c519e0493127c1f091f0a8936884be7721c4e618` |
| playfair-display-cyrillic-wght-normal.woff2 | `c108681cba6a9820bff52f4a1a4a1d9edf356b347bd79b7c61e916028e8a8b54` |
| playfair-display-latin-ext-wght-normal.woff2 | `42898ad49a6b23f32b109243e1df596edf831015ed685f429e4dafbb181d599d` |
| playfair-display-latin-wght-normal.woff2 | `e0c764a8e9e1cce92163c55bac4b2ad6cd4cf8c696ce2289ab5c41565e65b7e2` |

Re-verify after any font update: `sha256sum apps/nexus/public/fonts/*.woff2`.
Faces are wired in `apps/nexus/src/app/fonts.css` (@font-face, verbatim
fontsource unicode-range, `font-display: swap`); family names match
`--nexus-font-*` tokens 1:1.
