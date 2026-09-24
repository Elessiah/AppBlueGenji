import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/solo-entries-service");
jest.mock("@/lib/server/stats-service");
jest.mock("@/lib/server/image-upload");

import { deleteOwnAccount, getAccountDeletionPlan } from "@/lib/server/users-service";
import { getDatabase } from "@/lib/server/database";
import { deleteStoredImage } from "@/lib/server/image-upload";
import { syncSoloEntryIdentityOn } from "@/lib/server/solo-entries-service";
import { fakePool } from "../../helpers/sql-double";
import { ANONYMOUS_PSEUDOS } from "@/lib/shared/anonymous-pseudos";

/**
 * L'écriture de la suppression : ce qu'elle efface, ce qu'elle garde, et ce
 * qu'elle refuse d'effacer.
 *
 * Le mode est décidé par le module pur ; ce qui se teste ici, c'est la **lecture
 * des traces** et les gestes qui en découlent — notamment ceux qu'aucune
 * cascade ne fait : `bg_site_visits` n'a pas de clé étrangère (une cascade y
 * effacerait l'historique de fréquentation), donc c'est le lien vers la personne
 * qu'il faut retirer à la main.
 */
type Query = { sql: string; params: unknown[] };

type Trace = { played: number; organized: number; owned: number };

/**
 * La base, et la transaction qui la porte.
 *
 * L'écriture passe par une connexion dédiée : c'est elle qui tient le verrou et
 * la transaction, et le test doit pouvoir dire qu'elle a bien été ouverte,
 * commitée — ou annulée, quand une écriture échoue.
 */
function fakeDb(
  trace: Trace,
  options: {
    avatarUrl?: string | null;
    discordId?: string | null;
    missing?: boolean;
    failOn?: string;
    failWith?: Error;
    /** Pseudos d'emprunt dont l'écriture rend `ER_DUP_ENTRY` (une fois chacun). */
    duplicatePseudos?: string[];
  } = {},
) {
  const queries: Query[] = [];
  const avatarUrl = options.avatarUrl ?? null;

  const execute = jest.fn(async (sql: string, params: unknown[] = []) => {
    const q = String(sql).replace(/\s+/g, " ").trim();
    queries.push({ sql: q, params });
    if (options.failOn && q.includes(options.failOn)) {
      throw options.failWith ?? new Error("DB_DOWN");
    }
    if (q.startsWith("UPDATE bg_users SET pseudo = ?")) {
      const index = options.duplicatePseudos?.indexOf(String(params[0])) ?? -1;
      if (index >= 0) {
        options.duplicatePseudos!.splice(index, 1);
        throw Object.assign(new Error("Duplicate entry"), { code: "ER_DUP_ENTRY" });
      }
    }
    if (q.includes("AS played")) return [[trace]];
    if (q.includes("SELECT avatar_url, discord_id, created_at FROM bg_users")) {
      return [
        options.missing ? [] : [{ avatar_url: avatarUrl, discord_id: options.discordId ?? null, created_at: "2026-01-02 03:04:05" }],
      ];
    }
    return [[]];
  });

  const connection = {
    execute,
    beginTransaction: jest.fn(async () => {}),
    commit: jest.fn(async () => {}),
    rollback: jest.fn(async () => {}),
    release: jest.fn(() => {}),
  };

  jest.mocked(getDatabase).mockResolvedValue(fakePool({
    execute,
    getConnection: jest.fn(async () => connection),
  }));
  return { queries, connection };
}

const has = (queries: Query[], needle: string) => queries.some((q) => q.sql.includes(needle));

const EMPTY = { played: 0, organized: 0, owned: 0 };

beforeEach(() => {
  jest.clearAllMocks();
});

