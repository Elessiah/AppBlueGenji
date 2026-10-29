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
  forgetCertificationPromptsOf,
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
 * Roster simulé, rendu comme la requête le calcule (drapeaux seulement) ;
 * `declined` : réponse à la lecture du « Ne plus voir » de la proposition de la
 * connexion (ou son échec) ; `dismissed` : celle du « Ne plus voir » de cette
 * invitation (ou son échec).
 */
function rosterOf(members: Member[], declined: number | Error = 0, dismissed: number | Error = 0) {
  const rows = members.map((member) => ({
    user_id: member.user_id,
    discord_verified: member.discord_verified_at !== null && (member.discord_pseudo ?? "") !== "" ? 1 : 0,
    battletag_verified: member.blizzard_sub !== null && (member.overwatch_battletag ?? "") !== "" ? 1 : 0,
    blizzard_linked: member.blizzard_sub !== null ? 1 : 0,
  }));
  const answer = (value: number | Error) => {
    if (value instanceof Error) throw value;
    return [[{ chosen: value }], []];
  };
  const execute = jest.fn<SqlQuery>().mockImplementation(async (sql) => {
    if (String(sql).includes("discord_certify_prompt_dismissed_at")) return answer(declined);
    if (String(sql).includes("certification_prompt_dismissed_at")) return answer(dismissed);
    return [rows, []];
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

  it("ne sort de la base que des drapeaux : ni pseudo, ni tag, ni identifiant Battle.net, ni rôles (EF-04)", async () => {
    const { execute, executor } = rosterOf([{ user_id: 7, ...BARE }]);
    await loadCertificationPrompt(executor, 7, 42, false, true);
    const select = String(execute.mock.calls[0][0]).split(/\bFROM\b/)[0];
    expect(select).toMatch(/AS discord_verified/);
    expect(select).toMatch(/AS battletag_verified/);
    expect(select).toMatch(/AS blizzard_linked/);
    // Les colonnes ne servent qu'au calcul : parenthèses retirées, chaque champ rendu est un drapeau nommé.
    let flat = select.replace(/\s+/g, " ");
    while (/\([^()]*\)/.test(flat)) flat = flat.replace(/\([^()]*\)/g, "");
    expect(flat.replace(/^SELECT /, "").split(",").map((field) => field.trim())).toEqual([
      "tm.user_id",
      "AS discord_verified",
      "AS battletag_verified",
      "AS blizzard_linked",
    ]);
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
    const missing = Object.assign(new Error("Unknown column"), { code: "ER_BAD_FIELD_ERROR" });
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
    // Roster, puis le seul « Ne plus voir » de cette invitation : le refus de la connexion n'est pas lu.
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls.some(([sql]) => String(sql).includes("discord_certify_prompt_dismissed_at"))).toBe(false);
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

  it("une lecture en cours oubliée n'est pas retenue : la suivante relit (EF-04)", async () => {
    forgetCertificationPrompts();
    clock = 0;
    let finish!: (value: typeof PROMPT) => void;
    const reading = cachedCertificationPrompt("7:42:1:1", () => new Promise((resolve) => (finish = resolve)), now);
    forgetCertificationPromptsOf(7);
    finish(PROMPT);
    // L'appelant qui l'attendait reçoit sa réponse…
    expect(await reading).toEqual(PROMPT);
    // …mais elle n'est pas gardée.
    expect(peekCertificationPrompt("7:42:1:1", now)).toBeUndefined();
    const load = jest.fn(async () => null);
    expect(await cachedCertificationPrompt("7:42:1:1", load, now)).toBeNull();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("issue finale : la réponse tardive d'une lecture abandonnée, `null` si elle échoue ou pend trop (EF-04)", async () => {
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
      expect(await failing).toBeNull();

      const hanging = finalCertificationPrompt("22:42:1:1", () => new Promise<null>(() => undefined), now);
      await jest.advanceTimersByTimeAsync(CERTIFICATION_PROMPT_READ_TIMEOUT_MS);
      await jest.advanceTimersByTimeAsync(CERTIFICATION_PROMPT_TTL_MS);
      expect(await hanging).toBeNull();
      // Une lecture tranchée à temps : la même issue que la course.
      expect(await finalCertificationPrompt("23:42:1:1", async () => PROMPT, now)).toEqual(PROMPT);
    } finally {
      jest.clearAllTimers();
      errors.mockRestore();
      jest.useRealTimers();
      forgetCertificationPrompts();
    }
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
