import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/solo-entries-service");
jest.mock("@/lib/server/stats-service");

import {
  anonymizeOwnAccount,
  createOrGetDiscordUser,
  getFullProfile,
  getUserById,
  listPlayers,
  normalizeDiscordHandle,
  updateOwnProfile,
} from "@/lib/server/users-service";
import { getDatabase } from "@/lib/server/database";
import { getPlayerEntityStats } from "@/lib/server/stats-service";

/**
 * Le tag Discord **en base** : ce qui le certifie, ce qui le décertifie, et ce
 * qui sort d'une fiche de profil.
 *
 * Trois propriétés, trois pannes évitées :
 *
 * 1. **la certification se perd à chaque changement de tag** — sinon l'arbitrage
 *    lit un pseudo que personne n'a prouvé, ce que la certification est censée
 *    empêcher ;
 * 2. **se connecter par Discord certifie le tag** — sans quoi les comptes nés par
 *    cette porte devraient refaire une preuve qu'ils viennent de faire ;
 * 3. **la fiche ne rend le tag qu'à qui y a droit**, et la question du tournoi
 *    n'est posée que quand elle peut changer la réponse.
 *
 * Voir `docs/features/DISCORD_VERIFICATION.md`.
 */

type Query = { sql: string; params: unknown[] };

function fakeDb(handler?: (q: string, params: unknown[]) => unknown) {
  const queries: Query[] = [];
  const execute = jest.fn(async (sql: string, params: unknown[] = []) => {
    const q = String(sql).replace(/\s+/g, " ").trim();
    queries.push({ sql: q, params });
    const handled = handler?.(q, params);
    if (handled !== undefined) return handled;
    return [[]];
  });
  (getDatabase as jest.Mock).mockResolvedValue({ execute } as never);
  return { queries, execute };
}

const find = (queries: Query[], needle: string) =>
  queries.find((q) => q.sql.includes(needle));

/**
 * Les six paramètres que l'écriture consacre au tag Discord, nommés.
 *
 * Deux `CASE` jumeaux — l'un pour `discord_verified_at`, l'autre pour
 * `discord_pseudo` — prennent chacun « le patch parle-t-il du tag ? » puis la
 * valeur visée, deux fois. Les compter à la main par leur indice rendait ces
 * tests illisibles et faux au premier paramètre inséré devant.
 */
function tagParams(params: unknown[]): { touches: unknown[]; tags: unknown[] } {
  return {
    touches: [params[3], params[6]],
    tags: [params[4], params[5], params[7], params[8]],
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  (getPlayerEntityStats as jest.Mock).mockResolvedValue({
    stats: {},
    tournaments: [],
  } as never);
});

