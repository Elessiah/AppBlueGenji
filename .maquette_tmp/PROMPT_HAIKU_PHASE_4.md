# Prompt de démarrage — Phase 4 (Refonte landing `/`)

> Pré-requis : Phases 1 → 3 commitées (tokens cyber, primitives
> `components/cyber/*`, endpoints `/api/landing/*`).
>
> Copier-coller le bloc ci-dessous dans une nouvelle session Claude Code
> (Haiku 4.5) à la racine du projet `C:\work\BlueGenji\appbluegenji`.

---

```
Tu travailles sur la refonte « Cyber minimal » de BlueGenji.

LIS D'ABORD :
1. CLAUDE.md (section « Refonte graphique en cours »).
2. .maquette_tmp/bluegenji-arena/project/app.jsx (fonctions HeaderBar,
   Hero, TournamentBoard, LeaderCal, About, Sponsors, JoinCTA,
   FooterBar) — SOURCE DE VÉRITÉ.
3. .maquette_tmp/bluegenji-arena/project/page.css (styles de la landing).
4. components/cyber/index.ts et tous les composants qu'il exporte
   (Pill, CyberCard, CyberButton, TeamSigil, CountdownStrip, Ticker,
   MiniBracket).
5. app/page.tsx actuel (version v0.3.0 — 3 features cards).
6. components/page-with-palette.tsx et lib/palette-context.tsx.

OBJECTIF (Phase 4 — refonte COMPLÈTE de la landing publique `/`) :

Remplacer intégralement le contenu de app/page.tsx par une landing
vitrine long-scroll qui consomme les endpoints /api/landing/* créés
en Phase 3. Structure fidèle à la maquette (app.jsx).

Conserver :
- Le wrapper <PageWithPalette palette="blue"> (pour cohérence avec
  le reste de l'app).
- Les Link href="/tournois" et href="/connexion" (routes existantes).
- L'usage de next/font déjà en place (pas de nouvelle police).

Remplacer :
- Tout le JSX interne par la composition ci-dessous.

────────────────────────────────────────────────────────────────────
ARCHITECTURE DES FICHIERS
────────────────────────────────────────────────────────────────────
app/page.tsx                          (Server Component, par défaut)
  -> appelle fetch côté serveur (Next cache) pour stats/live/leaderboard/
     calendar/ticker, passe en props aux sections.

components/cyber/landing/Hero.tsx                 ("use client" car contient LiveCard+Countdown)
components/cyber/landing/LiveCard.tsx             ("use client", fetch périodique SSE ou polling 5s)
components/cyber/landing/TournamentBoard.tsx      (Server Component)
components/cyber/landing/LeaderCal.tsx            (Server Component)
components/cyber/landing/Leaderboard.tsx          ("use client" pour chips filtres)
components/cyber/landing/CalendarCard.tsx         (Server Component)
components/cyber/landing/AboutSection.tsx         (Server Component)
components/cyber/landing/SponsorsGrid.tsx         (Server Component)
components/cyber/landing/JoinCTA.tsx              (Server Component)
components/cyber/landing/PublicHeader.tsx         (Server Component, nouvelle nav
                                                   publique sticky — NE remplace PAS ArenaNav)
components/cyber/landing/PublicFooter.tsx         (Server Component)

Chaque composant : `.tsx` + `.module.css`.

────────────────────────────────────────────────────────────────────
SPÉCIFICATIONS PAR SECTION
────────────────────────────────────────────────────────────────────

1. PublicHeader
   - Sticky top, backdrop-filter blur(14px), background rgba(5,8,12,0.82),
     border-bottom 1px var(--line-soft).
   - Gauche : logo SVG hexagonal (reproduire depuis app.jsx lignes
     70-76) + "BlueGenji" en .logotype + "ARENA · EST. 2023" en .mono
     var(--ink-mute) letter-spacing 0.18em.
   - Centre : nav 5 liens vers #tournois, #equipes, #calendrier, #assoc,
     #sponsors — color var(--ink-mute), hover var(--blue-300).
   - Droite : <CyberButton variant="ghost" asChild><Link href="/connexion">
     Connexion</Link></CyberButton> + <CyberButton variant="primary"
     asChild><Link href="/tournois">Rejoindre →</Link></CyberButton>.

2. Hero
   - Props : { stats: { players, teams, tournaments }, live: LivePayload | null }
   - Grid 2 colonnes (1.1fr / 1fr), gap 72px, padding 80px 0.
   - Fond <div className="fabric"/> en absolute inset 0.
   - Colonne gauche :
     * <span className="eyebrow">ASSOCIATION ESPORT · LOI 1901</span>
     * <h1 className="display" font-size clamp(48px, 7vw, 82px)> :
         "Organiser,\n jouer,\n <span className="hero-title-accent">
         gagner ensemble.</span>"
       hero-title-accent : linear-gradient(180deg, var(--blue-300),
       var(--blue-500)) + background-clip text.
     * Paragraphe lede 17px var(--ink-mute) : reprendre texte du
       app.jsx ligne 123-127.
     * Deux boutons : primary "Inscrire mon équipe" (Link /tournois)
       + ghost "Regarder le live" avec icône play.
     * Row de 3 stats (players/teams/tournaments) séparés par
       .hero-stat-sep (1px×32px var(--line-soft)). Chaque stat :
       .num 28px var(--blue-500) + .mono var(--ink-mute) 11px.
   - Colonne droite : <LiveCard live={live}/> + <CountdownStrip/>
     pour le prochain tournoi (premier upcoming reçu en props).

3. LiveCard
   - "use client". Props : { initialLive: LivePayload | null }.
   - Polling toutes les 10s vers /api/landing/live (AbortController
     pour cleanup).
   - Si live === null : rendre <CyberCard ticks> avec :
       "Aucun tournoi en direct. Le prochain démarre dans X jours."
   - Sinon : reproduire le bloc live-card du app.jsx lignes 158-199 :
       * En-tête : <Pill variant="live">LIVE</Pill>,
         "{game} · {phase}" en mono, viewers avec icône œil.
       * Titre tournoi en .mono 22px uppercase letter-spacing 0.04em.
       * Bloc .match : 2 .match-team (sigil via <TeamSigil>, name,
         seed fictif "FR · SEED N", score 30px) séparés par
         .match-vs "MATCH N · BOX" (X = BO3/BO5).
       * .live-map en bas : "CARTE EN COURS — {map}" sur border
         1px dashed. Pour v1 sans colonne map en DB, afficher "—".

4. TournamentBoard
   - Server Component. Fetch server-side via
     listTournamentBuckets() depuis lib/server/tournaments-service.
   - Grid : 1.4fr 1fr 1fr 1fr, gap 20px.
   - Première carte (span 2 lignes) : tournoi RUNNING si existe,
     sinon premier UPCOMING :
       * <Pill variant="live"> ou <Pill variant="blue">
       * eyebrow "OVERWATCH 2" (placeholder, brancher en Phase 6)
       * Titre 26px
       * Sous-titre phase (mono 10px var(--blue-300))
       * <MiniBracket matches={4 matchs} /> (depuis bg_matches du
         tournoi)
       * Footer : "CASH PRIZE" + <CyberButton primary>
         Voir le bracket →</CyberButton>
   - 3 cartes upcoming à droite :
       * <Pill variant="blue">OW2</Pill>
       * eyebrow game, titre 22px, .tc-meta 2 colonnes (DÉBUT, ÉQUIPES).
       * Barre de progression .tc-progress 2px (linear-gradient
         var(--blue-500) -> var(--blue-300)) à width
         (registeredTeams/maxTeams)*100%.
       * Footer : CASH PRIZE placeholder "—" + CyberButton ghost
         "S'inscrire" (Link /tournois/[id]).

5. LeaderCal
   - Server Component wrapper. Fetch /api/landing/leaderboard et
     /api/landing/calendar en parallèle (Promise.all via fetch avec
     `{ cache: "no-store" }` ou revalidate 300).
   - Grid 2 colonnes : <Leaderboard/> (1.25fr) + <CalendarCard/> (1fr),
     gap 24px.

6. Leaderboard
   - "use client" (chips filtre).
   - Props : { initialRows: LeaderboardRow[] }
   - State : game: "all" | "ow2" | "mr" (défaut "all").
   - Fetch /api/landing/leaderboard?game={game} au changement.
   - Header : "TOP ÉQUIPES" + 3 chips (classe .chip/.chip-on).
   - Table 5 colonnes (32px / 1fr / 70px / 60px / 36px) :
     #  / ÉQUIPE (sigil+nom) / V–D / PTS / TR.
   - Les 3 premières lignes portent une classe .top (rang en
     var(--blue-500)).
   - Trend : up=#6bd48a, down=#e87a7a, flat=var(--ink-dim).
     Affichage : "+{trendValue}" ou "-{trendValue}" ou "—".
   - Footer : lien mono "VOIR LE CLASSEMENT COMPLET →" vers /joueurs
     (ou /tournois pour v1).

7. CalendarCard
   - Server Component.
   - Props : { events: CalendarEvent[] }
   - Header : "PROCHAINS ÉVÉNEMENTS" + <a
     href="/api/landing/calendar?format=ics" download> en mono
     var(--blue-300) "ICS →".
   - Liste .cal-row : date(jour/mois en 3 lettres) / bar / label
     (pill OW2/MR + tag + titre) / time (mono var(--blue-300)).
   - Utiliser formatLocalDateTime de lib/shared/dates pour le jour
     et l'heure.

8. AboutSection
   - Server Component. Contenu statique.
   - Grid 2 colonnes gap 48px.
   - Gauche :
     * lede 22px : "Une structure associative à but non lucratif,
       gérée par des bénévoles passionnés. On organise des tournois
       accessibles, bien arbitrés, avec des cash prizes réinvestis
       dans la scène amateur française."
     * 4 stats : 100% Bénévole, €4 200 Prizepool 2025, 12 Arbitres,
       0 € Frais d'inscription.
   - Droite : 3 piliers (Accessible / Compétitif / Communautaire)
     textes du app.jsx lignes 439-442.

9. SponsorsGrid
   - Server Component.
   - Props : { names: string[] }
   - 6 slots (aspect-ratio 3/1), border 1px var(--line-soft), radius
     var(--r-cy-md). Placeholder hachuré SVG au centre + nom en .mono
     var(--ink-mute) letter-spacing 0.2em.
   - Pour v1, hardcoder : ["LOGITECH G", "CORSAIR", "CROUS LYON",
     "LDLC", "OVH CLOUD", "RAZER"]. Ce sera remplacé par une table
     bg_sponsors en Phase 5.

10. JoinCTA
    - Server Component.
    - <CyberCard ticks> padding 48px, border-color rgba(90,200,255,0.22),
      <div className="fabric" opacity 0.8/>.
    - Contenu : eyebrow "REJOINDRE LA SCÈNE", h3 display 40px
      "Ton équipe. Notre bracket.\n Le prochain tournoi commence
      maintenant." (dernière ligne en var(--blue-500)), paragraphe,
      2 CTA primary "Créer un compte" (Link /connexion) + ghost
      "Rejoindre le Discord" (lien externe).

11. PublicFooter
    - 4 colonnes (COMPÉTITIONS / COMMUNAUTÉ / ASSOCIATION / LÉGAL)
      identique au FooterBar du app.jsx lignes 524-570.
    - Colonne brand à gauche avec logo SVG + nom asso + texte
      "Association loi 1901..." + SIRET/RNA en .mono var(--ink-dim).
    - Bottom strip : "© 2026 BLUEGENJI · TOUS DROITS RÉSERVÉS" et
      "BUILT WITH ♠ IN LYON" séparés par space-between.

────────────────────────────────────────────────────────────────────
STRUCTURE FINALE DE app/page.tsx
────────────────────────────────────────────────────────────────────

export const revalidate = 60;

export default async function HomePage() {
  const [statsRes, liveRes, leaderRes, calRes, tickerRes, bucketsRes] =
    await Promise.all([
      fetch(`${APP_URL}/api/landing/stats`,         { next: { revalidate: 60 } }),
      fetch(`${APP_URL}/api/landing/live`,          { cache: "no-store" }),
      fetch(`${APP_URL}/api/landing/leaderboard`,   { next: { revalidate: 300 } }),
      fetch(`${APP_URL}/api/landing/calendar`,      { next: { revalidate: 300 } }),
      fetch(`${APP_URL}/api/landing/ticker`,        { next: { revalidate: 60 } }),
      // Pour TournamentBoard : appeler listTournamentBuckets directement
      // (évite un round-trip HTTP).
    ]);
  // ... parsing .json(), fallbacks sur erreur.

  return (
    <PageWithPalette palette="blue">
      <PublicHeader />
      <Hero stats={stats} live={live} nextUpcoming={buckets.upcoming[0]} />
      <Ticker items={ticker.items} />
      <TournamentBoard buckets={buckets} />
      <LeaderCal leaderboard={leaderboard} events={events} />
      <AboutSection />
      <SponsorsGrid />
      <JoinCTA />
      <PublicFooter />
    </PageWithPalette>
  );
}

APP_URL : utiliser `process.env.APP_URL ?? "http://localhost:3000"`.

────────────────────────────────────────────────────────────────────
CONTRAINTES
────────────────────────────────────────────────────────────────────
- NE PAS TOUCHER : ArenaNav, components/page-with-palette.tsx,
  PaletteProvider, ToastProvider, routes /(secured)/*, /connexion,
  /association, /bot, /api/* existantes.
- Le Background3D reste actif (il est dans app/layout.tsx). Rendre
  les sections AU-DESSUS en z-index 1.
- Tous les textes en français.
- Pas de Tailwind utility classes.
- Pas de dépendance externe nouvelle.
- Gestion d'erreur : si un fetch échoue, afficher la section en mode
  dégradé (ex : LiveCard -> card "Aucun tournoi en direct") plutôt
  que crasher la page.

────────────────────────────────────────────────────────────────────
CRITÈRES D'ACCEPTATION
────────────────────────────────────────────────────────────────────
- npm run lint && npm run build -> success.
- http://localhost:3000/ affiche toutes les sections dans l'ordre.
- Hero responsive (colonne unique sous 900px).
- LiveCard met à jour les viewers toutes les 10s (ouvrir devtools
  Network pour vérifier).
- Leaderboard : cliquer sur "Overwatch 2" change l'URL de fetch en
  ?game=ow2 (visible Network).
- CalendarCard : cliquer sur "ICS →" télécharge bluegenji.ics.
- Tous les composants cyber préexistants (Phase 2) sont utilisés
  (Pill, CyberCard, CyberButton, TeamSigil, CountdownStrip, Ticker,
  MiniBracket).

Quand tu as fini, rapporte :
- Liste exhaustive des fichiers créés/modifiés.
- Captures mentales (texte) des 3 premières sections observées dans
  ton rendu (si tu peux lancer le dev, sinon skip).
- Sorties lint/build.

Ne committe pas. N'ouvre pas de prompts de confirmation npm.
```

---

## Après Phase 4

Commit `feat(cyber): phase 4 — refonte landing publique`.
Phase 5 : refonte `/association` + nouvelle page `/partenaires`.
