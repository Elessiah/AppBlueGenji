# Édition des tournois — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettre au staff `tournaments` de modifier un tournoi après sa création — tout tant qu'il est invisible, le nom / la description / la clôture / le début / l'effectif à la hausse une fois publié.

**Architecture:** Un module pur `lib/shared/tournament-edit.ts` décide *ce qui* est modifiable (la « fenêtre »), un module serveur `lib/server/tournaments/edit.ts` applique la modification sous verrou, et `lib/server/tournaments/validation.ts` — extrait du POST existant — décide si les valeurs sont *saines*, pour la création comme pour l'édition. Côté interface, le formulaire de création est extrait en composant partagé et servi par une nouvelle page `/tournois/[id]/modifier`.

**Tech Stack:** Next.js 15 (App Router), React 18, TypeScript strict, MySQL 8 via `mysql2` (requêtes brutes, pas d'ORM), Jest.

## Global Constraints

- Spec de référence : `docs/superpowers/specs/2026-08-27-tournament-editing-design.md`. En cas de contradiction, la spec fait foi.
- Tout le texte d'interface est en **français**.
- Les messages d'erreur et de succès passent par `useToast()` de `@/components/ui/toast` (`showError` / `showSuccess`), en superposition bas-gauche — **jamais** en ligne dans la page.
- `lib/server/*` ne s'importe jamais depuis un composant client. `lib/shared/*` s'importe partout.
- Les routes protégées utilisent `can(user, "tournaments")` de `@/lib/shared/permissions` — jamais `user.isAdmin` directement.
- Toute zone défilante passe par `<ScrollArea>` de `@/components/cyber`.
- Alias de chemin : `@/*` → racine du projet.
- Chaque commit porte le trailer `Co-authored-by: Claude Opus 4.8 <noreply@anthropic.com>` (`git commit --trailer '...'`).
- Le worktree a besoin d'une copie du `.env` du dépôt parent (déjà en place, gitignoré). `DEV_AUTH_USER_ID` y vaut actuellement **743** (compte sans rôle) — le remettre à **589** (admin) avant toute vérification manuelle en préview.
- Commande de test unitaire : `npx jest <chemin>`. Suite complète : `npm test`.
- **Commits :** le TDD impose que test et implémentation arrivent ensemble ; les tâches 1 à 6 commitent donc chacune son couple test + code. Le pipeline de `CLAUDE.md` est respecté par les tâches 7 (commit docs) et 8 (commit polish), avant push et PR.

---

## Structure des fichiers

**Créés**

| Fichier | Responsabilité |
|---|---|
| `lib/shared/tournament-edit.ts` | Pur. Quelle fenêtre d'édition, quels champs, quelles violations. Aucune notion de HTTP ni de SQL. |
| `lib/server/tournaments/validation.ts` | Validation et normalisation d'une saisie de tournoi (création **et** édition). Aucune notion de HTTP. |
| `lib/server/tournaments/edit.ts` | Lecture des valeurs éditables et écriture sous verrou. |
| `app/api/tournaments/[id]/edit/route.ts` | `GET` (fenêtre + valeurs) et `PATCH` (modification). Traduit les erreurs métier en codes HTTP. |
| `app/(secured)/tournois/_components/TournamentForm.tsx` | Formulaire partagé création / édition. Ne connaît ni route ni fenêtre. |
| `app/(secured)/tournois/[id]/modifier/page.tsx` | Page de modification : charge, rend le formulaire, `PATCH`, retour à la fiche. |
| `docs/features/TOURNAMENT_EDITING.md` | Documentation de la fonctionnalité. |

**Modifiés**

| Fichier | Changement |
|---|---|
| `app/api/tournaments/route.ts` | Le bloc de validation du `POST` est remplacé par un appel à `validateTournamentInput`. |
| `lib/server/tournaments/index.ts` | `createTournament` appelle `validateDateOrder` au lieu de sa vérification en ligne. |
| `app/(secured)/tournois/creer/page.tsx` | Devient une coquille autour de `TournamentForm`. |
| `app/(secured)/tournois/[id]/page.tsx` | Bouton « Modifier » en tête de page. |
| `app/(secured)/tournois/[id]/_lib/error-map.ts` | Nouveaux codes d'erreur traduits. |
| `CLAUDE.md` | Une ligne dans la section « Tournament Engine ». |

---

## Task 1 : Règle d'édition (module pur)

**Files:**
- Create: `lib/shared/tournament-edit.ts`
- Test: `tests/lib/shared/tournament-edit.test.ts`

**Interfaces:**
- Consumes: `TournamentState` de `@/lib/shared/types`.
- Produces:
  - `type TournamentField` — union de 23 littéraux (liste exacte dans le code ci-dessous)
  - `type EditWindow = "FULL" | "RESTRICTED" | "LOCKED"`
  - `type EditLockReason = "VISIBLE" | "STARTED" | null`
  - `type EditableTournament = { state: TournamentState; startVisibilityAt: string; maxTeams: number }`
  - `const RESTRICTED_FIELDS: readonly TournamentField[]`
  - `const ALL_TOURNAMENT_FIELDS: readonly TournamentField[]`
  - `editWindowFor(t: EditableTournament, now?: number): EditWindow`
  - `editLockReason(t: EditableTournament, now?: number): EditLockReason`
  - `editableFieldsFor(t: EditableTournament, now?: number): ReadonlySet<TournamentField>`
  - `isFieldEditable(field: TournamentField, t: EditableTournament, now?: number): boolean`
  - `type EditViolation = { code: "FIELD_NOT_EDITABLE"; field: TournamentField } | { code: "MAX_TEAMS_CANNOT_DECREASE" } | { code: "REGISTRATION_CLOSE_IN_PAST" }`
  - `checkEditPatch(current: EditableTournament, patch: Partial<Record<TournamentField, unknown>>, now?: number): EditViolation | null`

- [ ] **Step 1 : Écrire le test qui échoue**

Créer `tests/lib/shared/tournament-edit.test.ts` :

```ts
import { describe, expect, it } from "@jest/globals";
import {
  RESTRICTED_FIELDS,
  checkEditPatch,
  editLockReason,
  editWindowFor,
  editableFieldsFor,
  isFieldEditable,
  type EditableTournament,
} from "@/lib/shared/tournament-edit";

const NOW = Date.parse("2026-08-27T12:00:00.000Z");
const iso = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();
const HOUR = 3600_000;

function tournament(over: Partial<EditableTournament> = {}): EditableTournament {
  return {
    state: "UPCOMING",
    startVisibilityAt: iso(24 * HOUR),
    maxTeams: 16,
    ...over,
  };
}

describe("editWindowFor", () => {
  it("ouvre tout tant que le tournoi n'est pas visible", () => {
    expect(editWindowFor(tournament(), NOW)).toBe("FULL");
    expect(editLockReason(tournament(), NOW)).toBeNull();
  });

  it("bascule en RESTRICTED à la seconde où la visibilité s'ouvre", () => {
    const t = tournament({ startVisibilityAt: iso(0) });
    expect(editWindowFor(t, NOW - 1)).toBe("FULL");
    expect(editWindowFor(t, NOW)).toBe("RESTRICTED");
    expect(editLockReason(t, NOW)).toBe("VISIBLE");
  });

  it("reste RESTRICTED pendant les inscriptions", () => {
    const t = tournament({ state: "REGISTRATION", startVisibilityAt: iso(-HOUR) });
    expect(editWindowFor(t, NOW)).toBe("RESTRICTED");
  });

  it("verrouille dès que le tournoi est lancé ou terminé", () => {
    for (const state of ["RUNNING", "FINISHED"] as const) {
      const t = tournament({ state, startVisibilityAt: iso(-HOUR) });
      expect(editWindowFor(t, NOW)).toBe("LOCKED");
      expect(editLockReason(t, NOW)).toBe("STARTED");
    }
  });

  it("verrouille un tournoi lancé même si sa date de visibilité est future", () => {
    // Date reprise à la main : l'état prime sur la visibilité.
    const t = tournament({ state: "RUNNING", startVisibilityAt: iso(24 * HOUR) });
    expect(editWindowFor(t, NOW)).toBe("LOCKED");
  });

  it("traite une date illisible comme visible", () => {
    const t = tournament({ startVisibilityAt: "pas-une-date" });
    expect(editWindowFor(t, NOW)).toBe("RESTRICTED");
  });
});

describe("editableFieldsFor", () => {
  it("autorise tous les champs en FULL", () => {
    const fields = editableFieldsFor(tournament(), NOW);
    expect(fields.has("format")).toBe(true);
    expect(fields.has("phases")).toBe(true);
    expect(fields.has("startVisibilityAt")).toBe(true);
  });

  it("n'autorise que la liste restreinte en RESTRICTED", () => {
    const t = tournament({ startVisibilityAt: iso(-HOUR) });
    const fields = editableFieldsFor(t, NOW);
    expect([...fields].sort()).toEqual([...RESTRICTED_FIELDS].sort());
    expect(fields.has("format")).toBe(false);
    expect(fields.has("registrationOpenAt")).toBe(false);
  });

  it("n'autorise rien en LOCKED", () => {
    const t = tournament({ state: "RUNNING", startVisibilityAt: iso(-HOUR) });
    expect(editableFieldsFor(t, NOW).size).toBe(0);
    expect(isFieldEditable("name", t, NOW)).toBe(false);
  });
});

describe("checkEditPatch", () => {
  it("accepte un patch vide", () => {
    expect(checkEditPatch(tournament(), {}, NOW)).toBeNull();
  });

  it("refuse un champ hors fenêtre en le nommant", () => {
    const t = tournament({ startVisibilityAt: iso(-HOUR) });
    expect(checkEditPatch(t, { format: "DOUBLE" }, NOW)).toEqual({
      code: "FIELD_NOT_EDITABLE",
      field: "format",
    });
  });

  it("refuse une baisse d'effectif en RESTRICTED", () => {
    const t = tournament({ startVisibilityAt: iso(-HOUR), maxTeams: 16 });
    expect(checkEditPatch(t, { maxTeams: 8 }, NOW)).toEqual({
      code: "MAX_TEAMS_CANNOT_DECREASE",
    });
    expect(checkEditPatch(t, { maxTeams: 32 }, NOW)).toBeNull();
    expect(checkEditPatch(t, { maxTeams: 16 }, NOW)).toBeNull();
  });

  it("autorise une baisse d'effectif tant que le tournoi est caché", () => {
    expect(checkEditPatch(tournament(), { maxTeams: 8 }, NOW)).toBeNull();
  });

  it("refuse une clôture d'inscriptions dans le passé pendant les inscriptions", () => {
    const t = tournament({ state: "REGISTRATION", startVisibilityAt: iso(-HOUR) });
    expect(checkEditPatch(t, { registrationCloseAt: iso(-HOUR) }, NOW)).toEqual({
      code: "REGISTRATION_CLOSE_IN_PAST",
    });
    expect(checkEditPatch(t, { registrationCloseAt: iso(HOUR) }, NOW)).toBeNull();
  });

  it("ne contrôle pas la clôture passée hors état REGISTRATION", () => {
    const t = tournament({ state: "UPCOMING", startVisibilityAt: iso(-HOUR) });
    expect(checkEditPatch(t, { registrationCloseAt: iso(-HOUR) }, NOW)).toBeNull();
  });

  it("signale le champ interdit avant la contrainte de valeur", () => {
    const t = tournament({ state: "RUNNING", startVisibilityAt: iso(-HOUR) });
    expect(checkEditPatch(t, { maxTeams: 2 }, NOW)).toEqual({
      code: "FIELD_NOT_EDITABLE",
      field: "maxTeams",
    });
  });
});
```

- [ ] **Step 2 : Lancer le test pour vérifier qu'il échoue**

```bash
npx jest tests/lib/shared/tournament-edit.test.ts
```

Attendu : ÉCHEC — `Cannot find module '@/lib/shared/tournament-edit'`.

- [ ] **Step 3 : Écrire l'implémentation**

Créer `lib/shared/tournament-edit.ts` :

```ts
/**
 * Fenêtre d'édition d'un tournoi — logique pure, partagée client/serveur.
 *
 * Un tournoi n'est pas modifiable de la même façon selon qu'il est encore
 * caché, déjà annoncé, ou lancé. La règle est ici et nulle part ailleurs : le
 * serveur la rejoue sous verrou pour refuser une modification interdite, et
 * l'interface s'en sert pour désactiver les champs concernés. Même modèle que
 * `match-lock.ts` et `seeding.ts`.
 */
import type { TournamentState } from "./types";

/** Champ modifiable d'un tournoi. */
export type TournamentField =
  | "name"
  | "description"
  | "game"
  | "format"
  | "participantType"
  | "maxTeams"
  | "startVisibilityAt"
  | "registrationOpenAt"
  | "registrationCloseAt"
  | "startAt"
  | "hasThirdPlaceMatch"
  | "survivalRoundsBeforeFirstCut"
  | "survivalRoundsPerCut"
  | "swissTotalRounds"
  | "swissPointsWin"
  | "swissPointsDraw"
  | "swissPointsLoss"
  | "endurancePoints"
  | "enduranceWinDelta"
  | "enduranceLossDelta"
  | "endurancePlayoffSize"
  | "matchFormat"
  | "phases";

export const ALL_TOURNAMENT_FIELDS: readonly TournamentField[] = [
  "name",
  "description",
  "game",
  "format",
  "participantType",
  "maxTeams",
  "startVisibilityAt",
  "registrationOpenAt",
  "registrationCloseAt",
  "startAt",
  "hasThirdPlaceMatch",
  "survivalRoundsBeforeFirstCut",
  "survivalRoundsPerCut",
  "swissTotalRounds",
  "swissPointsWin",
  "swissPointsDraw",
  "swissPointsLoss",
  "endurancePoints",
  "enduranceWinDelta",
  "enduranceLossDelta",
  "endurancePlayoffSize",
  "matchFormat",
  "phases",
];

/**
 * Champs qui survivent à la publication.
 *
 * `registrationOpenAt` n'en fait volontairement pas partie, même sur un tournoi
 * visible dont l'ouverture n'a pas encore eu lieu : la date d'ouverture est le
 * cœur de l'annonce, et la repousser après coup est précisément ce qui fait
 * rater une inscription.
 */
export const RESTRICTED_FIELDS: readonly TournamentField[] = [
  "name",
  "description",
  "registrationCloseAt",
  "startAt",
  "maxTeams",
];

/**
 * - `FULL` — tournoi encore invisible : tout est modifiable, personne n'a rien lu.
 * - `RESTRICTED` — annonce publiée, tournoi pas encore lancé.
 * - `LOCKED` — tournoi en cours ou terminé : plus rien, l'arbitrage prend le relais.
 */
export type EditWindow = "FULL" | "RESTRICTED" | "LOCKED";

/** Pourquoi la fenêtre est-elle réduite ? `null` = elle ne l'est pas. */
export type EditLockReason = "VISIBLE" | "STARTED" | null;

/** Vue minimale d'un tournoi, satisfaite par `TournamentCard` comme par une ligne SQL. */
export type EditableTournament = {
  state: TournamentState;
  startVisibilityAt: string;
  maxTeams: number;
};

/**
 * Le tournoi est-il encore invisible ?
 *
 * Une date illisible est traitée comme **visible** : mieux vaut restreindre à
 * tort que rouvrir le format d'un tournoi déjà annoncé. Même parti pris que
 * `isTournamentHidden` dans `tournament-visibility.ts`.
 */
function isHidden(tournament: EditableTournament, now: number): boolean {
  const visibleAt = new Date(tournament.startVisibilityAt).getTime();
  return Number.isFinite(visibleAt) && visibleAt > now;
}

export function editWindowFor(
  tournament: EditableTournament,
  now: number = Date.now(),
): EditWindow {
  // L'état prime : un tournoi lancé reste verrouillé même si sa date de
  // visibilité a été reprise à la main et pointe dans le futur.
  if (tournament.state === "RUNNING" || tournament.state === "FINISHED") return "LOCKED";
  return isHidden(tournament, now) ? "FULL" : "RESTRICTED";
}

export function editLockReason(
  tournament: EditableTournament,
  now: number = Date.now(),
): EditLockReason {
  const window = editWindowFor(tournament, now);
  if (window === "LOCKED") return "STARTED";
  if (window === "RESTRICTED") return "VISIBLE";
  return null;
}

export function editableFieldsFor(
  tournament: EditableTournament,
  now: number = Date.now(),
): ReadonlySet<TournamentField> {
  switch (editWindowFor(tournament, now)) {
    case "FULL":
      return new Set(ALL_TOURNAMENT_FIELDS);
    case "RESTRICTED":
      return new Set(RESTRICTED_FIELDS);
    default:
      return new Set();
  }
}

export function isFieldEditable(
  field: TournamentField,
  tournament: EditableTournament,
  now: number = Date.now(),
): boolean {
  return editableFieldsFor(tournament, now).has(field);
}

/** Ce qui empêche un patch de passer. */
export type EditViolation =
  | { code: "FIELD_NOT_EDITABLE"; field: TournamentField }
  | { code: "MAX_TEAMS_CANNOT_DECREASE" }
  | { code: "REGISTRATION_CLOSE_IN_PAST" };

/**
 * Première violation d'un patch, ou `null` s'il passe.
 *
 * L'ordre des contrôles est significatif : un champ interdit est signalé comme
 * tel avant que sa valeur soit jugée. Dire « effectif trop bas » sur un tournoi
 * en cours, où l'effectif n'est de toute façon plus modifiable, enverrait
 * l'utilisateur corriger la mauvaise chose.
 *
 * Ne juge que le **droit** de modifier. La cohérence des valeurs entre elles
 * (ordre des dates, barème suisse monotone…) appartient à
 * `lib/server/tournaments/validation.ts`.
 */
export function checkEditPatch(
  current: EditableTournament,
  patch: Partial<Record<TournamentField, unknown>>,
  now: number = Date.now(),
): EditViolation | null {
  const editable = editableFieldsFor(current, now);

  for (const field of ALL_TOURNAMENT_FIELDS) {
    if (patch[field] === undefined) continue;
    if (!editable.has(field)) return { code: "FIELD_NOT_EDITABLE", field };
  }

  const window = editWindowFor(current, now);
  if (window !== "RESTRICTED") return null;

  if (patch.maxTeams !== undefined && Number(patch.maxTeams) < current.maxTeams) {
    return { code: "MAX_TEAMS_CANNOT_DECREASE" };
  }

  // Reculer la clôture dans le passé ne clôt pas les inscriptions :
  // `computeTournamentState` renverrait `UPCOMING` et le tournoi reculerait
  // d'un état. Pour clore tout de suite, on avance `startAt`.
  if (current.state === "REGISTRATION" && patch.registrationCloseAt !== undefined) {
    const closeAt = new Date(String(patch.registrationCloseAt)).getTime();
    if (Number.isFinite(closeAt) && closeAt < now) return { code: "REGISTRATION_CLOSE_IN_PAST" };
  }

  return null;
}
```

- [ ] **Step 4 : Lancer le test pour vérifier qu'il passe**

```bash
npx jest tests/lib/shared/tournament-edit.test.ts
```

Attendu : PASS, 17 tests.

- [ ] **Step 5 : Commit**

```bash
git add lib/shared/tournament-edit.ts tests/lib/shared/tournament-edit.test.ts
git commit --trailer 'Co-authored-by: Claude Opus 4.8 <noreply@anthropic.com>' -m "add tournament edit window"
```

---

## Task 2 : Validation partagée création / édition

Extraction sans changement de comportement : le `POST` doit rendre exactement les mêmes codes d'erreur qu'avant, et ses tests existants sont le filet.

**Files:**
- Create: `lib/server/tournaments/validation.ts`
- Modify: `app/api/tournaments/route.ts` (bloc `POST`, lignes ~120-320)
- Modify: `lib/server/tournaments/index.ts` (`createTournament`, vérification de dates lignes ~198-221)
- Test: `tests/lib/server/tournaments-validation.test.ts`

**Interfaces:**
- Consumes: `isValidMatchFormat`, `type MatchFormat` de `@/lib/shared/match-format` ; `DEFAULT_SWISS_POINTS` de `@/lib/shared/swiss` ; `isParticipantType`, `type ParticipantType` de `@/lib/shared/participants` ; `type PhaseConfig` de `@/lib/shared/tournament-phases`.
- Produces:
  - `type TournamentInputBody` — le corps brut reçu du client (tous les champs optionnels)
  - `type ValidatedTournamentInput` — les valeurs normalisées passées à `createTournament` / `updateTournament`
  - `validateTournamentInput(body: TournamentInputBody): { error: string } | { value: ValidatedTournamentInput }`
  - `validateDateOrder(dates: { startVisibilityAt: string; registrationOpenAt: string; registrationCloseAt: string; startAt: string }): "INVALID_DATES" | "INVALID_DATE_ORDER" | null`
  - `PHASE_ERROR_CODES: ReadonlySet<string>`

- [ ] **Step 1 : Écrire le test qui échoue**

Créer `tests/lib/server/tournaments-validation.test.ts` :

```ts
import { describe, expect, it } from "@jest/globals";
import {
  validateDateOrder,
  validateTournamentInput,
} from "@/lib/server/tournaments/validation";

const base = {
  name: "Coupe test",
  game: "OW2" as const,
  format: "SINGLE" as const,
  maxTeams: 16,
};

function value(input: Parameters<typeof validateTournamentInput>[0]) {
  const result = validateTournamentInput(input);
  if ("error" in result) throw new Error(`attendu valide, reçu ${result.error}`);
  return result.value;
}

describe("validateTournamentInput", () => {
  it("normalise les défauts d'un tournoi minimal", () => {
    const v = value(base);
    expect(v.name).toBe("Coupe test");
    expect(v.game).toBe("OW2");
    expect(v.participantType).toBe("TEAM");
    expect(v.description).toBeNull();
    expect(v.matchFormat).toBeNull();
    expect(v.phases).toBeNull();
  });

  it("coupe les espaces autour du nom", () => {
    expect(value({ ...base, name: "  Coupe  " }).name).toBe("Coupe");
  });

  it("refuse un nom vide", () => {
    expect(validateTournamentInput({ ...base, name: "   " })).toEqual({ error: "MISSING_NAME" });
  });

  it("refuse un format inconnu", () => {
    expect(validateTournamentInput({ ...base, format: "TRIPLE" as never })).toEqual({
      error: "INVALID_FORMAT",
    });
  });

  it("refuse un effectif hors bornes", () => {
    expect(validateTournamentInput({ ...base, maxTeams: 1 })).toEqual({
      error: "INVALID_MAX_TEAMS",
    });
    expect(validateTournamentInput({ ...base, maxTeams: 257 })).toEqual({
      error: "INVALID_MAX_TEAMS",
    });
  });

  it("refuse un demi-format de match", () => {
    expect(validateTournamentInput({ ...base, matchFormatType: "BO" })).toEqual({
      error: "INVALID_MATCH_FORMAT",
    });
  });

  it("accepte un BO5 complet", () => {
    expect(value({ ...base, matchFormatType: "BO", matchFormatValue: 5 }).matchFormat).toEqual({
      type: "BO",
      value: 5,
    });
  });

  it("refuse un barème suisse non monotone", () => {
    expect(
      validateTournamentInput({
        ...base,
        format: "SWISS",
        swissPointsWin: 1,
        swissPointsDraw: 3,
        swissPointsLoss: 0,
      }),
    ).toEqual({ error: "INVALID_SWISS_POINTS" });
  });

  it("refuse un barème suisse dont seul le point de victoire est fourni à zéro", () => {
    expect(
      validateTournamentInput({ ...base, format: "SWISS", swissPointsWin: 0 }),
    ).toEqual({ error: "INVALID_SWISS_POINTS" });
  });

  it("exige une cadence de coupe en survie", () => {
    expect(validateTournamentInput({ ...base, format: "SURVIVAL" })).toEqual({
      error: "INVALID_SURVIVAL_ROUNDS",
    });
  });

  it("retombe sur la cadence pour la première coupe", () => {
    const v = value({ ...base, format: "SURVIVAL", survivalRoundsPerCut: 2 });
    expect(v.survivalRoundsBeforeFirstCut).toBe(2);
  });

  it("ignore les réglages d'un format qui ne les porte pas", () => {
    const v = value({ ...base, format: "SINGLE", survivalRoundsPerCut: 3, swissTotalRounds: 5 });
    expect(v.survivalRoundsPerCut).toBeNull();
    expect(v.swissTotalRounds).toBeNull();
  });

  it("refuse un plan de phases vide en MULTI", () => {
    expect(validateTournamentInput({ ...base, format: "MULTI", phases: [] })).toEqual({
      error: "MISSING_PHASES",
    });
  });

  it("refuse une double élimination ailleurs qu'en phase finale", () => {
    const phases = [
      { format: "DOUBLE", qualifierMode: "COUNT", qualifierValue: 8 },
      { format: "SINGLE", qualifierMode: "COUNT", qualifierValue: 1 },
    ];
    expect(validateTournamentInput({ ...base, format: "MULTI", phases })).toEqual({
      error: "DOUBLE_MUST_BE_LAST_PHASE",
    });
  });
});

describe("validateDateOrder", () => {
  const d = (h: number) => new Date(Date.parse("2026-08-27T12:00:00.000Z") + h * 3600_000).toISOString();

  it("accepte un ordre croissant", () => {
    expect(
      validateDateOrder({
        startVisibilityAt: d(0),
        registrationOpenAt: d(1),
        registrationCloseAt: d(2),
        startAt: d(3),
      }),
    ).toBeNull();
  });

  it("accepte des dates égales", () => {
    expect(
      validateDateOrder({
        startVisibilityAt: d(0),
        registrationOpenAt: d(0),
        registrationCloseAt: d(0),
        startAt: d(0),
      }),
    ).toBeNull();
  });

  it("refuse un ordre inversé", () => {
    expect(
      validateDateOrder({
        startVisibilityAt: d(3),
        registrationOpenAt: d(1),
        registrationCloseAt: d(2),
        startAt: d(4),
      }),
    ).toBe("INVALID_DATE_ORDER");
  });

  it("refuse une date illisible", () => {
    expect(
      validateDateOrder({
        startVisibilityAt: "n'importe quoi",
        registrationOpenAt: d(1),
        registrationCloseAt: d(2),
        startAt: d(3),
      }),
    ).toBe("INVALID_DATES");
  });
});
```

- [ ] **Step 2 : Lancer le test pour vérifier qu'il échoue**

```bash
npx jest tests/lib/server/tournaments-validation.test.ts
```

Attendu : ÉCHEC — `Cannot find module '@/lib/server/tournaments/validation'`.

- [ ] **Step 3 : Créer le module par déplacement**

Créer `lib/server/tournaments/validation.ts`. Le contenu est **déplacé** depuis `app/api/tournaments/route.ts` — ne pas réécrire les règles de mémoire, les couper-coller depuis le fichier existant pour préserver bornes, défauts et codes d'erreur au caractère près :

- `isPositiveInt`, `validateRawPhases`, `normalizePhases`, `PHASE_ERROR_CODES`, `PHASE_FORMATS`, `type RawPhase` (lignes ~21-118 de `route.ts`) ;
- le corps de validation du `POST` (lignes ~154-290) transposé en une fonction qui **retourne** `{ error }` au lieu d'appeler `fail(...)`.

Squelette à remplir avec ce code déplacé :

```ts
/**
 * Validation d'une saisie de tournoi — création comme édition.
 *
 * Sortie de la route `POST /api/tournaments` pour être partagée avec
 * `PATCH /api/tournaments/[id]/edit`. Sans ce partage, les deux jeux de règles
 * divergent au premier format ajouté : la création accepte ce que l'édition
 * refuse, ou l'inverse.
 *
 * Le module ne connaît pas HTTP : il rend un **code d'erreur**, que l'appelant
 * traduit en statut (`fail(code, 400)`) ou en exception.
 */
import { isValidMatchFormat, type MatchFormat } from "@/lib/shared/match-format";
import { isParticipantType, type ParticipantType } from "@/lib/shared/participants";
import { DEFAULT_SWISS_POINTS } from "@/lib/shared/swiss";
import type { PhaseConfig } from "@/lib/shared/tournament-phases";
import type { TournamentFormat, TournamentGame } from "@/lib/shared/types";

export type TournamentInputBody = {
  name?: string;
  description?: string | null;
  format?: TournamentFormat;
  game?: TournamentGame;
  participantType?: ParticipantType;
  maxTeams?: number;
  hasThirdPlaceMatch?: boolean;
  survivalRoundsBeforeFirstCut?: number;
  survivalRoundsPerCut?: number;
  phases?: unknown;
  swissTotalRounds?: number;
  swissPointsWin?: number;
  swissPointsDraw?: number;
  swissPointsLoss?: number;
  endurancePoints?: number;
  enduranceWinDelta?: number;
  enduranceLossDelta?: number;
  endurancePlayoffSize?: number;
  matchFormatType?: string | null;
  matchFormatValue?: number | null;
};

export type ValidatedTournamentInput = {
  name: string;
  description: string | null;
  format: TournamentFormat;
  game: TournamentGame;
  participantType: ParticipantType;
  maxTeams: number;
  hasThirdPlaceMatch: boolean;
  survivalRoundsBeforeFirstCut: number | null;
  survivalRoundsPerCut: number | null;
  swissTotalRounds: number | null;
  swissPointsWin: number | null;
  swissPointsDraw: number | null;
  swissPointsLoss: number | null;
  endurancePoints: number | null;
  enduranceWinDelta: number | null;
  enduranceLossDelta: number | null;
  endurancePlayoffSize: number | null;
  matchFormat: MatchFormat | null;
  /** `null` hors format MULTI. */
  phases: PhaseConfig[] | null;
};

export function validateTournamentInput(
  body: TournamentInputBody,
): { error: string } | { value: ValidatedTournamentInput } {
  // …bloc déplacé depuis POST, chaque `return fail(CODE, 400)` devenant
  // `return { error: CODE }`, et le tout se terminant par `return { value: … }`.
}

/**
 * Ordre chronologique des quatre jalons.
 *
 * Déplacé depuis `createTournament` pour que l'édition applique la même règle
 * sur les valeurs **résultantes** — champs modifiés et champs conservés mêlés.
 */
export function validateDateOrder(dates: {
  startVisibilityAt: string;
  registrationOpenAt: string;
  registrationCloseAt: string;
  startAt: string;
}): "INVALID_DATES" | "INVALID_DATE_ORDER" | null {
  const startVisibilityAt = new Date(dates.startVisibilityAt);
  const registrationOpenAt = new Date(dates.registrationOpenAt);
  const registrationCloseAt = new Date(dates.registrationCloseAt);
  const startAt = new Date(dates.startAt);

  if (
    Number.isNaN(startVisibilityAt.getTime()) ||
    Number.isNaN(registrationOpenAt.getTime()) ||
    Number.isNaN(registrationCloseAt.getTime()) ||
    Number.isNaN(startAt.getTime())
  ) {
    return "INVALID_DATES";
  }

  if (
    !(
      startVisibilityAt <= registrationOpenAt &&
      registrationOpenAt <= registrationCloseAt &&
      registrationCloseAt <= startAt
    )
  ) {
    return "INVALID_DATE_ORDER";
  }

  return null;
}
```

Note : `validateTournamentInput` ne valide **pas** les dates — elles ne font pas partie de `TournamentInputBody`. `validateDateOrder` est appelée séparément par `createTournament` et par `updateTournament`, qui seuls connaissent les quatre valeurs résultantes.

- [ ] **Step 4 : Recâbler le POST**

Dans `app/api/tournaments/route.ts` : supprimer le bloc déplacé, importer depuis `@/lib/server/tournaments/validation`, et réduire le corps du `POST` à :

```ts
const validation = validateTournamentInput(body);
if ("error" in validation) return fail(validation.error, 400);
const input = validation.value;

const id = await createTournament(user.id, {
  ...input,
  startVisibilityAt: body.startVisibilityAt ?? "",
  registrationOpenAt: body.registrationOpenAt ?? "",
  registrationCloseAt: body.registrationCloseAt ?? "",
  startAt: body.startAt ?? "",
  ...(input.phases ? { phases: input.phases } : {}),
});

return ok({ id }, 201);
```

Le `catch` existant est conservé tel quel (`INVALID_DATES`, `INVALID_DATE_ORDER`, `PHASE_ERROR_CODES`), en important `PHASE_ERROR_CODES` depuis le nouveau module.

- [ ] **Step 5 : Recâbler createTournament**

Dans `lib/server/tournaments/index.ts`, remplacer la vérification de dates en ligne (lignes ~198-221) par :

```ts
const dateError = validateDateOrder({
  startVisibilityAt: payload.startVisibilityAt,
  registrationOpenAt: payload.registrationOpenAt,
  registrationCloseAt: payload.registrationCloseAt,
  startAt: payload.startAt,
});
if (dateError) throw new Error(dateError);

const startVisibilityAt = new Date(payload.startVisibilityAt);
const registrationOpenAt = new Date(payload.registrationOpenAt);
const registrationCloseAt = new Date(payload.registrationCloseAt);
const startAt = new Date(payload.startAt);
```

- [ ] **Step 6 : Lancer les tests**

```bash
npx jest tests/lib/server/tournaments-validation.test.ts tests/app/api/tournaments
```

Attendu : PASS partout. **Les tests existants du POST (`create-match-format`, `create-multi`, `create-solo`, `create-survival`) doivent passer sans être modifiés** — c'est la preuve que l'extraction n'a rien changé. S'ils échouent, corriger `validation.ts` pour retrouver le comportement d'origine, pas les tests.

- [ ] **Step 7 : Vérifier les types**

```bash
npx tsc --noEmit
```

Attendu : aucune erreur.

- [ ] **Step 8 : Commit**

```bash
git add lib/server/tournaments/validation.ts app/api/tournaments/route.ts lib/server/tournaments/index.ts tests/lib/server/tournaments-validation.test.ts
git commit --trailer 'Co-authored-by: Claude Opus 4.8 <noreply@anthropic.com>' -m "share tournament input validation"
```

---

## Task 3 : Service d'édition

**Files:**
- Create: `lib/server/tournaments/edit.ts`
- Modify: `lib/server/tournaments-service.ts` (ré-export)
- Test: `tests/lib/server/tournaments-edit.test.ts`

**Interfaces:**
- Consumes: `checkEditPatch`, `editWindowFor`, `type EditWindow`, `type TournamentField` de `@/lib/shared/tournament-edit` ; `validateDateOrder`, `validateTournamentInput` de `./validation` ; `getDatabase` de `@/lib/server/database` ; `publishUpdatedEvent` de `./notifications` ; `insertPhases` de `./phases-repository`.
- Produces:
  - `type EditableTournamentValues` — champs de `TournamentField` en valeurs concrètes, dates en ISO
  - `loadEditableTournament(tournamentId: number): Promise<{ window: EditWindow; values: EditableTournamentValues } | null>`
  - `updateTournament(tournamentId: number, patch: Partial<EditableTournamentValues>): Promise<void>`
- Codes d'erreur levés (`throw new Error(code)`) : `TOURNAMENT_NOT_FOUND`, `TOURNAMENT_LOCKED`, `FIELD_NOT_EDITABLE:<field>`, `MAX_TEAMS_CANNOT_DECREASE`, `REGISTRATION_CLOSE_IN_PAST`, plus tout code rendu par `validateTournamentInput` / `validateDateOrder`.

- [ ] **Step 1 : Écrire le test qui échoue**

Créer `tests/lib/server/tournaments-edit.test.ts`. Le test simule MySQL comme les autres tests serveur du dépôt (`jest.mock("@/lib/server/database")`) :

```ts
import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/tournaments/notifications");

import { getDatabase } from "@/lib/server/database";
import { publishUpdatedEvent } from "@/lib/server/tournaments/notifications";
import { loadEditableTournament, updateTournament } from "@/lib/server/tournaments/edit";

const HOUR = 3600_000;
const future = new Date(Date.now() + 48 * HOUR);
const past = new Date(Date.now() - 48 * HOUR);

/** Ligne SQL d'un tournoi encore invisible. */
function hiddenRow(over: Record<string, unknown> = {}) {
  return {
    id: 1,
    name: "Coupe test",
    description: null,
    format: "SINGLE",
    game: "OW2",
    participant_type: "TEAM",
    max_teams: 16,
    state: "UPCOMING",
    start_visibility_at: future,
    registration_open_at: future,
    registration_close_at: new Date(future.getTime() + HOUR),
    start_at: new Date(future.getTime() + 2 * HOUR),
    has_third_place_match: 0,
    survival_rounds_before_first_cut: null,
    survival_rounds_per_cut: null,
    swiss_total_rounds: null,
    swiss_points_win: 3,
    swiss_points_draw: 1,
    swiss_points_loss: 0,
    endurance_start_points: null,
    endurance_win_delta: null,
    endurance_loss_delta: null,
    endurance_playoff_size: null,
    match_format_type: null,
    match_format_value: null,
    ...over,
  };
}

const executed: { sql: string; params: unknown[] }[] = [];
let rowToReturn: Record<string, unknown> | null;

const connection = {
  beginTransaction: jest.fn(async () => undefined),
  commit: jest.fn(async () => undefined),
  rollback: jest.fn(async () => undefined),
  release: jest.fn(() => undefined),
  execute: jest.fn(async (sql: string, params: unknown[] = []) => {
    executed.push({ sql, params });
    if (/FROM bg_tournaments/i.test(sql)) return [rowToReturn ? [rowToReturn] : []];
    if (/FROM bg_tournament_phases/i.test(sql)) return [[]];
    return [{ affectedRows: 1, insertId: 1 }];
  }),
};

beforeEach(() => {
  executed.length = 0;
  rowToReturn = hiddenRow();
  jest.clearAllMocks();
  (getDatabase as jest.Mock).mockResolvedValue({
    getConnection: async () => connection,
    execute: connection.execute,
  } as never);
});

describe("loadEditableTournament", () => {
  it("rend la fenêtre et les valeurs d'un tournoi caché", async () => {
    const loaded = await loadEditableTournament(1);
    expect(loaded?.window).toBe("FULL");
    expect(loaded?.values.name).toBe("Coupe test");
    expect(loaded?.values.maxTeams).toBe(16);
    expect(loaded?.values.swissPointsWin).toBe(3);
    expect(typeof loaded?.values.startAt).toBe("string");
  });

  it("rend RESTRICTED sur un tournoi visible", async () => {
    rowToReturn = hiddenRow({ start_visibility_at: past });
    expect((await loadEditableTournament(1))?.window).toBe("RESTRICTED");
  });

  it("rend null sur un tournoi inconnu", async () => {
    rowToReturn = null;
    expect(await loadEditableTournament(1)).toBeNull();
  });
});

describe("updateTournament", () => {
  it("écrit un champ autorisé et publie l'événement une fois", async () => {
    await updateTournament(1, { name: "Nouveau nom" });
    const update = executed.find((q) => /UPDATE bg_tournaments/i.test(q.sql));
    expect(update).toBeDefined();
    expect(update!.params).toContain("Nouveau nom");
    expect(connection.commit).toHaveBeenCalledTimes(1);
    expect(publishUpdatedEvent).toHaveBeenCalledTimes(1);
    expect(publishUpdatedEvent).toHaveBeenCalledWith(1);
  });

  it("verrouille la ligne pendant la modification", async () => {
    await updateTournament(1, { name: "X" });
    const select = executed.find((q) => /FROM bg_tournaments/i.test(q.sql));
    expect(select!.sql).toMatch(/FOR UPDATE/i);
  });

  it("refuse un tournoi inconnu", async () => {
    rowToReturn = null;
    await expect(updateTournament(1, { name: "X" })).rejects.toThrow("TOURNAMENT_NOT_FOUND");
  });

  it("refuse toute modification d'un tournoi lancé", async () => {
    rowToReturn = hiddenRow({ state: "RUNNING", start_visibility_at: past });
    await expect(updateTournament(1, { name: "X" })).rejects.toThrow("TOURNAMENT_LOCKED");
    expect(connection.rollback).toHaveBeenCalled();
  });

  it("refuse un champ hors fenêtre en le nommant", async () => {
    rowToReturn = hiddenRow({ start_visibility_at: past });
    await expect(updateTournament(1, { format: "DOUBLE" })).rejects.toThrow(
      "FIELD_NOT_EDITABLE:format",
    );
  });

  it("refuse une baisse d'effectif sur un tournoi visible", async () => {
    rowToReturn = hiddenRow({ start_visibility_at: past });
    await expect(updateTournament(1, { maxTeams: 8 })).rejects.toThrow(
      "MAX_TEAMS_CANNOT_DECREASE",
    );
  });

  it("refuse une clôture au passé pendant les inscriptions", async () => {
    rowToReturn = hiddenRow({ state: "REGISTRATION", start_visibility_at: past });
    await expect(
      updateTournament(1, { registrationCloseAt: past.toISOString() }),
    ).rejects.toThrow("REGISTRATION_CLOSE_IN_PAST");
  });

  it("valide l'ordre des dates sur les valeurs résultantes", async () => {
    // Seul `startAt` change, et il passe avant la clôture conservée en base.
    await expect(
      updateTournament(1, { startAt: new Date(future.getTime() - HOUR).toISOString() }),
    ).rejects.toThrow("INVALID_DATE_ORDER");
  });

  it("valide les valeurs métier du patch", async () => {
    await expect(updateTournament(1, { maxTeams: 1 })).rejects.toThrow("INVALID_MAX_TEAMS");
  });

  it("laisse intacts les champs absents du patch", async () => {
    rowToReturn = hiddenRow({ description: "Description d'origine", max_teams: 24 });
    await updateTournament(1, { name: "Nouveau nom" });
    const update = executed.find((q) => /UPDATE bg_tournaments/i.test(q.sql))!;
    // Ordre des colonnes de l'UPDATE : name, description, game, format,
    // participant_type, max_teams, … Les champs absents du patch sont réécrits
    // à leur valeur d'origine, pas effacés.
    expect(update.params[0]).toBe("Nouveau nom");
    expect(update.params[1]).toBe("Description d'origine");
    expect(update.params[5]).toBe(24);
  });

  it("remplace les phases d'un tournoi MULTI", async () => {
    rowToReturn = hiddenRow({ format: "MULTI" });
    await updateTournament(1, {
      format: "MULTI",
      phases: [
        {
          position: 1,
          format: "SWISS",
          name: null,
          qualifierMode: "COUNT",
          qualifierValue: 8,
          hasThirdPlaceMatch: false,
          swissTotalRounds: 4,
          survivalRoundsBeforeFirstCut: null,
          survivalRoundsPerCut: null,
        },
        {
          position: 2,
          format: "SINGLE",
          name: null,
          qualifierMode: "COUNT",
          qualifierValue: 1,
          hasThirdPlaceMatch: false,
          swissTotalRounds: null,
          survivalRoundsBeforeFirstCut: null,
          survivalRoundsPerCut: null,
        },
      ],
    });
    expect(executed.some((q) => /DELETE FROM bg_tournament_phases/i.test(q.sql))).toBe(true);
    expect(executed.some((q) => /INSERT INTO bg_tournament_phases/i.test(q.sql))).toBe(true);
  });

  it("efface les phases quand le format quitte MULTI", async () => {
    rowToReturn = hiddenRow({ format: "MULTI" });
    await updateTournament(1, { format: "SINGLE" });
    expect(executed.some((q) => /DELETE FROM bg_tournament_phases/i.test(q.sql))).toBe(true);
    expect(executed.some((q) => /INSERT INTO bg_tournament_phases/i.test(q.sql))).toBe(false);
  });

  it("ne publie rien quand la transaction échoue", async () => {
    rowToReturn = null;
    await expect(updateTournament(1, { name: "X" })).rejects.toThrow();
    expect(publishUpdatedEvent).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2 : Lancer le test pour vérifier qu'il échoue**

```bash
npx jest tests/lib/server/tournaments-edit.test.ts
```

Attendu : ÉCHEC — `Cannot find module '@/lib/server/tournaments/edit'`.

- [ ] **Step 3 : Écrire l'implémentation**

Créer `lib/server/tournaments/edit.ts` :

```ts
/**
 * Édition d'un tournoi après création.
 *
 * Le module vit hors de `index.ts`, déjà volumineux. Il ne décide pas *ce qui*
 * est modifiable — c'est `lib/shared/tournament-edit.ts`, partagé avec
 * l'interface — ni si les valeurs sont saines — c'est `./validation.ts`,
 * partagé avec la création. Il orchestre : verrou, contrôle, écriture, event.
 */
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import {
  checkEditPatch,
  editWindowFor,
  type EditWindow,
  type TournamentField,
} from "@/lib/shared/tournament-edit";
import type { MatchFormat } from "@/lib/shared/match-format";
import type { ParticipantType } from "@/lib/shared/participants";
import type { PhaseConfig } from "@/lib/shared/tournament-phases";
import type { TournamentFormat, TournamentGame } from "@/lib/shared/types";
import { toIso } from "@/lib/server/serialization";
import type { TournamentState } from "@/lib/shared/types";
import { validateDateOrder, validateTournamentInput } from "./validation";
import { insertPhases } from "./phases-repository";
import { publishUpdatedEvent } from "./notifications";

/** Valeurs éditables d'un tournoi. Dates en ISO, comme partout côté client. */
export type EditableTournamentValues = {
  name: string;
  description: string | null;
  game: TournamentGame;
  format: TournamentFormat;
  participantType: ParticipantType;
  maxTeams: number;
  startVisibilityAt: string;
  registrationOpenAt: string;
  registrationCloseAt: string;
  startAt: string;
  hasThirdPlaceMatch: boolean;
  survivalRoundsBeforeFirstCut: number | null;
  survivalRoundsPerCut: number | null;
  swissTotalRounds: number | null;
  swissPointsWin: number | null;
  swissPointsDraw: number | null;
  swissPointsLoss: number | null;
  endurancePoints: number | null;
  enduranceWinDelta: number | null;
  enduranceLossDelta: number | null;
  endurancePlayoffSize: number | null;
  matchFormat: MatchFormat | null;
  phases: PhaseConfig[] | null;
};

type EditRow = RowDataPacket & Record<string, never>;

/**
 * Lit la ligne avec **toutes** les colonnes éditables.
 *
 * `loadTournamentRow` ne suffit pas : elle ignore le barème suisse et les
 * réglages d'endurance, que le formulaire doit pourtant préremplir.
 */
async function loadEditRow(
  connection: PoolConnection,
  tournamentId: number,
  forUpdate: boolean,
): Promise<Record<string, unknown> | null> {
  const [rows] = await connection.execute<EditRow[]>(
    `SELECT
      id, name, description, format, game, participant_type, max_teams, state,
      start_visibility_at, registration_open_at, registration_close_at, start_at,
      has_third_place_match,
      survival_rounds_before_first_cut, survival_rounds_per_cut,
      swiss_total_rounds, swiss_points_win, swiss_points_draw, swiss_points_loss,
      endurance_start_points, endurance_win_delta, endurance_loss_delta,
      endurance_playoff_size,
      match_format_type, match_format_value
     FROM bg_tournaments
     WHERE id = ?
     LIMIT 1${forUpdate ? " FOR UPDATE" : ""}`,
    [tournamentId],
  );

  return rows.length === 0 ? null : (rows[0] as unknown as Record<string, unknown>);
}

/** Convertit une ligne SQL en valeurs éditables. */
function toValues(row: Record<string, unknown>, phases: PhaseConfig[] | null): EditableTournamentValues {
  const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
  return {
    name: String(row.name),
    description: row.description === null ? null : String(row.description),
    game: row.game as TournamentGame,
    format: row.format as TournamentFormat,
    participantType: row.participant_type as ParticipantType,
    maxTeams: Number(row.max_teams),
    startVisibilityAt: toIso(row.start_visibility_at as Date)!,
    registrationOpenAt: toIso(row.registration_open_at as Date)!,
    registrationCloseAt: toIso(row.registration_close_at as Date)!,
    startAt: toIso(row.start_at as Date)!,
    hasThirdPlaceMatch: Boolean(row.has_third_place_match),
    survivalRoundsBeforeFirstCut: num(row.survival_rounds_before_first_cut),
    survivalRoundsPerCut: num(row.survival_rounds_per_cut),
    swissTotalRounds: num(row.swiss_total_rounds),
    swissPointsWin: num(row.swiss_points_win),
    swissPointsDraw: num(row.swiss_points_draw),
    swissPointsLoss: num(row.swiss_points_loss),
    endurancePoints: num(row.endurance_start_points),
    enduranceWinDelta: num(row.endurance_win_delta),
    enduranceLossDelta: num(row.endurance_loss_delta),
    endurancePlayoffSize: num(row.endurance_playoff_size),
    matchFormat:
      row.match_format_type === null || row.match_format_value === null
        ? null
        : { type: row.match_format_type as MatchFormat["type"], value: Number(row.match_format_value) },
    phases,
  };
}

/** Phases d'un tournoi MULTI, sous la forme attendue par le formulaire. */
async function loadPhaseConfigs(
  connection: PoolConnection,
  tournamentId: number,
): Promise<PhaseConfig[]> {
  const [rows] = await connection.execute<EditRow[]>(
    `SELECT position, name, format, qualifier_mode, qualifier_value,
            has_third_place_match, swiss_total_rounds,
            survival_rounds_before_first_cut, survival_rounds_per_cut
     FROM bg_tournament_phases
     WHERE tournament_id = ?
     ORDER BY position ASC`,
    [tournamentId],
  );

  return (rows as unknown as Record<string, unknown>[]).map((row) => ({
    position: Number(row.position),
    format: row.format as PhaseConfig["format"],
    name: row.name === null ? null : String(row.name),
    qualifierMode: row.qualifier_mode as PhaseConfig["qualifierMode"],
    qualifierValue: Number(row.qualifier_value),
    hasThirdPlaceMatch: Boolean(row.has_third_place_match),
    swissTotalRounds: row.swiss_total_rounds === null ? null : Number(row.swiss_total_rounds),
    survivalRoundsBeforeFirstCut:
      row.survival_rounds_before_first_cut === null
        ? null
        : Number(row.survival_rounds_before_first_cut),
    survivalRoundsPerCut:
      row.survival_rounds_per_cut === null ? null : Number(row.survival_rounds_per_cut),
  }));
}

export async function loadEditableTournament(
  tournamentId: number,
): Promise<{ window: EditWindow; values: EditableTournamentValues } | null> {
  const db = await getDatabase();
  const connection = await db.getConnection();

  try {
    const row = await loadEditRow(connection, tournamentId, false);
    if (!row) return null;

    const phases =
      row.format === "MULTI" ? await loadPhaseConfigs(connection, tournamentId) : null;
    const values = toValues(row, phases);

    return {
      window: editWindowFor({
        state: row.state as TournamentState,
        startVisibilityAt: values.startVisibilityAt,
        maxTeams: values.maxTeams,
      }),
      values,
    };
  } finally {
    connection.release();
  }
}

export async function updateTournament(
  tournamentId: number,
  patch: Partial<EditableTournamentValues>,
): Promise<void> {
  const db = await getDatabase();
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    const row = await loadEditRow(connection, tournamentId, true);
    if (!row) throw new Error("TOURNAMENT_NOT_FOUND");

    const current = toValues(
      row,
      row.format === "MULTI" ? await loadPhaseConfigs(connection, tournamentId) : null,
    );

    // La fenêtre est recalculée ici, sous verrou : un tournoi devenu visible ou
    // lancé depuis le chargement du formulaire est refusé, pas modifié en silence.
    const editable = {
      state: row.state as never,
      startVisibilityAt: current.startVisibilityAt,
      maxTeams: current.maxTeams,
    };

    if (editWindowFor(editable) === "LOCKED") throw new Error("TOURNAMENT_LOCKED");

    const violation = checkEditPatch(editable, patch as Partial<Record<TournamentField, unknown>>);
    if (violation) {
      throw new Error(
        violation.code === "FIELD_NOT_EDITABLE"
          ? `FIELD_NOT_EDITABLE:${violation.field}`
          : violation.code,
      );
    }

    const next: EditableTournamentValues = { ...current, ...patch };

    const validation = validateTournamentInput({
      name: next.name,
      description: next.description,
      format: next.format,
      game: next.game,
      participantType: next.participantType,
      maxTeams: next.maxTeams,
      hasThirdPlaceMatch: next.hasThirdPlaceMatch,
      survivalRoundsBeforeFirstCut: next.survivalRoundsBeforeFirstCut ?? undefined,
      survivalRoundsPerCut: next.survivalRoundsPerCut ?? undefined,
      swissTotalRounds: next.swissTotalRounds ?? undefined,
      swissPointsWin: next.swissPointsWin ?? undefined,
      swissPointsDraw: next.swissPointsDraw ?? undefined,
      swissPointsLoss: next.swissPointsLoss ?? undefined,
      endurancePoints: next.endurancePoints ?? undefined,
      enduranceWinDelta: next.enduranceWinDelta ?? undefined,
      enduranceLossDelta: next.enduranceLossDelta ?? undefined,
      endurancePlayoffSize: next.endurancePlayoffSize ?? undefined,
      matchFormatType: next.matchFormat?.type ?? null,
      matchFormatValue: next.matchFormat?.value ?? null,
      phases: next.phases ?? undefined,
    });
    if ("error" in validation) throw new Error(validation.error);
    const valid = validation.value;

    const dateError = validateDateOrder({
      startVisibilityAt: next.startVisibilityAt,
      registrationOpenAt: next.registrationOpenAt,
      registrationCloseAt: next.registrationCloseAt,
      startAt: next.startAt,
    });
    if (dateError) throw new Error(dateError);

    await connection.execute(
      `UPDATE bg_tournaments SET
        name = ?, description = ?, game = ?, format = ?, participant_type = ?,
        max_teams = ?,
        start_visibility_at = ?, registration_open_at = ?,
        registration_close_at = ?, start_at = ?,
        has_third_place_match = ?,
        survival_rounds_before_first_cut = ?, survival_rounds_per_cut = ?,
        swiss_total_rounds = ?, swiss_points_win = ?, swiss_points_draw = ?, swiss_points_loss = ?,
        endurance_start_points = ?, endurance_win_delta = ?, endurance_loss_delta = ?,
        endurance_playoff_size = ?,
        match_format_type = ?, match_format_value = ?
       WHERE id = ?`,
      [
        valid.name,
        valid.description,
        valid.game,
        valid.format,
        valid.participantType,
        valid.maxTeams,
        new Date(next.startVisibilityAt),
        new Date(next.registrationOpenAt),
        new Date(next.registrationCloseAt),
        new Date(next.startAt),
        valid.hasThirdPlaceMatch ? 1 : 0,
        valid.survivalRoundsBeforeFirstCut,
        valid.survivalRoundsPerCut,
        valid.swissTotalRounds,
        valid.swissPointsWin ?? 3,
        valid.swissPointsDraw ?? 1,
        valid.swissPointsLoss ?? 0,
        valid.endurancePoints,
        valid.enduranceWinDelta,
        valid.enduranceLossDelta,
        valid.endurancePlayoffSize,
        valid.matchFormat?.type ?? null,
        valid.matchFormat?.value ?? null,
        tournamentId,
      ],
    );

    // Les phases sont toujours reposées à neuf : en fenêtre FULL aucun match
    // n'existe, le tournoi n'étant pas même ouvert aux inscriptions. Un format
    // qui quitte MULTI voit donc simplement les siennes disparaître.
    await connection.execute(`DELETE FROM bg_tournament_phases WHERE tournament_id = ?`, [
      tournamentId,
    ]);
    if (valid.format === "MULTI" && valid.phases) {
      await insertPhases(connection, tournamentId, valid.phases);
    }

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  publishUpdatedEvent(tournamentId);
}
```

Deux pièges vérifiés à l'écriture de ce plan : `toIso` vit dans
`@/lib/server/serialization` (et non dans `@/lib/shared/dates`), et
`editWindowFor` doit recevoir `row.state`, pas une valeur dérivée des `values`.

- [ ] **Step 4 : Ré-exporter depuis la façade**

Dans `lib/server/tournaments-service.ts`, ajouter au bloc `export { … } from "./tournaments"` :

```ts
  // Édition
  loadEditableTournament,
  updateTournament,
```

et ré-exporter les deux depuis `lib/server/tournaments/index.ts` :

```ts
export { loadEditableTournament, updateTournament } from "./edit";
export type { EditableTournamentValues } from "./edit";
```

- [ ] **Step 5 : Lancer le test**

```bash
npx jest tests/lib/server/tournaments-edit.test.ts
```

Attendu : PASS, 16 tests.

- [ ] **Step 6 : Commit**

```bash
git add lib/server/tournaments/edit.ts lib/server/tournaments/index.ts lib/server/tournaments-service.ts tests/lib/server/tournaments-edit.test.ts
git commit --trailer 'Co-authored-by: Claude Opus 4.8 <noreply@anthropic.com>' -m "add tournament update service"
```

---

## Task 4 : Route API

**Files:**
- Create: `app/api/tournaments/[id]/edit/route.ts`
- Test: `tests/app/api/tournaments/edit.test.ts`

**Interfaces:**
- Consumes: `loadEditableTournament`, `updateTournament`, `type EditableTournamentValues` de `@/lib/server/tournaments-service` ; `getCurrentUser` de `@/lib/server/auth` ; `can` de `@/lib/shared/permissions` ; `ok`, `fail` de `@/lib/server/http`.
- Produces: `GET` et `PATCH` exportés depuis la route.

- [ ] **Step 1 : Écrire le test qui échoue**

Créer `tests/app/api/tournaments/edit.test.ts` :

```ts
import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/tournaments-service");

import { GET, PATCH } from "@/app/api/tournaments/[id]/edit/route";
import { getCurrentUser } from "@/lib/server/auth";
import * as service from "@/lib/server/tournaments-service";

const referee = { id: 1, isAdmin: false, roles: ["ARBITRE"] };
const plainUser = { id: 2, isAdmin: false, roles: [] };

const params = (id: string) => ({ params: Promise.resolve({ id }) });

function patchReq(body: unknown) {
  return new Request("http://localhost/api/tournaments/1/edit", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const loaded = {
  window: "FULL" as const,
  values: { name: "Coupe test", maxTeams: 16 },
};

beforeEach(() => {
  jest.clearAllMocks();
  (getCurrentUser as jest.Mock).mockResolvedValue(referee as never);
  (service.loadEditableTournament as jest.Mock).mockResolvedValue(loaded as never);
  (service.updateTournament as jest.Mock).mockResolvedValue(undefined as never);
});

describe("GET /api/tournaments/[id]/edit", () => {
  it("refuse un visiteur non connecté", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(null as never);
    expect((await GET(new Request("http://localhost"), params("1"))).status).toBe(401);
  });

  it("refuse un utilisateur sans la permission tournaments", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(plainUser as never);
    expect((await GET(new Request("http://localhost"), params("1"))).status).toBe(403);
  });

  it("refuse un identifiant invalide", async () => {
    expect((await GET(new Request("http://localhost"), params("abc"))).status).toBe(400);
  });

  it("rend 404 sur un tournoi inconnu", async () => {
    (service.loadEditableTournament as jest.Mock).mockResolvedValue(null as never);
    expect((await GET(new Request("http://localhost"), params("1"))).status).toBe(404);
  });

  it("rend la fenêtre et les valeurs", async () => {
    const res = await GET(new Request("http://localhost"), params("1"));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(loaded);
  });
});

describe("PATCH /api/tournaments/[id]/edit", () => {
  it("refuse un utilisateur sans la permission tournaments", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(plainUser as never);
    expect((await PATCH(patchReq({ name: "X" }), params("1"))).status).toBe(403);
  });

  it("transmet le patch au service", async () => {
    const res = await PATCH(patchReq({ name: "Nouveau nom" }), params("1"));
    expect(res.status).toBe(200);
    expect(service.updateTournament).toHaveBeenCalledWith(1, { name: "Nouveau nom" });
  });

  it("ignore les clés inconnues du corps", async () => {
    await PATCH(patchReq({ name: "X", isAdmin: true, id: 99 }), params("1"));
    expect(service.updateTournament).toHaveBeenCalledWith(1, { name: "X" });
  });

  it("refuse un patch vide", async () => {
    const res = await PATCH(patchReq({}), params("1"));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "EMPTY_PATCH" });
  });

  it("traduit un tournoi inconnu en 404", async () => {
    (service.updateTournament as jest.Mock).mockRejectedValue(
      new Error("TOURNAMENT_NOT_FOUND") as never,
    );
    expect((await PATCH(patchReq({ name: "X" }), params("1"))).status).toBe(404);
  });

  it("traduit un tournoi verrouillé en 409", async () => {
    (service.updateTournament as jest.Mock).mockRejectedValue(
      new Error("TOURNAMENT_LOCKED") as never,
    );
    expect((await PATCH(patchReq({ name: "X" }), params("1"))).status).toBe(409);
  });

  it("traduit un champ interdit en 409 en nommant le champ", async () => {
    (service.updateTournament as jest.Mock).mockRejectedValue(
      new Error("FIELD_NOT_EDITABLE:format") as never,
    );
    const res = await PATCH(patchReq({ name: "X" }), params("1"));
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({ error: "FIELD_NOT_EDITABLE", field: "format" });
  });

  it("traduit une valeur invalide en 400", async () => {
    (service.updateTournament as jest.Mock).mockRejectedValue(
      new Error("INVALID_DATE_ORDER") as never,
    );
    expect((await PATCH(patchReq({ name: "X" }), params("1"))).status).toBe(400);
  });

  it("rend 500 sur une panne inattendue", async () => {
    (service.updateTournament as jest.Mock).mockRejectedValue(new Error("ECONNRESET") as never);
    expect((await PATCH(patchReq({ name: "X" }), params("1"))).status).toBe(500);
  });
});
```

- [ ] **Step 2 : Lancer le test pour vérifier qu'il échoue**

```bash
npx jest tests/app/api/tournaments/edit.test.ts
```

Attendu : ÉCHEC — module de route introuvable.

- [ ] **Step 3 : Écrire la route**

Créer `app/api/tournaments/[id]/edit/route.ts` :

```ts
import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import {
  loadEditableTournament,
  updateTournament,
  type EditableTournamentValues,
} from "@/lib/server/tournaments-service";
import { ALL_TOURNAMENT_FIELDS } from "@/lib/shared/tournament-edit";
import { can } from "@/lib/shared/permissions";
import { NextResponse } from "next/server";