describe("updateOwnProfile — la certification suit le tag", () => {
  it("compare l'ancien tag **avant** de l'écraser", async () => {
    const { queries } = fakeDb();

    await updateOwnProfile(7, { discordPseudo: "keryan" });

    const update = find(queries, "UPDATE bg_users");
    expect(update).toBeDefined();
    // Le `CASE` précède l'affectation : MySQL évalue de gauche à droite, et
    // placé après il lirait déjà la valeur neuve — donc ne verrait jamais de
    // changement, donc ne décertifierait jamais rien.
    const caseIndex = update!.sql.indexOf("discord_verified_at = CASE");
    const assignIndex = update!.sql.indexOf("discord_pseudo = CASE");
    expect(caseIndex).toBeGreaterThanOrEqual(0);
    expect(assignIndex).toBeGreaterThan(caseIndex);
  });

  it("compare avec `<=>` : un profil sans tag ne perd rien à chaque sauvegarde", async () => {
    // `=` rendrait `NULL` quand les deux côtés sont `NULL`, donc « différent »,
    // donc une certification perdue à la première sauvegarde d'un champ voisin.
    const { queries } = fakeDb();

    await updateOwnProfile(7, {});

    expect(find(queries, "UPDATE bg_users")!.sql).toContain("discord_pseudo <=> ?");
  });

  it("passe le même tag aux six emplacements : les deux `CASE` doivent lire ce qui sera écrit", async () => {
    const { queries } = fakeDb();

    await updateOwnProfile(7, { pseudo: "Nova", discordPseudo: "keryan" });

    expect(tagParams(find(queries, "UPDATE bg_users")!.params)).toEqual({
      touches: [true, true],
      tags: ["keryan", "keryan", "keryan", "keryan"],
    });
  });

  it("efface le tag quand le formulaire l'a vidé, et la certification avec", async () => {
    // Le formulaire envoie la fiche entière : un champ vidé arrive à `null`, et
    // c'est bien un changement de tag.
    const { queries } = fakeDb();

    await updateOwnProfile(7, { pseudo: "Nova", discordPseudo: null });

    expect(tagParams(find(queries, "UPDATE bg_users")!.params)).toEqual({
      touches: [true, true],
      tags: [null, null, null, null],
    });
  });

  it("ne touche pas au tag quand le patch n'en parle pas — absent n'est pas vidé", async () => {
    // Une requête partielle qui ne mentionne pas le tag le supprimait, et sa
    // certification avec. Aucun appelant ne le faisait, mais le verrou du
    // rattachement en aurait fait un refus en 409 sur tout compte lié.
    const { queries } = fakeDb();

    await updateOwnProfile(7, { pseudo: "Nova" });

    expect(tagParams(find(queries, "UPDATE bg_users")!.params).touches).toEqual([false, false]);
  });
});

describe("anonymizeOwnAccount", () => {
  it("efface le tag **et** sa certification", async () => {
    // Une date restée seule ferait d'un compte anonymisé un compte « vérifié »
    // sans tag.
    const { queries } = fakeDb();

    await anonymizeOwnAccount(7);

    const update = find(queries, "UPDATE bg_users")!;
    expect(update.sql).toContain("discord_pseudo = NULL");
    expect(update.sql).toContain("discord_verified_at = NULL");
  });
});

describe("createOrGetDiscordUser — entrer par Discord certifie le tag", () => {
  it("certifie le compte existant avec le tag prouvé", async () => {
    const { queries } = fakeDb((q) =>
      q.startsWith("SELECT id FROM bg_users WHERE discord_id") ? [[{ id: 7 }]] : undefined,
    );

    await createOrGetDiscordUser("900000000000000001", undefined, "keryan");

    const update = find(queries, "UPDATE bg_users");
    expect(update).toBeDefined();
    expect(update!.sql).toContain("discord_verified_at = NOW()");
    expect(update!.params).toEqual(["keryan", 7]);
  });

  it("ne touche à rien quand la demande portait un identifiant numérique", async () => {
    // Il n'y a alors aucun tag à certifier : le joueur s'est connecté par son ID.
    const { queries } = fakeDb((q) =>
      q.startsWith("SELECT id FROM bg_users WHERE discord_id") ? [[{ id: 7 }]] : undefined,
    );

    await createOrGetDiscordUser("900000000000000001", undefined, "900000000000000001");

    expect(find(queries, "UPDATE bg_users")).toBeUndefined();
  });

  it("crée un compte neuf avec son tag certifié", async () => {
    const { queries } = fakeDb((q) => {
      if (q.startsWith("SELECT id FROM bg_users WHERE discord_id")) return [[]];
      if (q.startsWith("SELECT COUNT(*) AS c FROM bg_users WHERE pseudo")) return [[{ c: 0 }]];
      if (q.startsWith("INSERT INTO bg_users")) return [{ insertId: 42 }];
      return undefined;
    });

    const userId = await createOrGetDiscordUser("900000000000000002", "Nova", "keryan");

    expect(userId).toBe(42);
    const insert = find(queries, "INSERT INTO bg_users")!;
    expect(insert.sql).toContain("discord_verified_at");
    expect(insert.sql).toContain("NOW()");
    expect(insert.params).toContain("keryan");
  });

  it("crée un compte sans certification quand aucun tag n'a été prouvé", async () => {
    const { queries } = fakeDb((q) => {
      if (q.startsWith("SELECT id FROM bg_users WHERE discord_id")) return [[]];
      if (q.startsWith("SELECT COUNT(*) AS c FROM bg_users WHERE pseudo")) return [[{ c: 0 }]];
      if (q.startsWith("INSERT INTO bg_users")) return [{ insertId: 42 }];
      return undefined;
    });

    await createOrGetDiscordUser("900000000000000002", "Nova");

    expect(find(queries, "INSERT INTO bg_users")!.sql).toContain("NULL");
  });
});

