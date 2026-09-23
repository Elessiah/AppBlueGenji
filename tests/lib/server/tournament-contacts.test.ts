import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/auth");

import {
  loadContactTournamentState,
  loadTournamentContacts,
} from "@/lib/server/tournaments/contacts";
import { GET } from "@/app/api/admin/tournaments/[id]/contacts/route";
import { getDatabase } from "@/lib/server/database";
import { getCurrentUser } from "@/lib/server/auth";

/**
 * Les contacts Discord d'un plateau.
 *
 * Trois propriétés portent la feuille, et ce sont les trois clauses de la règle
 * de visibilité du tag : **seul un tag certifié en sort** (filtre en SQL, sur la
 * colonne qui porte la preuve), la route est **réservée au staff `tournaments`**,
 * et elle se **ferme avec le tournoi** — sans cette dernière, le panneau rendrait
 * après la clôture ce que la fiche d'un joueur refuse.
 *
 * Voir `docs/features/DISCORD_VERIFICATION.md`.
 */

type ContactRow = {
  team_id: number;
  team_name: string;
  user_id: number | null;
  pseudo: string | null;
  discord_tag: string | null;
};

/**
 * Base factice. `state` est celui que rendra la lecture d'état de la route ;
 * `null` = le tournoi n'existe pas.
 */
