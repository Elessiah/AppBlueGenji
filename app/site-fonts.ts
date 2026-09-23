import type { CSSProperties } from "react";
import localFont from "next/font/local";
import { fontStack } from "@/lib/shared/font-stack";

/*
 * Polices du site, **hébergées dans le dépôt** (`app/fonts/`, licence OFL de
 * chaque famille à côté) — jamais `next/font/google`, qui va chercher les
 * fichiers chez Google au démarrage de `next dev` et à la compilation : le job
 * E2E du CI en dépendait, et échouait par intermittence sans réseau.
 *
 * Un fichier **par sous-ensemble de glyphes**, comme les servait Google :
 * `next/font/google` ne limitait pas les fichiers à `subsets: ["latin"]` — il
 * téléchargeait tous les sous-ensembles et ne **préchargeait** que le latin.
 * Ne garder que le latin ferait rendre en Arial le `Ł` de « Łukasz », le `ş`
 * de « Şahin » ou un pseudo en cyrillique, lettre par lettre au milieu du nom.
 * Chaque sous-ensemble porte donc son `unicode-range` (le navigateur ne
 * télécharge que ceux dont la page a besoin) et seul le latin est préchargé.
 *
 * `next/font/local` n'accepte qu'un `unicode-range` par appel, d'où un appel
 * par sous-ensemble, et des options **écrites en littéral** — le compilateur
 * de Next refuse une constante. Les plages viennent des feuilles Fontsource
 * (paquets `@fontsource-variable/*` et `@fontsource/rajdhani`, v5.3.0), d'où
 * viennent aussi les fichiers. `fontStack` recompose ensuite la pile d'une
 * famille : ses sous-ensembles dans l'ordre, puis le repli à métriques ajustées
 * du latin — en dernier, sans quoi Arial, qui a des glyphes latin-ext, les
 * servirait avant la police.
 *
 * Nuance vérifiée : la compilation de production (webpack) émet bien les
 * `unicode-range`, mais Turbopack (`next dev --turbopack`) ignore
 * `declarations` en 15.5 — en développement, tous les sous-ensembles sont donc
 * téléchargés. Le rendu est le même, seul le poids de la page change, et
 * seulement là.
 */