/**
 * Édition d'un tournoi. `GET` rend la fenêtre d'édition et les valeurs à
 * préremplir, `PATCH` applique une modification partielle.
 *
 * Les deux sont réservés au staff `tournaments`, organisateur ou non : c'est la
 * règle déjà appliquée à l'arbitrage des scores.
 */

/** Identifiant de tournoi valide, ou `null`. */
function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

async function guard(idRaw: string) {
  const user = await getCurrentUser();
  if (!user) return { error: fail("UNAUTHORIZED", 401) };
  if (!can(user, "tournaments")) return { error: fail("FORBIDDEN", 403) };

  const id = parseId(idRaw);
  if (id === null) return { error: fail("INVALID_TOURNAMENT_ID", 400) };

  return { id };
}

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const checked = await guard(id);
  if (checked.error) return checked.error;

  const loaded = await loadEditableTournament(checked.id!);
  if (!loaded) return fail("TOURNAMENT_NOT_FOUND", 404);

  return ok(loaded);
}

export async function PATCH(req: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const checked = await guard(id);
  if (checked.error) return checked.error;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  // Liste blanche : le corps ne peut porter que des champs éditables connus.
  // Recopier le corps tel quel laisserait un client écrire n'importe quelle
  // colonne que le service viendrait à accepter plus tard.
  const patch: Partial<EditableTournamentValues> = {};
  for (const field of ALL_TOURNAMENT_FIELDS) {
    if (body[field] !== undefined) {
      (patch as Record<string, unknown>)[field] = body[field];
    }
  }

  if (Object.keys(patch).length === 0) return fail("EMPTY_PATCH", 400);

  try {
    await updateTournament(checked.id!, patch);
    return ok({ success: true });
  } catch (error) {
    const message = (error as Error).message;

    if (message.startsWith("FIELD_NOT_EDITABLE:")) {
      return NextResponse.json(
        { error: "FIELD_NOT_EDITABLE", field: message.slice("FIELD_NOT_EDITABLE:".length) },
        { status: 409 },
      );
    }
    if (message === "TOURNAMENT_LOCKED") return fail(message, 409);
    if (message === "TOURNAMENT_NOT_FOUND") return fail(message, 404);
    if (message.startsWith("INVALID_") || message.startsWith("MISSING_") ||
        message === "MAX_TEAMS_CANNOT_DECREASE" ||
        message === "REGISTRATION_CLOSE_IN_PAST" ||
        message === "DOUBLE_MUST_BE_LAST_PHASE") {
      return fail(message, 400);
    }

    return fail("TOURNAMENT_UPDATE_FAILED", 500);
  }
}
```

- [ ] **Step 4 : Lancer le test**

```bash
npx jest tests/app/api/tournaments/edit.test.ts
```

Attendu : PASS, 16 tests.

- [ ] **Step 5 : Commit**

```bash
git add "app/api/tournaments/[id]/edit/route.ts" tests/app/api/tournaments/edit.test.ts
git commit --trailer 'Co-authored-by: Claude Opus 4.8 <noreply@anthropic.com>' -m "add tournament edit route"
```

---

## Task 5 : Formulaire partagé

Refactor à comportement constant : la page de création doit se comporter exactement comme avant.

**Files:**
- Create: `app/(secured)/tournois/_components/TournamentForm.tsx`
- Modify: `app/(secured)/tournois/creer/page.tsx`
- Test: `tests/tournois/tournament-form.test.ts`

**Interfaces:**
- Consumes: `type TournamentField`, `type EditWindow` de `@/lib/shared/tournament-edit` ; `PhaseBuilder` et `createDefaultPhase` de `../creer/` (les déplacer dans `_components/` si l'import remonte mal — dans ce cas, mettre à jour les imports de `phase-form.ts`).
- Produces:
  - `type TournamentFormValues` — miroir client de `EditableTournamentValues`, dates au format `datetime-local`
  - `defaultTournamentFormValues(): TournamentFormValues`
  - `toApiPayload(values: TournamentFormValues): Record<string, unknown>` — convertit les dates locales en ISO et aplatit `matchFormat` en `matchFormatType` / `matchFormatValue`
  - `<TournamentForm mode initialValues editableFields submitLabel onSubmit />`

```ts
export type TournamentFormProps = {
  mode: "create" | "edit";
  initialValues: TournamentFormValues;
  editableFields: ReadonlySet<TournamentField>;
  submitLabel: string;
  onSubmit: (values: TournamentFormValues) => Promise<void>;
};
```

- [ ] **Step 1 : Écrire le test qui échoue**

Créer `tests/tournois/tournament-form.test.ts`. Le dépôt teste la logique de formulaire sans rendu DOM ; on teste donc les fonctions pures exportées à côté du composant :

```ts
import { describe, expect, it } from "@jest/globals";
import {
  defaultTournamentFormValues,
  toApiPayload,
} from "@/app/(secured)/tournois/_components/TournamentForm";