describe("deleteOwnAccount — effacement complet", () => {
  it("efface la ligne d'un compte qui n'a rien laissé", async () => {
    const { queries } = fakeDb(EMPTY);

    expect(await deleteOwnAccount(7)).toEqual({ mode: "ERASE", reason: null });
    expect(has(queries, "DELETE FROM bg_users")).toBe(true);
    expect(has(queries, "UPDATE bg_users SET pseudo")).toBe(false);
  });

  it("ne touche pas aux visites : elles ne désignent aucun compte", async () => {
    // `bg_site_visits` ne garde qu'une empreinte salée, sans `user_id` : il n'y
    // a plus de lien à détacher, et les visites restent comptées.
    const { queries } = fakeDb(EMPTY);

    await deleteOwnAccount(7);

    expect(has(queries, "bg_site_visits")).toBe(false);
  });

  it("ne resynchronise aucune entrée solo : l'orpheline part avec le compte", async () => {
    // Un compte effaçable n'a au plus qu'une entrée solo jamais inscrite :
    // elle est supprimée, pas renommée.
    const { queries } = fakeDb(EMPTY);

    await deleteOwnAccount(7);

    expect(syncSoloEntryIdentityOn).not.toHaveBeenCalled();
    expect(has(queries, "DELETE FROM bg_teams WHERE solo_user_id = ?")).toBe(true);
  });

  it("resynchronise l'entrée solo d'un compte anonymisé sous son pseudo d'emprunt", async () => {
    fakeDb({ ...EMPTY, played: 1 });

    await deleteOwnAccount(7);

    expect(syncSoloEntryIdentityOn).toHaveBeenCalledWith(expect.anything(), 7);
  });
});

describe("deleteOwnAccount — traces qui retiennent la ligne", () => {
  it.each([
    ["un tournoi joué", { ...EMPTY, played: 1 }, "TOURNAMENTS"],
    ["un tournoi organisé", { ...EMPTY, organized: 1 }, "ORGANIZED_TOURNAMENTS"],
    ["une équipe possédée", { ...EMPTY, owned: 1 }, "OWNED_TEAMS"],
  ])("anonymise sur %s, et le dit", async (_label, trace, reason) => {
    const { queries } = fakeDb(trace);

    // Le motif remonte jusqu'à l'écran : « tes statistiques restent » ne veut
    // rien dire à qui n'en a aucune.
    expect(await deleteOwnAccount(7)).toEqual({ mode: "ANONYMIZE", reason });
    expect(has(queries, "DELETE FROM bg_users")).toBe(false);
    expect(has(queries, "UPDATE bg_users SET pseudo = ?")).toBe(true);
  });

  it("ferme les sessions de la ligne anonymisée", async () => {
    const { queries } = fakeDb({ ...EMPTY, played: 1 });

    await deleteOwnAccount(7);

    expect(has(queries, "DELETE FROM bg_user_sessions")).toBe(true);
  });

  /**
   * Le dernier chemin par lequel un compte supprimé rejoignait une équipe
   * vivante. Une demande d'adhésion déposée avant la suppression reste visible
   * du gérant ; l'accepter passe par `respondToInvitation`, qui travaille sur un
   * identifiant et non sur un pseudo — le filtre de `getUserIdByPseudo` ne
   * l'atteint pas. Le compte réapparaissait au roster et « avec équipe » à
   * l'annuaire.
   */
  it("annule les invitations et demandes restées en attente", async () => {
    const { queries } = fakeDb({ ...EMPTY, played: 1 });

    await deleteOwnAccount(7);

    const cancel = queries.find((q) => q.sql.includes("bg_team_invitations"));
    expect(cancel).toBeDefined();
    expect(cancel!.sql).toContain("status = 'CANCELLED'");
    expect(cancel!.sql).toContain("status = 'PENDING'");
    expect(cancel!.params).toEqual([7]);
  });

  it("annule dans la transaction, jamais après le commit", async () => {
    const { queries, connection } = fakeDb({ ...EMPTY, played: 1 });

    await deleteOwnAccount(7);

    // Les requêtes relevées sont celles de la connexion verrouillée ; le commit
    // vient après la dernière d'entre elles.
    expect(has(queries, "bg_team_invitations")).toBe(true);
    expect(connection.commit).toHaveBeenCalled();
  });

  it("laisse la cascade faire le ménage d'un effacement complet", async () => {
    const { queries } = fakeDb(EMPTY);

    await deleteOwnAccount(7);

    // `fk_bg_team_inv_user` est en `ON DELETE CASCADE` : écrire ici serait une
    // instruction de plus sur une table qui disparaît avec la ligne.
    expect(has(queries, "bg_team_invitations")).toBe(false);
  });
});

/**
 * `bg_discord_login_challenges` n'a **aucune clé étrangère** : elle est indexée
 * sur un identifiant Discord, pas sur un compte du site. Aucune cascade ne la
 * couvre, et son seul ménage est la purge des lignes expirées depuis un jour,
 * déclenchée par la demande de code d'un *autre* joueur — un soir calme,
 * l'identifiant Discord d'un compte effacé restait en base indéfiniment, alors
 * que la confirmation promet « sans laisser de trace sur le site ».
 */
