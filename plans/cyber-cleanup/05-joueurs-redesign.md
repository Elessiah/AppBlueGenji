# Étape 5 — Refonte de la page `/joueurs`

## Objectif

Refaire entièrement `app/(secured)/joueurs/page.tsx` en suivant `joueurs.jsx` (maquette). Accent **bleu `#5ac8ff`** (rgb `90, 200, 255`). Implémenter les fonctionnalités manquantes : équipe affichée sur la carte, rôles (DPS/TANK/HEAL/COACH/CAP), nombre de tournois joués, V–D, jeux pratiqués (OW2/MR), tag pays.

## Données disponibles dans la maquette vs. réalité

| Champ maquette | Source dans le projet | Action |
|---|---|---|
| `pseudo` | `bg_users.pseudo` | ✅ |
| `avatar` | `bg_users.avatar_url` | ✅ |
| `team` (nom) | `bg_team_members` JOIN `bg_teams` (avec `left_at IS NULL`) | ✅ — à ajouter |
| `teamColor` | dérivé de `team_id` | ✅ — calcul TS, pas en DB |
| `roles` (DPS/TANK/HEAL/COACH/CAP) | `bg_team_members.roles_json` | ✅ — déjà stocké, mapper TANK/DPS/HEAL/COACH/CAP |
| `status` (online/ingame/offline) | ❌ pas tracké | ⚠️ omettre OU figer à `"offline"`. Le plan : **omettre l'indicateur** complètement de la carte (la maquette a `pl-status` en haut à droite — on le laisse vide / on retire le bloc) |
| `games` (OW2/MR) | dérivé : présence d'un `overwatch_battletag` ou `marvel_rivals_tag` | ✅ |
| `rank` (Diamant III…) | ❌ pas tracké | ⚠️ omettre — afficher `—` ou simplement retirer la stat |
| `w` / `l` | dérivé : matchs joués via les équipes du joueur (utiliser sa team courante OU historique) | ⚠️ Simplification : afficher 0/0 si pas de matchs trackés. Possible : compter les matchs gagnés/perdus par TOUTES les équipes du joueur. |
| `kd` | ❌ pas tracké | ⚠️ omettre — afficher `—` ou retirer la stat |
| `tournaments` | dérivé : `COUNT DISTINCT tournament_id` via `bg_tournament_registrations` joints aux équipes du joueur | ✅ |
| `country` | ❌ pas tracké | ⚠️ omettre OU défault `"FR"` |

**Décision** : pour rester honnête, retirer du composant les stats `rank`, `kd`, `country` (le statut online aussi). Garder uniquement `pseudo`, `avatar`, `team` (avec couleur), `roles`, `games`, `tournaments`, `wins`, `losses`. Mettre une mention discrète "Statistiques in-game à venir" en footer si on veut garder la place visuelle des stats — sinon ne montrer que les 2 cellules `Tournois` et `V – D` sur la carte.

## Partie A — Backend

### A.1 — Étendre `lib/shared/types.ts`

```ts
export type PlayerRole = "OWNER" | "CAPITAINE" | "MANAGER" | "COACH" | "TANK" | "DPS" | "HEAL";

export type PublicUserProfile = {
  id: number;
  pseudo: string;
  avatarUrl: string | null;
  overwatchBattletag: string | null;
  marvelRivalsTag: string | null;
  isAdult: boolean | null;
  visibility: VisibilitySettings;
  createdAt: string;
  // Nouveaux champs (dérivés)
  team: {
    id: number;
    name: string;
    colorIndex: number; // 0..N → la palette est mappée côté client
  } | null;
  roles: PlayerRole[];          // Vide si free agent
  games: ("OW2" | "MR")[];      // Présence d'un tag pour ce jeu
  tournamentsCount: number;     // Distinct tournaments via team memberships
  wins: number;
  losses: number;
};
```

### A.2 — Étendre `lib/server/users-service.ts` — `listPlayers()`

Réécrire en joignant `bg_team_members`, `bg_teams`, `bg_tournament_registrations`, `bg_matches`. Approche conseillée — N+1 acceptable car volume bas :

