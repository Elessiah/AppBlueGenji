# Étape 4 — Refonte de la page `/equipes`

## Objectif

Refaire entièrement `app/(secured)/equipes/page.tsx` en suivant `equipes.jsx` (maquette). Accent **orange `#ff9d2e`** (rgb `255, 157, 46`). Implémenter les fonctionnalités manquantes côté API/types pour alimenter les cartes : rang, points, V/D, form (10 derniers matchs), roster avatars, jeux pratiqués.

## Partie A — Backend

### A.1 — Étendre `lib/shared/types.ts`

```ts
export type TeamListItem = {
  id: number;
  name: string;
  logoUrl: string | null;
  membersCount: number;
  createdAt: string;
  // Nouveaux champs
  rank: number;                      // Position au classement (1 = meilleure)
  points: number;                    // Points cumulés (3 par victoire, 1 par défaite)
  wins: number;
  losses: number;
  form: ("w" | "l" | "d")[];         // 10 derniers résultats, plus récent en dernier
  games: ("OW2" | "MR")[];           // Jeux que l'équipe a pratiqués (au moins une inscription tournoi)
  rosterPreview: { userId: number; pseudo: string; avatarUrl: string | null }[]; // Max 6
  region: string | null;             // Pas tracké → toujours null pour l'instant
};
```

### A.2 — Étendre `lib/server/teams-service.ts` — `listTeams()`

Réécrire la fonction pour calculer les nouveaux champs en SQL (le moins de queries possible). Suggestion :

