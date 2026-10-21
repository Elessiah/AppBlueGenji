import { describe, expect, it, jest } from "@jest/globals";
import { loadCertificationPrompt } from "@/lib/server/tournaments/certification-prompt";
import { fakeConnection, type SqlQuery } from "../../helpers/sql-double";

/**
 * Lecture de l'invitation à certifier depuis le roster en cours
 * (`docs/features/CERTIFICATION_PROMPT.md`) : les certifications se lisent
 * comme `pickLaunchContacts` les lit — une date sans tag ne vaut rien.
 */

type Member = {
  user_id: number;
  discord_verified_at: string | null;
  discord_pseudo: string | null;
  blizzard_sub: string | null;
  overwatch_battletag: string | null;
};

const BARE: Omit<Member, "user_id"> = {
  discord_verified_at: null,
  discord_pseudo: "pseudo",
  blizzard_sub: null,
  overwatch_battletag: "Joueur#1234",
};
const DISCORD = { discord_verified_at: "2026-10-01 10:00:00", discord_pseudo: "pseudo" };
const BATTLETAG = { blizzard_sub: "sub", overwatch_battletag: "Joueur#1234" };

function rosterOf(members: Member[]) {
  const execute = jest.fn<SqlQuery>().mockResolvedValue([members, []]);
  return { execute, executor: fakeConnection({ execute }) };
}

describe("loadCertificationPrompt", () => {
  it("lit le roster en cours de l'équipe, comptes supprimés exclus", async () => {
    const { execute, executor } = rosterOf([{ user_id: 7, ...BARE }]);
    await loadCertificationPrompt(executor, 7, 42, false, true);
    const [sql, params] = execute.mock.calls[0];
    expect(sql).toContain("tm.left_at IS NULL");
    expect(sql).toContain("u.is_deleted = 0");
    expect(params).toEqual([42]);
  });

  it("invite le joueur d'une équipe sans aucun contact", async () => {
    const { executor } = rosterOf([{ user_id: 7, ...BARE }, { user_id: 8, ...BARE }]);
    expect(await loadCertificationPrompt(executor, 7, 42, false, true)).toEqual({
      reason: "TEAM_WITHOUT_CONTACT",
      discordVerified: false,
      battletagVerified: false,
      battletagRelevant: true,
    });
  });

  it("n'invite pas le joueur quand un coéquipier a un contact", async () => {
    const { executor } = rosterOf([{ user_id: 7, ...BARE }, { user_id: 8, ...BARE, ...BATTLETAG }]);
    expect(await loadCertificationPrompt(executor, 7, 42, false, true)).toBeNull();
  });

  it("invite le manager à qui manque le BattleTag, l'équipe eût-elle un contact", async () => {
    const { executor } = rosterOf([{ user_id: 7, ...BARE, ...DISCORD }]);
    expect(await loadCertificationPrompt(executor, 7, 42, true, true)).toEqual({
      reason: "MANAGER",
      discordVerified: true,
      battletagVerified: false,
      battletagRelevant: true,
    });
  });

  it("n'invite pas le manager qui a les deux", async () => {
    const { executor } = rosterOf([{ user_id: 7, ...BARE, ...DISCORD, ...BATTLETAG }]);
    expect(await loadCertificationPrompt(executor, 7, 42, true, true)).toBeNull();
  });

  it("une date de certification sans tag, ou un compte Blizzard sans BattleTag, ne certifie rien", async () => {
    const { executor } = rosterOf([
      { user_id: 7, ...BARE, discord_verified_at: "2026-10-01 10:00:00", discord_pseudo: null, blizzard_sub: "sub", overwatch_battletag: null },
    ]);
    expect(await loadCertificationPrompt(executor, 7, 42, false, true)).toEqual({
      reason: "TEAM_WITHOUT_CONTACT",
      discordVerified: false,
      battletagVerified: false,
      battletagRelevant: true,
    });
  });

  it("en Marvel Rivals, n'invite pas le manager au Discord certifié", async () => {
    const { executor } = rosterOf([{ user_id: 7, ...BARE, ...DISCORD }]);
    expect(await loadCertificationPrompt(executor, 7, 42, true, false)).toBeNull();
  });

  it("en Marvel Rivals, invite le joueur dont l'équipe n'a qu'un BattleTag vérifié", async () => {
    const { executor } = rosterOf([{ user_id: 7, ...BARE }, { user_id: 8, ...BARE, ...BATTLETAG }]);
    expect((await loadCertificationPrompt(executor, 7, 42, false, false))?.reason).toBe("TEAM_WITHOUT_CONTACT");
  });

  it("rien pour un lecteur qui n'est plus dans le roster", async () => {
    const { executor } = rosterOf([{ user_id: 8, ...BARE }]);
    expect(await loadCertificationPrompt(executor, 7, 42, true, true)).toBeNull();
  });
});
