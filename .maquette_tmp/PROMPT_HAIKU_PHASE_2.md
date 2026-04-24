# Prompt de démarrage — Phase 2 (Composants cyber réutilisables)

> Pré-requis : Phase 1 commitée (tokens cyber + polices additifs).
>
> Copier-coller le bloc ci-dessous dans une nouvelle session Claude Code
> (Haiku 4.5) à la racine du projet `C:\work\BlueGenji\appbluegenji`.

---

```
Tu travailles sur la refonte graphique « Cyber minimal » de BlueGenji.

LIS D'ABORD :
1. CLAUDE.md
2. .maquette_tmp/bluegenji-arena/project/styles.css (sections "Pill / tag",
   "Buttons", "Card", "Layout helpers")
3. .maquette_tmp/bluegenji-arena/project/app.jsx (HeaderBar, Hero,
   LiveCard, TournamentBoard, LeaderCal — pour voir l'usage réel)
4. .maquette_tmp/bluegenji-arena/project/page.css (sections live-card,
   match, mini-bracket, countdown, ticker)

VÉRIFICATION D'ENTRÉE :
- Confirme que app/globals.css contient bien le bloc CYBER-MINIMAL TOKENS
  avec --ink, --blue-500, --line-soft, --r-cy-md, --glow, --density, et
  les classes .eyebrow, .pill, .pill-live, .card-ticks.
- Confirme que app/layout.tsx expose --font-sans, --font-mono,
  --font-display.
- Si l'un manque : STOP, signale-le-moi, n'essaie pas de patcher.

OBJECTIF (Phase 2 — primitives cyber dans un namespace dédié) :

Crée le dossier `components/cyber/` et les fichiers suivants. Chacun
=> un .tsx + un .module.css. Les composants doivent être utilisables
côté Server Component par défaut (pas de "use client" sauf si state/effet
nécessaire — précisé ci-dessous).

1. components/cyber/Pill.tsx + Pill.module.css
   - Server Component.
   - Props : { variant?: "default" | "live" | "blue";
               children: ReactNode; className?: string }
   - Réutilise les classes globales .pill / .pill-live / .pill-blue
     (déjà déclarées en Phase 1) en composant via tailwind-merge (cn
     helper) : `cn("pill", variant === "live" && "pill-live", ...)`.
   - Pour variant="live", rend en plus <span className="dot"/> avant
     les children.
   - Pas de styles propres dans Pill.module.css au-delà de fixes mineurs
     si nécessaire.

2. components/cyber/CyberCard.tsx + CyberCard.module.css
   - Server Component.
   - Props : { lift?: boolean; ticks?: boolean;
               as?: "div" | "section" | "article";
               className?: string; children: ReactNode;
               style?: CSSProperties }
   - Style local (CyberCard.module.css) :
       .root  : background linear-gradient(180deg, var(--cyber-bg-1),
                var(--cyber-bg)) ; border 1px solid var(--line-soft) ;
                border-radius var(--r-cy-lg) ; position relative ;
                overflow hidden.
       .lift  : transition border-color .2s, transform .2s ;
                hover -> border-color rgba(90,200,255,0.3).
   - ticks=true => ajouter la classe globale "card-ticks" (déjà déclarée
     Phase 1) à côté de styles.root.

3. components/cyber/CyberButton.tsx + CyberButton.module.css
   - Client OU Server selon usage. Par défaut Server.
   - Props : { variant?: "primary" | "ghost"; asChild?: boolean;
               className?: string; children: ReactNode }
     + spread des HTMLButtonAttributes.
   - asChild via @radix-ui/react-slot (déjà en deps).
   - .root : inline-flex, gap 8px, padding 11px 18px,
             border-radius var(--r-cy-md), font-family var(--font-sans),
             weight 500, font-size 13px, letter-spacing 0.01em,
             cursor pointer, border 1px solid transparent,
             transition transform/background/border .15s.
   - .primary : background var(--blue-500), color #001520,
                box-shadow 0 0 0 1px rgba(90,200,255,0.35),
                          0 calc(10px*var(--glow)) calc(40px*var(--glow))
                          rgba(90,200,255, calc(0.2*var(--glow))).
                hover -> transform translateY(-1px).
   - .ghost   : background transparent, border-color var(--line-strong-cy),
                color var(--ink). hover -> border var(--blue-500),
                color var(--blue-300).

4. components/cyber/TeamSigil.tsx + TeamSigil.module.css
   - Server Component.
   - Props : { letter: string; color?: string; size?: 24 | 32 | 40 }
   - Carré size×size, border 1px solid var(--c) où --c est color (par
     défaut var(--blue-500)), color var(--c), border-radius 4 ou 6px,
     font-family var(--font-display), font-weight 600,
     background color-mix(in oklab, var(--c) 8%, transparent),
     display grid place-items center.
   - Passe la couleur via style={{ "--c": color } as CSSProperties}.

5. components/cyber/CountdownStrip.tsx + CountdownStrip.module.css
   - "use client".
   - Props : { targetISO: string; label?: string }
   - Hook interne useCountdown(targetISO) reproduisant la logique du
     app.jsx maquette lignes 46-60 (setInterval 1s, parts d/h/m/s
     padStart(2,"0"), cleanup au unmount).
   - Render : flex, 4 .cd-unit chacun avec .cd-val (font-size 22px,
     mono) et .cd-lbl (J/H/M/S, font-size 9px letter-spacing 0.2em,
     color var(--ink-mute)).

6. components/cyber/Ticker.tsx + Ticker.module.css
   - Server Component (l'animation est CSS).
   - Props : { items: string[] }
   - Render :
     <div className={styles.ticker}>
       <div className={styles.track}>
         {[...items, ...items].map(...)}  // double pour boucle continue
       </div>
     </div>
   - .ticker : border-top/bottom var(--line-soft),
               background rgba(0,0,0,0.5), height 38px, overflow hidden,
               position relative.
   - .track  : flex gap 48px, white-space nowrap, height 100%,
               align-items center, animation cy-tk 58s linear infinite,
               padding-left 48px.
   - @keyframes cy-tk : from translateX(0) -> to translateX(-50%).
   - Chaque item : font-mono 11px letter-spacing 0.16em var(--ink-mute),
     suivi d'un séparateur "◆" en var(--blue-500) margin-left 48px.

7. components/cyber/MiniBracket.tsx + MiniBracket.module.css
   - Server Component.
   - Props : { matches: { a: string; b: string;
                          sa: number | "—"; sb: number | "—" }[] }
   - Grille 2 colonnes, gap 10px (responsive : 1 colonne si <600px).
   - Chaque match : 2 lignes mb-row (a/sa puis b/sb). La ligne gagnante
     (score plus grand) reçoit la classe .win (color var(--ink),
     background rgba(90,200,255,0.06), score en var(--blue-300)).
   - Style à reprendre de page.css "mini-bracket" / ".mb-match" /
     ".mb-row.win".

8. components/cyber/index.ts
   - Réexporter Pill, CyberCard, CyberButton, TeamSigil, CountdownStrip,
     Ticker, MiniBracket.

9. PAGE DE PREVIEW (temporaire, sera supprimée en Phase 7)
   - Crée app/_dev/cyber-preview/page.tsx ("use client" pour pouvoir
     tester CountdownStrip et MiniBracket en interactif).
   - Layout simple sur fond var(--cyber-bg) :
     a) Bandeau Pills : default "BETA", live "LIVE EN COURS",
        blue "OW2".
     b) Bandeau Buttons : primary "Inscrire mon équipe",
        ghost "Voir le bracket".
     c) Bandeau TeamSigils : N (var(--blue-500)), S (var(--amber)),
        K (#8fd5ff), V (#b4c8d4).
     d) Grille 2x2 CyberCard : (sans options), (lift), (ticks),
        (lift + ticks). 24px padding, titre + paragraphe court.
     e) CountdownStrip avec targetISO = (now + 3 jours).toISOString().
     f) Ticker avec 5 items : "RÉSULTAT · X 3 — Y 1", "INSCRIPTIONS · X · 7/8",
        "PARTENARIAT · ANNONCE 30.04", "RECRUTEMENT · STAFF MR",
        "DISCORD · 4212 MEMBRES".
     g) MiniBracket avec 4 matchs (mock).

CONTRAINTES :
- Pas de modification de l'existant (composants Button.tsx, ButtonLink.tsx,
  ds-* dans globals.css restent intacts).
- Pas de couleur hex hardcodée hors #001520 (text-on-cyan du btn-primary,
  identique maquette) et hors les couleurs de signature passées en props
  TeamSigil dans la preview.
- Imports : utiliser le path alias @/components/cyber/...
- Toutes les classes globales (.pill, .card-ticks, etc.) viennent de
  Phase 1 ; n'invente pas de nouveaux noms globaux.

CRITÈRES D'ACCEPTATION :
- npm run lint && npm run build OK.
- http://localhost:3000/_dev/cyber-preview affiche tous les composants.
- Pill LIVE pulse rouge, Pill blue cyan glacé.
- CyberCard ticks affiche 4 petits coins cyan top-left et bottom-right.
- CyberButton primary halo cyan ajustable via :root { --glow: 1.5 }
  (testable depuis devtools).
- CountdownStrip décrémente chaque seconde sans warnings React.
- Ticker défile horizontalement en boucle continue.
- MiniBracket : la ligne gagnante est mise en évidence cyan.

Quand tu as fini, rapporte les fichiers créés et les sorties lint/build.
Ne committe pas. N'ouvre pas de prompts de confirmation pour npm.
```

---

## Après Phase 2

1. Vérifie visuellement chaque variante sur `/_dev/cyber-preview`.
2. Si OK : commit `feat(cyber): phase 2 — primitives Pill/Card/Button/Sigil/Countdown/Ticker/MiniBracket`.
3. Lance la Phase 3 (endpoints landing : `/api/landing/{stats,live,leaderboard,calendar,ticker}`).

> La page `/_dev/cyber-preview` reste en place jusqu'en Phase 7 pour
> valider les non-régressions visuelles.
