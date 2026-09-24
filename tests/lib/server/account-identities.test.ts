import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/users-service", () => ({
  adoptRemoteAvatar: jest.fn(),
  createOrGetBlizzardUser: jest.fn(),
  createOrGetDiscordUser: jest.fn(),
  createOrGetGoogleUser: jest.fn(),
  normalizeBattletag: (raw: string | null | undefined) => {
    const trimmed = (raw ?? "").trim();
    return trimmed.length === 0 ? null : trimmed.slice(0, 64);
  },
  normalizeDiscordHandle: (raw: string | null | undefined) => {
    const trimmed = (raw ?? "").trim().replace(/^@/, "");
    if (trimmed.length === 0) return null;
    if (/^\d{5,32}$/.test(trimmed)) return null;
    return trimmed.slice(0, 64);
  },
}));

import { getDatabase } from "@/lib/server/database";
import {
  adoptRemoteAvatar,
  createOrGetBlizzardUser,
  createOrGetDiscordUser,
  createOrGetGoogleUser,
} from "@/lib/server/users-service";
import {
  createOrGetOAuthUser,
  linkOAuthIdentity,
  listAccountConnections,
  unlinkOAuthIdentity,
  type OAuthIdentity,
} from "@/lib/server/account-identities";
import { fakePool } from "../../helpers/sql-double";

/**
 * **Les portes d'entrée d'un compte : deux règles, et rien d'autre.**
 *
 * *On ne déplace jamais une porte* — un compte dont le `discord_id` est posé le
 * garde, sans quoi rattacher un autre Discord ferait glisser l'identité de
 * connexion d'un compte à un autre. *On ne mure jamais la dernière* — détacher
 * le seul moyen d'entrer ferme le compte, le site n'ayant aucune récupération
 * par courriel.
 *
 * S'y ajoute la conséquence la moins évidente, celle qui se lirait autrement
 * comme une incohérence : détacher Discord **efface la certification** et garde
 * le tag. La certification atteste que le compte Discord appartient au joueur ;
 * la preuve venant de partir, la laisser exposerait à l'organisation un tag que
 * plus rien ne couvre.
 */

type Row = {
  google_sub: string | null;
  discord_id: string | null;
  discord_link_method: "OAUTH" | "DM_CODE" | null;
  blizzard_sub: string | null;
  discord_pseudo: string | null;
  overwatch_battletag: string | null;
};

type Statement = { sql: string; params: unknown[] };

const emptyRow: Row = {
  google_sub: null,
  discord_id: null,
  discord_link_method: null,
  blizzard_sub: null,
  discord_pseudo: null,
  overwatch_battletag: null,
};

