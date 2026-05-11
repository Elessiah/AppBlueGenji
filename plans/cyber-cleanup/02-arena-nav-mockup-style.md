# Étape 2 — Refonte de la navigation `(secured)` selon la maquette

## Objectif

Remplacer `components/arena-nav.tsx` par la version maquette : 3 onglets mono à gauche (Joueurs / Équipes / Tournois), logo central avec anneaux animés, lien `⌂ Accueil` + chip avatar à droite. L'onglet actif affiche **une barre 2px en bas** dans la couleur du segment, avec un petit losange (puce 6×6 rotation 45°) à gauche du label, glow paramétrable.

Référence visuelle exacte : `equipes-joueurs.css` lignes 6-107 (`.t-nav`, `.t-nav-link`, `.t-nav-logo`, `.t-nav-home`, `.t-avatar-chip`).

## Fichiers à modifier / créer

### 2.1 — Créer `components/arena-nav.module.css`

Nouveau module CSS dédié (les règles actuelles dans `globals.css` sous `.nav-shell`, `.nav-link`, `.avatar-chip` sont à conserver pour rétrocompat **ou** à supprimer si non utilisées ailleurs — vérifier avec grep).

Coller le contenu adapté depuis `equipes-joueurs.css` (lignes 6-107) en mode CSS Module — préfixer toutes les classes locales (`.nav`, `.navInner`, `.navLeft`, `.navLink`, `.navLinkActive`, `.navLogo`, `.navRight`, `.navHome`, `.avatarChip`). Conserver les `var(--font-mono)`, `var(--blue-300)`, `var(--blue-500)`, `var(--line-soft)`, `var(--cyber-bg)` qui existent déjà dans `globals.css`.

Points clés :
- `.nav` → `position: sticky; top: 0; z-index: 50; background: rgba(7,10,16,0.82); backdrop-filter: blur(14px);` + `border-bottom: 1px solid var(--line-soft);`
- `.navInner` → `display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; padding: 14px 0; gap: 24px;`
- `.navLeft` → `display: flex; gap: 28px;`
- `.navLink` → mono 11px, letter-spacing 0.2em, uppercase, color `var(--ink-mute)`, padding 8px 0, `::before` losange 6×6 border 1px courant + `transform: rotate(45deg)`.
- `.navLink:hover` et `.navLinkActive` → `color: rgb(var(--nav-rgb));`
- `.navLinkActive::before` → fill couleur, glow box-shadow.
- `.navLinkActive::after` → barre 2px en bas (`bottom: -15px; left:0; right:0; height:2px;`) avec glow.
- `.navLogo` → 52×52, border 1px `rgba(90,200,255,0.25)`, anneaux pseudo-éléments rotation infinie (`ringSpin 18s` + `28s reverse`).
- `.navRight` → flex right gap 16px.
- `.navHome` → mono 11px, padding 8px 14px, border `var(--line-strong-cy)`, hover bleu.
- `.avatarChip` → pill arrondi avec image 30×30.

Ajouter le keyframe `@keyframes ringSpin { to { transform: rotate(360deg); } }`.

### 2.2 — Réécrire `components/arena-nav.tsx`