describe("defaultTournamentFormValues", () => {
  it("propose un tournoi à élimination simple par équipes", () => {
    const v = defaultTournamentFormValues();
    expect(v.format).toBe("SINGLE");
    expect(v.participantType).toBe("TEAM");
    expect(v.game).toBe("OW2");
    expect(v.maxTeams).toBe(16);
  });

  it("propose quatre jalons dans l'ordre chronologique", () => {
    const v = defaultTournamentFormValues();
    const t = (s: string) => new Date(s).getTime();
    expect(t(v.startVisibilityAt)).toBeLessThanOrEqual(t(v.registrationOpenAt));
    expect(t(v.registrationOpenAt)).toBeLessThanOrEqual(t(v.registrationCloseAt));
    expect(t(v.registrationCloseAt)).toBeLessThanOrEqual(t(v.startAt));
  });
});

describe("toApiPayload", () => {
  const values = { ...defaultTournamentFormValues(), name: "Coupe test" };

  it("convertit les dates locales en ISO", () => {
    const payload = toApiPayload(values);
    expect(String(payload.startAt)).toMatch(/\dT.*Z$/);
  });

  it("aplatit le format de match en deux champs", () => {
    const payload = toApiPayload({ ...values, matchFormat: { type: "BO", value: 5 } });
    expect(payload.matchFormatType).toBe("BO");
    expect(payload.matchFormatValue).toBe(5);
  });

  it("rend deux champs nuls quand la saisie de score est libre", () => {
    const payload = toApiPayload({ ...values, matchFormat: null });
    expect(payload.matchFormatType).toBeNull();
    expect(payload.matchFormatValue).toBeNull();
  });

  it("n'envoie les phases qu'en format MULTI", () => {
    expect(toApiPayload({ ...values, format: "SINGLE" }).phases).toBeUndefined();
    expect(toApiPayload({ ...values, format: "MULTI" }).phases).toBeDefined();
  });

  it("n'envoie les réglages de survie qu'en format SURVIVAL", () => {
    expect(toApiPayload({ ...values, format: "SINGLE" }).survivalRoundsPerCut).toBeUndefined();
    expect(toApiPayload({ ...values, format: "SURVIVAL" }).survivalRoundsPerCut).toBeDefined();
  });
});
```

- [ ] **Step 2 : Lancer le test pour vérifier qu'il échoue**

```bash
npx jest tests/tournois/tournament-form.test.ts
```

Attendu : ÉCHEC — module introuvable.

- [ ] **Step 3 : Extraire le composant**

Créer `app/(secured)/tournois/_components/TournamentForm.tsx` par **déplacement** du contenu de `app/(secured)/tournois/creer/page.tsx` :

1. Copier l'intégralité du fichier `creer/page.tsx` dans le nouveau fichier.
2. Remplacer les 24 `useState(<défaut>)` par un état unique initialisé depuis `initialValues` :

```tsx
const [values, setValues] = useState<TournamentFormValues>(initialValues);
const set = <K extends keyof TournamentFormValues>(key: K, value: TournamentFormValues[K]) =>
  setValues((prev) => ({ ...prev, [key]: value }));