function fakeDb(rows: ContactRow[], state: string | null = "RUNNING") {
  const execute = jest.fn(async (sql: string) => {
    if (String(sql).includes("SELECT state FROM bg_tournaments")) {
      return [state === null ? [] : [{ state }]];
    }
    return [rows];
  });
  (getDatabase as jest.Mock).mockResolvedValue({ execute } as never);
  return { execute };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("loadTournamentContacts", () => {
  it("groupe par engagé et signale ceux qu'on ne peut pas joindre", async () => {
    fakeDb([
      { team_id: 10, team_name: "Dragon Squad", user_id: 1, pseudo: "Nova", discord_tag: "nova" },
      { team_id: 10, team_name: "Dragon Squad", user_id: 2, pseudo: "Zed", discord_tag: null },
      { team_id: 11, team_name: "Phoenix", user_id: 3, pseudo: "Ash", discord_tag: null },
    ]);

    const groups = await loadTournamentContacts(5);

    expect(groups).toHaveLength(2);
    expect(groups[0]).toEqual({
      teamId: 10,
      teamName: "Dragon Squad",
      reachable: true,
      members: [
        { userId: 1, pseudo: "Nova", discordTag: "nova" },
        { userId: 2, pseudo: "Zed", discordTag: null },
      ],
    });
    // L'engagé injoignable est ce qui appelle un geste : il porte son propre
    // drapeau plutôt que d'être recalculé par chaque écran.
    expect(groups[1].reachable).toBe(false);
  });

  it("garde l'engagé sans joueur (équipe fantôme) avec un roster vide", async () => {
    // La jointure gauche rend une ligne sans joueur : l'engagé existe, son
    // roster est vide, et c'est exact — le site ne sait pas qui le staff a invité.
    fakeDb([{ team_id: 900, team_name: "Invitée", user_id: null, pseudo: null, discord_tag: null }]);

    const groups = await loadTournamentContacts(5);

    expect(groups).toEqual([
      { teamId: 900, teamName: "Invitée", reachable: false, members: [] },
    ]);
  });

  it("ne rend le tag que certifié, et le filtre est en SQL", async () => {
    const { execute } = fakeDb([]);

    await loadTournamentContacts(5);

    const sql = String((execute.mock.calls[0] as unknown[])[0]).replace(/\s+/g, " ");
    // Un tag non certifié ne sort pas, administrateur compris : c'est la clause
    // qui protège les comptes d'avant la certification.
    expect(sql).toContain("WHEN u.discord_verified_at IS NULL THEN NULL");
    // Les membres **actifs** seulement : un joueur parti n'est plus un
    // interlocuteur.
    expect(sql).toContain("tm.left_at IS NULL");
    // L'entrée solo n'a aucun membre : son joueur se lit sur `solo_user_id`.
    expect(sql).toContain("COALESCE(tm.user_id, t.solo_user_id)");
    // Ordre du tirage : la liste se lit comme le plateau.
    expect(sql).toContain("ORDER BY r.seed ASC");
  });

  it("rend une liste vide sur un plateau sans engagé", async () => {
    fakeDb([]);
    expect(await loadTournamentContacts(5)).toEqual([]);
  });
});

describe("loadContactTournamentState", () => {
  it("rend l'état du tournoi", async () => {
    fakeDb([], "REGISTRATION");
    expect(await loadContactTournamentState(5)).toBe("REGISTRATION");
  });

  it("rend null sur un tournoi inexistant, plutôt qu'un état inventé", async () => {
    // « N'existe pas » et « terminé » appellent deux réponses différentes (404
    // et 409) : les confondre enverrait chercher un tournoi qui est là.
    fakeDb([], null);
    expect(await loadContactTournamentState(5)).toBeNull();
  });
});

describe("GET /api/admin/tournaments/[id]/contacts", () => {
  const params = Promise.resolve({ id: "5" });
  const request = new Request("http://localhost:3000/api/admin/tournaments/5/contacts");

  it("refuse un visiteur sans session", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(null as never);

    expect((await GET(request, { params })).status).toBe(401);
  });

  it("refuse un compte sans la permission `tournaments`", async () => {
    // Le cast en fait partie : diffuser n'est pas joindre.
    for (const roles of [[], ["CASTER"], ["COMMUNITY_MANAGER"], ["RECRUTEUR"]]) {
      (getCurrentUser as jest.Mock).mockResolvedValue({ id: 9, roles } as never);
      expect((await GET(request, { params })).status).toBe(403);
    }
  });

  it("accorde l'arbitre comme l'administrateur", async () => {
    fakeDb([]);

    for (const user of [
      { id: 9, roles: ["ARBITRE"] },
      { id: 9, roles: ["ADMIN"], isAdmin: true },
    ]) {
      (getCurrentUser as jest.Mock).mockResolvedValue(user as never);
      const response = await GET(request, { params });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ entrants: [] });
    }
  });

  /**
   * **L'accès s'éteint avec le tournoi.**
   *
   * La règle n'ouvre l'arbitrage que sur un tournoi vivant : sans cette garde,
   * ce panneau rendrait six mois après la finale ce que la fiche d'un joueur
   * refuse — deux chemins vers la même donnée qui ne s'arrêtent pas au même
   * endroit.
   */
  it("refuse sur un tournoi terminé, sans lire aucun contact", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue({ id: 9, isAdmin: true } as never);
    const { execute } = fakeDb([], "FINISHED");

    const response = await GET(request, { params });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "TOURNAMENT_FINISHED" });
    // Une seule requête : celle de l'état. Les contacts n'ont pas été lus.
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it.each(["UPCOMING", "REGISTRATION", "RUNNING"])(
    "accorde l'accès sur un tournoi %s",
    async (state) => {
      (getCurrentUser as jest.Mock).mockResolvedValue({ id: 9, isAdmin: true } as never);
      fakeDb([], state);

      expect((await GET(request, { params })).status).toBe(200);
    },
  );

  it("rend 404 sur un tournoi inexistant", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue({ id: 9, isAdmin: true } as never);
    fakeDb([], null);

    expect((await GET(request, { params })).status).toBe(404);
  });

  it("refuse un identifiant de tournoi invalide", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue({ id: 9, isAdmin: true } as never);

    for (const id of ["0", "-3", "abc"]) {
      const response = await GET(request, { params: Promise.resolve({ id }) });
      expect(response.status).toBe(400);
    }
  });
});