describe("deleteOwnAccount — les défis de connexion par message privé", () => {
  it.each([
    ["un compte effacé", EMPTY],
    ["un compte anonymisé", { ...EMPTY, played: 1 }],
  ])("efface les défis portant l'identifiant Discord (%s)", async (_label, trace) => {
    const { queries } = fakeDb(trace, { discordId: "900000000000000001" });

    await deleteOwnAccount(7);

    const purge = queries.find((q) => q.sql.includes("bg_discord_login_challenges"));
    expect(purge).toBeDefined();
    expect(purge!.sql).toContain("DELETE FROM bg_discord_login_challenges");
    expect(purge!.params).toEqual(["900000000000000001"]);
  });

  it("relève l'identifiant sous le verrou, avant que la ligne ne le perde", async () => {
    const { queries } = fakeDb(EMPTY, { discordId: "900000000000000001" });

    await deleteOwnAccount(7);

    // La lecture verrouillante rend l'identifiant en même temps que l'avatar :
    // une seconde lecture, après l'écriture, ne trouverait plus rien — la ligne
    // est partie (effacement) ou vidée de son `discord_id` (anonymisation).
    const locked = queries.findIndex((q) => q.sql.includes("FOR UPDATE"));
    expect(locked).toBe(0);
    expect(queries[0].sql).toContain("discord_id");
  });

  it("n'écrit rien quand le compte n'a jamais eu de Discord", async () => {
    const { queries } = fakeDb(EMPTY);

    await deleteOwnAccount(7);

    expect(has(queries, "bg_discord_login_challenges")).toBe(false);
  });

  it("efface dans la transaction : un rollback ne doit pas les avoir perdus", async () => {
    const { queries, connection } = fakeDb(EMPTY, { discordId: "900000000000000001" });

    await deleteOwnAccount(7);

    expect(has(queries, "bg_discord_login_challenges")).toBe(true);
    expect(connection.commit).toHaveBeenCalled();
    expect(connection.rollback).not.toHaveBeenCalled();
  });
});

/**
 * Un signalement qui vise le compte garde sa cible, mais pas le pseudo relevé à
 * l'envoi : le panneau retombe sur ce relevé dès que le compte n'est plus
 * vivant, et la suppression promet justement de le retirer.
 */
describe("deleteOwnAccount — les signalements qui visent le compte", () => {
  it.each([
    ["un compte effacé", EMPTY],
    ["un compte anonymisé", { ...EMPTY, played: 1 }],
  ])("efface le pseudo relevé sur leurs cibles (%s)", async (_label, trace) => {
    const { queries, connection } = fakeDb(trace);

    await deleteOwnAccount(7);

    const scrub = queries.find((q) => q.sql.includes("bg_report_targets"));
    expect(scrub).toBeDefined();
    expect(scrub!.sql).toContain("label_snapshot = NULL");
    expect(scrub!.sql).toContain("target_type = 'USER'");
    expect(scrub!.params).toEqual([7]);
    expect(connection.commit).toHaveBeenCalled();
  });
});

describe("deleteOwnAccount — l'effacement emporte l'entrée solo orpheline", () => {
  it("efface une entrée solo jamais inscrite ni jouée, avant la ligne du compte", async () => {
    const { queries } = fakeDb(EMPTY);

    await deleteOwnAccount(7);

    const solo = queries.findIndex((q) => q.sql.startsWith("DELETE FROM bg_teams WHERE solo_user_id = ?"));
    const user = queries.findIndex((q) => q.sql.startsWith("DELETE FROM bg_users"));
    expect(solo).toBeGreaterThan(-1);
    expect(user).toBeGreaterThan(solo);
    // Une inscription ou un match repris entre-temps la garde en place.
    expect(queries[solo].sql).toContain("NOT EXISTS (SELECT 1 FROM bg_tournament_registrations");
    expect(queries[solo].sql).toContain("m.team1_id = bg_teams.id");
    expect(queries[solo].sql).toContain("m.team2_id = bg_teams.id");
    expect(queries[solo].params).toEqual([7]);
  });

  it("n'y touche pas quand le compte est anonymisé", async () => {
    const { queries } = fakeDb({ ...EMPTY, played: 1 });

    await deleteOwnAccount(7);

    expect(has(queries, "DELETE FROM bg_teams")).toBe(false);
  });
});

