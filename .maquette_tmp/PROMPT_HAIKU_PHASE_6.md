# Prompt de démarrage — Phase 6 (Refonte pages `/(secured)/*`)

> Pré-requis : Phases 1 → 5 commitées (landing complète, /association,
> /partenaires, tokens, primitives, endpoints).
>
> Copier-coller le bloc ci-dessous dans une nouvelle session Claude Code
> (Haiku 4.5) à la racine du projet `C:\work\BlueGenji\appbluegenji`.

---

```
Tu travailles sur la refonte « Cyber minimal » de BlueGenji.

LIS D'ABORD :
1. CLAUDE.md — sections Architecture, Tournament Engine, Live Updates,
   Conventions.
2. .maquette_tmp/bluegenji-arena/project/app.jsx (TournamentBoard,
   LeaderCal, match rendering — inspiration).
3. .maquette_tmp/bluegenji-arena/project/page.css (styles tourney-card,
   match, mini-bracket, leader-table).
4. app/(secured)/layout.tsx — pour comprendre l'enforcement auth.
5. app/(secured)/tournois/page.tsx, /[id]/page.tsx, /creer/page.tsx.
6. app/(secured)/equipes/page.tsx, /[id]/page.tsx, /creer/page.tsx.
7. app/(secured)/joueurs/page.tsx, /[id]/page.tsx.
8. app/(secured)/profil/page.tsx.
9. components/arena-nav.tsx (nav sécurisée existante).
10. components/cyber/* (toutes les primitives Phase 2).

OBJECTIF (Phase 6) :
Refondre les pages secured en langage cyber-minimal **SANS toucher à
la logique fonctionnelle**. Les pages gardent leur rôle (auth, data
fetch, actions), seul le rendu change. Les chips `<Pill>`, cards
`<CyberCard>`, boutons `<CyberButton>`, sigils `<TeamSigil>`, tables
en `.num`/`.mono` remplacent les `ds-block`/`.tournament-card`/`.btn`/
`.ds-chip` existants au fil du rendu.

────────────────────────────────────────────────────────────────────
A. MULTI-JEU — MIGRATION bg_tournaments
────────────────────────────────────────────────────────────────────
Dans lib/server/database.ts, runMigrations, ajouter APRÈS la table
bg_tournaments (pas DANS, pour que l'auto-migration l'applique aux
installations existantes) :

  await db.execute(`
    ALTER TABLE bg_tournaments
    ADD COLUMN IF NOT EXISTS game ENUM('OW2', 'MR') NOT NULL DEFAULT 'OW2'
    AFTER description
  `);

  // MySQL 8 supporte IF NOT EXISTS sur ADD COLUMN depuis 8.0.29.
  // Si la version est antérieure, wrapper dans un try/catch qui
  // inspecte l'erreur "Duplicate column name" et l'ignore.

Mettre à jour lib/shared/types.ts :
  export type TournamentGame = "OW2" | "MR";
  export type TournamentCard = { ... existant ...; game: TournamentGame };

Mettre à jour lib/server/tournaments-service.ts :
  - SELECT ajoute la colonne game.
  - createTournament accepte `game: TournamentGame` (défaut "OW2").
  - Mapper game dans listTournamentBuckets et tournamentDetail.

Mettre à jour app/api/tournaments/route.ts (POST) pour accepter
`body.game` (validation : "OW2" | "MR", défaut "OW2").

────────────────────────────────────────────────────────────────────
B. app/(secured)/layout.tsx — AJOUTER HEADER PUBLIC OPTIONNEL
────────────────────────────────────────────────────────────────────
NE PAS REMPLACER ArenaNav existant (la nav secured reste utile).
Vérifier simplement que le layout consume bien ToastProvider (il est
dans app/layout.tsx, donc hérité).

────────────────────────────────────────────────────────────────────
C. app/(secured)/tournois/page.tsx — REFONTE
────────────────────────────────────────────────────────────────────
Conserver : "use client", useToast, SearchBar (côté logique), fetch
/api/tournaments, buckets state, onSearch, PaletteProvider (palette
"blue" via useSetPalette au mount).

Remplacer le JSX :

  <Link href="/" className="cta-float-home home"> ... reste

  <section className="fade-in container">
    <div className="section-head">
      <div>
        <span className="eyebrow">PLATEFORME</span>
        <h1 className="display" style={{fontSize: 56}}>
          Tournois BlueGenji
        </h1>
        <p className="mono" style={{color: "var(--ink-mute)"}}>
          SUIVI TEMPS RÉEL · PHASES MULTIPLES
        </p>
      </div>
      <Link href="/tournois/creer">
        <CyberButton variant="primary">+ Créer un tournoi</CyberButton>
      </Link>
    </div>

    <SearchBar ... /> (inchangé, mais wrap dans style container)

    {(["upcoming", "registration", "running", "finished"] as const).map(key => (
      <TournamentBucketColumn key={key} ... items={buckets[key]}/>
    ))}
  </section>

TournamentBucketColumn (nouveau composant local dans le fichier) :
  - <CyberCard lift> par tournoi, remplace .tournament-card.
  - En-tête bucket : .eyebrow + titre + <Pill variant="blue">{count}</Pill>.
  - Collapse/expand conservé (state local).
  - Dans chaque carte :
      <div style={{display: "flex", justifyContent: "space-between"}}>
        <div>
          <Pill variant="blue">{tournament.game}</Pill> {/* OW2 ou MR */}
          <h3 className="display" style={{fontSize: 20}}>{name}</h3>
          <p className="mono" style={{color: "var(--ink-mute)"}}>
            {formatLocalDateTime(startAt)} · {format === "SINGLE" ? "Simple élim." : "Double élim."}
          </p>
        </div>
        <div style={{textAlign: "right"}}>
          <div className="num" style={{fontSize: 22}}>
            {registeredTeams}/{maxTeams}
          </div>
          <div className="mono" style={{color: "var(--ink-dim)"}}>ÉQUIPES</div>
        </div>
      </div>
      <div className="tc-progress">
        <div className="tc-progress-bar" style={{width: pct}}/>
      </div>

────────────────────────────────────────────────────────────────────
D. app/(secured)/tournois/[id]/page.tsx — REFONTE
────────────────────────────────────────────────────────────────────
Conserver l'intégralité de la logique (fetch detail, SSE via
EventSource vers /api/tournaments/[id]/stream, reportScore, register/
unregister, admin actions, etc.).

Remplacer le JSX haut de page :
  - Header : <Pill variant="live"> si state === "RUNNING", sinon
    <Pill variant="blue">{bucket}</Pill>.
  - Viewers (utiliser le listenerCount serveur via /api/landing/live
    ou exposer /api/tournaments/[id]/viewers — au choix, simple fallback
    si pas dispo).
  - Titre tournoi en .display 48px.
  - Countdown avant startAt via <CountdownStrip> si state === "UPCOMING"
    ou "REGISTRATION".

Bracket : conserver react-brackets OU la grille existante, mais
override CSS :
  .match-card -> background rgba(0,0,0,0.3), border 1px var(--line-soft)
  .team-line.win -> bg rgba(90,200,255,0.06), color var(--blue-300)
  .team-line.lose -> bg transparent, color var(--ink-mute)
  Score en .num var(--blue-300).

Ajouter en haut un bouton .ics :
  <CyberButton variant="ghost" asChild>
    <a href={`/api/landing/calendar?format=ics`} download>
      + Ajouter au calendrier
    </a>
  </CyberButton>

────────────────────────────────────────────────────────────────────
E. app/(secured)/tournois/creer/page.tsx — REFONTE
────────────────────────────────────────────────────────────────────
Form existant conservé. Restyler :
- Wrapper <CyberCard ticks>.
- Label + input : .field inchangé mais bordures var(--line-soft),
  focus var(--blue-500), font var(--font-sans).
- Ajouter un <select name="game"> avec options OW2 / MR.
- Bouton submit : <CyberButton primary type="submit">.

────────────────────────────────────────────────────────────────────
F. app/(secured)/equipes/page.tsx — REFONTE
────────────────────────────────────────────────────────────────────
- Header section identique à tournois (eyebrow + h1 + bouton Créer).
- Grille de teams : <CyberCard lift> pour chaque équipe avec :
    <TeamSigil letter={team.name[0]} color={colorFromId(team.id)}/>
    <h3>{team.name}</h3>
    <div className="num">{team.membersCount} membres</div>
    <div className="mono">{formatLocalDateTime(team.createdAt)}</div>

colorFromId : fonction utilitaire locale qui mappe un id à une
couleur parmi ["#5ac8ff", "#f5a524", "#8fd5ff", "#6bd48a", "#b4c8d4"].

────────────────────────────────────────────────────────────────────
G. app/(secured)/equipes/[id]/page.tsx — REFONTE
────────────────────────────────────────────────────────────────────
- Header : <TeamSigil size=40/> grande + nom équipe en .display 48px.
- Section Membres : table-like 4 colonnes avec <TeamSigil>+pseudo/
  roles en Pills (OWNER/CAPITAINE/...) / joinedAt en .mono / actions.
- Section Historique tournois : liste <CyberCard lift> avec name,
  game pill, rang final en .num var(--blue-500).
- Boutons actions (ajouter membre, renommer, dissoudre) :
  <CyberButton primary / ghost / danger>.

────────────────────────────────────────────────────────────────────
H. app/(secured)/equipes/creer/page.tsx — REFONTE
────────────────────────────────────────────────────────────────────
Form existant, restylé comme creer-tournoi.

────────────────────────────────────────────────────────────────────
I. app/(secured)/joueurs/page.tsx — REFONTE
────────────────────────────────────────────────────────────────────
- Grille de joueurs : <CyberCard lift>
    avatar (36px rounded) + pseudo .display 18px + .mono pseudo normalisé
    + pills jeux : <Pill variant="blue">OW2</Pill> si overwatchBattletag,
                   <Pill>MR</Pill> (variant ambre custom) si marvelRivalsTag
    + membre de : liste teams (si visible)

────────────────────────────────────────────────────────────────────
J. app/(secured)/joueurs/[id]/page.tsx — REFONTE
────────────────────────────────────────────────────────────────────
- Header : avatar 80px + pseudo .display 48px + pills jeux.
- Section Stats : 6 KPIs en .num var(--blue-500) + .mono var(--ink-mute).
  tournamentsPlayed / tournamentsWon / matchesWon / matchesLost /
  bestRank / averageRank.
- Section Équipes : timeline verticale (<CyberCard> avec joinedAt →
  leftAt et rôles en Pills).
- Section Tournois : historique identique à equipes/[id].

────────────────────────────────────────────────────────────────────
K. app/(secured)/profil/page.tsx — REFONTE
────────────────────────────────────────────────────────────────────
- Formulaire paramètres dans <CyberCard ticks> : avatar, pseudo,
  overwatchBattletag, marvelRivalsTag, visibility toggles, suppression
  de compte.
- Toggles visibility en 5 rangées avec <Coche> (composant existant
  components/Coche.tsx) + label mono.
- Bouton submit primary, bouton "Supprimer mon compte" danger (on
  conserve la classe .btn.danger pour l'accent rouge).

────────────────────────────────────────────────────────────────────
L. NE PAS TOUCHER
────────────────────────────────────────────────────────────────────
- ArenaNav (la nav secured reste fonctionnelle, restyler son CSS
  uniquement via override léger dans les pages si besoin).
- PaletteProvider, useToast, SearchBar (logique).
- Routes API /api/teams, /api/players, /api/profile, /api/tournaments/*.
- Bot, connexion (Phase 7).

────────────────────────────────────────────────────────────────────
CONTRAINTES
────────────────────────────────────────────────────────────────────
- Chaque page retestée manuellement : login, créer team, créer
  tournoi, s'inscrire, rapporter un score, voir profil, voir équipe,
  voir joueur.
- Les toasts utilisent toujours useToast() (vérifier que showError/
  showSuccess sont appelés comme avant, pas de rendu inline).
- Pas de régression fonctionnelle : tous les appels fetch existants
  conservés.
- TypeScript strict sans any.

────────────────────────────────────────────────────────────────────
CRITÈRES D'ACCEPTATION
────────────────────────────────────────────────────────────────────
- npm run lint && npm run build -> success.
- npm test -> pass (s'il y a des tests sur ces pages).
- Parcours manuel complet validé :
    /connexion -> login
    /joueurs -> liste + détail
    /equipes -> liste + création + détail
    /tournois -> liste + création + détail + inscription
    /profil -> modification + sauvegarde
- La colonne game existe en DB (SHOW COLUMNS FROM bg_tournaments
  pour vérifier).

Quand tu as fini, rapporte :
- Liste des pages modifiées.
- Liste des composants cyber nouvellement utilisés.
- Sorties lint/build/test.
- Captures textuelles du parcours manuel (ce que tu as observé).

Ne committe pas. N'ouvre pas de prompts de confirmation npm.
```

---

## Après Phase 6

Commit `feat(cyber): phase 6 — refonte secured pages + multi-jeu DB`.
Phase 7 : bot, connexion, polish, QA finale.
