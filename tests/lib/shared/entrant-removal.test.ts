import { describe, expect, it } from "@jest/globals";

import {
  ENTRANT_REMOVAL_BLOCK_MESSAGES,
  canRemoveEntrant,
  entrantRemovalBlockMessage,
  entrantRemovalBlockReason,
  type RemovableEntrantTournament,
} from "@/lib/shared/entrant-removal";
import type { TournamentState } from "@/lib/shared/types";

/**
 * La fenêtre de retrait d'un engagé — « jusqu'au début du tournoi, pas une
 * seconde de plus ».
 *
 * Trois pannes possibles, et elles ne se voient pas de la même façon :
 *
 * 1. la fenêtre **trop large** — on retire une inscrite d'un plateau déjà tiré,
 *    ce qui laisse un match sans adversaire et un classement qui compte un
 *    absent ;
 * 2. la fenêtre **trop étroite** — le geste devient inutilisable précisément
 *    quand on en a besoin, la veille du tournoi ;
 * 3. une **seule** des deux lectures de l'état — la panne silencieuse : tout
 *    marche, sauf sur les tournois que personne n'a ouverts depuis leur heure de
 *    début, ou sur ceux qu'un staff a lancés en avance.
 */

const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 0, 15, 12, 0, 0);

/** Tournoi aux inscriptions, coup d'envoi dans deux heures. */
function tournament(
  overrides: Partial<RemovableEntrantTournament> = {},
): RemovableEntrantTournament {
  return {
    state: "REGISTRATION",
    registrationOpenAt: new Date(NOW - 48 * HOUR).toISOString(),
    registrationCloseAt: new Date(NOW + HOUR).toISOString(),
    startAt: new Date(NOW + 2 * HOUR).toISOString(),
    ...overrides,
  };
}

describe("entrantRemovalBlockReason — la fenêtre est ouverte", () => {
  it("pendant les inscriptions", () => {
    expect(entrantRemovalBlockReason(tournament(), NOW)).toBeNull();
    expect(canRemoveEntrant(tournament(), NOW)).toBe(true);
  });

  it("dans l'entre-deux : inscriptions closes, coup d'envoi à venir", () => {
    // C'est le cas qui compte le plus en pratique — un désistement de la veille
    // arrive après la clôture —, et c'est celui qu'une règle écrite sur le seul
    // `REGISTRATION` aurait manqué. `computeTournamentState` retombe alors à
    // `UPCOMING`, ce qui n'est pas « a commencé ».
    const closed = tournament({
      state: "UPCOMING",
      registrationCloseAt: new Date(NOW - HOUR).toISOString(),
    });

    expect(entrantRemovalBlockReason(closed, NOW)).toBeNull();
  });

  it("avant même l'ouverture des inscriptions", () => {
    const early = tournament({
      state: "UPCOMING",
      registrationOpenAt: new Date(NOW + HOUR).toISOString(),
      registrationCloseAt: new Date(NOW + 2 * HOUR).toISOString(),
      startAt: new Date(NOW + 3 * HOUR).toISOString(),
    });

    expect(entrantRemovalBlockReason(early, NOW)).toBeNull();
  });

  it("à la seconde qui précède le coup d'envoi", () => {
    const eve = tournament({
      registrationCloseAt: new Date(NOW - HOUR).toISOString(),
      startAt: new Date(NOW + 1000).toISOString(),
    });

    expect(entrantRemovalBlockReason(eve, NOW)).toBeNull();
  });
});

describe("entrantRemovalBlockReason — la fenêtre est fermée", () => {
  it("à l'instant même du coup d'envoi, bornes comprises", () => {
    // `computeTournamentState` rend `RUNNING` dès `now >= startAt` : la borne
    // appartient au tournoi lancé, pas à la fenêtre de retrait. Un `>` au lieu
    // d'un `>=` laisserait passer exactement un retrait, sur le plateau qu'on
    // vient de tirer.
    const kickoff = tournament({
      registrationCloseAt: new Date(NOW - HOUR).toISOString(),
      startAt: new Date(NOW).toISOString(),
    });

    expect(entrantRemovalBlockReason(kickoff, NOW)).toBe("ENTRANT_REMOVAL_TOURNAMENT_STARTED");
    expect(canRemoveEntrant(kickoff, NOW)).toBe(false);
  });

  it("sur un tournoi en cours", () => {
    expect(entrantRemovalBlockReason(tournament({ state: "RUNNING" }), NOW)).toBe(
      "ENTRANT_REMOVAL_TOURNAMENT_STARTED",
    );
  });

  it("sur un tournoi terminé", () => {
    expect(entrantRemovalBlockReason(tournament({ state: "FINISHED" }), NOW)).toBe(
      "ENTRANT_REMOVAL_TOURNAMENT_FINISHED",
    );
  });

  it("sur un tournoi porteur d'une date de clôture, quel que soit son état stocké", () => {
    const finished = tournament({ finishedAt: new Date(NOW - HOUR).toISOString() });

    expect(entrantRemovalBlockReason(finished, NOW)).toBe(
      "ENTRANT_REMOVAL_TOURNAMENT_FINISHED",
    );
  });
});