describe("deleteOwnAccount — l'anonymisation sous un pseudo d'emprunt", () => {
  const anonymization = (queries: Query[]) =>
    queries.find((q) => q.sql.startsWith("UPDATE bg_users SET pseudo = ?"))!;

  it("remplace le pseudo par un pseudo de la liste, jamais par l'identifiant", async () => {
    const { queries } = fakeDb({ ...EMPTY, played: 1 });

    await deleteOwnAccount(7);

    const update = anonymization(queries);
    expect(ANONYMOUS_PSEUDOS).toContain(update.params[0]);
    expect(update.params[1]).toBe(7);
    expect(update.sql).not.toContain("compte_supprime_");
  });

  it("relit les pseudos déjà portés par les autres comptes, sur la transaction", async () => {
    const { queries, connection } = fakeDb({ ...EMPTY, played: 1 });

    await deleteOwnAccount(7);

    const taken = queries.find((q) => q.sql.startsWith("SELECT pseudo FROM bg_users WHERE id <> ?"))!;
    expect(taken.params[0]).toBe(7);
    expect(taken.params).toHaveLength(ANONYMOUS_PSEUDOS.length + 1);
    expect(connection.execute).toHaveBeenCalled();
  });

  it("efface tags, identités, majorité, rôles de plateforme et avatar dans la même instruction", async () => {
    const { queries } = fakeDb({ ...EMPTY, played: 1 });

    await deleteOwnAccount(7);

    const sql = anonymization(queries).sql;
    for (const cleared of [
      "avatar_url = NULL",
      "overwatch_battletag = NULL",
      "marvel_rivals_tag = NULL",
      "discord_pseudo = NULL",
      "discord_verified_at = NULL",
      "discord_id = NULL",
      "google_sub = NULL",
      "blizzard_sub = NULL",
      "is_adult = NULL",
      "is_admin = 0",
      "platform_roles_json = NULL",
      "is_deleted = 1",
    ]) {
      expect(sql).toContain(cleared);
    }
  });

  it("efface les consentements et la trace des messages privés", async () => {
    const { queries } = fakeDb({ ...EMPTY, played: 1 });

    await deleteOwnAccount(7);

    expect(has(queries, "DELETE FROM bg_privacy_acknowledgments WHERE user_id = ?")).toBe(true);
    expect(has(queries, "DELETE FROM bg_privacy_change_notifications WHERE user_id = ?")).toBe(true);
  });

  it("retire son tirage et recommence quand un autre compte vient de prendre le nom", async () => {
    // Aucun pseudo n'est relu comme pris : le premier tirage part à l'écriture,
    // qui le refuse — la course qu'une suppression simultanée ouvre.
    const { queries } = fakeDb(
      { ...EMPTY, played: 1 },
      { duplicatePseudos: [ANONYMOUS_PSEUDOS[0]] },
    );
    const random = jest.spyOn(Math, "random");
    random.mockReturnValueOnce(0).mockReturnValueOnce(0.5);

    await deleteOwnAccount(7);

    const writes = queries.filter((q) => q.sql.startsWith("UPDATE bg_users SET pseudo = ?"));
    expect(writes.map((w) => w.params[0])).toEqual([ANONYMOUS_PSEUDOS[0], ANONYMOUS_PSEUDOS[500]]);
    random.mockRestore();
  });

  it("renonce après cinq collisions plutôt que de boucler", async () => {
    const random = jest.spyOn(Math, "random").mockReturnValue(0);
    // Tirage figé sur le premier pseudo libre : chaque refus le retire, le
    // suivant est tiré — cinq refus de suite épuisent les tentatives.
    const { connection } = fakeDb({ ...EMPTY, played: 1 }, { duplicatePseudos: ANONYMOUS_PSEUDOS.slice(0, 5) });

    await expect(deleteOwnAccount(7)).rejects.toThrow("Duplicate entry");
    expect(connection.rollback).toHaveBeenCalled();
    expect(connection.commit).not.toHaveBeenCalled();
    random.mockRestore();
  });
});