```

   Chaque `value={name} onChange={(e) => setName(e.target.value)}` devient
   `value={values.name} onChange={(e) => set("name", e.target.value)}`.

3. Ajouter à chaque contrôle son verrouillage :

```tsx
const locked = (field: TournamentField) => !editableFields.has(field);
// puis, sur chaque input / select / textarea :
disabled={locked("name")}
```

4. Supprimer le `fetch` : `onSubmit` du formulaire appelle `await onSubmit(values)` après les validations client existantes (`matchFormatValid`, `validatePhases`). La garde de permission (`useEffect` sur `/api/auth/me`) et le `<Link>` d'en-tête **restent dans les pages**, pas dans le composant.
5. Exporter `TournamentFormValues`, `defaultTournamentFormValues()` (les défauts actuels : `localDateTimeInput(1/3/24/30)`, `maxTeams: 16`, `format: "SINGLE"`, etc.) et `toApiPayload(values)` (le corps du `JSON.stringify` actuel).

- [ ] **Step 4 : Réduire la page de création**

`app/(secured)/tournois/creer/page.tsx` conserve : le `<Link>` d'accueil, l'en-tête, la garde de permission, et rend :

```tsx
<TournamentForm
  mode="create"
  initialValues={defaultTournamentFormValues()}
  editableFields={new Set(ALL_TOURNAMENT_FIELDS)}
  submitLabel="Créer le tournoi"
  onSubmit={async (values) => {
    const response = await fetch("/api/tournaments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(toApiPayload(values)),
    });
    const payload = (await response.json()) as { error?: string; id?: number };
    if (!response.ok || !payload.id) throw new Error(payload.error || "TOURNAMENT_CREATE_FAILED");
    router.push(`/tournois/${payload.id}`);
    router.refresh();
  }}
