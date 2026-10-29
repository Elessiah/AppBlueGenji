import { describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");

import { getDatabase } from "@/lib/server/database";
import {
  CERTIFICATION_PROMPT_CACHE_MAX,
  CERTIFICATION_PROMPT_FAILURE_TTL_MS,
  CERTIFICATION_PROMPT_READ_TIMEOUT_MS,
  CERTIFICATION_PROMPT_STUCK_READ_MS,
  CERTIFICATION_PROMPT_TTL_MS,
  cachedCertificationPrompt,
  finalCertificationPrompt,
  forgetCertificationPrompts,
  forgetCertificationPromptsAround,
  forgetCertificationPromptsOf,
  forgetCertificationPromptsOfTeam,
  loadCertificationPrompt,
  peekCertificationPrompt,
  recordCertificationPromptOff,
} from "@/lib/server/tournaments/certification-prompt";
import { fakeConnection, fakePool, type SqlQuery } from "../../helpers/sql-double";

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
  /** 1 : BattleTag tapé, gardé sous un Battle.net qui n'en donnait aucun (D3). */
  overwatch_battletag_typed?: number;
};

const BARE: Omit<Member, "user_id"> = {
  discord_verified_at: null,
  discord_pseudo: "pseudo",
  blizzard_sub: null,
  overwatch_battletag: "Joueur#1234",
};
const DISCORD = { discord_verified_at: "2026-10-01 10:00:00", discord_pseudo: "pseudo" };
const BATTLETAG = { blizzard_sub: "sub", overwatch_battletag: "Joueur#1234" };

/**
 * Roster simulé, colonnes brutes (les règles du lancement les jugent, EF-23) ;
 * `declined` : réponse à la lecture du « Ne plus voir » de la proposition de la
 * connexion (ou son échec) ; `dismissed` : celle du « Ne plus voir » de cette
 * invitation (ou son échec). Les deux se lisent d'un SELECT commun, qui échoue
 * si l'une échoue ; chacune se relit alors à part.
 */
function rosterOf(members: Member[], declined: number | Error = 0, dismissed: number | Error = 0) {
  const rows = members.map((member) => ({ overwatch_battletag_typed: 0, ...member }));
  const answer = (value: number | Error) => {
    if (value instanceof Error) throw value;
    return [[{ chosen: value }], []];
  };
  const execute = jest.fn<SqlQuery>().mockImplementation(async (sql) => {
    const text = String(sql);
    const readsDeclined = text.includes("discord_certify_prompt_dismissed_at");
    const readsDismissed = text.includes("certification_prompt_dismissed_at");
    if (readsDeclined && readsDismissed) {
      if (dismissed instanceof Error) throw dismissed;
      if (declined instanceof Error) throw declined;
      return [[{ certification_off: dismissed, discord_off: declined }], []];
    }
    if (readsDeclined) return answer(declined);
    if (readsDismissed) return answer(dismissed);
    return [rows, []];
  });
  return { execute, executor: fakeConnection({ execute }) };
}

const UNKNOWN_COLUMN = () => Object.assign(new Error("Unknown column"), { code: "ER_BAD_FIELD_ERROR" });

