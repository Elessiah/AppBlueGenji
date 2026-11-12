import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/solo-entries-service");
jest.mock("@/lib/server/landing-cache");
jest.mock("@/lib/server/avatar-rotation");
jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/bot-integration");
jest.mock("@/lib/server/stats-service");
jest.mock("@/lib/server/terms-acceptance", () =>
  jest.requireActual<typeof import("../../helpers/terms-acceptance-double")>("../../helpers/terms-acceptance-double").termsAcceptanceDouble(),
);
jest.mock("@/lib/server/tournaments/referee-names", () => ({ forgetRefereeNamesOf: jest.fn() }));
jest.mock("@/lib/server/tournaments/certification-prompt", () => ({
  forgetCertificationPromptsAround: jest.fn(async () => undefined),
}));

import { getDatabase } from "@/lib/server/database";
import { forgetCertificationPromptsAround } from "@/lib/server/tournaments/certification-prompt";
import { updateOwnProfile } from "@/lib/server/users/profile-update";
import { unlinkOAuthIdentity } from "@/lib/server/account-identities";
import { createOrGetBlizzardUser } from "@/lib/server/users/sign-in";
import { fakePool } from "../../helpers/sql-double";

/**
 * Un geste qui change la certification d'un compte (tag Discord, BattleTag,
 * détachement de Discord ou de Battle.net, connexion Battle.net qui réécrit le
 * BattleTag) oublie tout de suite ses invitations « équipe sans contact » et
 * celles de ses coéquipiers — pas une minute plus tard.
 */

type Reply = { select?: unknown[]; update: { affectedRows: number; changedRows?: number } };

function mockDb({ select = [], update }: Reply) {
  const execute = jest.fn(async (sql: string) => {
    if (/^\s*UPDATE/.test(sql)) return [update, []];
    return [select, []];
  });
  jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("updateOwnProfile — invitations à certifier", () => {
  it("updateOwnProfile_discordTagChangedRow_forgetsPromptsAround", async () => {
    mockDb({ update: { affectedRows: 1, changedRows: 1 } });

    await updateOwnProfile(7, { discordPseudo: null });

    expect(forgetCertificationPromptsAround).toHaveBeenCalledWith(7);
  });

  it("updateOwnProfile_battletagChangedRow_forgetsPromptsAround", async () => {
    mockDb({ update: { affectedRows: 1, changedRows: 1 } });

    await updateOwnProfile(7, { overwatchBattletag: "Nova#2143" });

    expect(forgetCertificationPromptsAround).toHaveBeenCalledWith(7);
  });

  it("updateOwnProfile_tagUnchanged_doesNotForget", async () => {
    mockDb({ update: { affectedRows: 1, changedRows: 0 } });

    await updateOwnProfile(7, { discordPseudo: null });

    expect(forgetCertificationPromptsAround).not.toHaveBeenCalled();
  });

  it("updateOwnProfile_visibilityOnly_doesNotForget", async () => {
    mockDb({ update: { affectedRows: 1, changedRows: 1 } });

    await updateOwnProfile(7, { visibility: { marvel: true } });

    expect(forgetCertificationPromptsAround).not.toHaveBeenCalled();
  });
});

describe("unlinkOAuthIdentity — invitations à certifier", () => {
  it("unlinkOAuthIdentity_discordDetached_forgetsPromptsAround", async () => {
    mockDb({ update: { affectedRows: 1 } });

    await unlinkOAuthIdentity(7, "DISCORD");

    expect(forgetCertificationPromptsAround).toHaveBeenCalledWith(7);
  });

  it("unlinkOAuthIdentity_blizzardDetached_forgetsPromptsAround", async () => {
    mockDb({ update: { affectedRows: 1 } });

    await unlinkOAuthIdentity(7, "BLIZZARD");

    expect(forgetCertificationPromptsAround).toHaveBeenCalledWith(7);
  });

  it("unlinkOAuthIdentity_googleDetached_doesNotForget", async () => {
    mockDb({ update: { affectedRows: 1 } });

    await unlinkOAuthIdentity(7, "GOOGLE");

    expect(forgetCertificationPromptsAround).not.toHaveBeenCalled();
  });

  it("unlinkOAuthIdentity_lastConnectionRefused_doesNotForget", async () => {
    mockDb({
      select: [{ google_sub: null, discord_id: "123456789012345678", blizzard_sub: null }],
      update: { affectedRows: 0 },
    });

    await expect(unlinkOAuthIdentity(7, "DISCORD")).rejects.toThrow("LAST_CONNECTION");

    expect(forgetCertificationPromptsAround).not.toHaveBeenCalled();
  });
});

describe("createOrGetBlizzardUser — invitations à certifier", () => {
  it("createOrGetBlizzardUser_existingRowChanged_forgetsPromptsAround", async () => {
    mockDb({ select: [{ id: 7 }], update: { affectedRows: 1, changedRows: 1 } });

    await createOrGetBlizzardUser("bz-1", "Nova#2143", { termsAccepted: true });

    expect(forgetCertificationPromptsAround).toHaveBeenCalledWith(7);
  });

  it("createOrGetBlizzardUser_existingRowUnchanged_doesNotForget", async () => {
    mockDb({ select: [{ id: 7 }], update: { affectedRows: 1, changedRows: 0 } });

    await createOrGetBlizzardUser("bz-1", "Nova#2143", { termsAccepted: true });

    expect(forgetCertificationPromptsAround).not.toHaveBeenCalled();
  });
});