/** Base factice : la ligne du compte visé, plus les identités déjà prises ailleurs. */
function fakeDb(row: Row | null, takenElsewhere: Record<string, boolean> = {}) {
  const statements: Statement[] = [];

  const execute = jest.fn(async (sql: string, params: unknown[] = []) => {
    const q = String(sql).replace(/\s+/g, " ").trim();
    statements.push({ sql: q, params });

    if (q.startsWith("SELECT google_sub, discord_id, discord_link_method")) {
      return [row ? [row] : [], []];
    }

    // « Une autre ligne détient-elle déjà cette identité ? »
    if (q.startsWith("SELECT id FROM bg_users WHERE")) {
      const column = q.match(/WHERE (\w+) = \?/)?.[1] ?? "";
      return [takenElsewhere[column] ? [{ id: 99 }] : [], []];
    }

    // **Le détachement, évalué comme MySQL l'évaluerait.** La borne « il reste
    // une autre porte » est portée par le `WHERE` de l'écriture : un `UPDATE`
    // factice qui rendrait toujours `affectedRows: 1` ne prouverait rien, et
    // c'est justement ce qui laissait passer la course d'avant. On applique donc
    // la condition à la ligne, et on la **mute** — les appels suivants voient
    // l'état que le premier a laissé.
    if (q.startsWith("UPDATE bg_users SET") && q.includes("IS NOT NULL")) {
      const guarded = q.match(/AND (\w+) IS NOT NULL AND \(/)?.[1] ?? "";
      const others = [...q.matchAll(/(\w+) IS NOT NULL/g)]
        .map((match) => match[1])
        .filter((column) => column !== guarded);
      const current = row as unknown as Record<string, string | null> | null;
      const matches =
        current !== null &&
        Boolean(current[guarded]) &&
        others.some((column) => Boolean(current[column]));
      if (!matches) return [{ affectedRows: 0 }, []];
      current[guarded] = null;
      if (guarded === "discord_id") {
        current.discord_verified_at = null;
        // La méthode décrit le **rattachement** : détaché, il n'en reste rien.
        current.discord_link_method = null;
      }
      return [{ affectedRows: 1 }, []];
    }

    return [{ affectedRows: 1 }, []];
  });

  jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
  return { execute, statements };
}

const find = (statements: Statement[], fragment: string) =>
  statements.find(({ sql }) => sql.includes(fragment));

const identity = (overrides: Partial<OAuthIdentity> = {}): OAuthIdentity => ({
  provider: "DISCORD",
  subject: "123456789012345678",
  handle: "nova",
  avatarUrl: null,
  displayName: "Nova",
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(adoptRemoteAvatar).mockResolvedValue(undefined);
});

const CONSENT = { termsAccepted: true };

describe("createOrGetOAuthUser", () => {
  it("aiguille vers la fonction du fournisseur, sans en oublier un", async () => {
    jest.mocked(createOrGetGoogleUser).mockResolvedValue(1);
    jest.mocked(createOrGetDiscordUser).mockResolvedValue(2);
    jest.mocked(createOrGetBlizzardUser).mockResolvedValue(3);

    await expect(
      createOrGetOAuthUser(identity({ provider: "GOOGLE", subject: "sub", handle: null }), CONSENT),
    ).resolves.toBe(1);
    expect(createOrGetGoogleUser).toHaveBeenCalledWith(
      {
        sub: "sub",
        name: "Nova",
        picture: undefined,
      },
      CONSENT,
    );

    await expect(createOrGetOAuthUser(identity(), CONSENT)).resolves.toBe(2);
    // La porte est **nommée** : un aller-retour OAuth laisse une autorisation
    // d'application chez Discord, le code en message privé n'en laisse aucune.
    expect(createOrGetDiscordUser).toHaveBeenCalledWith(
      "123456789012345678",
      undefined,
      "nova",
      // L'acceptation des conditions suit la porte jusqu'à la création.
      { avatarUrl: null, method: "OAUTH", termsAccepted: true },
    );

    await expect(
      createOrGetOAuthUser(identity({ provider: "BLIZZARD", subject: "bz", handle: "Nova#2143" }), CONSENT),
    ).resolves.toBe(3);
    expect(createOrGetBlizzardUser).toHaveBeenCalledWith("bz", "Nova#2143", CONSENT);
  });
});

describe("listAccountConnections", () => {
  it("rend les trois portes avec leurs tags", async () => {
    fakeDb({
      ...emptyRow,
      discord_id: "123456789012345678",
      discord_pseudo: "nova",
      discord_link_method: "DM_CODE",
      blizzard_sub: "bz-1",
      overwatch_battletag: "Nova#2143",
    });

    const connections = await listAccountConnections(7);

    // La **méthode** voyage avec le reste, et elle ne concerne que Discord : les
    // deux autres n'ont qu'une porte, et une ligne « rattaché par… » y serait du
    // bruit sur chaque compte.
    expect(connections).toEqual([
      { provider: "GOOGLE", linked: false, handle: null, method: null },
      { provider: "DISCORD", linked: true, handle: "nova", method: "DM_CODE" },
      { provider: "BLIZZARD", linked: true, handle: "Nova#2143", method: null },
    ]);
  });

  it("refuse un compte introuvable", async () => {
    fakeDb(null);
    await expect(listAccountConnections(7)).rejects.toThrow("PROFILE_NOT_FOUND");
  });
});

describe("linkOAuthIdentity — on ne déplace jamais une porte", () => {
  it("refuse une **autre** identité du même fournisseur", async () => {
    const { statements } = fakeDb({ ...emptyRow, discord_id: "999999999999999999" });

    await expect(linkOAuthIdentity(7, identity())).rejects.toThrow("PROVIDER_ALREADY_LINKED");
    expect(find(statements, "UPDATE bg_users")).toBeUndefined();
  });

  it("accepte de rejouer la **même** identité, et rafraîchit le tag", async () => {
    // Un pseudo Discord se change : reprendre le même identifiant est le cas où
    // le tag stocké est justement périmé.
    const { statements } = fakeDb({
      ...emptyRow,
      discord_id: "123456789012345678",
      discord_pseudo: "ancien_tag",
    });

    await expect(linkOAuthIdentity(7, identity({ handle: "nouveau_tag" }))).resolves.toBe(
      "REFRESHED",
    );

    const update = find(statements, "UPDATE bg_users SET discord_id")!;
    expect(update.sql).toContain("discord_verified_at = NOW()");
    expect(update.params).toEqual(["123456789012345678", "nouveau_tag", 7]);
  });

  it("refuse une identité déjà prise par un autre compte du site", async () => {
    const { statements } = fakeDb(emptyRow, { discord_id: true });

    await expect(linkOAuthIdentity(7, identity())).rejects.toThrow("IDENTITY_ALREADY_LINKED");
    expect(find(statements, "UPDATE bg_users")).toBeUndefined();
  });

  it("traduit la course perdue en le même refus lisible", async () => {
    // Le `SELECT` donne le refus, l'index unique tranche la course entre deux
    // comptes qui rattacheraient la même identité au même instant.
    const { execute } = fakeDb(emptyRow);
    execute.mockImplementation(async (sql: string) => {
      const q = String(sql).replace(/\s+/g, " ").trim();
      if (q.startsWith("SELECT google_sub")) return [[emptyRow], []];
      if (q.startsWith("SELECT id FROM bg_users WHERE")) return [[], []];
      const error = new Error("Duplicate entry") as Error & { code: string };
      error.code = "ER_DUP_ENTRY";
      throw error;
    });

    await expect(linkOAuthIdentity(7, identity())).rejects.toThrow("IDENTITY_ALREADY_LINKED");
  });

  it("certifie le tag Discord en le rattachant", async () => {
    const { statements } = fakeDb(emptyRow);

    await expect(linkOAuthIdentity(7, identity())).resolves.toBe("LINKED");

    const update = find(statements, "UPDATE bg_users SET discord_id")!;
    expect(update.sql).toContain("discord_pseudo = ?");
    expect(update.sql).toContain("discord_verified_at = NOW()");
  });

  it("rattache sans certifier quand le pseudo n'est qu'une suite de chiffres", async () => {
    // On ne publie pas dix-huit chiffres là où un arbitre attend un nom.
    const { statements } = fakeDb(emptyRow);

    await linkOAuthIdentity(7, identity({ handle: "123456789012" }));

    const update = find(statements, "UPDATE bg_users SET discord_id")!;
    expect(update.sql).not.toContain("discord_verified_at");
    // Seuls l'identifiant et le compte : le tag ne passe pas, faute d'être
    // certifiable.
    expect(update.params).toEqual(["123456789012345678", 7]);
  });

  it("écrit le BattleTag avec l'identité Blizzard", async () => {
    const { statements } = fakeDb(emptyRow);

    await linkOAuthIdentity(
      7,
      identity({ provider: "BLIZZARD", subject: "bz-1", handle: "Nova#2143" }),
    );

    const update = find(statements, "UPDATE bg_users SET blizzard_sub")!;
    expect(update.sql).toContain("overwatch_battletag = ?");
    expect(update.params).toEqual(["bz-1", "Nova#2143", 7]);
  });

  it("n'efface pas un BattleTag saisi quand Blizzard n'en donne aucun", async () => {
    const { statements } = fakeDb({ ...emptyRow, overwatch_battletag: "Saisi#1111" });

    await linkOAuthIdentity(7, identity({ provider: "BLIZZARD", subject: "bz-1", handle: null }));

    const update = find(statements, "UPDATE bg_users SET blizzard_sub")!;
    expect(update.sql).not.toContain("overwatch_battletag");
  });

  it("n'écrit que le `sub` pour Google", async () => {
    const { statements } = fakeDb(emptyRow);

    await linkOAuthIdentity(7, identity({ provider: "GOOGLE", subject: "sub-1", handle: null }));

    const update = find(statements, "UPDATE bg_users SET google_sub")!;
    expect(update.params).toEqual(["sub-1", 7]);
  });

  it("copie la photo **après** l'écriture qui compte", async () => {
    fakeDb(emptyRow);

    await linkOAuthIdentity(7, identity({ avatarUrl: "https://cdn.discord.test/a.png" }));

    expect(adoptRemoteAvatar).toHaveBeenCalledWith(7, "https://cdn.discord.test/a.png");
  });

  it("n'annule pas le rattachement si la copie de la photo échoue", async () => {
    // `importRemoteAvatar` ne lève jamais, mais les deux `db.execute` qui
    // l'encadrent, si. Laissé remonter, ce rejet faisait annoncer « le
    // rattachement a échoué » sur une identité **déjà écrite** — que la liste
    // d'à côté montrait rattachée dans le même écran.
    const { statements } = fakeDb(emptyRow);
    jest.mocked(adoptRemoteAvatar).mockRejectedValue(new Error("ER_LOCK_DEADLOCK"));

    await expect(
      linkOAuthIdentity(7, identity({ avatarUrl: "https://cdn.discord.test/a.png" })),
    ).resolves.toBe("LINKED");

    expect(find(statements, "UPDATE bg_users SET discord_id")).toBeDefined();
  });

  it("refuse un compte introuvable", async () => {
    fakeDb(null);
    await expect(linkOAuthIdentity(7, identity())).rejects.toThrow("PROFILE_NOT_FOUND");
  });
});

describe("unlinkOAuthIdentity — on ne mure jamais la dernière", () => {
  it("porte la borne dans le `WHERE` de l'écriture, pas dans une lecture", async () => {
    // **Le cœur de la règle.** Lue d'abord puis écrite après un `await`, elle
    // laissait deux retraits concurrents passer tous les deux. Portée par
    // l'écriture, elle ne peut plus être prise deux fois.
    const { statements } = fakeDb({ ...emptyRow, google_sub: "sub-1", blizzard_sub: "bz-1" });

    await unlinkOAuthIdentity(7, "GOOGLE");

    const update = find(statements, "UPDATE bg_users")!;
    expect(update.sql).toContain("google_sub IS NOT NULL");
    expect(update.sql).toMatch(/\(discord_id IS NOT NULL OR blizzard_sub IS NOT NULL\)/);
    // Et le cas nominal ne coûte qu'une instruction : plus de lecture préalable.
    expect(statements.filter(({ sql }) => sql.startsWith("SELECT"))).toHaveLength(0);
  });

  it("**refuse le second de deux retraits concurrents** sur un compte à deux portes", async () => {
    // Deux onglets ouverts sur `/profil` — le `busy` de l'écran n'en couvre
    // qu'un — et deux `DELETE` lancés de front sur deux fournisseurs différents.
    // Avant, les deux lectures voyaient deux connexions et les deux écritures
    // passaient : compte fermé, sans recours.
    const row = { ...emptyRow, google_sub: "sub-1", discord_id: "123456789012345678" };
    fakeDb(row);

    await unlinkOAuthIdentity(7, "GOOGLE");
    await expect(unlinkOAuthIdentity(7, "DISCORD")).rejects.toThrow("LAST_CONNECTION");

    // La porte restante est intacte : le compte reste atteignable.
    expect(row.discord_id).toBe("123456789012345678");
  });

  it("refuse de retirer le seul moyen de connexion", async () => {
    const { statements } = fakeDb({ ...emptyRow, discord_id: "123456789012345678" });

    await expect(unlinkOAuthIdentity(7, "DISCORD")).rejects.toThrow("LAST_CONNECTION");
    // L'écriture est tentée, mais elle n'apparie rien : c'est elle qui refuse.
    expect(find(statements, "discord_id = NULL")).toBeDefined();
  });

  it("refuse de retirer ce qui n'est pas rattaché", async () => {
    fakeDb({ ...emptyRow, google_sub: "sub-1", discord_id: "123456789012345678" });

    await expect(unlinkOAuthIdentity(7, "BLIZZARD")).rejects.toThrow("NOT_LINKED");
  });

  it("refuse un compte introuvable", async () => {
    fakeDb(null);

    await expect(unlinkOAuthIdentity(7, "GOOGLE")).rejects.toThrow("PROFILE_NOT_FOUND");
  });

  it("retire Discord **et sa certification**, en gardant le tag", async () => {
    const { statements } = fakeDb({
      ...emptyRow,
      google_sub: "sub-1",
      discord_id: "123456789012345678",
      discord_pseudo: "nova",
    });

    await unlinkOAuthIdentity(7, "DISCORD");

    const update = find(statements, "discord_id = NULL")!;
    expect(update.sql).toContain("discord_verified_at = NULL");
    expect(update.sql).not.toContain("discord_pseudo");
  });

  it("garde le BattleTag en retirant Blizzard", async () => {
    // Le BattleTag n'est ni une porte d'entrée ni une attestation : c'est un
    // pseudo de jeu, que le joueur peut aussi taper à la main.
    const { statements } = fakeDb({
      ...emptyRow,
      google_sub: "sub-1",
      blizzard_sub: "bz-1",
      overwatch_battletag: "Nova#2143",
    });

    await unlinkOAuthIdentity(7, "BLIZZARD");

    const update = find(statements, "blizzard_sub = NULL")!;
    expect(update.sql).not.toContain("overwatch_battletag");
  });
});