describe("loadAccountTrace — ce qu'on interroge", () => {
  it("compte l'entrée solo inscrite, jouée ou non : son nom d'engagé est le pseudo du joueur", async () => {
    const { queries } = fakeDb(EMPTY);

    await deleteOwnAccount(7);

    const trace = queries.find((q) => q.sql.includes("AS played"))!;
    expect(trace.sql).toContain(
      "FROM bg_teams s JOIN bg_tournament_registrations r ON r.team_id = s.id WHERE s.solo_user_id = u.id",
    );
  });

  it("écarte les équipes dissoutes et les appartenances closes du critère OWNER", async () => {
    const { queries } = fakeDb(EMPTY);

    await deleteOwnAccount(7);

    const trace = queries.find((q) => q.sql.includes("AS played"))!;
    expect(trace.sql).toContain("t.deleted_at IS NULL");
    expect(trace.sql).toContain("m.left_at IS NULL");
  });

  /**
   * Être au roster d'une équipe engagée ne suffit plus : sans match, la fiche
   * du joueur n'a aucune statistique à garder sous un faux nom. Le match doit
   * être **compté** (ni exemption ni match fantôme) et tomber dans la fenêtre
   * d'appartenance des statistiques — close comprise.
   */
  it("exige un match compté, joué pendant l'appartenance, des deux côtés du match", async () => {
    const { queries } = fakeDb(EMPTY);

    await deleteOwnAccount(7);

    const trace = queries.find((q) => q.sql.includes("AS played"))!;
    const played = trace.sql.slice(0, trace.sql.indexOf("AS played"));
    expect(played).toContain("JOIN bg_matches m ON m.team1_id = tm.team_id");
    expect(played).toContain("JOIN bg_matches m ON m.team2_id = tm.team_id");
    expect(played).toContain("m.status = 'COMPLETED'");
    expect(played).toContain("m.is_bye = 0");
    expect(played).toContain("tm.joined_at <= t.finished_at");
    expect(played).toContain("tm.left_at IS NULL OR");
    // Une simple inscription de l'équipe ne retient plus la ligne.
    expect(played).not.toContain("JOIN bg_team_members tm ON tm.team_id = r.team_id");
  });

  it("lie chaque paramètre à l'identifiant du compte", async () => {
    const { queries } = fakeDb(EMPTY);

    await getAccountDeletionPlan(7);

    const placeholders = (queries[0].sql.match(/\?/g) ?? []).length;
    expect(queries[0].params).toEqual(Array(placeholders).fill(7));
  });

  it("pose les trois questions en une requête — un await entre elles les désaccorderait", async () => {
    const { queries } = fakeDb(EMPTY);

    await getAccountDeletionPlan(7);

    expect(queries).toHaveLength(1);
    expect(queries[0].sql).toContain("AS organized");
    expect(queries[0].sql).toContain("AS owned");
  });

  it("est lue **après** le verrou : avant lui, elle daterait d'avant l'attente", async () => {
    const { queries } = fakeDb(EMPTY);

    await deleteOwnAccount(7);

    const lock = queries.findIndex((q) => q.sql.includes("FOR UPDATE"));
    const trace = queries.findIndex((q) => q.sql.includes("AS played"));
    expect(lock).toBe(0);
    expect(trace).toBeGreaterThan(lock);
  });
});

describe("getAccountDeletionPlan", () => {
  it("n'écrit rien", async () => {
    const { queries } = fakeDb(EMPTY);

    expect(await getAccountDeletionPlan(7)).toEqual({ mode: "ERASE", reason: null });
    expect(queries.every((q) => q.sql.startsWith("SELECT"))).toBe(true);
  });
});

describe("deleteOwnAccount — transaction et verrou", () => {
  it("ouvre une transaction, verrouille la ligne du compte, puis commite", async () => {
    const { queries, connection } = fakeDb(EMPTY);

    await deleteOwnAccount(7);

    expect(connection.beginTransaction).toHaveBeenCalled();
    expect(queries[0].sql).toContain("FOR UPDATE");
    expect(queries[0].sql).toContain("FROM bg_users");
    expect(connection.commit).toHaveBeenCalled();
    expect(connection.rollback).not.toHaveBeenCalled();
    expect(connection.release).toHaveBeenCalled();
  });

  it("annule tout si l'effacement échoue — jamais de visites détachées sans compte effacé", async () => {
    const { connection } = fakeDb(EMPTY, { failOn: "DELETE FROM bg_users" });

    await expect(deleteOwnAccount(7)).rejects.toThrow("DB_DOWN");

    expect(connection.commit).not.toHaveBeenCalled();
    expect(connection.rollback).toHaveBeenCalled();
    expect(connection.release).toHaveBeenCalled();
  });

  it("refuse un compte disparu plutôt que d'écrire à vide", async () => {
    const { connection } = fakeDb(EMPTY, { missing: true });

    await expect(deleteOwnAccount(7)).rejects.toThrow("USER_NOT_FOUND");

    expect(connection.rollback).toHaveBeenCalled();
  });
});