describe("entrantRemovalBlockReason — les deux lectures de l'état", () => {
  it("l'état stocké rattrape un tournoi lancé avant l'heure annoncée", () => {
    // Lancement anticipé (`tournament-launch.ts`) : les dates sont abrégées dans
    // la même transaction, mais un appelant qui ne consulterait que le calendrier
    // d'origine verrait encore « inscriptions » sur un tournoi déjà tiré.
    const early = tournament({
      state: "RUNNING",
      registrationCloseAt: new Date(NOW + HOUR).toISOString(),
      startAt: new Date(NOW + 2 * HOUR).toISOString(),
    });

    expect(entrantRemovalBlockReason(early, NOW)).toBe("ENTRANT_REMOVAL_TOURNAMENT_STARTED");
  });

  it("l'état calculé rattrape une colonne qui n'a pas été recalée", () => {
    // Personne n'a ouvert la page depuis l'heure de début : `state` vaut encore
    // `REGISTRATION`. Ne lire que lui autoriserait un retrait après le coup
    // d'envoi, au seul motif que nul n'était allé voir.
    const stale = tournament({
      state: "REGISTRATION",
      registrationCloseAt: new Date(NOW - 2 * HOUR).toISOString(),
      startAt: new Date(NOW - HOUR).toISOString(),
    });

    expect(entrantRemovalBlockReason(stale, NOW)).toBe("ENTRANT_REMOVAL_TOURNAMENT_STARTED");
  });
});

describe("les phrases du refus", () => {
  it.each(Object.keys(ENTRANT_REMOVAL_BLOCK_MESSAGES) as (keyof typeof ENTRANT_REMOVAL_BLOCK_MESSAGES)[])(
    "%s a une phrase française, jamais son propre code",
    (reason) => {
      const message = entrantRemovalBlockMessage(reason);

      expect(message).not.toBe(reason);
      expect(/^[A-Z][A-Z0-9_]*$/.test(message)).toBe(false);
      expect(message.length).toBeGreaterThan(20);
    },
  );

  it("distingue les deux causes : « commencé » n'est pas « terminé »", () => {
    // Deux codes pour une règle unique, justement pour que le tournoi terminé
    // ne s'entende pas dire qu'il vient de commencer.
    expect(ENTRANT_REMOVAL_BLOCK_MESSAGES.ENTRANT_REMOVAL_TOURNAMENT_STARTED).not.toBe(
      ENTRANT_REMOVAL_BLOCK_MESSAGES.ENTRANT_REMOVAL_TOURNAMENT_FINISHED,
    );
    // Celle du tournoi lancé nomme le geste qui reste ouvert : qui vient ici
    // cherche l'abandon.
    expect(ENTRANT_REMOVAL_BLOCK_MESSAGES.ENTRANT_REMOVAL_TOURNAMENT_STARTED).toMatch(/abandon/i);
  });
});

describe("couverture des états", () => {
  it.each([
    ["UPCOMING", null],
    ["REGISTRATION", null],
    ["RUNNING", "ENTRANT_REMOVAL_TOURNAMENT_STARTED"],
    ["FINISHED", "ENTRANT_REMOVAL_TOURNAMENT_FINISHED"],
  ] as const)("%s → %s, calendrier neutre", (state, expected) => {
    // Calendrier volontairement « au milieu des inscriptions » : ce qui est
    // mesuré ici est la contribution de l'état stocké seul.
    expect(entrantRemovalBlockReason(tournament({ state: state as TournamentState }), NOW)).toBe(
      expected,
    );
  });
});
