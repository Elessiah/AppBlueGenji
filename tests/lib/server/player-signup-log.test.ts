import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/bot-integration");
jest.mock("@/lib/server/database");
jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/solo-entries-service");
jest.mock("@/lib/server/stats-service");
jest.mock("@/lib/server/user-avatar-import");

import { sendBotLog } from "@/lib/server/bot-integration";
import { getDatabase } from "@/lib/server/database";
import { ensureUniquePseudo } from "@/lib/server/auth";
import { shouldImportRemoteAvatar } from "@/lib/server/user-avatar-import";
import {
  createOrGetBlizzardUser,
  createOrGetDiscordUser,
  createOrGetGoogleUser,
} from "@/lib/server/users-service";

/**
 * **Une ligne au journal Discord quand un joueur s'inscrit — une seule, et au
 * bon moment.**
 *
 * Le canal de logs annonçait tout d'un tournoi (création, engagements, matchs,
 * clôture) mais rien de ce qui le précède : un compte pouvait naître le soir
 * d'une annonce sans qu'une ligne ne passe.
 *
 * Toute la difficulté tient en un point, et c'est ce que ce fichier garde : le
 * site n'a **pas** de formulaire d'inscription. Un compte naît à la première
 * connexion, par la même fonction qui retrouve les habitués les soirs suivants
 * — `createOrGet…`, qui rend le même identifiant dans les deux cas. La ligne est
 * donc posée sur l'`INSERT` lui-même : là, et nulle part ailleurs, « ce joueur
 * est neuf » n'est pas une déduction.
 */

type Row = {
  id: number;
  google_sub: string | null;
  discord_id: string | null;
  blizzard_sub?: string | null;
  email: string | null;
};

/** Base factice : une table de comptes, adressée par l'identité d'un fournisseur. */
function fakeDb(rows: Row[]) {
  const execute = jest.fn(async (sql: string, params: unknown[] = []) => {
    const q = String(sql).replace(/\s+/g, " ").trim();

    if (q.startsWith("SELECT id FROM bg_users WHERE google_sub = ?")) {
      return [rows.filter((row) => row.google_sub === params[0]).map(({ id }) => ({ id })), []];
    }

    if (q.startsWith("SELECT id FROM bg_users WHERE discord_id = ?")) {
      return [rows.filter((row) => row.discord_id === params[0]).map(({ id }) => ({ id })), []];
    }

    if (q.startsWith("SELECT id FROM bg_users WHERE blizzard_sub = ?")) {
      return [rows.filter((row) => row.blizzard_sub === params[0]).map(({ id }) => ({ id })), []];
    }

    // Aucune branche pour `WHERE email = ?` : plus rien ne cherche un compte par
    // son adresse, et une requête qui reparaîtrait ici retomberait sur le repli
    // « aucune ligne » — donc créerait un compte, ce que les cas ci-dessous
    // verraient.

    if (q.startsWith("INSERT INTO bg_users")) {
      return [{ insertId: 4242 }, []];
    }

    return [[], []];
  });

  (getDatabase as jest.Mock).mockResolvedValue({ execute } as never);
  return { execute };
}

const lines = () => (sendBotLog as jest.Mock).mock.calls.map((call) => String(call[0]));

beforeEach(() => {
  jest.clearAllMocks();
  (ensureUniquePseudo as jest.Mock).mockImplementation(async (source: unknown) => String(source));
  (sendBotLog as jest.Mock).mockResolvedValue(undefined as never);
  // La photo de profil ne concerne pas ce fichier : rien à copier, donc aucun
  // appel sortant en marge de celui qu'on mesure.
  (shouldImportRemoteAvatar as jest.Mock).mockReturnValue(false);
});

