import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

/**
 * L'instantané partagé est la pièce maîtresse de la refonte : c'est lui qui fait
 * qu'un score rapporté devant cent spectateurs coûte **un** calcul et non cent.
 *
 * Cette propriété-là ne peut pas être vérifiée depuis `tournament-broadcast`,
 * qui remplace ce module par un bouchon : son « ne calcule qu'une fois pour
 * toute la salle » prouve seulement que la salle n'appelle qu'une fois. On
 * exerce donc ici le vrai module, base bouchonnée — comme le fait déjà
 * `state-running-maintenance.test.ts`.
 */
jest.mock("@/lib/server/tournaments/repository");
jest.mock("@/lib/server/tournaments/state");
jest.mock("@/lib/server/tournaments/list-cache");
jest.mock("@/lib/server/solo-entries-service");
jest.mock("@/lib/server/database");
// Les formats à classement chargent leurs métadonnées : hors sujet ici, et elles
// exigeraient une vraie base.
jest.mock("@/lib/server/tournaments/swiss");
jest.mock("@/lib/server/tournaments/survival");
jest.mock("@/lib/server/tournaments/bg-survie");
// Le classement du site rejoue tout `bg_matches` : bouchonné, seul compte ici
// l'ordre qu'il rend.
jest.mock("@/lib/server/ranking-service");

import {
  getTournamentSnapshot,
  getTournamentSnapshotFrame,
  invalidateTournamentSnapshot,
} from "@/lib/server/tournaments/snapshot";
import {
  getMatchRows,
  getRegistrationRows,
  getTournamentListRow,
  loadTournamentRow,
} from "@/lib/server/tournaments/repository";
import { hasPendingStateTransition, syncTournamentState } from "@/lib/server/tournaments/state";
import { invalidateTournamentLists } from "@/lib/server/tournaments/list-cache";
import { getDatabase } from "@/lib/server/database";
import { loadSwissMeta } from "@/lib/server/tournaments/swiss";
import { loadSurvivalMeta } from "@/lib/server/tournaments/survival";
import { loadEnduranceMeta } from "@/lib/server/tournaments/bg-survie";
import { loadEntrantsBySiteRanking } from "@/lib/server/ranking-service";
import { clearCache } from "@/lib/server/cache";
import type { TournamentListRow, TournamentRow } from "@/lib/server/tournaments/_internal";
import { fakePool } from "../../helpers/sql-double";
import type { RowOverrides } from "../../helpers/row-overrides";
import {
  registrationRow,
  tournamentListRow,
  tournamentRow,
} from "../../helpers/tournament-rows";

const TOURNAMENT_ID = 5;

/** Ligne de tournoi en cours, plateau déjà construit : aucun entretien requis. */
function runningRow(overrides: RowOverrides<TournamentRow> = {}): TournamentRow {
  const past = new Date(Date.now() - 86_400_000);
  return tournamentRow({
    id: TOURNAMENT_ID,
    state: "RUNNING",
    format: "SINGLE",
    participant_type: "TEAM",
    finished_at: null,
    registration_open_at: past,
    registration_close_at: past,
    start_at: past,
    bracket_size: 8,
    ...overrides,
  });
}

/** Ligne de liste, telle que `mapCard` l'attend. */
function listRow(overrides: RowOverrides<TournamentListRow> = {}): TournamentListRow {
  const past = new Date(Date.now() - 86_400_000);
  return tournamentListRow({
    id: TOURNAMENT_ID,
    name: "Tournoi",
    state: "RUNNING",
    start_visibility_at: past,
    registration_open_at: past,
    registration_close_at: past,
    start_at: past,
    bracket_size: 8,
    created_at: past,
    registered_teams: 2,
    ...overrides,
  });
}

/**
 * Connexion bouchonnée : le module en emprunte une pour lire, et une seconde
 * (transactionnelle) quand l'entretien s'impose.
 */
const connection = {
  release: jest.fn(),
  beginTransaction: jest.fn(async () => undefined),
  commit: jest.fn(async () => undefined),
  rollback: jest.fn(async () => undefined),
};
let expiredRows: unknown[] = [];