1. Une requête principale pour les équipes + agrégats (members_count, wins, losses, points) basés sur `bg_matches` joints aux registrations.
2. Une seconde requête qui renvoie les 10 derniers matchs par équipe (utiliser `ROW_NUMBER() OVER (PARTITION BY team_id ORDER BY played_at DESC)` si MySQL 8 le supporte — c'est le cas selon `CLAUDE.md`).
3. Une troisième pour les rosters (limite 6 membres par équipe, ordre `joined_at ASC`).
4. Une quatrième pour les jeux pratiqués (`SELECT DISTINCT t.game FROM bg_tournament_registrations tr JOIN bg_tournaments t ON t.id = tr.tournament_id WHERE tr.team_id = ?`).

> Si la complexité SQL devient excessive, faire les agrégats en TS après plusieurs SELECT simples — l'effectif d'équipes reste petit (< 100). Privilégier la lisibilité.

Pseudocode du calcul de victoires/défaites (s'appuyer sur la table `bg_matches`) :
- Une victoire = `winner_team_id = team.id`
- Une défaite = match terminé (`status = 'COMPLETED'`) avec `team_a_id = team.id` ou `team_b_id = team.id` ET `winner_team_id != team.id` ET `winner_team_id IS NOT NULL`.
- Points = `wins * 3 + losses * 1`.
- Le **rang** est calculé en TypeScript après tri par `points DESC, wins DESC, name ASC` puis `index + 1`.

`form` : remplir avec les 10 derniers résultats de matches `COMPLETED`. Pour chaque match, `"w"` si winner = team, `"l"` sinon. Si moins de 10, padder à droite avec rien (tableau plus court — la maquette gère le `flex: 1` sur chaque cellule).

> ⚠️ Si `bg_matches` n'a pas encore de données réelles dans la base, retourner `wins=0, losses=0, points=0, form=[], rank` calculé naïvement par ordre alphabétique. **Ne pas crasher** — toutes les colonnes doivent renvoyer une valeur valide.

`games` : `["OW2", "MR"]` selon les inscriptions. Si aucune inscription, tableau vide → la maquette gère.

`rosterPreview` : `SELECT u.id, u.pseudo, u.avatar_url FROM bg_team_members tm JOIN bg_users u ON u.id = tm.user_id WHERE tm.team_id = ? AND tm.left_at IS NULL ORDER BY tm.joined_at ASC LIMIT 6`.

### A.3 — Vérifier l'API `/api/teams`

Le `route.ts` n'a pas besoin de changer — il appelle juste `listTeams()`.

### A.4 — Tests

Si une suite de tests existe sous `tests/` qui couvre `teams-service`, l'adapter. Sinon, ajouter un test rapide qui vérifie la forme de retour (présence de tous les nouveaux champs).

```bash
npm test -- teams-service
```

## Partie B — Frontend

### B.1 — Créer `app/(secured)/equipes/cards/TeamCard.tsx`

```tsx
"use client";

import Image from "next/image";
import Link from "next/link";
import type { TeamListItem } from "@/lib/shared/types";
import s from "./TeamCard.module.css";

const TEAM_COLORS = ["#5ac8ff", "#ff9d2e", "#a773ff", "#4fe0a2", "#ff4d5e", "#8fd5ff", "#f5a524"];

function colorFor(id: number) {
  return TEAM_COLORS[id % TEAM_COLORS.length];
}

export function TeamCard({ team }: { team: TeamListItem }) {
  const color = colorFor(team.id);
  const isTop3 = team.rank <= 3;

  return (
    <Link href={`/equipes/${team.id}`} className={s.card} style={{ "--c": color } as React.CSSProperties}>
      <div className={`${s.rank} ${isTop3 ? s.rankTop : ""}`}>
        #{String(team.rank).padStart(2, "0")}
      </div>

      <div className={s.head}>
        <div className={s.sigil} style={{ "--c": color } as React.CSSProperties}>
          {team.name[0].toUpperCase()}
        </div>
        <div className={s.nameWrap}>
          <div className={s.name}>{team.name}</div>
          <div className={s.tag}>
            {team.name.slice(0, 3).toUpperCase()}
            {team.region && ` · ${team.region}`}
          </div>
        </div>
      </div>

      {team.form.length > 0 && (
        <div className={s.formBar} title="10 derniers matchs">
          {team.form.map((r, i) => (
            <div key={i} className={`${s.formCell} ${s[r]}`} />
          ))}
        </div>
      )}

      <div className={s.stats}>
        <div>
          <div className={s.statLbl}>Pts</div>
          <div className={s.statVal}>{team.points}</div>
        </div>
        <div>
          <div className={s.statLbl}>Vict.</div>
          <div className={`${s.statVal} ${s.win}`}>{team.wins}</div>
        </div>
        <div>
          <div className={s.statLbl}>Déf.</div>
          <div className={`${s.statVal} ${s.loss}`}>{team.losses}</div>
        </div>
      </div>

      <div className={s.roster}>
        <span className={s.rosterLbl}>Roster</span>
        {team.rosterPreview.slice(0, 5).map((m) =>
          m.avatarUrl ? (
            <Image
              key={m.userId}
              src={m.avatarUrl}
              alt={m.pseudo}
              width={26}
              height={26}
              unoptimized
              referrerPolicy="no-referrer"
              className={s.avatar}
            />
          ) : (
            <div key={m.userId} className={s.avatar}>{m.pseudo[0].toUpperCase()}</div>
          )
        )}
        {team.rosterPreview.length > 5 && (
          <div className={`${s.avatar} ${s.avatarMore}`}>+{team.rosterPreview.length - 5}</div>
        )}
      </div>

      {team.games.length > 0 && (
        <div className={s.games}>
          {team.games.map((g) => (
            <span key={g} className={`${s.gamePill} ${g === "OW2" ? s.ow : s.mr}`}>
              {g === "OW2" ? "Overwatch 2" : "Marvel Rivals"}
            </span>
          ))}
        </div>
      )}

      <div className={s.foot}>
        <span className={s.footMeta}>
          FONDÉE · {new Date(team.createdAt).toLocaleDateString("fr-FR", { month: "short", year: "numeric" }).toUpperCase()}
        </span>
        <span className={s.cta}>Voir l'équipe →</span>
      </div>
    </Link>
  );
}
```

### B.2 — Créer `app/(secured)/equipes/cards/TeamCard.module.css`

Reprendre les styles `.tm-card`, `.tm-rank`, `.tm-card-head`, `.tm-sigil`, `.tm-name`, `.tm-tag`, `.tm-stats`, `.tm-stat-*`, `.tm-roster`, `.tm-avatar`, `.tm-games`, `.tm-game-pill`, `.tm-foot`, `.tm-foot-meta`, `.tm-cta`, `.tm-form-bar`, `.tm-form-cell` depuis `equipes-joueurs.css` (lignes 327-536). Renommer en camelCase pour CSS Module.

Variables CSS attendues : `--c` (color de l'équipe), tokens globaux (`--cyber-bg-1`, `--line-soft`, `--blue-300`, etc.). L'accent orange est codé en dur dans ce fichier (la maquette utilise `#ff9d2e` directement pour les ticks d'angle, le `tm-rank.top`, le `tm-tag`, le `tm-cta`).

### B.3 — Créer `app/(secured)/equipes/cards/HighlightStrip.tsx`

```tsx
import type { TeamListItem } from "@/lib/shared/types";
import s from "./HighlightStrip.module.css";

export function HighlightStrip({ teams }: { teams: TeamListItem[] }) {
  const top = teams.slice(0, 3);
  if (top.length < 3) return null;

  return (
    <div className={s.strip}>
      {top.map((t) => (
        <div key={t.id} className={s.card} data-rank={t.rank}>
          <div className={s.rank}>{String(t.rank).padStart(2, "0")}</div>
          <div>
            <div className={s.name}>{t.name}</div>
            <div className={s.meta}>
              {t.wins}V – {t.losses}D{t.region ? ` · ${t.region}` : ""}
            </div>
          </div>
          <div>
            <div className={s.pts}>{t.points}</div>
            <div className={s.ptsLbl}>PTS</div>
          </div>
        </div>
      ))}
    </div>
  );
}
```

CSS Module à créer en parallèle, repris de `.highlight-strip`, `.highlight-card`, `.highlight-rank`, `.highlight-name`, `.highlight-meta`, `.highlight-pts`, `.highlight-pts-lbl` (lignes 707-778 de `equipes-joueurs.css`).

### B.4 — Réécrire `app/(secured)/equipes/page.tsx`

```tsx
"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { TeamListItem } from "@/lib/shared/types";
import { useToast } from "@/components/ui/toast";
import { Ticker } from "@/components/cyber/Ticker";
import { BgCanvas } from "../_shared/BgCanvas";
import { TeamCard } from "./cards/TeamCard";
import { HighlightStrip } from "./cards/HighlightStrip";
import s from "../_shared/annuaire.module.css";

const ACCENT_RGB = "255, 157, 46";
const ACCENT_300 = "#ffc18a";
const ACCENT_500 = "#ff9d2e";

type GameFilter = "all" | "ow2" | "mr";
type SortKey = "rank" | "name" | "wins" | "members";

const TICKER_ITEMS = [
  "ROSTER · Annuaire mis à jour quotidiennement",
  "CLASSEMENT · Calculé sur l'ensemble des matchs validés",
  "COMMUNAUTÉ · Inscris ton équipe pour rejoindre la saison",
];

export default function TeamsPage() {
  const { showError } = useToast();
  const [teams, setTeams] = useState<TeamListItem[]>([]);
  const [activeTeam, setActiveTeam] = useState<{ teamId: number; teamName: string } | null>(null);
  const [query, setQuery] = useState("");
  const [gameFilter, setGameFilter] = useState<GameFilter>("all");
  const [sort, setSort] = useState<SortKey>("rank");

  useEffect(() => {
    fetch("/api/teams", { cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json()) as {
          error?: string;
          teams?: TeamListItem[];
          activeTeam?: { teamId: number; teamName: string } | null;
        };
        if (!response.ok || !payload.teams) {
          throw new Error(payload.error || "TEAMS_LOAD_FAILED");
        }
        setTeams(payload.teams);
        setActiveTeam(payload.activeTeam || null);
      })
      .catch((e) => showError((e as Error).message));
  }, [showError]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let r = teams.filter((t) => {
      if (q && !`${t.name} ${t.region || ""}`.toLowerCase().includes(q)) return false;
      if (gameFilter === "all") return true;
      if (gameFilter === "ow2") return t.games.includes("OW2");
      if (gameFilter === "mr") return t.games.includes("MR");
      return true;
    });
    r = [...r];
    if (sort === "rank") r.sort((a, b) => a.rank - b.rank);
    if (sort === "name") r.sort((a, b) => a.name.localeCompare(b.name, "fr"));
    if (sort === "wins") r.sort((a, b) => b.wins - a.wins);
    if (sort === "members") r.sort((a, b) => b.membersCount - a.membersCount);
    return r;
  }, [teams, query, gameFilter, sort]);

  const totalMembers = teams.reduce((s, t) => s + t.membersCount, 0);
  const countOw2 = teams.filter((t) => t.games.includes("OW2")).length;
  const countMr = teams.filter((t) => t.games.includes("MR")).length;

  const accentStyle = {
    "--g-rgb": ACCENT_RGB,
    "--g-300": ACCENT_300,
    "--g-500": ACCENT_500,
  } as React.CSSProperties;

  return (
    <div style={accentStyle}>
      <BgCanvas rgb={ACCENT_RGB} />

      <header className={s.page}>
        <div className={s.fabric} />
        <div className={`container ${s.pageInner}`}>
          <div className={s.pageHead}>
            <div>
              <span className="eyebrow">COMMUNAUTÉ · ROSTERS</span>
              <h1 className={s.title}>
                Équipes <em>BlueGenji</em>
              </h1>
              <div className={s.subtitle}>ANNUAIRE · ROSTERS · CLASSEMENT GÉNÉRAL</div>
            </div>
            {!activeTeam && (
              <Link href="/equipes/creer" className={s.cta}>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                  <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
                Créer une équipe
              </Link>
            )}
          </div>

          <div className={s.metrics}>
            <div className={s.metric}>
              <div className={s.metricNum}>
                <em>{teams.length}</em>
              </div>
              <div className={s.metricLbl}>Équipes actives</div>
            </div>
            <div className={s.metric}>
              <div className={s.metricNum}>{totalMembers}</div>
              <div className={s.metricLbl}>Joueurs sous roster</div>
            </div>
            <div className={s.metric}>
              <div className={s.metricNum}>{countOw2}</div>
              <div className={s.metricLbl}>Équipes Overwatch 2</div>
            </div>
            <div className={s.metric}>
              <div className={s.metricNum}>{countMr}</div>
              <div className={s.metricLbl}>Équipes Marvel Rivals</div>
            </div>
          </div>

          <div className={s.toolbar}>
            <div className={s.search}>
              <span className={s.searchIcon}>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                  <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.4" />
                  <path d="M11 11l3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                </svg>
              </span>
              <input
                placeholder="Rechercher une équipe, un tag, une région…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <span className={s.searchKbd}>⌘K</span>
            </div>
            <div className={s.filters}>
              {([
                ["all", "Toutes", teams.length],
                ["ow2", "Overwatch 2", countOw2],
                ["mr", "Marvel Rivals", countMr],
              ] as const).map(([k, label, n]) => (
                <button
                  key={k}
                  className={`${s.chip} ${gameFilter === k ? s.chipOn : ""}`}
                  onClick={() => setGameFilter(k)}
                >
                  {label}
                  <span className="num">{n}</span>
                </button>
              ))}
            </div>
          </div>

          <div className={s.sortRow}>
            <span>{filtered.length} équipe{filtered.length > 1 ? "s" : ""}</span>
            <div className={s.sortOpts}>
              <span style={{ color: "var(--ink-dim)" }}>Trier :</span>
              {([
                ["rank", "Classement"],
                ["name", "Nom"],
                ["wins", "Victoires"],
                ["members", "Effectif"],
              ] as const).map(([k, l]) => (
                <button
                  key={k}
                  className={`${s.sortBtn} ${sort === k ? s.sortBtnOn : ""}`}
                  onClick={() => setSort(k)}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>
        </div>
      </header>

      <Ticker items={TICKER_ITEMS} />

      <section className={`container ${s.sections}`}>
        {sort === "rank" && filtered.length >= 3 && <HighlightStrip teams={filtered} />}

        <div className={s.section}>
          <div className={s.sectionHead}>
            <span className={s.sectionIx}>01</span>
            <span className={s.sectionTtl}>
              ROSTERS <span className={s.sectionAccent}>· SAISON ACTUELLE</span>
            </span>
            <span className={s.sectionCount}>{filtered.length} ÉQUIPES</span>
          </div>

          <div style={{ paddingTop: 24 }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, 1fr)",
                gap: 18,
              }}
            >
              {filtered.map((t) => (
                <TeamCard key={t.id} team={t} />
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
```

> Le `Ticker` existant dans `components/cyber/Ticker.tsx` doit accepter un prop `items: string[]`. Vérifier sa signature — si différente, adapter.

### B.5 — Vérifier `components/cyber/Ticker.tsx`

Si la signature ne matche pas (ex : `items?: string[]`), tout va bien. Sinon, l'aligner. Le visuel cible : barre 36px de hauteur, défilement horizontal infini.

### B.6 — Page `/equipes/creer`

Pas de modification structurelle — la page existe. Vérifier juste qu'elle hérite bien du nouveau layout (la nav refaite à l'étape 2 s'applique automatiquement par le `(secured)/layout.tsx`).

## Critères d'acceptation

- L'API `/api/teams` retourne pour chaque équipe : `rank`, `points`, `wins`, `losses`, `form`, `games`, `rosterPreview`. La forme de la réponse doit valider à la compilation TS.
- La page `/equipes` affiche :
  - Hero avec titre + 4 métriques
  - Recherche + 3 filtres jeu (Toutes / Overwatch 2 / Marvel Rivals)
  - Sortie de tri (Classement, Nom, Victoires, Effectif)
  - Highlight strip top 3 quand sort = rank
  - Grille 3 colonnes de cartes équipes (responsive : 2 colonnes < 1080px, 1 colonne < 720px)
  - Chaque carte affiche : rang, sigil coloré, nom, tag, barre de forme 10 cellules, stats (Pts/V/D), roster avatars, pills jeux, date fondation, CTA "Voir l'équipe"
  - Ticks d'angle orange (`#ff9d2e`) sur la carte, hover orange
- La nav refait à l'étape 2 montre `Équipes` avec barre orange en bas.
- `npm run lint` et `npm run build` passent.
- Aucun `useSetPalette`, aucun `cta-float-home` ni `Background3D`.

## Risques

- Calculs SQL des V/D peuvent être longs si beaucoup de matchs — ajouter index sur `bg_matches.winner_team_id` et `(team_a_id, team_b_id, status)` si la perf devient un problème (probablement OK pour < 1000 matchs).
- `bg_team_members.left_at IS NULL` doit être respecté partout pour ne pas compter d'anciens membres.
- Si `bg_matches` n'existe pas encore comme table peuplée, **ne pas lever d'erreur** — retourner 0/[] partout.