/>
```

- [ ] **Step 5 : Lancer les tests et vérifier les types**

```bash
npx jest tests/tournois/tournament-form.test.ts && npx tsc --noEmit && npm run lint
```

Attendu : PASS, aucune erreur de type, aucun avertissement ESLint.

- [ ] **Step 6 : Vérifier la création dans le navigateur**

Remettre `DEV_AUTH_USER_ID=589` dans `.env`, démarrer la préview (`preview_start` sur la configuration `dev` de `.claude/launch.json`), aller sur `/tournois/creer`, créer un tournoi de test, vérifier qu'il apparaît. Ne pas conclure sans cette vérification : le refactor touche 24 champs.

- [ ] **Step 7 : Commit**

```bash
git add "app/(secured)/tournois/_components/TournamentForm.tsx" "app/(secured)/tournois/creer/page.tsx" tests/tournois/tournament-form.test.ts
git commit --trailer 'Co-authored-by: Claude Opus 4.8 <noreply@anthropic.com>' -m "extract shared tournament form"
```

---

## Task 6 : Page de modification et bouton d'accès

**Files:**
- Create: `app/(secured)/tournois/[id]/modifier/page.tsx`
- Modify: `app/(secured)/tournois/[id]/page.tsx`
- Modify: `app/(secured)/tournois/[id]/_lib/error-map.ts`
- Test: `tests/tournois/tournament-edit-entry.test.ts`

**Interfaces:**
- Consumes: `editWindowFor`, `editableFieldsFor`, `editLockReason` de `@/lib/shared/tournament-edit` ; `TournamentForm`, `toApiPayload`, `type TournamentFormValues` de `../../_components/TournamentForm`.
- Produces: `canShowEditButton(card, isAdmin, now?)` exporté depuis `app/(secured)/tournois/[id]/_lib/edit-entry.ts`, et `editLockNotice(reason, startVisibilityAt): string | null` dans le même fichier.

- [ ] **Step 1 : Écrire le test qui échoue**

Créer `tests/tournois/tournament-edit-entry.test.ts` :

```ts
import { describe, expect, it } from "@jest/globals";
import {
  canShowEditButton,
  editLockNotice,
} from "@/app/(secured)/tournois/[id]/_lib/edit-entry";