beforeEach(() => {
  jest.clearAllMocks();
  clearCache();
  expiredRows = [];

  jest.mocked(getDatabase).mockResolvedValue(fakePool({
    getConnection: jest.fn(async () => connection),
    execute: jest.fn(async () => [expiredRows]),
  }));

  jest.mocked(loadTournamentRow).mockResolvedValue(runningRow());
  jest.mocked(hasPendingStateTransition).mockResolvedValue(false);
  jest.mocked(syncTournamentState).mockResolvedValue({
    row: runningRow(),
    stateChanged: false,
    contentChanged: false,
  });
  jest.mocked(getTournamentListRow).mockResolvedValue(listRow());
  jest.mocked(getRegistrationRows).mockResolvedValue([]);
  jest.mocked(getMatchRows).mockResolvedValue([]);
  jest.mocked(loadSwissMeta).mockResolvedValue(null);
  jest.mocked(loadSurvivalMeta).mockResolvedValue(null);
  jest.mocked(loadEnduranceMeta).mockResolvedValue(null);
});

afterEach(() => {
  clearCache();
  jest.restoreAllMocks();
});

describe("getTournamentSnapshotFrame — mutualisation", () => {
  it("ne construit qu'un instantané pour cent lecteurs simultanés", async () => {
    // La propriété qui justifie toute la refonte : avant, chacun reconstruisait
    // le détail pour lui-même — cent fois le même travail, en même temps, sur un
    // pool de 25 connexions.
    const readers = Array.from({ length: 100 }, () => getTournamentSnapshotFrame(TOURNAMENT_ID));
    const frames = await Promise.all(readers);

    expect(getTournamentListRow).toHaveBeenCalledTimes(1);
    // Tous repartent avec exactement la même trame, encodée une seule fois.
    for (const frame of frames) expect(frame).toBe(frames[0]);
  });

  it("resert l'instantané en cache aux lectures suivantes", async () => {
    await getTournamentSnapshotFrame(TOURNAMENT_ID);
    await getTournamentSnapshotFrame(TOURNAMENT_ID);

    expect(getTournamentListRow).toHaveBeenCalledTimes(1);
  });

  it("le reconstruit dès qu'une écriture l'invalide", async () => {
    // C'est ce qui permet une durée de vie confortable sans jamais afficher un
    // score périmé.
    await getTournamentSnapshotFrame(TOURNAMENT_ID);
    invalidateTournamentSnapshot(TOURNAMENT_ID);
    await getTournamentSnapshotFrame(TOURNAMENT_ID);

    expect(getTournamentListRow).toHaveBeenCalledTimes(2);
  });

  it("porte une empreinte qui suit le contenu", async () => {
    const first = await getTournamentSnapshotFrame(TOURNAMENT_ID);

    invalidateTournamentSnapshot(TOURNAMENT_ID);
    jest.mocked(getTournamentListRow).mockResolvedValue(
      listRow({ registered_teams: 3 }),
    );
    const second = await getTournamentSnapshotFrame(TOURNAMENT_ID);

    expect(second!.version).not.toBe(first!.version);
  });

  it("rend null pour un tournoi inexistant", async () => {
    jest.mocked(loadTournamentRow).mockResolvedValue(null);
    expect(await getTournamentSnapshot(TOURNAMENT_ID)).toBeNull();
  });
});