// Rajdhani — latin, latin-ext, devanagari
const rajdhaniLatin = localFont({
  src: [
    { path: "./fonts/rajdhani-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "./fonts/rajdhani-latin-600-normal.woff2", weight: "600", style: "normal" },
    { path: "./fonts/rajdhani-latin-700-normal.woff2", weight: "700", style: "normal" },
  ],
  declarations: [{ prop: "unicode-range", value: "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD" }],
});

const rajdhaniLatinExt = localFont({
  src: [
    { path: "./fonts/rajdhani-latin-ext-500-normal.woff2", weight: "500", style: "normal" },
    { path: "./fonts/rajdhani-latin-ext-600-normal.woff2", weight: "600", style: "normal" },
    { path: "./fonts/rajdhani-latin-ext-700-normal.woff2", weight: "700", style: "normal" },
  ],
  preload: false,
  adjustFontFallback: false,
  declarations: [{ prop: "unicode-range", value: "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF" }],
});

const rajdhaniDevanagari = localFont({
  src: [
    { path: "./fonts/rajdhani-devanagari-500-normal.woff2", weight: "500", style: "normal" },
    { path: "./fonts/rajdhani-devanagari-600-normal.woff2", weight: "600", style: "normal" },
    { path: "./fonts/rajdhani-devanagari-700-normal.woff2", weight: "700", style: "normal" },
  ],
  preload: false,
  adjustFontFallback: false,
  declarations: [{ prop: "unicode-range", value: "U+0900-097F,U+1CD0-1CF9,U+200C-200D,U+20A8,U+20B9,U+20F0,U+25CC,U+A830-A839,U+A8E0-A8FF,U+11B00-11B09" }],
});

// Exo 2 — latin, latin-ext, cyrillic, cyrillic-ext, vietnamese
const exo2Latin = localFont({
  src: "./fonts/exo-2-latin-wght-normal.woff2",
  weight: "100 900",
  style: "normal",
  declarations: [{ prop: "unicode-range", value: "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD" }],
});

const exo2LatinExt = localFont({
  src: "./fonts/exo-2-latin-ext-wght-normal.woff2",
  weight: "100 900",
  style: "normal",
  preload: false,
  adjustFontFallback: false,
  declarations: [{ prop: "unicode-range", value: "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF" }],
});

const exo2Cyrillic = localFont({
  src: "./fonts/exo-2-cyrillic-wght-normal.woff2",
  weight: "100 900",
  style: "normal",
  preload: false,
  adjustFontFallback: false,
  declarations: [{ prop: "unicode-range", value: "U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116" }],
});

const exo2CyrillicExt = localFont({
  src: "./fonts/exo-2-cyrillic-ext-wght-normal.woff2",
  weight: "100 900",
  style: "normal",
  preload: false,
  adjustFontFallback: false,
  declarations: [{ prop: "unicode-range", value: "U+0460-052F,U+1C80-1C8A,U+20B4,U+2DE0-2DFF,U+A640-A69F,U+FE2E-FE2F" }],
});

const exo2Vietnamese = localFont({
  src: "./fonts/exo-2-vietnamese-wght-normal.woff2",
  weight: "100 900",
  style: "normal",
  preload: false,
  adjustFontFallback: false,
  declarations: [{ prop: "unicode-range", value: "U+0102-0103,U+0110-0111,U+0128-0129,U+0168-0169,U+01A0-01A1,U+01AF-01B0,U+0300-0301,U+0303-0304,U+0308-0309,U+0323,U+0329,U+1EA0-1EF9,U+20AB" }],
});

// Inter — latin, latin-ext, cyrillic, cyrillic-ext, greek, greek-ext, vietnamese
const interLatin = localFont({
  src: "./fonts/inter-latin-wght-normal.woff2",
  weight: "100 900",
  style: "normal",
  declarations: [{ prop: "unicode-range", value: "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD" }],
});

const interLatinExt = localFont({
  src: "./fonts/inter-latin-ext-wght-normal.woff2",
  weight: "100 900",
  style: "normal",
  preload: false,
  adjustFontFallback: false,
  declarations: [{ prop: "unicode-range", value: "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF" }],
});

const interCyrillic = localFont({
  src: "./fonts/inter-cyrillic-wght-normal.woff2",
  weight: "100 900",
  style: "normal",
  preload: false,
  adjustFontFallback: false,
  declarations: [{ prop: "unicode-range", value: "U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116" }],
});

const interCyrillicExt = localFont({
  src: "./fonts/inter-cyrillic-ext-wght-normal.woff2",
  weight: "100 900",
  style: "normal",
  preload: false,
  adjustFontFallback: false,
  declarations: [{ prop: "unicode-range", value: "U+0460-052F,U+1C80-1C8A,U+20B4,U+2DE0-2DFF,U+A640-A69F,U+FE2E-FE2F" }],
});

const interGreek = localFont({
  src: "./fonts/inter-greek-wght-normal.woff2",
  weight: "100 900",
  style: "normal",
  preload: false,
  adjustFontFallback: false,
  declarations: [{ prop: "unicode-range", value: "U+0370-0377,U+037A-037F,U+0384-038A,U+038C,U+038E-03A1,U+03A3-03FF" }],
});

const interGreekExt = localFont({
  src: "./fonts/inter-greek-ext-wght-normal.woff2",
  weight: "100 900",
  style: "normal",
  preload: false,
  adjustFontFallback: false,
  declarations: [{ prop: "unicode-range", value: "U+1F00-1FFF" }],
});

const interVietnamese = localFont({
  src: "./fonts/inter-vietnamese-wght-normal.woff2",
  weight: "100 900",
  style: "normal",
  preload: false,
  adjustFontFallback: false,
  declarations: [{ prop: "unicode-range", value: "U+0102-0103,U+0110-0111,U+0128-0129,U+0168-0169,U+01A0-01A1,U+01AF-01B0,U+0300-0301,U+0303-0304,U+0308-0309,U+0323,U+0329,U+1EA0-1EF9,U+20AB" }],
});

// JetBrains Mono — latin, latin-ext, cyrillic, cyrillic-ext, greek, vietnamese
const jetbrainsMonoLatin = localFont({
  src: "./fonts/jetbrains-mono-latin-wght-normal.woff2",
  weight: "100 800",
  style: "normal",
  declarations: [{ prop: "unicode-range", value: "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD" }],
});

const jetbrainsMonoLatinExt = localFont({
  src: "./fonts/jetbrains-mono-latin-ext-wght-normal.woff2",
  weight: "100 800",
  style: "normal",
  preload: false,
  adjustFontFallback: false,
  declarations: [{ prop: "unicode-range", value: "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF" }],
});

const jetbrainsMonoCyrillic = localFont({
  src: "./fonts/jetbrains-mono-cyrillic-wght-normal.woff2",
  weight: "100 800",
  style: "normal",
  preload: false,
  adjustFontFallback: false,
  declarations: [{ prop: "unicode-range", value: "U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116" }],
});

const jetbrainsMonoCyrillicExt = localFont({
  src: "./fonts/jetbrains-mono-cyrillic-ext-wght-normal.woff2",
  weight: "100 800",
  style: "normal",
  preload: false,
  adjustFontFallback: false,
  declarations: [{ prop: "unicode-range", value: "U+0460-052F,U+1C80-1C8A,U+20B4,U+2DE0-2DFF,U+A640-A69F,U+FE2E-FE2F" }],
});

const jetbrainsMonoGreek = localFont({
  src: "./fonts/jetbrains-mono-greek-wght-normal.woff2",
  weight: "100 800",
  style: "normal",
  preload: false,
  adjustFontFallback: false,
  declarations: [{ prop: "unicode-range", value: "U+0370-0377,U+037A-037F,U+0384-038A,U+038C,U+038E-03A1,U+03A3-03FF" }],
});

const jetbrainsMonoVietnamese = localFont({
  src: "./fonts/jetbrains-mono-vietnamese-wght-normal.woff2",
  weight: "100 800",
  style: "normal",
  preload: false,
  adjustFontFallback: false,
  declarations: [{ prop: "unicode-range", value: "U+0102-0103,U+0110-0111,U+0128-0129,U+0168-0169,U+01A0-01A1,U+01AF-01B0,U+0300-0301,U+0303-0304,U+0308-0309,U+0323,U+0329,U+1EA0-1EF9,U+20AB" }],
});

// Orbitron — latin
const orbitronLatin = localFont({
  src: "./fonts/orbitron-latin-wght-normal.woff2",
  weight: "400 900",
  style: "normal",
  declarations: [{ prop: "unicode-range", value: "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD" }],
});

/**
 * Les cinq variables de police du site, posées sur `<body>` par la mise en
 * page racine. Mêmes noms qu'avec `next/font/google` : aucune feuille n'a eu à
 * changer.
 */
export const FONT_VARIABLES = {
  "--font-title": fontStack([rajdhaniLatin, rajdhaniLatinExt, rajdhaniDevanagari]),
  "--font-body": fontStack([exo2Latin, exo2LatinExt, exo2Cyrillic, exo2CyrillicExt, exo2Vietnamese]),
  "--font-sans": fontStack([interLatin, interLatinExt, interCyrillic, interCyrillicExt, interGreek, interGreekExt, interVietnamese]),
  "--font-mono": fontStack([jetbrainsMonoLatin, jetbrainsMonoLatinExt, jetbrainsMonoCyrillic, jetbrainsMonoCyrillicExt, jetbrainsMonoGreek, jetbrainsMonoVietnamese]),
  "--font-display": fontStack([orbitronLatin]),
} as CSSProperties;