describe("loadCertificationPrompt", () => {
  it("lit le roster en cours de l'équipe, comptes supprimés exclus", async () => {
    const { execute, executor } = rosterOf([{ user_id: 7, ...BARE }]);
    await loadCertificationPrompt(executor, 7, 42, false, true);
    const [sql, params] = execute.mock.calls[0];
    expect(sql).toContain("tm.left_at IS NULL");
    expect(sql).toContain("u.is_deleted = 0");
    expect(params).toEqual([42]);
  });

  it("loadRosterCertifications_select_readsOnlyTheColumnsTheLaunchRulesJudge (EF-23)", async () => {
    const { execute, executor } = rosterOf([{ user_id: 7, ...BARE }]);
    await loadCertificationPrompt(executor, 7, 42, false, true);
    const select = String(execute.mock.calls[0][0]).split(/\bFROM\b/)[0].replace(/\s+/g, " ").trim();
    // Ni pseudo du site, ni rôles : les seules colonnes que `hasVerifiedDiscord`,
    // `hasVerifiedBattletag` et `battletagFromBlizzard` jugent.
    expect(select).toBe(
      "SELECT tm.user_id, u.discord_verified_at, u.discord_pseudo, u.blizzard_sub, u.overwatch_battletag, u.overwatch_battletag_typed",
    );
  });

  it("loadCertificationPrompt_result_carriesFlagsOnlyNeverATagOrIdentifier (EF-04)", async () => {
    const { executor } = rosterOf([{ user_id: 7, ...BARE, ...DISCORD }]);
    const prompt = await loadCertificationPrompt(executor, 7, 42, true, true);
    expect(JSON.stringify(prompt)).not.toMatch(/pseudo|Joueur#1234|sub/);
  });

  it("loadCertificationPrompt_typedBattletagUnderBattleNet_notAVerifiedContact (D3)", async () => {
    const { executor } = rosterOf([{ user_id: 7, ...BARE, ...BATTLETAG, overwatch_battletag_typed: 1 }]);
    expect(await loadCertificationPrompt(executor, 7, 42, false, true)).toEqual({
      reason: "TEAM_WITHOUT_CONTACT",
      discordVerified: false,
      battletagVerified: false,
      // Battle.net rattaché : un BattleTag n'est plus à demander de ce côté.
      battletagRelevant: false,
      teamHasContact: false,
    });
  });

  it("loadCertificationPrompt_verifiedDiscordWithBlankTag_notAContact (EF-23)", async () => {
    const { executor } = rosterOf([{ user_id: 7, ...BARE, discord_verified_at: "2026-10-01 10:00:00", discord_pseudo: "" }]);
    expect((await loadCertificationPrompt(executor, 7, 42, false, true))?.discordVerified).toBe(false);
  });

  it("loadAccountChoices_bothChoices_readByASingleSelect (EF-23)", async () => {
    const { execute, executor } = rosterOf([{ user_id: 7, ...BARE, ...BATTLETAG }], 1, 0);
    expect(await loadCertificationPrompt(executor, 7, 42, true, true)).toBeNull();
    expect(execute).toHaveBeenCalledTimes(2);
    expect(String(execute.mock.calls[1][0])).toMatch(
      /SELECT certification_prompt_dismissed_at IS NOT NULL AS certification_off,\s+discord_certify_prompt_dismissed_at IS NOT NULL AS discord_off\s+FROM bg_users WHERE id = \?/,
    );
    expect(execute.mock.calls[1][1]).toEqual([7]);
  });

  it("loadAccountChoices_oneColumnMissing_rereadsEachAndKeepsTheOther (EF-23)", async () => {
    const { execute, executor } = rosterOf([{ user_id: 7, ...BARE, ...BATTLETAG }], 1, UNKNOWN_COLUMN());
    // L'absente vaut « sans choix », l'autre (refus de la connexion) tient.
    expect(await loadCertificationPrompt(executor, 7, 42, true, true)).toBeNull();
    expect(execute).toHaveBeenCalledTimes(4);
  });

  it("« Ne plus voir » de cette invitation, posé sur le compte, la tait toute (équipe sans contact comprise) (EF-04)", async () => {
    const { execute, executor } = rosterOf([{ user_id: 7, ...BARE }], 0, 1);
    expect(await loadCertificationPrompt(executor, 7, 42, false, true)).toBeNull();
    const { executor: leader } = rosterOf([{ user_id: 7, ...BARE, ...DISCORD }], 0, 1);
    expect(await loadCertificationPrompt(leader, 7, 42, true, true)).toBeNull();
    const choice = execute.mock.calls.find(([sql]) => String(sql).includes("certification_prompt_dismissed_at"));
    expect(String(choice?.[0])).toMatch(/FROM bg_users WHERE id = \?/);
    expect(choice?.[1]).toEqual([7]);
  });

  it("colonne du « Ne plus voir » de l'invitation absente : comme sans choix ; toute autre panne remonte (EF-04)", async () => {
    const missing = UNKNOWN_COLUMN();
    const { executor } = rosterOf([{ user_id: 7, ...BARE }], 0, missing);
    expect((await loadCertificationPrompt(executor, 7, 42, false, true))?.reason).toBe("TEAM_WITHOUT_CONTACT");
    const { executor: failing } = rosterOf([{ user_id: 7, ...BARE }], 0, new Error("pool"));
    await expect(loadCertificationPrompt(failing, 7, 42, false, true)).rejects.toThrow("pool");
  });

  it("invite le joueur d'une équipe sans aucun contact", async () => {
    const { executor } = rosterOf([{ user_id: 7, ...BARE }, { user_id: 8, ...BARE }]);
    expect(await loadCertificationPrompt(executor, 7, 42, false, true)).toEqual({
      reason: "TEAM_WITHOUT_CONTACT",
      discordVerified: false,
      battletagVerified: false,
      battletagRelevant: true,
      teamHasContact: false,
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
      teamHasContact: true,
    });
  });

  it("loadCertificationPrompt_managerOfTeamWithoutContact_saysTeamUnreachable : le meneur apprend que l'équipe est injoignable", async () => {
    const { executor } = rosterOf([{ user_id: 7, ...BARE }, { user_id: 8, ...BARE }]);
    expect(await loadCertificationPrompt(executor, 7, 42, true, true)).toEqual({
      reason: "MANAGER",
      discordVerified: false,
      battletagVerified: false,
      battletagRelevant: true,
      teamHasContact: false,
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
      teamHasContact: false,
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
    // Roster, puis les deux choix du compte d'un seul SELECT : le refus de la connexion, lu, n'y vaut pas.
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("colonne du « Ne plus voir » absente : comme sans choix ; toute autre panne remonte", async () => {
    const missing = UNKNOWN_COLUMN();
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
  const PROMPT = { reason: "MANAGER", discordVerified: false, battletagVerified: true, battletagRelevant: true, teamHasContact: true } as const;
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
    const PROMPT_LATE = { reason: "MANAGER", discordVerified: false, battletagVerified: true, battletagRelevant: true, teamHasContact: true } as const;
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

  it("une lecture abandonnée qui pend encore n'en relance pas d'autre ; tenue pour perdue après dix minutes (EF-04)", async () => {
    forgetCertificationPrompts();
    jest.useFakeTimers();
    const errors = jest.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const load = jest.fn(() => new Promise<null>(() => undefined));
      clock = 0;
      const hung = cachedCertificationPrompt("11:42:0:1", load, now);
      jest.advanceTimersByTime(CERTIFICATION_PROMPT_READ_TIMEOUT_MS);
      await hung;
      // Chaque minute d'un blocage du pool : « rien », sans nouvelle acquisition en file.
      for (const at of [CERTIFICATION_PROMPT_TTL_MS + 1, 3 * CERTIFICATION_PROMPT_TTL_MS, CERTIFICATION_PROMPT_STUCK_READ_MS - 1]) {
        clock = at;
        expect(await cachedCertificationPrompt("11:42:0:1", load, now)).toBeNull();
      }
      expect(load).toHaveBeenCalledTimes(1);
      // Au-delà de dix minutes (et de l'échéance de la dernière minute servie) : relue.
      clock = CERTIFICATION_PROMPT_STUCK_READ_MS + CERTIFICATION_PROMPT_TTL_MS;
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
    const extra = jest.fn(async () => PROMPT);
    // « Rien », sans lire : en pleine surcharge, une lecture par appel ajouterait à la charge (EF-04).
    expect(await cachedCertificationPrompt("en-trop", extra, now)).toBeNull();
    expect(await cachedCertificationPrompt("en-trop", extra, now)).toBeNull();
    expect(extra).not.toHaveBeenCalled();
    jest.clearAllTimers();
    jest.useRealTimers();
    forgetCertificationPrompts();
  });

  it("pleine, une seule place libre sert à une lecture (borne exacte)", async () => {
    forgetCertificationPrompts();
    jest.useFakeTimers();
    clock = 0;
    const pending = () => new Promise<null>(() => undefined);
    for (let i = 0; i < CERTIFICATION_PROMPT_CACHE_MAX - 1; i += 1) void cachedCertificationPrompt(`p${i}`, pending, now);
    const last = jest.fn(async () => PROMPT);
    expect(await cachedCertificationPrompt("derniere", last, now)).toEqual(PROMPT);
    expect(last).toHaveBeenCalledTimes(1);
    jest.clearAllTimers();
    jest.useRealTimers();
    forgetCertificationPrompts();
  });

  it("finalCertificationPrompt_memoryFullOfPendingReads_unknownOutcomeWithoutReading (EF-23)", async () => {
    forgetCertificationPrompts();
    jest.useFakeTimers();
    clock = 0;
    const pending = () => new Promise<null>(() => undefined);
    for (let i = 0; i < CERTIFICATION_PROMPT_CACHE_MAX; i += 1) void cachedCertificationPrompt(`p${i}`, pending, now);
    const load = jest.fn(async () => PROMPT);
    // Rien à pousser au flux : une trame `null` y retirerait l'invitation posée.
    expect(await finalCertificationPrompt("pleine", load, now)).toBeUndefined();
    expect(load).not.toHaveBeenCalled();
    jest.clearAllTimers();
    jest.useRealTimers();
    forgetCertificationPrompts();
  });

  it("peek rend l'issue connue sans lire ; rien pour une clé inconnue, en cours ou expirée (EF-04)", async () => {
    forgetCertificationPrompts();
    clock = 0;
    expect(peekCertificationPrompt("7:42:1:1", now)).toBeUndefined();
    let finish!: (value: typeof PROMPT) => void;
    const reading = cachedCertificationPrompt("7:42:1:1", () => new Promise((resolve) => (finish = resolve)), now);
    expect(peekCertificationPrompt("7:42:1:1", now)).toBeUndefined();
    finish(PROMPT);
    await reading;
    expect(peekCertificationPrompt("7:42:1:1", now)).toEqual({ prompt: PROMPT });
    await cachedCertificationPrompt("8:42:1:1", async () => null, now);
    expect(peekCertificationPrompt("8:42:1:1", now)).toEqual({ prompt: null });
    clock = CERTIFICATION_PROMPT_TTL_MS;
    expect(peekCertificationPrompt("7:42:1:1", now)).toBeUndefined();
  });

  it("oublie les invitations d'un compte, toutes équipes et tous rôles, sans toucher aux autres (EF-04)", async () => {
    forgetCertificationPrompts();
    clock = 0;
    for (const key of ["7:42:1:1", "7:43:0:0", "70:42:1:1"]) await cachedCertificationPrompt(key, async () => PROMPT, now);
    forgetCertificationPromptsOf(7);
    expect(peekCertificationPrompt("7:42:1:1", now)).toBeUndefined();
    expect(peekCertificationPrompt("7:43:0:0", now)).toBeUndefined();
    // `70:` ne commence pas par `7:` : gardée.
    expect(peekCertificationPrompt("70:42:1:1", now)).toEqual({ prompt: PROMPT });
    const load = jest.fn(async () => null);
    expect(await cachedCertificationPrompt("7:42:1:1", load, now)).toBeNull();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("cachedCertificationPrompt_inFlightReadForgotten_rereadsAfterTheGesture (EF-04, EF-23)", async () => {
    forgetCertificationPrompts();
    clock = 0;
    let finishFirst!: (value: typeof PROMPT | null) => void;
    const load = jest
      .fn<() => Promise<typeof PROMPT | null>>()
      .mockImplementationOnce(() => new Promise((resolve) => (finishFirst = resolve)))
      .mockResolvedValueOnce(null);
    const reading = cachedCertificationPrompt("7:42:1:1", load, now);
    forgetCertificationPromptsOf(7);
    finishFirst(PROMPT);
    // L'issue d'avant le geste (certification, « Ne plus voir ») n'est pas
    // servie : l'appelant reçoit celle d'une relecture partie après lui.
    expect(await reading).toBeNull();
    expect(load).toHaveBeenCalledTimes(2);
    // La relecture, elle, est retenue.
    expect(peekCertificationPrompt("7:42:1:1", now)).toEqual({ prompt: null });
  });

  it("cachedCertificationPrompt_teamReadForgotten_servesTheNowDueInvitation (EF-23)", async () => {
    // Le seul contact certifié de l'équipe part pendant la lecture d'un
    // coéquipier : l'invitation devient due — « rien » la tairait.
    forgetCertificationPrompts();
    clock = 0;
    let finishFirst!: (value: typeof PROMPT | null) => void;
    const load = jest
      .fn<() => Promise<typeof PROMPT | null>>()
      .mockImplementationOnce(() => new Promise((resolve) => (finishFirst = resolve)))
      .mockResolvedValueOnce(PROMPT);
    const final = finalCertificationPrompt("8:42:1:1", load, now);
    forgetCertificationPromptsOfTeam(42);
    finishFirst(null);

    expect(await final).toEqual(PROMPT);
  });

  it("issue finale : la réponse tardive d'une lecture abandonnée, inconnue (`undefined`) si elle échoue ou pend trop (EF-04, EF-23)", async () => {
    forgetCertificationPrompts();
    jest.useFakeTimers();
    const errors = jest.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      clock = 0;
      const control: { finish?: (value: typeof PROMPT) => void; fail?: (error: Error) => void } = {};
      const slow = () => new Promise<typeof PROMPT>((resolve, reject) => Object.assign(control, { finish: resolve, fail: reject }));
      const final = finalCertificationPrompt("20:42:1:1", slow, now);
      const raced = cachedCertificationPrompt("20:42:1:1", slow, now);
      await jest.advanceTimersByTimeAsync(CERTIFICATION_PROMPT_READ_TIMEOUT_MS);
      expect(await raced).toBeNull();
      control.finish?.(PROMPT);
      expect(await final).toEqual(PROMPT);

      const failing = finalCertificationPrompt("21:42:1:1", slow, now);
      await jest.advanceTimersByTimeAsync(CERTIFICATION_PROMPT_READ_TIMEOUT_MS);
      control.fail?.(new Error("pool"));
      // Issue inconnue : aucune trame, le client garde l'invitation posée.
      expect(await failing).toBeUndefined();

      const hanging = finalCertificationPrompt("22:42:1:1", () => new Promise<null>(() => undefined), now);
      await jest.advanceTimersByTimeAsync(CERTIFICATION_PROMPT_READ_TIMEOUT_MS);
      await jest.advanceTimersByTimeAsync(CERTIFICATION_PROMPT_TTL_MS);
      expect(await hanging).toBeUndefined();
      // Une lecture tranchée à temps : la même issue que la course.
      expect(await finalCertificationPrompt("23:42:1:1", async () => PROMPT, now)).toEqual(PROMPT);
    } finally {
      jest.clearAllTimers();
      errors.mockRestore();
      jest.useRealTimers();
      forgetCertificationPrompts();
    }
  });

  it("finalCertificationPrompt_lateReadForgotten_unknownOutcome (EF-23)", async () => {
    forgetCertificationPrompts();
    jest.useFakeTimers();
    try {
      clock = 0;
      let finish!: (value: typeof PROMPT) => void;
      const final = finalCertificationPrompt("24:42:1:1", () => new Promise((resolve) => (finish = resolve)), now);
      await jest.advanceTimersByTimeAsync(CERTIFICATION_PROMPT_READ_TIMEOUT_MS);
      forgetCertificationPromptsOf(24);
      finish(PROMPT);
      // Oubliée (certifiée entre-temps) : sa réponse date d'avant le geste —
      // issue inconnue, rien à pousser (`null` dirait « retrait décidé »).
      expect(await final).toBeUndefined();
    } finally {
      jest.clearAllTimers();
      jest.useRealTimers();
      forgetCertificationPrompts();
    }
  });

  it("forgetCertificationPromptsOfTeam_teamKeys_forgetsEveryMemberOfThatTeamOnly (EF-23)", async () => {
    forgetCertificationPrompts();
    clock = 0;
    await cachedCertificationPrompt("7:42:0:1", async () => PROMPT, now);
    await cachedCertificationPrompt("8:42:1:1", async () => PROMPT, now);
    await cachedCertificationPrompt("9:420:0:1", async () => PROMPT, now);
    await cachedCertificationPrompt("42:9:0:1", async () => PROMPT, now);

    forgetCertificationPromptsOfTeam(42);

    expect(peekCertificationPrompt("7:42:0:1", now)).toBeUndefined();
    expect(peekCertificationPrompt("8:42:1:1", now)).toBeUndefined();
    // Ni l'équipe 420 (préfixe), ni le compte 42 d'une autre équipe.
    expect(peekCertificationPrompt("9:420:0:1", now)).toEqual({ prompt: PROMPT });
    expect(peekCertificationPrompt("42:9:0:1", now)).toEqual({ prompt: PROMPT });
    forgetCertificationPrompts();
  });

  it("pleine, la mémoire ne chasse pas une lecture abandonnée qui pend encore (EF-04)", async () => {
    forgetCertificationPrompts();
    jest.useFakeTimers();
    const errors = jest.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      clock = 0;
      const stuck = jest.fn(() => new Promise<null>(() => undefined));
      const hung = cachedCertificationPrompt("pendante", stuck, now);
      jest.advanceTimersByTime(CERTIFICATION_PROMPT_READ_TIMEOUT_MS);
      await hung;
      for (let i = 0; i < CERTIFICATION_PROMPT_CACHE_MAX - 1; i += 1) await cachedCertificationPrompt(`k${i}`, async () => null, now);
      // Pleine : une nouvelle clé chasse `k0`, jamais la lecture pendante (la plus ancienne).
      await cachedCertificationPrompt("neuve", async () => null, now);
      expect(await cachedCertificationPrompt("pendante", stuck, now)).toBeNull();
      expect(stuck).toHaveBeenCalledTimes(1);
    } finally {
      jest.clearAllTimers();
      errors.mockRestore();
      jest.useRealTimers();
      forgetCertificationPrompts();
    }
  });

  it("oubliée, une lecture abandonnée qui pend reste une garde, et sa réponse tardive est écartée (EF-04)", async () => {
    forgetCertificationPrompts();
    jest.useFakeTimers();
    const errors = jest.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      clock = 0;
      const control: { finish?: (value: typeof PROMPT) => void } = {};
      const load = jest.fn(() => new Promise<typeof PROMPT>((resolve) => (control.finish = resolve)));
      const hung = cachedCertificationPrompt("7:42:1:1", load, now);
      jest.advanceTimersByTime(CERTIFICATION_PROMPT_READ_TIMEOUT_MS);
      await hung;
      forgetCertificationPromptsOf(7);
      expect(peekCertificationPrompt("7:42:1:1", now)).toBeUndefined();
      // Pas de seconde acquisition en file derrière elle.
      expect(await cachedCertificationPrompt("7:42:1:1", load, now)).toBeNull();
      expect(load).toHaveBeenCalledTimes(1);
      // Sa réponse tardive date d'avant le geste : jamais servie.
      control.finish?.(PROMPT);
      await Promise.resolve();
      await Promise.resolve();
      expect(await cachedCertificationPrompt("7:42:1:1", load, now)).toBeNull();
    } finally {
      jest.clearAllTimers();
      errors.mockRestore();
      jest.useRealTimers();
      forgetCertificationPrompts();
    }
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

describe("recordCertificationPromptOff (EF-04)", () => {
  const PROMPT = { reason: "MANAGER", discordVerified: false, battletagVerified: true, battletagRelevant: true, teamHasContact: true } as const;

  it("pose la date du premier choix sur le compte, jamais sur un compte supprimé, et oublie ses invitations retenues", async () => {
    forgetCertificationPrompts();
    await cachedCertificationPrompt("7:42:1:1", async () => PROMPT);
    const execute = jest.fn<SqlQuery>().mockResolvedValue([{ affectedRows: 1 }, []]);
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
    await recordCertificationPromptOff(7);
    const [sql, params] = execute.mock.calls[0];
    expect(String(sql)).toMatch(/UPDATE bg_users SET certification_prompt_dismissed_at = NOW\(\)/);
    expect(String(sql)).toMatch(/WHERE id = \? AND is_deleted = 0 AND certification_prompt_dismissed_at IS NULL/);
    expect(params).toEqual([7]);
    expect(peekCertificationPrompt("7:42:1:1")).toBeUndefined();
  });

  it("ignore un identifiant invalide sans rien écrire", async () => {
    const execute = jest.fn<SqlQuery>();
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
    for (const id of [0, -1, 1.5, Number.NaN]) await recordCertificationPromptOff(id);
    expect(execute).not.toHaveBeenCalled();
  });

  it("une panne d'écriture remonte, et la mémoire n'est pas oubliée", async () => {
    forgetCertificationPrompts();
    await cachedCertificationPrompt("7:42:1:1", async () => PROMPT);
    const execute = jest.fn<SqlQuery>().mockRejectedValue(new Error("pool"));
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
    await expect(recordCertificationPromptOff(7)).rejects.toThrow("pool");
    expect(peekCertificationPrompt("7:42:1:1")).toEqual({ prompt: PROMPT });
  });
});

describe("recordCertificationPromptOff — choix rejoué (EF-23)", () => {
  const PROMPT = { reason: "MANAGER", discordVerified: false, battletagVerified: true, battletagRelevant: true, teamHasContact: true } as const;

  it("recordCertificationPromptOff_alreadySaved_leavesMemoryUntouched", async () => {
    forgetCertificationPrompts();
    await cachedCertificationPrompt("7:42:1:1", async () => PROMPT);
    const execute = jest.fn<SqlQuery>().mockResolvedValue([{ affectedRows: 0 }, []]);
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));

    await recordCertificationPromptOff(7);

    // 0 ligne : le premier choix l'a déjà oubliée — la mémoire n'est pas reparcourue.
    expect(peekCertificationPrompt("7:42:1:1")).toEqual({ prompt: PROMPT });
    forgetCertificationPrompts();
  });
});

describe("forgetCertificationPromptsAround (EF-23)", () => {
  const PROMPT = { reason: "TEAM_WITHOUT_CONTACT", discordVerified: false, battletagVerified: false, battletagRelevant: true, teamHasContact: false } as const;

  it("forgetCertificationPromptsAround_certified_forgetsTheAccountAndItsActiveTeams", async () => {
    forgetCertificationPrompts();
    await cachedCertificationPrompt("7:42:0:1", async () => PROMPT);
    await cachedCertificationPrompt("8:42:0:1", async () => PROMPT);
    await cachedCertificationPrompt("9:50:0:1", async () => PROMPT);
    const execute = jest.fn<SqlQuery>().mockResolvedValue([[{ team_id: 42 }], []]);
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));

    await forgetCertificationPromptsAround(7);

    const [sql, params] = execute.mock.calls[0];
    expect(String(sql)).toMatch(/SELECT team_id FROM bg_team_members WHERE user_id = \? AND left_at IS NULL/);
    expect(params).toEqual([7]);
    // Le coéquipier : son « équipe sans contact » ne vaut plus.
    expect(peekCertificationPrompt("8:42:0:1")).toBeUndefined();
    expect(peekCertificationPrompt("7:42:0:1")).toBeUndefined();
    expect(peekCertificationPrompt("9:50:0:1")).toEqual({ prompt: PROMPT });
    forgetCertificationPrompts();
  });

  it("forgetCertificationPromptsAround_teamReadFails_neverRejectsAndStillForgetsTheAccount", async () => {
    forgetCertificationPrompts();
    await cachedCertificationPrompt("7:42:0:1", async () => PROMPT);
    const errors = jest.spyOn(console, "error").mockImplementation(() => undefined);
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute: jest.fn<SqlQuery>().mockRejectedValue(new Error("pool")) }));

    await expect(forgetCertificationPromptsAround(7)).resolves.toBeUndefined();

    expect(peekCertificationPrompt("7:42:0:1")).toBeUndefined();
    expect(errors).toHaveBeenCalled();
    errors.mockRestore();
    forgetCertificationPrompts();
  });
});
