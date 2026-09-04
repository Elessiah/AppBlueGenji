import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { PoolConnection } from "mysql2/promise";
import { findTournamentsNeedingSync } from "@/lib/server/tournaments/sync-scope";

/**
 * L'entretien de fond ne visite plus que les tournois qui ont **quelque chose à
 * faire**.
 *
 * Il repassait sur tous les tournois non terminés, dans une transaction unique,
 * et refaisait pour chacun le tour de son entretien : sur une base de
 * démonstration (76 tournois, dont 46 en cours), une passe dépassait les cinq
 * minutes — et, la lecture de la liste l'attendant, l'accueil et toute écriture
 * sur `bg_tournaments` attendaient derrière.
 *
 * Le repérage se pose en deux temps, parce que la question a deux natures :
 * les **jalons de calendrier** se tranchent en mémoire avec la règle partagée
 * (`computeTournamentState`), les **entretiens dus** par des `EXISTS` indexés.
 */

type Row = Record<string, unknown>;

const NOW = new Date("2026-06-15T12:00:00Z");

function at(offsetHours: number): Date {
  return new Date(NOW.getTime() + offsetHours * 3600_000);
}

/** Tournoi dont l'état stocké correspond à ses dates : rien à faire. */
function settledRow(overrides: Row = {}): Row {
  return {
    id: 1,
    state: "REGISTRATION",
    finished_at: null,
    registration_open_at: at(-48),
    registration_close_at: at(24),
    start_at: at(48),
    ...overrides,
  };
}

/**
 * Connexion factice routée **par le SQL** : les deux lectures du module partent
 * l'une après l'autre, mais un test n'a pas à figer leur ordre.
 */
function makeConn(schedule: Row[], maintenance: Row[]) {
  const execute = jest.fn(async (sql: unknown) => {
    const text = String(sql);
    if (text.includes("registration_open_at, registration_close_at")) return [schedule];
    if (text.includes("t.state = 'RUNNING'")) return [maintenance];
    return [[]];
  });
  return { execute } as unknown as PoolConnection & { execute: jest.Mock };
}

/** Le SQL du repérage d'entretien, tel que le module l'émet. */
async function maintenanceSql(): Promise<string> {
  const conn = makeConn([], []);
  await findTournamentsNeedingSync(conn);
  return conn.execute.mock.calls
    .map((call) => String(call[0]))
    .find((sql) => sql.includes("t.state = 'RUNNING'"))!;
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers().setSystemTime(NOW);
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("findTournamentsNeedingSync — jalons de calendrier", () => {
  it("ignore un tournoi dont l'état stocké dit déjà la vérité", async () => {
    const conn = makeConn([settledRow()], []);

    expect(await findTournamentsNeedingSync(conn)).toEqual([]);
  });

  it("retient un tournoi dont les inscriptions viennent d'ouvrir", async () => {
    const conn = makeConn(
      [settledRow({ id: 7, state: "UPCOMING", registration_open_at: at(-1) })],
      [],
    );

    expect(await findTournamentsNeedingSync(conn)).toEqual([7]);
  });

  it("retient un tournoi dont l'heure de début est passée", async () => {
    const conn = makeConn(
      [
        settledRow({
          id: 3,
          state: "REGISTRATION",
          registration_close_at: at(-2),
          start_at: at(-1),
        }),
      ],
      [],
    );

    expect(await findTournamentsNeedingSync(conn)).toEqual([3]);
  });

  // Entre la clôture des inscriptions et le coup d'envoi, un tournoi repasse par
  // `UPCOMING` : c'est une bascule comme une autre, et elle doit être vue.
  it("retient le retour à UPCOMING après la clôture des inscriptions", async () => {
    const conn = makeConn(
      [settledRow({ id: 4, state: "REGISTRATION", registration_close_at: at(-1) })],
      [],
    );

    expect(await findTournamentsNeedingSync(conn)).toEqual([4]);
  });

  // La règle est celle du client : la réécrire en SQL en ferait une seconde, et
  // les deux finiraient par diverger.
  it("ne lit que les colonnes de date, et laisse le calcul à la règle partagée", async () => {
    const conn = makeConn([], []);

    await findTournamentsNeedingSync(conn);

    const sql = conn.execute.mock.calls
      .map((call) => String(call[0]))
      .find((text) => text.includes("registration_open_at, registration_close_at"))!;
    expect(sql).toContain("state <> 'FINISHED'");
    expect(sql).not.toContain("NOW()");
  });
});

describe("findTournamentsNeedingSync — entretien dû", () => {
  it("remonte les tournois désignés par la requête d'entretien", async () => {
    const conn = makeConn([], [{ id: 12 }, { id: 15 }]);

    expect(await findTournamentsNeedingSync(conn)).toEqual([12, 15]);
  });

  it("ne cherche l'entretien que sur les tournois en cours", async () => {
    expect(await maintenanceSql()).toContain("t.state = 'RUNNING'");
  });

  // Une condition par tâche de la branche RUNNING de `syncTournamentState` :
  // ce qui n'a pas de précondition ici ne sera jamais entretenu.
  it("couvre le plateau d'élimination manquant", async () => {
    const sql = await maintenanceSql();
    expect(sql).toContain("t.bracket_size IS NULL");
    expect(sql).toContain("t.format IN ('SINGLE', 'DOUBLE')");
  });

  it("couvre les reports de score expirés", async () => {
    const sql = await maintenanceSql();
    expect(sql).toContain("m.status = 'AWAITING_CONFIRMATION'");
    expect(sql).toContain("m.score_deadline_at <= NOW()");
  });

  it("couvre les byes et matchs fantômes encore ouverts", async () => {
    const sql = await maintenanceSql();
    expect(sql).toContain("m.team1_id IS NULL OR m.team2_id IS NULL");
  });

  it("couvre la clôture d'une élimination entièrement jouée", async () => {
    const sql = await maintenanceSql();
    expect(sql).toContain("m.winner_team_id IS NULL");
    expect(sql).toContain("m.team1_id IS NOT NULL OR m.team2_id IS NOT NULL");
  });

  // Un plateau sans adversaires resté « en cours » doit être rattrapé : aucun
  // match ne viendra le clore.
  it("couvre le tournoi sous-rempli resté en cours", async () => {
    const sql = await maintenanceSql();
    expect(sql).toMatch(/FROM bg_tournament_registrations r\s+WHERE r\.tournament_id = t\.id\) < 2/);
  });
});

describe("findTournamentsNeedingSync — assemblage", () => {
  it("réunit les deux sources sans doublon et dans l'ordre", async () => {
    const conn = makeConn(
      [
        settledRow({ id: 9, state: "UPCOMING", registration_open_at: at(-1) }),
        settledRow({ id: 2, state: "UPCOMING", registration_open_at: at(-1) }),
      ],
      [{ id: 9 }, { id: 5 }],
    );

    expect(await findTournamentsNeedingSync(conn)).toEqual([2, 5, 9]);
  });

  it("ne rend rien quand il n'y a rien à faire", async () => {
    const conn = makeConn([settledRow(), settledRow({ id: 2 })], []);

    expect(await findTournamentsNeedingSync(conn)).toEqual([]);
  });

  // Deux requêtes, quel que soit le nombre de tournois : c'est tout le coût du
  // repérage.
  it("tient en deux requêtes", async () => {
    const conn = makeConn([settledRow()], []);

    await findTournamentsNeedingSync(conn);

    expect(conn.execute).toHaveBeenCalledTimes(2);
  });
});