1. SELECT principal sur `bg_users` (déjà en place).
2. Pour chaque player, en SQL groupé (un seul aller-retour ou deux) :
   - Membership courante : `SELECT team_id, name, roles_json FROM bg_team_members JOIN bg_teams ON ... WHERE user_id IN (?...) AND left_at IS NULL`.
   - Tournois count : `SELECT user_id, COUNT(DISTINCT tr.tournament_id) FROM bg_team_members tm JOIN bg_tournament_registrations tr ON tr.team_id = tm.team_id WHERE tm.user_id IN (?...) GROUP BY user_id`.
   - Wins/losses : `SELECT user_id, ...` agrégé sur les matchs des équipes du joueur (via `bg_team_members` avec `joined_at <= match.played_at AND (left_at IS NULL OR left_at >= match.played_at)`). Si trop complexe, simplifier en : V/L de la team **courante** (rapide).

> Pragmatique : si les V/L par joueur sont coûteux/complexes à calculer correctement, **renvoyer 0/0** pour l'instant et laisser un TODO commentant la simplification. L'objectif principal est d'avoir le visuel maquette correct.

`games` : `["OW2"]` si `overwatch_battletag` non null, `["MR"]` si `marvel_rivals_tag` non null, les deux si les deux.

`roles` : `parseRoles(roles_json)` côté serveur depuis l'enregistrement de `bg_team_members`. Tableau vide si aucune membership active.

`team` : objet (id, name) ou `null`. `colorIndex` = `id % 7`.

### A.3 — Vérifier `app/api/players/route.ts`

Pas de changement (renvoie déjà `listPlayers()`).

## Partie B — Frontend

### B.1 — Créer `app/(secured)/joueurs/cards/PlayerCard.tsx`

```tsx
"use client";

import Image from "next/image";
import Link from "next/link";
import type { PublicUserProfile } from "@/lib/shared/types";
import s from "./PlayerCard.module.css";

const TEAM_COLORS = ["#5ac8ff", "#ff9d2e", "#a773ff", "#4fe0a2", "#ff4d5e", "#8fd5ff", "#f5a524"];

function colorFromIndex(i: number) {
  return TEAM_COLORS[i % TEAM_COLORS.length];
}

const ROLE_CLASS: Record<string, string> = {
  DPS: s.roleDps,
  TANK: s.roleTank,
  HEAL: s.roleHeal,
  COACH: s.roleCoach,
  CAPITAINE: s.roleCap,
  OWNER: s.roleCap,
};

const ROLE_LABEL: Record<string, string> = {
  DPS: "DPS",
  TANK: "TANK",
  HEAL: "HEAL",
  COACH: "COACH",
  CAPITAINE: "CAP",
  OWNER: "OWNER",
  MANAGER: "MANAGER",
};

export function PlayerCard({ player }: { player: PublicUserProfile }) {
  const teamColor = player.team ? colorFromIndex(player.team.colorIndex) : "var(--ink-mute)";

  return (
    <Link href={`/joueurs/${player.id}`} className={s.card}>
      <div className={s.head}>
        <div className={s.avatarWrap}>
          <div className={s.avatar}>
            {player.avatarUrl ? (
              <Image
                src={player.avatarUrl}
                alt={player.pseudo}
                width={64}
                height={64}
                unoptimized
                referrerPolicy="no-referrer"
              />
            ) : (
              <span className={s.avatarFallback}>{player.pseudo[0].toUpperCase()}</span>
            )}
          </div>
        </div>
        <div className={s.pseudo}>{player.pseudo}</div>
        <div className={s.team}>
          {player.team ? (
            <>
              ROSTER · <em style={{ color: teamColor }}>{player.team.name.toUpperCase()}</em>
            </>
          ) : (
            <span style={{ color: "var(--ink-dim)" }}>FREE AGENT</span>
          )}
        </div>
      </div>

      {player.roles.length > 0 && (
        <div className={s.roles}>
          {player.roles.slice(0, 4).map((r) => (
            <span key={r} className={`${s.role} ${ROLE_CLASS[r] || ""}`}>
              {ROLE_LABEL[r] || r}
            </span>
          ))}
        </div>
      )}

      <div className={s.stats}>
        <div>
          <div className={s.statLbl}>Tournois</div>
          <div className={s.statVal}>{player.tournamentsCount}</div>
        </div>
        <div>
          <div className={s.statLbl}>V – D</div>
          <div className={s.statVal}>
            {player.wins}–{player.losses}
          </div>
        </div>
      </div>

      {player.games.length > 0 && (
        <div className={s.tags}>
          {player.games.map((g) => (
            <span key={g} className={`${s.tag} ${g === "OW2" ? s.tagOw : s.tagMr}`}>
              {g}
            </span>
          ))}
        </div>
      )}
    </Link>
  );
}
```

### B.2 — Créer `app/(secured)/joueurs/cards/PlayerCard.module.css`