describe("inscription par Google", () => {
  it("annonce le compte qui vient de naître", async () => {
    fakeDb([]);

    await createOrGetGoogleUser({ sub: "google-sub-neuf", name: "Nova" });

    expect(sendBotLog).toHaveBeenCalledTimes(1);
    // L'identifiant est celui que l'`INSERT` vient de rendre, et le pseudo
    // celui qui a été retenu — pas celui que Google propose, qui peut être déjà
    // pris.
    expect(lines()[0]).toContain("« Nova » (#4242)");
    expect(lines()[0]).toContain("via Google");
  });

  it("se tait à chaque connexion suivante", async () => {
    // Le compte se reconnaît à son `sub` : c'est le cas nominal, celui d'un
    // habitué. Une ligne par connexion noierait le canal, et surtout ne dirait
    // plus rien — « nouveau joueur » cesserait d'être vrai.
    fakeDb([{ id: 7, google_sub: "google-sub-neuf", discord_id: null, email: "nova@exemple.test" }]);

    await expect(
      createOrGetGoogleUser({ sub: "google-sub-neuf", name: "Nova" }),
    ).resolves.toBe(7);

    expect(sendBotLog).not.toHaveBeenCalled();
  });

  it("annonce un compte neuf même si un membre porte la même adresse", async () => {
    // Un joueur venu par Discord qui se connecte ensuite par Google obtient
    // désormais un **compte distinct** : plus rien ne rattache par l'adresse, et
    // c'est donc bien un compte de plus à annoncer. Rapprocher les deux se fait
    // depuis « Applications connectées », qui n'écrit aucune ligne — un
    // rattachement n'est pas une naissance.
    fakeDb([{ id: 7, google_sub: null, discord_id: "123456789", email: "nova@exemple.test" }]);

    await expect(
      createOrGetGoogleUser({ sub: "google-sub-neuf", name: "Nova" }),
    ).resolves.toBe(4242);

    expect(sendBotLog).toHaveBeenCalledTimes(1);
    expect(lines()[0]).toContain("(#4242)");
  });
});

describe("inscription par Blizzard", () => {
  it("annonce le compte qui vient de naître, nommé d'après le BattleTag", async () => {
    // Le discriminant reste chez Blizzard : « Nova#2143 » donne « Nova », qui
    // est ce qu'on lit dans une URL de profil et sur une feuille de match.
    fakeDb([]);

    await createOrGetBlizzardUser("blizzard-sub-neuf", "Nova#2143");

    expect(sendBotLog).toHaveBeenCalledTimes(1);
    expect(lines()[0]).toContain("« Nova » (#4242)");
    expect(lines()[0]).toContain("via Blizzard");
  });

  it("se tait à chaque connexion suivante", async () => {
    fakeDb([{ id: 7, google_sub: null, discord_id: null, blizzard_sub: "blizzard-sub-neuf", email: null }]);

    await expect(createOrGetBlizzardUser("blizzard-sub-neuf", "Nova#2143")).resolves.toBe(7);

    expect(sendBotLog).not.toHaveBeenCalled();
  });
});

describe("inscription par Discord", () => {
  it("annonce le compte qui vient de naître", async () => {
    fakeDb([]);

    await createOrGetDiscordUser("123456789", "Nova");

    expect(sendBotLog).toHaveBeenCalledTimes(1);
    expect(lines()[0]).toContain("« Nova » (#4242)");
    expect(lines()[0]).toContain("via Discord");
  });

  it("se tait à chaque connexion suivante", async () => {
    fakeDb([{ id: 7, google_sub: null, discord_id: "123456789", email: null }]);

    await expect(createOrGetDiscordUser("123456789", "Nova")).resolves.toBe(7);

    expect(sendBotLog).not.toHaveBeenCalled();
  });
});

describe("le journal ne tient pas la connexion en otage", () => {
  it("laisse le compte se créer quand le bot est injoignable", async () => {
    // `sendBotLog` avale déjà ses erreurs ; ce test garde la propriété au cas où
    // une version future les laisserait passer. Un bot endormi ne doit ni faire
    // échouer une connexion, ni la rendre plus lente : l'envoi n'est pas attendu.
    (sendBotLog as jest.Mock).mockRejectedValue(new Error("ECONNREFUSED") as never);
    fakeDb([]);

    await expect(createOrGetDiscordUser("123456789", "Nova")).resolves.toBe(4242);
  });
});