describe("getTournamentSnapshotFrame — entretien à la lecture", () => {
  it("n'ouvre aucune transaction quand il n'y a rien à faire", async () => {
    await getTournamentSnapshotFrame(TOURNAMENT_ID);
    expect(syncTournamentState).not.toHaveBeenCalled();
  });

  it("déclenche une bascule d'état en retard, quel que soit l'état courant", async () => {
    // Auparavant l'entretien était réservé aux tournois déjà `RUNNING` : la page
    // d'un tournoi dont l'heure de début était passée restait aux inscriptions
    // jusqu'à ce que quelqu'un aille charger la liste.
    jest.mocked(loadTournamentRow).mockResolvedValue(
      runningRow({ state: "REGISTRATION" }),
    );
    jest.mocked(hasPendingStateTransition).mockResolvedValue(true);

    await getTournamentSnapshotFrame(TOURNAMENT_ID);

    expect(syncTournamentState).toHaveBeenCalled();
  });

  it("construit le plateau manquant d'un tournoi en cours", async () => {
    jest.mocked(loadTournamentRow).mockResolvedValue(
      runningRow({ bracket_size: null }),
    );

    await getTournamentSnapshotFrame(TOURNAMENT_ID);

    expect(syncTournamentState).toHaveBeenCalled();
  });

  it.each<TournamentRow["format"]>(["MULTI", "SWISS", "SURVIVAL", "BG_SURVIE"])(
    "n'ouvre aucune transaction pour un tournoi %s dont `bracket_size` est nul",
    async (format) => {
      // `bracket_size` ne décrit que les formats à plateau, et seul l'un d'eux
      // le renseigne : en `MULTI` la taille vit sur `bg_tournament_phases`, si
      // bien que cette colonne reste **définitivement** nulle. Sans filtre de
      // format, chaque reconstruction d'instantané d'un multi-phases en cours
      // ouvrait une transaction d'entretien — juste ce que ce module promet
      // d'éviter.
      jest.mocked(loadTournamentRow).mockResolvedValue(
        runningRow({ format, bracket_size: null }),
      );

      await getTournamentSnapshotFrame(TOURNAMENT_ID);

      expect(syncTournamentState).not.toHaveBeenCalled();
    },
  );

  it("arbitre un report de score expiré", async () => {
    expiredRows = [{ 1: 1 }];

    await getTournamentSnapshotFrame(TOURNAMENT_ID);

    expect(syncTournamentState).toHaveBeenCalled();
  });

  it("fait connaître aux listes une bascule déclenchée à la lecture", async () => {
    // La même bascule déclenchée depuis la liste publie un événement ; sans ce
    // pendant, un tournoi démarré parce qu'un spectateur a ouvert sa page
    // resterait annoncé « Inscriptions » dans la liste en cache.
    jest.mocked(hasPendingStateTransition).mockResolvedValue(true);
    jest.mocked(syncTournamentState).mockResolvedValue({
      row: runningRow(),
      stateChanged: true,
      contentChanged: false,
    });

    await getTournamentSnapshotFrame(TOURNAMENT_ID);

    expect(invalidateTournamentLists).toHaveBeenCalled();
  });

  it("fait connaître aux listes un plateau créé à la lecture", async () => {
    // Le moteur ne publie plus depuis le fond de sa transaction : il rend
    // `contentChanged`, et c'est ici — après le commit — que la liste apprend
    // que `bracket_size` a bougé.
    jest.mocked(loadTournamentRow).mockResolvedValue(
      runningRow({ bracket_size: null }),
    );
    jest.mocked(syncTournamentState).mockResolvedValue({
      row: runningRow({ bracket_size: 8 }),
      stateChanged: false,
      contentChanged: true,
    });

    await getTournamentSnapshotFrame(TOURNAMENT_ID);

    expect(invalidateTournamentLists).toHaveBeenCalled();
  });

  it("ne touche pas aux listes quand rien n'a basculé", async () => {
    jest.mocked(hasPendingStateTransition).mockResolvedValue(true);

    await getTournamentSnapshotFrame(TOURNAMENT_ID);

    expect(invalidateTournamentLists).not.toHaveBeenCalled();
  });
});

describe("getTournamentSnapshot — provenance de l'ordre de seeding", () => {
  it("annonce l'ordre d'inscription pour un format à plateau", async () => {
    const snapshot = await getTournamentSnapshot(TOURNAMENT_ID);
    expect(snapshot?.seedingSource).toBe("REGISTRATION");
  });

  it("annonce le classement du site pour un format à classement", async () => {
    jest.mocked(loadTournamentRow).mockResolvedValue(runningRow({ format: "SWISS" }));
    jest.mocked(syncTournamentState).mockResolvedValue({
      row: runningRow({ format: "SWISS" }),
      stateChanged: false,
      contentChanged: false,
    });
    jest.mocked(getTournamentListRow).mockResolvedValue(listRow({ format: "SWISS" }));

    const snapshot = await getTournamentSnapshot(TOURNAMENT_ID);
    expect(snapshot?.seedingSource).toBe("RANKING");
  });

  it("annonce l'ordre du staff dès que manual_seeding est posé, format à classement compris", async () => {
    // Sans quoi l'interface continuerait d'avertir « ce n'est pas le tirage »
    // alors que le staff vient précisément de le fixer.
    jest.mocked(loadTournamentRow).mockResolvedValue(
      runningRow({ format: "SWISS", manual_seeding: 1 }),
    );
    jest.mocked(syncTournamentState).mockResolvedValue({
      row: runningRow({ format: "SWISS", manual_seeding: 1 }),
      stateChanged: false,
      contentChanged: false,
    });
    jest.mocked(getTournamentListRow).mockResolvedValue(listRow({ format: "SWISS" }));

    const snapshot = await getTournamentSnapshot(TOURNAMENT_ID);
    expect(snapshot?.seedingSource).toBe("MANUAL");
  });
});