Reprendre `pl-card`, `pl-head`, `pl-avatar-wrap`, `pl-avatar`, `pl-avatar-fallback`, `pl-pseudo`, `pl-team`, `pl-roles`, `pl-role` (+ `dps`, `tank`, `heal`, `coach`, `cap`), `pl-stats`, `pl-stat-lbl`, `pl-stat-val`, `pl-tags`, `pl-tag` (+ `ow`, `mr`) depuis `equipes-joueurs.css` (lignes 539-705). Renommer en camelCase pour CSS Module.

Adaptations :
- Retirer `.pl-status` et son bloc — on n'affiche pas le statut online.
- `.pl-stats` doit avoir `grid-template-columns: repeat(2, 1fr)` (au lieu de 4 dans la maquette) puisqu'on n'a que 2 stats.
- Garder les ticks d'angle bleu (`#5ac8ff`).

### B.3 — Réécrire `app/(secured)/joueurs/page.tsx`

```tsx
"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { PublicUserProfile, PlayerRole } from "@/lib/shared/types";
import { useToast } from "@/components/ui/toast";
import { Ticker } from "@/components/cyber/Ticker";
import { BgCanvas } from "../_shared/BgCanvas";
import { PlayerCard } from "./cards/PlayerCard";
import s from "../_shared/annuaire.module.css";

const ACCENT_RGB = "90, 200, 255";

type RoleFilter = "all" | "DPS" | "TANK" | "HEAL" | "COACH";
type StatusFilter = "all" | "free";
type SortKey = "pseudo" | "tournaments";

const TICKER_ITEMS = [
  "ANNUAIRE · Profils mis à jour quotidiennement",
  "ROSTER · Inscris-toi dans une équipe pour participer",
  "TOURNOIS · Candidatures ouvertes pour les prochaines saisons",
];

export default function PlayersPage() {
  const { showError } = useToast();
  const [players, setPlayers] = useState<PublicUserProfile[]>([]);
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sort, setSort] = useState<SortKey>("pseudo");

  useEffect(() => {
    fetch("/api/players", { cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json()) as { error?: string; players?: PublicUserProfile[] };
        if (!response.ok || !payload.players) {
          throw new Error(payload.error || "PLAYERS_LOAD_FAILED");
        }
        setPlayers(payload.players);
      })
      .catch((e) => showError((e as Error).message));
  }, [showError]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let r = players.filter((p) => {
      if (q && !`${p.pseudo} ${p.team?.name || ""}`.toLowerCase().includes(q)) return false;
      if (roleFilter !== "all" && !p.roles.includes(roleFilter as PlayerRole)) return false;
      if (statusFilter === "free" && p.team) return false;
      return true;
    });
    r = [...r];
    if (sort === "pseudo") r.sort((a, b) => a.pseudo.localeCompare(b.pseudo, "fr"));
    if (sort === "tournaments") r.sort((a, b) => b.tournamentsCount - a.tournamentsCount);
    return r;
  }, [players, query, roleFilter, statusFilter, sort]);

  const freeAgents = players.filter((p) => !p.team).length;
  const ow2Count = players.filter((p) => p.games.includes("OW2")).length;
  const mrCount = players.filter((p) => p.games.includes("MR")).length;

  const accentStyle = {
    "--g-rgb": ACCENT_RGB,
    "--g-300": "#8fd5ff",
    "--g-500": "#5ac8ff",
  } as React.CSSProperties;

  return (
    <div style={accentStyle}>
      <BgCanvas rgb={ACCENT_RGB} />

      <header className={s.page}>
        <div className={s.fabric} />
        <div className={`container ${s.pageInner}`}>
          <div className={s.pageHead}>
            <div>
              <span className="eyebrow">COMMUNAUTÉ · ANNUAIRE</span>
              <h1 className={s.title}>
                Joueurs <em>BlueGenji</em>
              </h1>
              <div className={s.subtitle}>PROFILS · STATISTIQUES · DISPONIBILITÉ</div>
            </div>
            <Link href="/profil" className={s.cta}>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path
                  d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM2 14a6 6 0 0 1 12 0"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
              Mon profil
            </Link>
          </div>

          <div className={s.metrics}>
            <div className={s.metric}>
              <div className={s.metricNum}>
                <em>{players.length}</em>
              </div>
              <div className={s.metricLbl}>Profils référencés</div>
            </div>
            <div className={s.metric}>
              <div className={s.metricNum}>{freeAgents}</div>
              <div className={s.metricLbl}>Free agents · sans roster</div>
            </div>
            <div className={s.metric}>
              <div className={s.metricNum}>{ow2Count}</div>
              <div className={s.metricLbl}>Joueurs Overwatch 2</div>
            </div>
            <div className={s.metric}>
              <div className={s.metricNum}>{mrCount}</div>
              <div className={s.metricLbl}>Joueurs Marvel Rivals</div>
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
                placeholder="Rechercher un pseudo, une équipe…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <span className={s.searchKbd}>⌘K</span>
            </div>
            <div className={s.filters}>
              {([
                ["all", "Tous"],
                ["DPS", "DPS"],
                ["TANK", "Tank"],
                ["HEAL", "Heal"],
                ["COACH", "Coach"],
              ] as const).map(([k, l]) => (
                <button
                  key={k}
                  className={`${s.chip} ${roleFilter === k ? s.chipOn : ""}`}
                  onClick={() => setRoleFilter(k)}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>

          <div className={s.sortRow}>
            <div style={{ display: "flex", gap: 18, alignItems: "center" }}>
              <span>{filtered.length} joueur{filtered.length > 1 ? "s" : ""}</span>
              <span style={{ color: "var(--ink-dim)" }}>·</span>
              <div style={{ display: "flex", gap: 12 }}>
                {([
                  ["all", "Tous"],
                  ["free", "Free agents"],
                ] as const).map(([k, l]) => (
                  <button
                    key={k}
                    onClick={() => setStatusFilter(k)}
                    className={`${s.sortBtn} ${statusFilter === k ? s.sortBtnOn : ""}`}
                  >
                    {l.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
            <div className={s.sortOpts}>
              <span style={{ color: "var(--ink-dim)" }}>Trier :</span>
              {([
                ["pseudo", "Pseudo"],
                ["tournaments", "Tournois"],
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
        <div className={s.section}>
          <div className={s.sectionHead}>
            <span className={s.sectionIx}>01</span>
            <span className={s.sectionTtl}>
              PROFILS <span className={s.sectionAccent}>· COMMUNAUTÉ ACTIVE</span>
            </span>
            <span className={s.sectionCount}>{filtered.length} JOUEURS</span>
          </div>

          <div style={{ paddingTop: 24 }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(4, 1fr)",
                gap: 16,
              }}
            >
              {filtered.map((p) => (
                <PlayerCard key={p.id} player={p} />
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
```

