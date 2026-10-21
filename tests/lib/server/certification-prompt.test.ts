import { describe, expect, it, jest } from "@jest/globals";
import { loadCertificationPrompt } from "@/lib/server/tournaments/certification-prompt";
import { fakeConnection, type SqlQuery } from "../../helpers/sql-double";

/**
 * Lecture de l'invitation à certifier depuis le roster en cours
 * (`docs/features/CERTIFICATION_PROMPT.md`) : les certifications se lisent
 * comme `pickLaunchContacts` les lit — une date sans tag ne vaut rien.
 */

type Member = {
  team_id?: number;
  pseudo?: string;
  roles_json?: string;
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

/** Roster simulé ; `declined` : réponse à la lecture du « Ne plus voir » du compte (ou son échec). */
function rosterOf(members: Member[], declined: number | Error = 0) {
  const rows = members.map((member) => ({ team_id: 42, pseudo: `J${member.user_id}`, roles_json: "[]", ...member }));
  const execute = jest.fn<SqlQuery>().mockImplementation(async (sql) => {
    if (!String(sql).includes("discord_certify_prompt_dismissed_at")) return [rows, []];
    if (declined instanceof Error) throw declined;
    return [[{ declined }], []];
  });
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

  it("respecte le « Ne plus voir » donné à la proposition de la connexion (compte), Discord seul manquant", async () => {
    const { executor } = rosterOf([{ user_id: 7, ...BARE, ...BATTLETAG }], 1);
    expect(await loadCertificationPrompt(executor, 7, 42, true, true)).toBeNull();
    // Marvel Rivals : Discord est seul à compter.
    const { executor: mr } = rosterOf([{ user_id: 7, ...BARE }], 1);
    expect(await loadCertificationPrompt(mr, 7, 42, true, false)).toBeNull();
  });

  it("ce refus ne tait pas une invitation qui porte aussi sur le BattleTag", async () => {
    const { executor } = rosterOf([{ user_id: 7, ...BARE }], 1);
    expect((await loadCertificationPrompt(executor, 7, 42, true, true))?.reason).toBe("MANAGER");
  });

  it("ce refus ne tait pas une invitation qui ne porte que sur le BattleTag", async () => {
    const { execute, executor } = rosterOf([{ user_id: 7, ...BARE, ...DISCORD }], 1);
    expect((await loadCertificationPrompt(executor, 7, 42, true, true))?.reason).toBe("MANAGER");
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("colonne du « Ne plus voir » absente : comme sans choix ; toute autre panne remonte", async () => {
    const missing = Object.assign(new Error("Unknown column"), { code: "ER_BAD_FIELD_ERROR" });
    const { executor } = rosterOf([{ user_id: 7, ...BARE, ...BATTLETAG }], missing);
    expect((await loadCertificationPrompt(executor, 7, 42, true, true))?.reason).toBe("MANAGER");
    const { executor: failing } = rosterOf([{ user_id: 7, ...BARE, ...BATTLETAG }], new Error("pool"));
    await expect(loadCertificationPrompt(failing, 7, 42, true, true)).rejects.toThrow("pool");
  });

  it("ne lit pas le choix du compte quand aucune invitation n'est due", async () => {
    const { execute, executor } = rosterOf([{ user_id: 7, ...BARE, ...DISCORD, ...BATTLETAG }]);
    expect(await loadCertificationPrompt(executor, 7, 42, true, true)).toBeNull();
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("rien pour un lecteur qui n'est plus dans le roster", async () => {
    const { executor } = rosterOf([{ user_id: 8, ...BARE }]);
    expect(await loadCertificationPrompt(executor, 7, 42, true, true)).toBeNull();
  });
});