const NOW = Date.parse("2026-08-27T12:00:00.000Z");
const iso = (h: number) => new Date(NOW + h * 3600_000).toISOString();

const card = (over: Record<string, unknown> = {}) =>
  ({ state: "UPCOMING", startVisibilityAt: iso(24), maxTeams: 16, ...over }) as never;

describe("canShowEditButton", () => {
  it("montre le bouton au staff sur un tournoi caché", () => {
    expect(canShowEditButton(card(), true, NOW)).toBe(true);
  });

  it("montre le bouton au staff sur un tournoi en inscriptions", () => {
    expect(canShowEditButton(card({ state: "REGISTRATION", startVisibilityAt: iso(-1) }), true, NOW)).toBe(true);
  });

  it("cache le bouton à un utilisateur sans permission", () => {
    expect(canShowEditButton(card(), false, NOW)).toBe(false);
  });

  it("cache le bouton sur un tournoi lancé", () => {
    expect(canShowEditButton(card({ state: "RUNNING" }), true, NOW)).toBe(false);
  });

  it("cache le bouton sur un tournoi terminé", () => {
    expect(canShowEditButton(card({ state: "FINISHED" }), true, NOW)).toBe(false);
  });
});

describe("editLockNotice", () => {
  it("ne dit rien quand tout est modifiable", () => {
    expect(editLockNotice(null, iso(24))).toBeNull();
  });

  it("explique la restriction due à la publication en citant la date", () => {
    const notice = editLockNotice("VISIBLE", "2026-08-20T10:00:00.000Z");
    expect(notice).toContain("20/08/2026");
    expect(notice).toMatch(/format/i);
  });

  it("explique le verrouillage d'un tournoi lancé", () => {
    expect(editLockNotice("STARTED", iso(-24))).toMatch(/en cours|lanc/i);
  });
});
```

- [ ] **Step 2 : Lancer le test pour vérifier qu'il échoue**

```bash
npx jest tests/tournois/tournament-edit-entry.test.ts
```

Attendu : ÉCHEC — module introuvable.

- [ ] **Step 3 : Écrire le module d'entrée**

Créer `app/(secured)/tournois/[id]/_lib/edit-entry.ts` :

```ts
import { formatLocalDateTime } from "@/lib/shared/dates";
import {
  editLockReason,
  editWindowFor,
  type EditLockReason,
} from "@/lib/shared/tournament-edit";
import type { TournamentCard } from "@/lib/shared/types";

