import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/bot-integration");
jest.mock("@/lib/server/user-avatar-import");
jest.mock("@/lib/server/users-service", () => {
  const actual = jest.requireActual<typeof import("@/lib/server/users-service")>(
    "@/lib/server/users-service",
  );
  return {
    // Les deux normalisations restent **les vraies** : ce sont elles qui
    // décident de la forme de l'écriture (tag publiable ou non, BattleTag ou
    // non), donc du nombre de variantes à garder.
    normalizeDiscordHandle: actual.normalizeDiscordHandle,
    normalizeBattletag: actual.normalizeBattletag,
    createDiscordLoginChallenge: jest.fn(),
    consumeDiscordChallenge: jest.fn(),
    discardDiscordChallenge: jest.fn(),
    // La copie de la photo est hors sujet ici, et elle est déjà avalée par
    // `linkOAuthIdentity` : un bouchon suffit.
    adoptRemoteAvatar: jest.fn(async () => undefined),
  };
});

import { linkOAuthIdentity } from "@/lib/server/account-identities";
import { startDiscordVerification } from "@/lib/server/discord-verification";
import { getDatabase } from "@/lib/server/database";
import { resolveDiscordUser } from "@/lib/server/bot-integration";

/**
 * Les écritures qui reposent une **porte d'entrée**, et la course qu'elles
 * perdaient.
 *
 * `deleteOwnAccount` promet qu'un compte anonymisé n'a plus aucune identité :
 * `discord_id`, `google_sub` et `blizzard_sub` passent à `NULL`, et c'est par
 * eux que `createOrGetDiscordUser` et consorts retrouvent un compte. Or la
 * certification du tag et le rattachement OAuth sont **longs** — un aller-retour
 * chez le fournisseur, un message privé, une saisie — et leur écriture finale
 * attend le verrou de la suppression pour reprendre juste après son commit.
 *
 * Sans `is_deleted = 0` sur l'écriture elle-même, elles reposaient une identité
 * neuve sur la ligne morte : le compte « supprimé de façon irréversible »
 * redevenait joignable par connexion, et un tag personnel certifié repartait à
 * l'arbitrage par `canViewDiscordTag`. Une lecture préalable ne peut pas fermer
 * cela — un `await` la sépare de l'écriture.
 */

type Query = { sql: string; params: unknown[] };

const resolveMock = resolveDiscordUser as jest.MockedFunction<typeof resolveDiscordUser>;

/** Base factice : lignes vivantes, écritures relevées. */
function fakeDb(row: Record<string, unknown> | null) {
  const queries: Query[] = [];
  const execute = jest.fn(async (sql: string, params: unknown[] = []) => {
    const q = String(sql).replace(/\s+/g, " ").trim();
    queries.push({ sql: q, params });
    if (q.startsWith("UPDATE bg_users")) return [{ affectedRows: row ? 1 : 0 }];
    if (q.startsWith("SELECT id FROM bg_users")) return [[]];
    return [row ? [row] : []];
  });
  (getDatabase as jest.Mock).mockResolvedValue({ execute } as never);
  return { queries };
}

const writes = (queries: Query[]) => queries.filter((q) => q.sql.startsWith("UPDATE bg_users"));

beforeEach(() => jest.clearAllMocks());

describe("certification du tag Discord — jamais sur une ligne morte", () => {
  it("borne l'écriture aux comptes vivants", async () => {
    const { queries } = fakeDb({
      discord_id: "900000000000000001",
      discord_pseudo: null,
      discord_verified_at: null,
    });
    resolveMock.mockResolvedValue("900000000000000001");

    await startDiscordVerification(7, "keryan");

    // Une seule écriture, et elle porte la condition : sans elle, `discord_id`
    // revenait sur la ligne anonymisée — donc une connexion Discord de nouveau
    // ouverte sur un compte supprimé.
    expect(writes(queries)).toHaveLength(1);
    expect(writes(queries)[0].sql).toContain("is_deleted = 0");
  });

  it("ne lit même pas l'état d'un compte supprimé", async () => {
    const { queries } = fakeDb(null);

    await expect(startDiscordVerification(7, "keryan")).rejects.toThrow("PROFILE_NOT_FOUND");

    const read = queries.find((q) => q.sql.startsWith("SELECT discord_id"));
    expect(read).toBeDefined();
    expect(read!.sql).toContain("is_deleted = 0");
    // Aucun appel sortant : le bot n'a pas à résoudre un tag pour un compte mort.
    expect(resolveMock).not.toHaveBeenCalled();
  });
});

describe("rattachement d'une identité OAuth — jamais sur une ligne morte", () => {
  const identities = [
    ["GOOGLE", { provider: "GOOGLE" as const, subject: "g-1" }],
    ["DISCORD", { provider: "DISCORD" as const, subject: "d-1", handle: "keryan" }],
    ["DISCORD sans tag publiable", { provider: "DISCORD" as const, subject: "d-1", handle: "123456" }],
    ["BLIZZARD", { provider: "BLIZZARD" as const, subject: "b-1", handle: "Keryan#2100" }],
    ["BLIZZARD sans BattleTag", { provider: "BLIZZARD" as const, subject: "b-1" }],
  ] as const;

  it.each(identities)("borne l'écriture %s aux comptes vivants", async (_label, identity) => {
    const { queries } = fakeDb({
      google_sub: null,
      discord_id: null,
      blizzard_sub: null,
      discord_pseudo: null,
      overwatch_battletag: null,
    });

    await linkOAuthIdentity(7, identity);

    // Les cinq variantes d'écriture doivent porter la même condition : c'est
    // exactement la symétrie qui manquait face au détachement, qui l'avait déjà.
    expect(writes(queries)).toHaveLength(1);
    expect(writes(queries)[0].sql).toContain("is_deleted = 0");
  });

  it("refuse le rattachement quand la ligne n'est plus vivante", async () => {
    fakeDb(null);
    await expect(
      linkOAuthIdentity(7, { provider: "GOOGLE", subject: "g-1" }),
    ).rejects.toThrow("PROFILE_NOT_FOUND");
  });
});