describe("normalizeDiscordHandle", () => {
  it("retire le @ que colle le client Discord", () => {
    expect(normalizeDiscordHandle("@keryan")).toBe("keryan");
    expect(normalizeDiscordHandle("  keryan  ")).toBe("keryan");
  });

  it("refuse un identifiant numérique : ce n'est pas un pseudo", () => {
    expect(normalizeDiscordHandle("900000000000000001")).toBeNull();
  });

  it("refuse le vide", () => {
    for (const value of [null, undefined, "", "   ", "@"]) {
      expect(normalizeDiscordHandle(value)).toBeNull();
    }
  });

  it("borne la longueur à celle de la colonne", () => {
    expect(normalizeDiscordHandle("a".repeat(120))).toHaveLength(64);
  });
});

describe("getFullProfile — ce qui sort du tag", () => {
  function userRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 7,
      pseudo: "Player",
      avatar_url: null,
      overwatch_battletag: null,
      marvel_rivals_tag: null,
      discord_pseudo: "keryan",
      discord_verified_at: new Date("2026-09-01T00:00:00Z"),
      is_adult: 1,
      visible_avatar: 1,
      visible_pseudo: 1,
      visible_overwatch: 1,
      visible_marvel: 1,
      visible_major: 1,
      open_to_recruitment: 1,
      is_admin: 0,
      created_at: new Date("2026-01-01T00:00:00Z"),
      ...overrides,
    };
  }

  function profileDb(row: Record<string, unknown>, inTournament = false) {
    return fakeDb((q) => {
      if (q.startsWith("SELECT id, pseudo, avatar_url")) return [[row]];
      if (q.includes("FROM bg_tournament_registrations r")) return [inTournament ? [{ c: 1 }] : []];
      return [[]];
    });
  }

  it("rend le tag à son titulaire, certifié ou non", async () => {
    profileDb(userRow({ discord_verified_at: null }));

    const profile = await getFullProfile({ id: 7 }, 7);

    expect(profile?.profile.discordPseudo).toBe("keryan");
    expect(profile?.profile.discordVerified).toBe(false);
  });

  it("rend le tag certifié à un administrateur, sans interroger les tournois", async () => {
    const { queries } = profileDb(userRow());

    const profile = await getFullProfile({ id: 99, isAdmin: true }, 7);

    expect(profile?.profile.discordPseudo).toBe("keryan");
    expect(profile?.profile.discordVerified).toBe(true);
    // L'administrateur voit de toute façon : la requête serait du travail pour
    // rien sur chaque fiche consultée.
    expect(find(queries, "FROM bg_tournament_registrations r")).toBeUndefined();
  });

  it("cache un tag non certifié à un administrateur", async () => {
    const profile = await (async () => {
      profileDb(userRow({ discord_verified_at: null }));
      return getFullProfile({ id: 99, isAdmin: true }, 7);
    })();

    expect(profile?.profile.discordPseudo).toBeNull();
    expect(profile?.profile.discordVerified).toBe(false);
  });

  /**
   * **La pastille ne suit pas le tag.**
   *
   * Le tag dit *comment* joindre le joueur, la certification dit seulement
   * *qu'il est joignable* — un fait qui ne nomme personne et qui manque au
   * capitaine dont le tournoi exige « tous les Discord vérifiés ».
   */
  it("annonce la certification même quand le tag est filtré", async () => {
    profileDb(userRow(), false);

    const profile = await getFullProfile({ id: 99, roles: [] }, 7);

    expect(profile?.profile.discordPseudo).toBeNull();
    expect(profile?.profile.discordVerified).toBe(true);
  });

  it("ne l'annonce pas quand elle n'existe pas", async () => {
    profileDb(userRow({ discord_verified_at: null }), false);

    const profile = await getFullProfile({ id: 99, roles: [] }, 7);

    expect(profile?.profile.discordVerified).toBe(false);
  });

  it("n'accorde l'arbitre que si le joueur est engagé dans un tournoi vivant", async () => {
    profileDb(userRow(), false);
    const away = await getFullProfile({ id: 99, roles: ["ARBITRE"] }, 7);
    expect(away?.profile.discordPseudo).toBeNull();

    profileDb(userRow(), true);
    const engaged = await getFullProfile({ id: 99, roles: ["ARBITRE"] }, 7);
    expect(engaged?.profile.discordPseudo).toBe("keryan");
  });

  it("ne consulte les tournois que pour l'arbitrage sur un tag certifié", async () => {
    const { queries } = profileDb(userRow({ discord_verified_at: null }), true);

    await getFullProfile({ id: 99, roles: ["ARBITRE"] }, 7);

    // Tag non certifié : la réponse est « non » quoi qu'en dise le plateau.
    expect(find(queries, "FROM bg_tournament_registrations r")).toBeUndefined();
  });

  it("cache le tag à un lecteur ordinaire, même sur un joueur engagé", async () => {
    profileDb(userRow(), true);

    const profile = await getFullProfile({ id: 99, roles: ["CASTER"] }, 7);

    // Le tag, lui, reste filtré : c'est la coordonnée, pas l'état.
    expect(profile?.profile.discordPseudo).toBeNull();
  });
});