> Responsive : le grid 4 colonnes doit passer à 3 colonnes < 1080px et 1 colonne < 720px. Soit on le fait via media query inline dans `PlayerCard.module.css` (ajouter une classe wrapper de grille), soit on déplace le grid dans le CSS Module `annuaire.module.css` sous une classe dédiée `.plGrid`. **Recommandation** : créer dans `annuaire.module.css` les classes `tmGrid` (3 cols → 2 → 1) et `plGrid` (4 cols → 3 → 1) et les utiliser dans les pages. Mettre à jour aussi `04-equipes-redesign.md` côté implémenteur.

### B.4 — Vérifier que `lib/shared/types.ts` exporte `PlayerRole`

Si déjà couvert par `TeamRole`, réexporter ou aligner.

## Critères d'acceptation

- L'API `/api/players` retourne pour chaque joueur : `team`, `roles`, `games`, `tournamentsCount`, `wins`, `losses`.
- La page `/joueurs` affiche :
  - Hero + 4 métriques (Profils, Free agents, OW2, MR)
  - Recherche + filtres rôle (Tous/DPS/Tank/Heal/Coach)
  - Sous-filtres status (Tous / Free agents)
  - Tri (Pseudo / Tournois)
  - Grille 4 colonnes de cartes joueurs
  - Carte : avatar 64×64 (initiale en fallback), pseudo, mention équipe (couleur dérivée de `colorIndex`) ou FREE AGENT, badges rôles colorés, 2 stats (Tournois / V–D), pills jeux
  - Ticks d'angle bleu, hover bleu
- Nav : `Joueurs` actif avec barre bleue 2px en bas.
- Build + lint OK, pas d'erreur TS.

## Risques

- `roles_json` peut être au format texte non-JSON dans des données legacy → utiliser `parseRoles()` qui gère ça.
- Les counts par joueur peuvent être faussés si un joueur a quitté une équipe pendant qu'elle gagnait — on accepte cette approximation. Documenter via un commentaire court dans la fonction SQL.
- L'image `next/image` peut bloquer sur des domaines externes si le `remotePatterns` n'est pas configuré → utiliser `unoptimized` (déjà dans le code) suffit.