describe("getTournamentSnapshot — inscrites rangées par le classement du site", () => {
  /** Tournoi aux inscriptions (ou clos, selon `state`), dans le format donné. */
  function preLaunch(
    format: TournamentRow["format"],
    state: TournamentRow["state"] = "REGISTRATION",
    manualSeeding = 0,
  ) {
    const row = runningRow({ format, state, manual_seeding: manualSeeding, bracket_size: null });
    jest.mocked(loadTournamentRow).mockResolvedValue(row);
    jest.mocked(syncTournamentState).mockResolvedValue({
      row,
      stateChanged: false,
      contentChanged: false,
    });
    jest.mocked(getTournamentListRow).mockResolvedValue(listRow({ format, state }));
  }

  // Ordre d'arrivée : Alpha, Beta, Gamma (seeds 1, 2, 3).
  const arrivals = [
    registrationRow({ team_id: 1, team_name: "Alpha", seed: 1 }),
    registrationRow({ team_id: 2, team_name: "Beta", seed: 2 }),
    registrationRow({ team_id: 3, team_name: "Gamma", seed: 3 }),
  ];

  beforeEach(() => {
    jest.mocked(getRegistrationRows).mockResolvedValue(arrivals);
    // Classement du site : Gamma, Alpha, Beta.
    jest.mocked(loadEntrantsBySiteRanking).mockResolvedValue([
      { teamId: 3, teamName: "Gamma" },
      { teamId: 1, teamName: "Alpha" },
      { teamId: 2, teamName: "Beta" },
    ]);
  });

  const order = (snapshot: Awaited<ReturnType<typeof getTournamentSnapshot>>) =>
    snapshot?.registrations.map((reg) => [reg.teamName, reg.seed]);

  it.each<[TournamentRow["format"], TournamentRow["state"]]>([
    ["BG_SURVIE", "REGISTRATION"],
    ["BG_SURVIE", "UPCOMING"],
    ["SWISS", "REGISTRATION"],
    ["SURVIVAL", "UPCOMING"],
  ])("range une %s en %s dans l'ordre du classement, rangs renumérotés", async (format, state) => {
    preLaunch(format, state);

    const snapshot = await getTournamentSnapshot(TOURNAMENT_ID);

    expect(order(snapshot)).toEqual([
      ["Gamma", 1],
      ["Alpha", 2],
      ["Beta", 3],
    ]);
    // Lecture mutualisée : l'instantané n'écrit rien, il n'a pas à rejouer
    // tout `bg_matches` à chaque construction.
    // Double partiel de connexion : Jest 30 confronte les arguments à la
    // signature simulée, d'où le `as never` (cf. CLAUDE.md, « Tests »).
    expect(loadEntrantsBySiteRanking).toHaveBeenCalledWith(connection as never, TOURNAMENT_ID, {
      transactional: false,
    });
  });

  it("garde l'ordre d'arrivée d'un format à plateau", async () => {
    preLaunch("SINGLE");

    const snapshot = await getTournamentSnapshot(TOURNAMENT_ID);

    expect(order(snapshot)).toEqual([
      ["Alpha", 1],
      ["Beta", 2],
      ["Gamma", 3],
    ]);
    expect(loadEntrantsBySiteRanking).not.toHaveBeenCalled();
  });

  it("garde l'ordre saisi par le staff", async () => {
    preLaunch("BG_SURVIE", "REGISTRATION", 1);

    const snapshot = await getTournamentSnapshot(TOURNAMENT_ID);

    expect(snapshot?.seedingSource).toBe("MANUAL");
    expect(order(snapshot)?.map(([name]) => name)).toEqual(["Alpha", "Beta", "Gamma"]);
    expect(loadEntrantsBySiteRanking).not.toHaveBeenCalled();
  });

  it("ne suit plus le classement une fois le tournoi lancé", async () => {
    // Les matchs du tournoi font bouger les cotes : le tirage, lui, est fait.
    preLaunch("BG_SURVIE", "RUNNING");

    const snapshot = await getTournamentSnapshot(TOURNAMENT_ID);

    expect(order(snapshot)?.map(([name]) => name)).toEqual(["Alpha", "Beta", "Gamma"]);
    expect(loadEntrantsBySiteRanking).not.toHaveBeenCalled();
  });

  it("garde en fin de liste une inscrite que le classement n'a pas encore vue", async () => {
    // Inscrite entre les deux lectures : elle ne doit pas disparaître.
    jest.mocked(loadEntrantsBySiteRanking).mockResolvedValue([
      { teamId: 2, teamName: "Beta" },
      { teamId: 1, teamName: "Alpha" },
    ]);
    preLaunch("BG_SURVIE");

    const snapshot = await getTournamentSnapshot(TOURNAMENT_ID);

    expect(order(snapshot)).toEqual([
      ["Beta", 1],
      ["Alpha", 2],
      ["Gamma", 3],
    ]);
  });
});