/**
 * Ce que la fiche et l'annuaire **ne lisent pas**.
 *
 * Le tag Discord est une donnée personnelle filtrée à la sortie : les deux
 * lectures qui ne l'affichent jamais n'ont aucune raison de la charger. Une
 * colonne qu'on ne sélectionne pas ne peut pas fuiter par un `...row` distrait.
 */
describe("les lectures qui n'ont pas à connaître le tag", () => {
  it("ne le sélectionne ni dans l'annuaire ni sur la fiche d'un joueur", async () => {
    const { queries } = fakeDb((q) =>
      q.startsWith("SELECT id, pseudo, avatar_url") ? [[]] : [[]],
    );

    await getUserById(7);
    await listPlayers(7);

    for (const query of queries.filter((q) => q.sql.includes("FROM bg_users"))) {
      expect(query.sql).not.toContain("discord_pseudo");
    }
  });
});

describe("updateOwnProfile — un compte Discord rattaché possède son tag", () => {
  /** Le `SELECT` du verrou, avec le rattachement et le tag qu'on veut lui faire lire. */
  const lockedDb = (discordId: string | null, storedTag: string | null) =>
    fakeDb((sql) =>
      sql.startsWith("SELECT discord_id, discord_pseudo")
        ? [[{ discord_id: discordId, discord_pseudo: storedTag }]]
        : undefined,
    );

  it("refuse une réécriture du tag quand un compte Discord est rattaché", async () => {
    lockedDb("100000000000000001", "keryan");

    await expect(updateOwnProfile(7, { discordPseudo: "quelquun_dautre" })).rejects.toThrow(
      "DISCORD_TAG_LOCKED",
    );
  });

  it("laisse passer la sauvegarde qui renvoie le tag déjà stocké", async () => {
    const { queries } = lockedDb("100000000000000001", "keryan");

    await updateOwnProfile(7, { discordPseudo: "keryan", isAdult: true });

    expect(find(queries, "UPDATE bg_users")).toBeDefined();
  });

  it("tolère la casse : le formulaire ne renvoie pas toujours l'orthographe exacte", async () => {
    const { queries } = lockedDb("100000000000000001", "Keryan");

    await updateOwnProfile(7, { discordPseudo: "keryan" });

    expect(find(queries, "UPDATE bg_users")).toBeDefined();
  });

  it("traite un tag absent des deux côtés comme inchangé", async () => {
    const { queries } = lockedDb("100000000000000001", null);

    await updateOwnProfile(7, { discordPseudo: null });

    expect(find(queries, "UPDATE bg_users")).toBeDefined();
  });

  it("n'oppose aucun verrou à un compte sans Discord rattaché", async () => {
    const { queries } = lockedDb(null, "ancien_tag");

    await updateOwnProfile(7, { discordPseudo: "nouveau_tag" });

    expect(find(queries, "UPDATE bg_users")).toBeDefined();
  });

  it("garde le tag dans l'écriture elle-même — le refus lisible ne tient pas la course", async () => {
    // La forme de l'écriture ne dépend pas de la ligne lue : c'est elle, et non
    // le `SELECT`, qui tient un rattachement survenu entre les deux.
    const { queries } = lockedDb(null, null);

    await updateOwnProfile(7, { discordPseudo: "keryan" });

    const sql = find(queries, "UPDATE bg_users")!.sql;
    expect(sql).toContain(
      "discord_pseudo = CASE WHEN NOT ? THEN discord_pseudo WHEN discord_id IS NOT NULL AND ? IS NOT NULL THEN discord_pseudo ELSE ? END",
    );
  });

  it("ne décertifie pas un compte rattaché, dont le tag ne peut pas bouger", async () => {
    const { queries } = lockedDb(null, null);
    // Même remarque : c'est la requête qu'on lit, pas son résultat.

    await updateOwnProfile(7, {});

    const sql = find(queries, "UPDATE bg_users")!.sql;
    expect(sql).toContain("WHEN discord_id IS NOT NULL AND ? IS NOT NULL THEN discord_verified_at");
  });
});