```tsx
"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogoWithGlow } from "./logo-with-glow";
import s from "./arena-nav.module.css";

type ArenaNavProps = {
  pseudo: string;
  avatarUrl: string | null;
};

const links = [
  { href: "/joueurs", label: "Joueurs", rgb: "90, 200, 255" },
  { href: "/equipes", label: "Équipes", rgb: "255, 157, 46" },
  { href: "/tournois", label: "Tournois", rgb: "79, 224, 162" },
];

export function ArenaNav({ pseudo, avatarUrl }: ArenaNavProps) {
  const pathname = usePathname();

  return (
    <nav className={s.nav}>
      <div className={`container ${s.navInner}`}>
        <div className={s.navLeft}>
          {links.map((link) => {
            const isActive =
              pathname === link.href || pathname.startsWith(`${link.href}/`);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`${s.navLink} ${isActive ? s.navLinkActive : ""}`}
                style={{ "--nav-rgb": link.rgb } as React.CSSProperties}
              >
                {link.label}
              </Link>
            );
          })}
        </div>

        <Link href="/" className={s.navLogo} aria-label="Accueil">
          <LogoWithGlow
            src="/logo_bg.webp"
            alt="BlueGenji"
            width={32}
            height={32}
            size="sm"
            borderRadius={8}
            borderColor="rgba(0,0,0,0)"
          />
        </Link>

        <div className={s.navRight}>
          <Link href="/" className={s.navHome}>⌂ Accueil</Link>
          <Link href="/profil" className={s.avatarChip}>
            <Image
              src={avatarUrl || "/vercel.svg"}
              alt="Avatar"
              width={30}
              height={30}
              unoptimized
              referrerPolicy="no-referrer"
            />
            <span>{pseudo}</span>
          </Link>
        </div>
      </div>
    </nav>
  );
}
```

> **Note `LogoWithGlow`** : si `size="sm"` n'existe pas, passer `width={32} height={32}` directement et adapter à la taille existante. L'objectif visuel est un logo dans un cadre 52×52 (le wrapper `.navLogo` fait 52×52, le SVG/image à l'intérieur 32×32).

### 2.3 — Nettoyage `app/globals.css`

Si les classes `.nav-shell`, `.nav-links`, `.nav-link`, `.avatar-chip` (et leurs variantes) ne sont plus consommées qu'à travers l'ancienne `arena-nav.tsx`, les supprimer.

Vérifier :
```bash
grep -rn "nav-shell\|nav-link\b\|nav-links\|avatar-chip" app components --include="*.tsx" --include="*.css"
```

Si seuls les fichiers nav consomment ces classes, retirer leur définition dans `globals.css`. Sinon (utilisé par d'autres pages ex. landing), laisser intact.

### 2.4 — `app/(secured)/layout.tsx`

Aucun changement structurel : il rend déjà `<ArenaNav pseudo={user.pseudo} avatarUrl={user.avatarUrl} />`. Vérifier que le wrapper `<main className="page-shell">` ne casse pas le sticky de la nav. Si oui, sortir la nav du `page-shell` et n'appliquer `page-shell` qu'à `{children}` :

```diff
  return (
-    <main className="page-shell">
-      <ArenaNav pseudo={user.pseudo} avatarUrl={user.avatarUrl} />
-      {children}
-    </main>
+    <>
+      <ArenaNav pseudo={user.pseudo} avatarUrl={user.avatarUrl} />
+      <main className="page-shell">{children}</main>
+    </>
  );
```

## Critères d'acceptation

- En naviguant sur `/joueurs`, `/equipes`, `/tournois` :
  - 3 onglets s'affichent à gauche, mono caps, espacés de 28px.
  - L'onglet actif est coloré (bleu / orange / vert selon le segment), avec un losange plein à gauche et **une barre 2px en bas**.
  - Le logo central est dans un cadre 52×52 avec deux anneaux qui tournent lentement.
  - À droite : bouton `⌂ Accueil` + chip avatar arrondi.
- Le scroll garde la nav sticky avec backdrop-filter blur.
- Pas de régression sur la nav publique (landing, association, partenaires) — celle-ci utilise `PublicHeader`/`PublicFooter`, indépendants.

## Risques

- L'ancienne `nav-shell` était dans `globals.css` et gérait la position absolute/sticky. Si l'on supprime ces règles trop vite, des layouts de pages secured peuvent casser. À vérifier visuellement page par page.
- `LogoWithGlow` peut imposer une taille minimum — si nécessaire, créer un mini SVG inline équivalent à celui de la maquette (lignes 223-228 de `tournois.jsx` : path hexagone + path inner shape + circle).