/**
 * Le bouton « Modifier » n'est affiché que s'il mène quelque part : au staff
 * `tournaments`, et sur un tournoi que la fenêtre laisse encore ouvrir. Pas de
 * bouton grisé — un tournoi en cours n'en montre aucun.
 */
export function canShowEditButton(
  card: TournamentCard,
  hasTournamentPermission: boolean,
  now: number = Date.now(),
): boolean {
  if (!hasTournamentPermission) return false;
  return editWindowFor(card, now) !== "LOCKED";
}

/**
 * Phrase affichée **une fois** en tête du formulaire, plutôt que répétée sur
 * chaque champ désactivé.
 */
export function editLockNotice(
  reason: EditLockReason,
  startVisibilityAt: string,
): string | null {
  if (reason === null) return null;
  if (reason === "STARTED") {
    return "Le tournoi est en cours : il n'est plus modifiable.";
  }
  return `Le tournoi est visible depuis le ${formatLocalDateTime(startVisibilityAt)} — le format, le jeu et les réglages ne sont plus modifiables.`;
}

export { editLockReason };
```

Vérifier la signature exacte de `formatLocalDateTime` dans `lib/shared/dates.ts` et adapter l'appel si elle attend un `Date` plutôt qu'une chaîne. Si sa sortie ne contient pas `20/08/2026` pour l'entrée du test, ajuster le test à la sortie réelle du helper — c'est lui qui fait autorité sur le format d'affichage du site.

- [ ] **Step 4 : Écrire la page de modification**

Créer `app/(secured)/tournois/[id]/modifier/page.tsx` :

```tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { CyberCard } from "@/components/cyber";
import { useToast } from "@/components/ui/toast";
import { can, type PlatformRole } from "@/lib/shared/permissions";
import {
  ALL_TOURNAMENT_FIELDS,
  RESTRICTED_FIELDS,
  type EditWindow,
  type TournamentField,
} from "@/lib/shared/tournament-edit";
import {
  TournamentForm,
  toApiPayload,
  type TournamentFormValues,
} from "../../_components/TournamentForm";
import { editLockNotice } from "../_lib/edit-entry";
import { mapError } from "../_lib/error-map";