describe("updateOwnProfile — retirer son tag reste possible", () => {
  const lockedDb = (discordId: string | null, storedTag: string | null) =>
    fakeDb((sql) =>
      sql.includes("SELECT discord_id, discord_pseudo")
        ? [[{ discord_id: discordId, discord_pseudo: storedTag }]]
        : undefined,
    );

  it("laisse un compte rattaché effacer son tag — c'est le seul geste d'annulation", async () => {
    // Sans lui, un compte né par Discord n'a aucune sortie : son tag est
    // certifié donc lisible de l'arbitrage, et détacher Discord lui est refusé
    // en `LAST_CONNECTION` faute d'une autre porte.
    const { queries } = lockedDb("100000000000000001", "keryan");

    await updateOwnProfile(7, { discordPseudo: null });

    expect(find(queries, "UPDATE bg_users")).toBeDefined();
  });

  it("n'interroge même pas le rattachement pour un effacement", async () => {
    const { queries } = lockedDb("100000000000000001", "keryan");

    await updateOwnProfile(7, { discordPseudo: null });

    expect(find(queries, "SELECT discord_id, discord_pseudo")).toBeUndefined();
  });

  it("refuse toujours d'y écrire un autre tag", async () => {
    const { queries } = lockedDb("100000000000000001", "keryan");

    await expect(updateOwnProfile(7, { discordPseudo: "quelquun_dautre" })).rejects.toThrow(
      "DISCORD_TAG_LOCKED",
    );
    expect(find(queries, "UPDATE bg_users")).toBeUndefined();
  });
});