describe("deleteOwnAccount — le fichier de l'avatar", () => {
  it("efface la photo d'un compte effacé : sa ligne partie, plus rien ne la désigne", async () => {
    const { connection } = fakeDb(EMPTY, { avatarUrl: "/api/uploads/avatars/7-ab.webp" });

    await deleteOwnAccount(7);

    expect(deleteStoredImage).toHaveBeenCalledWith("/uploads/avatars/7-ab.webp");
    // Après le commit : un `unlink` ne se défait pas.
    expect(connection.commit).toHaveBeenCalled();
  });

  it("efface aussi la photo d'un compte anonymisé — `avatar_url` passe à NULL", async () => {
    fakeDb({ ...EMPTY, played: 1 }, { avatarUrl: "/api/uploads/avatars/7-cd.webp" });

    await deleteOwnAccount(7);

    expect(deleteStoredImage).toHaveBeenCalledWith("/uploads/avatars/7-cd.webp");
  });

  it("ne touche à rien quand la photo n'est pas un fichier à nous", async () => {
    fakeDb(EMPTY, { avatarUrl: "https://exemple.invalid/photo.png" });

    await deleteOwnAccount(7);

    expect(deleteStoredImage).toHaveBeenCalledWith(null);
  });

  it("ne garde pas la photo si l'écriture est annulée", async () => {
    fakeDb(EMPTY, {
      avatarUrl: "/api/uploads/avatars/7-ef.webp",
      failOn: "DELETE FROM bg_users",
    });

    await expect(deleteOwnAccount(7)).rejects.toThrow("DB_DOWN");

    expect(deleteStoredImage).not.toHaveBeenCalled();
  });

  it("un disque récalcitrant ne fait pas échouer une suppression commitée", async () => {
    jest.mocked(deleteStoredImage).mockImplementation(() => {
      throw new Error("EACCES");
    });
    fakeDb(EMPTY, { avatarUrl: "/api/uploads/avatars/7-gh.webp" });

    await expect(deleteOwnAccount(7)).resolves.toEqual({ mode: "ERASE", reason: null });
  });
});

describe("deleteOwnAccount — un refus de la base ne part pas tel quel", () => {
  /** Ce que MySQL rend quand une clé étrangère en `RESTRICT` retient la ligne. */
  function referencedRow(): Error {
    const error = new Error(
      "Cannot delete or update a parent row: a foreign key constraint fails " +
        "(`bluegenji`.`bg_tournaments`, CONSTRAINT `fk_bg_tournaments_organizer` ...)",
    ) as Error & { code: string };
    error.code = "ER_ROW_IS_REFERENCED_2";
    return error;
  }

  it("rend un code stable plutôt que le message de MySQL", async () => {
    // Le contrôle de clé étrangère lit la dernière version commitée et non
    // l'instantané : un tournoi créé après la lecture des traces retient la
    // ligne, et la route rend le message de l'erreur telle quelle.
    fakeDb(EMPTY, { failOn: "DELETE FROM bg_users", failWith: referencedRow() });

    await expect(deleteOwnAccount(7)).rejects.toThrow("ACCOUNT_STILL_REFERENCED");
  });

  it("n'en fait pas un fourre-tout : une autre panne remonte telle quelle", async () => {
    fakeDb(EMPTY, { failOn: "DELETE FROM bg_users" });

    await expect(deleteOwnAccount(7)).rejects.toThrow("DB_DOWN");
  });

  it("annule tout de même la transaction", async () => {
    const { connection } = fakeDb(EMPTY, {
      failOn: "DELETE FROM bg_users",
      failWith: referencedRow(),
    });

    await expect(deleteOwnAccount(7)).rejects.toThrow();

    expect(connection.rollback).toHaveBeenCalled();
    expect(connection.commit).not.toHaveBeenCalled();
  });
});
