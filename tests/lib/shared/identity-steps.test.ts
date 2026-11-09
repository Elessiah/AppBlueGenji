import { describe, expect, it } from "@jest/globals";
import { identityStep, type IdentityStepInput } from "@/lib/shared/identity-steps";
import { profileSectionIdFromHash } from "@/app/(secured)/profil/_lib/profile-sections";

const input = (over: Partial<IdentityStepInput> = {}): IdentityStepInput => ({
  linked: true,
  discordHasTag: true,
  discordVerified: false,
  battletagFromBlizzard: false,
  ...over,
});

describe("identityStep", () => {
  it.each(["DISCORD", "BLIZZARD", "GOOGLE"] as const)("%s non lié : l'action est Lier", (provider) => {
    const step = identityStep(provider, input({ linked: false }));
    expect(step.stage).toBe("UNLINKED");
    expect(step.action).toBe("LINK");
  });

  it("Discord lié, tag certifié : terminé", () => {
    expect(identityStep("DISCORD", input({ discordVerified: true }))).toEqual({
      stage: "CERTIFIED",
      action: null,
      certifiable: true,
    });
  });

  it("Discord lié avec un tag non certifié : Certifier", () => {
    expect(identityStep("DISCORD", input())).toMatchObject({ stage: "LINKED", action: "CERTIFY" });
  });

  it("Discord lié sans tag : Enregistrer", () => {
    expect(identityStep("DISCORD", input({ discordHasTag: false }))).toMatchObject({
      stage: "LINKED",
      action: "REGISTER",
    });
  });

  it("Battle.net lié, BattleTag venu de Blizzard : certifié", () => {
    expect(identityStep("BLIZZARD", input({ battletagFromBlizzard: true }))).toMatchObject({
      stage: "CERTIFIED",
      action: null,
    });
  });

  it("Battle.net lié, BattleTag tapé : lié, aucun geste", () => {
    expect(identityStep("BLIZZARD", input())).toMatchObject({ stage: "LINKED", action: null, certifiable: true });
  });

  it("Google lié : terminé, non certifiable", () => {
    expect(identityStep("GOOGLE", input())).toEqual({ stage: "LINKED", action: null, certifiable: false });
  });
});

describe("profileSectionIdFromHash — anciennes ancres", () => {
  it.each(["jeux", "#discord", "#connexions"])("%s mène à la section réunie", (hash) => {
    expect(profileSectionIdFromHash(hash)).toBe("comptes");
  });

  it("refuse un nom hérité de Object.prototype", () => {
    expect(profileSectionIdFromHash("#constructor")).toBeNull();
  });
});