export default function EditTournamentPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { showError, showSuccess } = useToast();
  const tournamentId = Number(params.id);

  const [loaded, setLoaded] = useState<{
    window: EditWindow;
    values: TournamentFormValues;
    startVisibilityAt: string;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const me = await fetch("/api/auth/me", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);
      if (!can(me?.user as { isAdmin?: boolean; roles?: PlatformRole[] }, "tournaments")) {
        showError("Modification de tournoi réservée aux arbitres et administrateurs.");
        router.replace("/tournois");
        return;
      }

      const response = await fetch(`/api/tournaments/${tournamentId}/edit`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) {
        showError(mapError(payload.error ?? "TOURNAMENT_NOT_FOUND"));
        router.replace("/tournois");
        return;
      }
      if (cancelled) return;

      // Les valeurs serveur arrivent en ISO ; le formulaire attend des dates
      // locales `datetime-local`.
      setLoaded({
        window: payload.window,
        values: toFormValues(payload.values),
        startVisibilityAt: payload.values.startVisibilityAt,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [tournamentId, router, showError]);

  if (!loaded) {
    return (
      <section className="ds-block" style={{ color: "var(--text-2)" }}>
        Chargement du tournoi...
      </section>
    );
  }

  // Le bouton « Modifier » n'apparaît pas sur un tournoi lancé, mais l'URL
  // reste atteignable à la main : on explique plutôt que de rendre un
  // formulaire entièrement grisé.
  if (loaded.window === "LOCKED") {
    return (
      <section className="fade-in container">
        <Link href={`/tournois/${tournamentId}`} style={{ fontSize: 13, color: "var(--ink-mute)" }}>
          ← Retour au tournoi
        </Link>
        <p style={{ color: "var(--amber)", marginTop: 16 }}>
          {editLockNotice("STARTED", loaded.startVisibilityAt)}
        </p>
      </section>
    );
  }

  const editableFields: ReadonlySet<TournamentField> =
    loaded.window === "FULL" ? new Set(ALL_TOURNAMENT_FIELDS) : new Set(RESTRICTED_FIELDS);
  const notice = editLockNotice(
    loaded.window === "FULL" ? null : "VISIBLE",
    loaded.startVisibilityAt,
  );

  return (
    <section className="fade-in container">
      <div style={{ marginBottom: 28 }}>
        <Link href={`/tournois/${tournamentId}`} style={{ fontSize: 13, color: "var(--ink-mute)" }}>
          ← Retour au tournoi
        </Link>
        <h1 className="display" style={{ fontSize: "clamp(30px, 6vw, 48px)", margin: "12px 0 8px" }}>
          Modifier le tournoi
        </h1>
        {notice && <p style={{ color: "var(--amber)", margin: 0, fontSize: 14 }}>{notice}</p>}
      </div>

      <CyberCard ticks style={{ padding: "clamp(20px, 3vw, 32px)" }}>
        <TournamentForm
          mode="edit"
          initialValues={loaded.values}
          editableFields={editableFields}
          submitLabel="Enregistrer les modifications"
          onSubmit={async (values) => {
            const payload = toApiPayload(values);
            const body: Record<string, unknown> = {};
            for (const field of editableFields) body[field] = payload[field];

            const response = await fetch(`/api/tournaments/${tournamentId}/edit`, {
              method: "PATCH",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(body),
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error ?? "TOURNAMENT_UPDATE_FAILED");

            showSuccess("Tournoi modifié.");
            router.push(`/tournois/${tournamentId}`);
            router.refresh();
          }}
        />
      </CyberCard>
    </section>
  );
}
```

`toFormValues` convertit chaque date ISO en chaîne `datetime-local` — écrire ce petit helper dans `TournamentForm.tsx` et l'exporter, symétrique de `toApiPayload`.

Attention : `toApiPayload` produit `matchFormatType` / `matchFormatValue`, pas `matchFormat`. La boucle de filtrage ci-dessus doit donc traiter `matchFormat` à part — recopier les deux clés quand `matchFormat` est éditable.

- [ ] **Step 5 : Ajouter le bouton sur la fiche**

Dans `app/(secured)/tournois/[id]/page.tsx`, dans l'en-tête à côté du titre :

```tsx
{canShowEditButton(detail.card, detail.isAdmin) && (
  <CyberButton asChild variant="ghost">
    <Link href={`/tournois/${detail.card.id}/modifier`}>Modifier</Link>
  </CyberButton>
)}
```

- [ ] **Step 6 : Traduire les nouveaux codes d'erreur**

Dans `app/(secured)/tournois/[id]/_lib/error-map.ts`, ajouter à `ERROR_MESSAGES` :

```ts
  TOURNAMENT_LOCKED: "Le tournoi est en cours : il n'est plus modifiable.",
  FIELD_NOT_EDITABLE: "Ce réglage n'est plus modifiable depuis que le tournoi est visible.",
  MAX_TEAMS_CANNOT_DECREASE:
    "Le nombre de places ne peut plus être réduit une fois le tournoi visible.",
  REGISTRATION_CLOSE_IN_PAST:
    "La clôture des inscriptions ne peut pas être placée dans le passé.",
  EMPTY_PATCH: "Aucune modification à enregistrer.",
  TOURNAMENT_UPDATE_FAILED: "Erreur lors de la modification du tournoi.",
  INVALID_DATE_ORDER:
    "Les dates doivent se suivre : visibilité, ouverture, clôture, puis début.",
  INVALID_DATES: "Une des dates est illisible.",
  INVALID_MAX_TEAMS: "Le nombre de places doit être compris entre 2 et 256.",
  MISSING_NAME: "Le nom du tournoi est obligatoire.",
```

- [ ] **Step 7 : Lancer les tests et vérifier**

```bash
npx jest tests/tournois && npx tsc --noEmit && npm run lint
```

Attendu : PASS, aucune erreur.

- [ ] **Step 8 : Vérifier dans le navigateur**

Avec `DEV_AUTH_USER_ID=589` (admin) : ouvrir un tournoi **caché** (`SELECT id FROM bg_tournaments WHERE start_visibility_at > NOW()`), cliquer « Modifier », changer le nom et le format, enregistrer, vérifier le toast et la fiche. Puis ouvrir un tournoi **en inscriptions** : vérifier que format et jeu sont désactivés, que la phrase d'explication apparaît, et qu'une baisse d'effectif est refusée avec un message lisible. Enfin ouvrir un tournoi **en cours** : le bouton doit être absent.

- [ ] **Step 9 : Commit**

```bash
git add "app/(secured)/tournois/[id]/modifier/page.tsx" "app/(secured)/tournois/[id]/_lib/edit-entry.ts" "app/(secured)/tournois/[id]/_lib/error-map.ts" "app/(secured)/tournois/[id]/page.tsx" "app/(secured)/tournois/_components/TournamentForm.tsx" tests/tournois/tournament-edit-entry.test.ts
git commit --trailer 'Co-authored-by: Claude Opus 4.8 <noreply@anthropic.com>' -m "add tournament edit page"
```

---

## Task 7 : Documentation

**Files:**
- Create: `docs/features/TOURNAMENT_EDITING.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1 : Écrire la documentation de la fonctionnalité**

Créer `docs/features/TOURNAMENT_EDITING.md` couvrant : les trois fenêtres et leur condition ; la liste des champs de `RESTRICTED_FIELDS` et pourquoi `registrationOpenAt` n'y est pas ; les deux contraintes de valeur (`MAX_TEAMS_CANNOT_DECREASE`, `REGISTRATION_CLOSE_IN_PAST`) ; le tableau des codes HTTP de la route ; le fait que la fenêtre est recalculée sous `FOR UPDATE` ; le point d'extension (ajouter un champ = l'ajouter à `TournamentField`, à `ALL_TOURNAMENT_FIELDS`, au `SELECT`/`UPDATE` de `edit.ts` et au formulaire).

- [ ] **Step 2 : Ajouter la ligne à CLAUDE.md**

Dans la section « Tournament Engine » de `CLAUDE.md`, après la puce sur l'ordre de seeding :

```markdown
- **Édition d'un tournoi** (`lib/shared/tournament-edit.ts` pur + `lib/server/tournaments/edit.ts`) : trois fenêtres — `FULL` tant que `start_visibility_at` est dans le futur (tout est modifiable, personne n'a rien lu), `RESTRICTED` dès la publication (nom, description, clôture, début, effectif **à la hausse** seulement), `LOCKED` en `RUNNING`/`FINISHED`. La fenêtre est recalculée côté serveur sous `SELECT … FOR UPDATE` — jamais reprise du client. La validation des valeurs est partagée avec la création (`lib/server/tournaments/validation.ts`), sans quoi les deux jeux de règles divergeraient. Route `GET`/`PATCH /api/tournaments/[id]/edit`, réservée à `can(user, "tournaments")`. Voir `docs/features/TOURNAMENT_EDITING.md`.
```

- [ ] **Step 3 : Commit**

```bash
git add docs/features/TOURNAMENT_EDITING.md CLAUDE.md
git commit --trailer 'Co-authored-by: Claude Opus 4.8 <noreply@anthropic.com>' -m "document tournament editing"
```

---

## Task 8 : Vérification complète, polish et PR

- [ ] **Step 1 : Suite complète**

```bash
npm test
```

Attendu : PASS intégral. Aucun test préexistant modifié.

- [ ] **Step 2 : Lint et types**

```bash
npm run lint && npx tsc --noEmit
```

- [ ] **Step 3 : Vérification en conditions réelles**

```bash
npm run seed
```

Seul contrôle qui exerce réellement les migrations et le SQL — les tests simulent MySQL et ne peuvent pas détecter une colonne absente ou une requête invalide. Attendu : le seed va au bout et affiche l'id de l'admin.

- [ ] **Step 4 : Commit de polish**

Passe d'interface sans changement de logique : espacements du formulaire d'édition alignés sur ceux de la création, état `disabled` visuellement distinct (opacité et curseur), `aria-describedby` reliant chaque champ verrouillé à la phrase d'explication, focus au clavier conservé sur les champs actifs.

```bash
git add -A
git commit --trailer 'Co-authored-by: Claude Opus 4.8 <noreply@anthropic.com>' -m "polish edit form states"
```

- [ ] **Step 5 : Push et PR**

```bash
git push -u origin feature/tournois-acces-bloque-494a18
```

Puis `gh pr create` vers `main`. Corps de PR décrivant les trois fenêtres, la route, et **mentionnant explicitement la réserve** : la fuite d'accès aux tournois non visibles (`getTournamentDetail` et le flux SSE) n'est pas traitée par cette PR.

- [ ] **Step 6 : Boucle de revue**

Lancer `/code-review --comment` sur le diff, corriger, commiter, pousser, **relancer une revue complète**. Répéter jusqu'à un cycle sans aucun finding. Ne pas rendre la main avant cela, avec `npm test`, `npm run lint` et `npx tsc --noEmit` verts.

- [ ] **Step 7 : Arrêter les préviews**

Arrêter tout serveur de prévisualisation démarré pendant les tâches 5 et 6.
