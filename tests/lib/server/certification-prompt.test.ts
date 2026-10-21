import { describe, expect, it, jest } from "@jest/globals";
import {
  CERTIFICATION_PROMPT_FAILURE_TTL_MS,
  CERTIFICATION_PROMPT_READ_TIMEOUT_MS,
  CERTIFICATION_PROMPT_TTL_MS,
  cachedCertificationPrompt,
  forgetCertificationPrompts,
  loadCertificationPrompt,
} from "@/lib/server/tournaments/certification-prompt";
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
    // L'équipe reste sans contact ; le BattleTag, inactionnable (Battle.net déjà
    // rattaché), n'est pas demandé au lecteur : la modale ne parle que de Discord.
    expect(await loadCertificationPrompt(executor, 7, 42, false, true)).toEqual({
      reason: "TEAM_WITHOUT_CONTACT",
      discordVerified: false,
      battletagVerified: false,
      battletagRelevant: false,
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

  it("ce refus ne tait jamais l'invitation d'une équipe sans contact, meneur compris", async () => {
    const { executor } = rosterOf([{ user_id: 7, ...BARE }], 1);
    expect((await loadCertificationPrompt(executor, 7, 42, false, false))?.reason).toBe("TEAM_WITHOUT_CONTACT");
    const { executor: leader } = rosterOf([{ user_id: 7, ...BARE }], 1);
    expect((await loadCertificationPrompt(leader, 7, 42, true, false))?.reason).toBe("MANAGER");
  });

  it("respecte le « Ne plus voir » donné à la proposition de la connexion (compte), Discord seul manquant", async () => {
    const { executor } = rosterOf([{ user_id: 7, ...BARE, ...BATTLETAG }], 1);
    expect(await loadCertificationPrompt(executor, 7, 42, true, true)).toBeNull();
    // Marvel Rivals : Discord est seul à compter.
    const { executor: mr } = rosterOf([{ user_id: 7, ...BARE }, { user_id: 8, ...BARE, ...DISCORD }], 1);
    expect(await loadCertificationPrompt(mr, 7, 42, true, false)).toBeNull();
  });

  it("ce refus tait aussi l'invitation « Discord seul » d'un BattleTag inactionnable", async () => {
    const { executor } = rosterOf(
      [{ user_id: 7, ...BARE, blizzard_sub: "sub", overwatch_battletag: null }, { user_id: 8, ...BARE, ...DISCORD }],
      1,
    );
    expect(await loadCertificationPrompt(executor, 7, 42, true, true)).toBeNull();
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

  it("Battle.net rattaché sans BattleTag : rien à lui demander de ce côté (inactionnable)", async () => {
    const { executor } = rosterOf([{ user_id: 7, ...BARE, ...DISCORD, blizzard_sub: "sub", overwatch_battletag: null }]);
    expect(await loadCertificationPrompt(executor, 7, 42, true, true)).toBeNull();
  });

  it("rien pour un lecteur qui n'est plus dans le roster", async () => {
    const { executor } = rosterOf([{ user_id: 8, ...BARE }]);
    expect(await loadCertificationPrompt(executor, 7, 42, true, true)).toBeNull();
  });
});

describe("mémoire courte des invitations", () => {
  const PROMPT = { reason: "MANAGER", discordVerified: false, battletagVerified: true, battletagRelevant: true } as const;
  let clock = 0;
  const now = () => clock;

  it("sert l'invitation retenue pendant une minute, puis relit", async () => {
    forgetCertificationPrompts();
    clock = 1_000;
    const load = jest.fn(async () => PROMPT);
    expect(await cachedCertificationPrompt("7:42:1:1", load, now)).toEqual(PROMPT);
    clock += CERTIFICATION_PROMPT_TTL_MS - 1;
    await cachedCertificationPrompt("7:42:1:1", load, now);
    expect(load).toHaveBeenCalledTimes(1);
    clock += 1;
    await cachedCertificationPrompt("7:42:1:1", load, now);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("partage la lecture en cours : une vague de lectures ne vaut qu'une requête", async () => {
    forgetCertificationPrompts();
    const load = jest.fn(async () => null);
    await Promise.all([1, 2, 3].map(() => cachedCertificationPrompt("8:42:0:1", load, now)));
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("un échec rend « rien », journalisé, et n'est retenté qu'après dix secondes", async () => {
    forgetCertificationPrompts();
    clock = 0;
    const errors = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const load = jest.fn(async (): Promise<null> => {
      throw new Error("pool");
    });
    expect(await cachedCertificationPrompt("9:42:0:1", load, now)).toBeNull();
    clock = CERTIFICATION_PROMPT_FAILURE_TTL_MS - 1;
    await cachedCertificationPrompt("9:42:0:1", load, now);
    expect(load).toHaveBeenCalledTimes(1);
    clock = CERTIFICATION_PROMPT_FAILURE_TTL_MS;
    await cachedCertificationPrompt("9:42:0:1", load, now);
    expect(load).toHaveBeenCalledTimes(2);
    expect(errors).toHaveBeenCalled();
    errors.mockRestore();
  });

  it("une lecture qui pend est abandonnée : « rien » pour une minute, puis relue ; tardive, elle sert", async () => {
    forgetCertificationPrompts();
    jest.useFakeTimers();
    const errors = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const PROMPT_LATE = { reason: "MANAGER", discordVerified: false, battletagVerified: true, battletagRelevant: true } as const;
    try {
      const control: { finish?: (value: typeof PROMPT_LATE) => void } = {};
      const load = jest.fn(
        () =>
          new Promise<typeof PROMPT_LATE>((resolve) => {
            control.finish = resolve;
          }),
      );
      clock = 0;
      const hung = cachedCertificationPrompt("10:42:0:1", load, now);
      jest.advanceTimersByTime(CERTIFICATION_PROMPT_READ_TIMEOUT_MS);
      expect(await hung).toBeNull();
      // Pendant la minute : rien d'autre ne part.
      clock = CERTIFICATION_PROMPT_TTL_MS - 1;
      expect(await cachedCertificationPrompt("10:42:0:1", load, now)).toBeNull();
      expect(load).toHaveBeenCalledTimes(1);
      // Finie tard mais réussie : elle sert, pour une minute.
      control.finish?.(PROMPT_LATE);
      await Promise.resolve();
      await Promise.resolve();
      expect(await cachedCertificationPrompt("10:42:0:1", load, now)).toEqual(PROMPT_LATE);
      expect(load).toHaveBeenCalledTimes(1);
      jest.clearAllTimers();
      forgetCertificationPrompts();
    } finally {
      errors.mockRestore();
      jest.useRealTimers();
    }
  });

  it("une lecture qui pend pour de bon libère la clé au bout d'une minute", async () => {
    forgetCertificationPrompts();
    jest.useFakeTimers();
    const errors = jest.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const load = jest.fn(() => new Promise<null>(() => undefined));
      clock = 0;
      const hung = cachedCertificationPrompt("11:42:0:1", load, now);
      jest.advanceTimersByTime(CERTIFICATION_PROMPT_READ_TIMEOUT_MS);
      await hung;
      clock = CERTIFICATION_PROMPT_TTL_MS + 1;
      void cachedCertificationPrompt("11:42:0:1", load, now);
      expect(load).toHaveBeenCalledTimes(2);
      jest.clearAllTimers();
      forgetCertificationPrompts();
    } finally {
      errors.mockRestore();
      jest.useRealTimers();
    }
  });

  it("une panne ne journalise qu'un message par fenêtre", async () => {
    forgetCertificationPrompts();
    clock = 0;
    const errors = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const failing = async (): Promise<null> => {
      throw new Error("pool");
    };
    await Promise.all(["a", "b", "c"].map((key) => cachedCertificationPrompt(key, failing, now)));
    expect(errors).toHaveBeenCalledTimes(1);
    clock = CERTIFICATION_PROMPT_FAILURE_TTL_MS;
    await cachedCertificationPrompt("d", failing, now);
    expect(errors).toHaveBeenCalledTimes(2);
    expect(String(errors.mock.calls[1][0])).toContain("2 autres tus");
    errors.mockRestore();
  });

  it("pleine, la mémoire chasse d'abord l'expiré, jamais une lecture en cours", async () => {
    forgetCertificationPrompts();
    jest.useFakeTimers();
    clock = 0;
    const pending = jest.fn(() => new Promise<null>(() => undefined));
    void cachedCertificationPrompt("en-cours", pending, now);
    for (let i = 0; i < 1_999; i += 1) await cachedCertificationPrompt(`k${i}`, async () => null, now);
    clock = CERTIFICATION_PROMPT_TTL_MS;
    await cachedCertificationPrompt("neuve", async () => null, now);
    void cachedCertificationPrompt("en-cours", pending, now);
    expect(pending).toHaveBeenCalledTimes(1);
    jest.clearAllTimers();
    jest.useRealTimers();
    forgetCertificationPrompts();
  });

  it("pleine de lectures en cours, elle ne grandit pas", async () => {
    forgetCertificationPrompts();
    jest.useFakeTimers();
    clock = 0;
    const pending = () => new Promise<null>(() => undefined);
    for (let i = 0; i < 2_000; i += 1) void cachedCertificationPrompt(`p${i}`, pending, now);
    const extra = jest.fn(async () => null);
    await cachedCertificationPrompt("en-trop", extra, now);
    await cachedCertificationPrompt("en-trop", extra, now);
    // Non retenue : relue à chaque fois.
    expect(extra).toHaveBeenCalledTimes(2);
    jest.clearAllTimers();
    jest.useRealTimers();
    forgetCertificationPrompts();
  });

  it("reste bornée : la plus ancienne part", async () => {
    forgetCertificationPrompts();
    clock = 0;
    for (let i = 0; i < 2_001; i += 1) await cachedCertificationPrompt(`k${i}`, async () => null, now);
    const load = jest.fn(async () => null);
    await cachedCertificationPrompt("k0", load, now);
    expect(load).toHaveBeenCalledTimes(1);
  });
});
