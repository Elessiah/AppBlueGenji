import { describe, expect, it } from "@jest/globals";
import {
  RECRUITMENT_BANNER_COOKIE,
  RECRUITMENT_BODY_MAX,
  RECRUITMENT_CONTACT_CHANNELS,
  RECRUITMENT_DOMAINS,
  RECRUITMENT_BANNER_ROTATION_MS,
  RECRUITMENT_MODAL_COOKIE,
  RECRUITMENT_MODAL_COOKIE_MAX_AGE,
  RECRUITMENT_MODAL_INTERVAL_MS,
  RECRUITMENT_PRIORITIES,
  parseRecruitmentSeen,
  recruitmentDismissed,
  recruitmentModalStart,
  recruitmentSeenAmong,
  serializeRecruitmentSeen,
  validateRecruitmentAdInput,
} from "@/lib/shared/recruitment";

describe("validateRecruitmentAdInput", () => {
  it("accepts a minimal valid input with defaults", () => {
    const result = validateRecruitmentAdInput({ title: "Recherche arbitre" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({
        title: "Recherche arbitre",
        teamName: null,
        domain: "AUTRE",
        roles: null,
        body: null,
        contactUrl: null,
        contactDiscord: null,
        contactDiscordId: null,
        contactPreferred: "AUTO",
        // Facultative par défaut : une annonce ne s'impose à tous les
        // visiteurs que si quelqu'un l'a demandé.
        priority: "OPTIONAL",
        active: true,
      });
    }
  });

  it("trims the title and optional fields, nulling empties", () => {
    const result = validateRecruitmentAdInput({
      title: "  Pôle arbitrage recrute  ",
      teamName: "  ",
      roles: " Arbitrage, litiges ",
      body: "",
      contactUrl: " https://discord.gg/x ",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.title).toBe("Pôle arbitrage recrute");
      expect(result.value.teamName).toBeNull();
      expect(result.value.roles).toBe("Arbitrage, litiges");
      expect(result.value.body).toBeNull();
      expect(result.value.contactUrl).toBe("https://discord.gg/x");
    }
  });

  it("accepts every valid domain", () => {
    for (const domain of RECRUITMENT_DOMAINS) {
      const result = validateRecruitmentAdInput({ title: "X", domain });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.domain).toBe(domain);
    }
  });

  it("accepts every valid priority", () => {
    for (const priority of RECRUITMENT_PRIORITIES) {
      const result = validateRecruitmentAdInput({ title: "X", priority });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.priority).toBe(priority);
    }
  });

  it("honours an explicit active=false", () => {
    const result = validateRecruitmentAdInput({ title: "X", active: false });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.active).toBe(false);
  });

  it("falls back to defaults when domain/priority are empty strings", () => {
    const result = validateRecruitmentAdInput({ title: "X", domain: "", priority: "" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.domain).toBe("AUTRE");
      expect(result.value.priority).toBe("OPTIONAL");
    }
  });

  it("truncates an over-long body to the max length", () => {
    const result = validateRecruitmentAdInput({
      title: "X",
      body: "a".repeat(RECRUITMENT_BODY_MAX + 500),
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.body).toHaveLength(RECRUITMENT_BODY_MAX);
  });

  it("rejects a missing title", () => {
    expect(validateRecruitmentAdInput({ title: "   " })).toEqual({
      ok: false,
      error: "TITLE_REQUIRED",
    });
  });

  it("rejects an over-long title", () => {
    expect(validateRecruitmentAdInput({ title: "a".repeat(141) })).toEqual({
      ok: false,
      error: "TITLE_TOO_LONG",
    });
  });

  it("rejects an invalid domain", () => {
    expect(validateRecruitmentAdInput({ title: "X", domain: "LOL" })).toEqual({
      ok: false,
      error: "INVALID_DOMAIN",
    });
  });

  it("rejects an invalid priority, legacy highlight values included", () => {
    // Les anciennes valeurs de mise en avant ne sont pas des statuts : un
    // client resté sur l'ancien formulaire doit se faire refuser, pas se voir
    // rabattre en silence sur « facultative ».
    for (const priority of ["POPUP", "MODAL", "BANNER", "NONE", "priority"]) {
      expect(validateRecruitmentAdInput({ title: "X", priority })).toEqual({
        ok: false,
        error: "INVALID_PRIORITY",
      });
    }
  });

  it("trims and keeps the Discord contact", () => {
    const result = validateRecruitmentAdInput({ title: "X", contactDiscord: "  marie#0001  " });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.contactDiscord).toBe("marie#0001");
  });

  it("nulls an empty Discord contact", () => {
    const result = validateRecruitmentAdInput({ title: "X", contactDiscord: "   " });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.contactDiscord).toBeNull();
  });

  it("truncates an over-long Discord contact to the max length", () => {
    const result = validateRecruitmentAdInput({ title: "X", contactDiscord: "a".repeat(200) });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.contactDiscord).toHaveLength(120);
  });

  it("accepts every valid contact channel and defaults to AUTO", () => {
    for (const channel of RECRUITMENT_CONTACT_CHANNELS) {
      const result = validateRecruitmentAdInput({ title: "X", contactPreferred: channel });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.contactPreferred).toBe(channel);
    }
    const empty = validateRecruitmentAdInput({ title: "X", contactPreferred: "" });
    expect(empty.ok).toBe(true);
    if (empty.ok) expect(empty.value.contactPreferred).toBe("AUTO");
  });

  it("rejects an invalid contact channel", () => {
    expect(validateRecruitmentAdInput({ title: "X", contactPreferred: "SMS" })).toEqual({
      ok: false,
      error: "INVALID_CONTACT_CHANNEL",
    });
  });

  it("keeps a Discord id only when a pseudo accompanies it", () => {
    const withPseudo = validateRecruitmentAdInput({
      title: "X",
      contactDiscord: "marie",
      contactDiscordId: "123456789012345678",
    });
    expect(withPseudo.ok).toBe(true);
    if (withPseudo.ok) expect(withPseudo.value.contactDiscordId).toBe("123456789012345678");

    // Sans pseudo, l'id seul ne sert à rien : neutralisé.
    const orphan = validateRecruitmentAdInput({ title: "X", contactDiscordId: "123456789012345678" });
    expect(orphan.ok).toBe(true);
    if (orphan.ok) expect(orphan.value.contactDiscordId).toBeNull();
  });

  it("drops a Discord id that is not a snowflake", () => {
    const result = validateRecruitmentAdInput({
      title: "X",
      contactDiscord: "marie",
      contactDiscordId: "not-a-snowflake",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.contactDiscordId).toBeNull();
  });
});

/**
 * Le cookie qui a remplacé `localStorage`.
 *
 * Ce n'est pas un changement de stockage par goût : le serveur doit savoir qui a
 * déjà écarté l'annonce pour pouvoir rendre la modale **dans le HTML initial**,
 * et `localStorage` ne quitte jamais l'onglet. C'est ce qui fait tomber le LCP
 * de l'accueil, la modale n'étant plus peinte après l'hydratation.
 */
describe("parseRecruitmentSeen / serializeRecruitmentSeen", () => {
  it("lit la liste des identifiants montrés", () => {
    expect([...parseRecruitmentSeen("12.15.3")]).toEqual([12, 15, 3]);
  });

  it("lit encore une valeur à un seul identifiant, la forme d'avant les statuts", () => {
    expect([...parseRecruitmentSeen("42")]).toEqual([42]);
  });

  it("écarte tout ce qui n'est pas un entier positif", () => {
    // Une valeur forgée ou abîmée ne peut taire que ce qu'elle nomme exactement.
    expect([...parseRecruitmentSeen("abc.0.-3.4 2.42x.0x2a.7")]).toEqual([7]);
    expect([...parseRecruitmentSeen("..")]).toEqual([]);
    expect([...parseRecruitmentSeen("99999999999999999999")]).toEqual([]);
  });

  it("rend un ensemble vide sans cookie", () => {
    expect(parseRecruitmentSeen(undefined).size).toBe(0);
    expect(parseRecruitmentSeen("").size).toBe(0);
  });

  it("fait l'aller-retour", () => {
    expect(serializeRecruitmentSeen([3, 1, 2])).toBe("3.1.2");
    expect([...parseRecruitmentSeen(serializeRecruitmentSeen([3, 1, 2]))]).toEqual([3, 1, 2]);
    expect(serializeRecruitmentSeen([])).toBe("");
  });
});

describe("recruitmentDismissed", () => {
  it("reconnaît les annonces que le visiteur a fermées", () => {
    expect(recruitmentDismissed("42", [42])).toBe(true);
    expect(recruitmentDismissed("1.2.3", [3, 1])).toBe(true);
  });

  it("réaffiche dès qu'une annonce jamais vue s'ajoute", () => {
    // La valeur est la liste des identifiants : une annonce neuve n'y figure
    // pas, et suffit à rouvrir.
    expect(recruitmentDismissed("41", [42])).toBe(false);
    expect(recruitmentDismissed("1.2", [1, 2, 3])).toBe(false);
  });

  it("affiche quand aucun cookie n'a été posé", () => {
    expect(recruitmentDismissed(undefined, [42])).toBe(false);
    expect(recruitmentDismissed("", [42])).toBe(false);
  });

  it("n'a rien à taire quand rien n'est mis en avant", () => {
    expect(recruitmentDismissed(undefined, [])).toBe(true);
  });

  it("tolère les espaces que peut laisser un client", () => {
    expect(recruitmentDismissed(" 42 ", [42])).toBe(true);
    expect(recruitmentDismissed("1. 2", [1, 2])).toBe(true);
  });

  it("affiche sur une valeur incompréhensible plutôt que de se taire", () => {
    // Dans le doute on montre : une mise en avant tue à tort ne se rattrape
    // pas, alors qu'une modale montrée une fois de trop se referme.
    for (const valeur of ["abc", "4 2", "[]", "42x", "0x2a"]) {
      expect(recruitmentDismissed(valeur, [42])).toBe(false);
    }
  });

  it("ne confond pas deux identifiants dont l'un préfixe l'autre", () => {
    expect(recruitmentDismissed("4", [42])).toBe(false);
    expect(recruitmentDismissed("420", [42])).toBe(false);
    expect(recruitmentDismissed("4.20", [42])).toBe(false);
  });

  it("tire la durée du cookie de la fenêtre, sans la réécrire", () => {
    // Deux nombres à tenir d'accord auraient divergé : la fenêtre de sept jours
    // est la même notion des deux côtés.
    expect(RECRUITMENT_MODAL_COOKIE_MAX_AGE).toBe(RECRUITMENT_MODAL_INTERVAL_MS / 1000);
  });

  it("nomme deux cookies distincts, la banderole et la modale ne durant pas pareil", () => {
    expect(RECRUITMENT_MODAL_COOKIE).not.toBe(RECRUITMENT_BANNER_COOKIE);
  });
});

describe("recruitmentModalStart", () => {
  it("ouvre sur la première page quand rien n'a été vu", () => {
    expect(recruitmentModalStart(undefined, [5, 6, 7])).toBe(0);
  });

  it("ouvre sur la première prioritaire jamais vue", () => {
    // Revenir pour une troisième prioritaire ne fait pas relire les deux autres.
    expect(recruitmentModalStart("5.6", [5, 6, 7])).toBe(2);
    expect(recruitmentModalStart("6", [5, 6, 7])).toBe(0);
  });

  it("se tait quand toutes ont été vues", () => {
    expect(recruitmentModalStart("5.6.7", [5, 6, 7])).toBeNull();
    expect(recruitmentModalStart("7.5.6.9", [5, 6, 7])).toBeNull();
  });

  it("se tait sans prioritaire", () => {
    expect(recruitmentModalStart(undefined, [])).toBeNull();
  });
});

describe("recruitmentSeenAmong", () => {
  it("garde, dans l'ordre de la modale, les annonces déjà vues", () => {
    expect(recruitmentSeenAmong("7.5", [5, 6, 7])).toEqual([5, 7]);
  });

  it("oublie les annonces qui ne sont plus mises en avant", () => {
    // Le cookie réécrit par la modale ne porte ainsi que des annonces en ligne.
    expect(recruitmentSeenAmong("5.99", [5, 6])).toEqual([5]);
  });

  it("ne rend rien sans cookie ni sur une valeur illisible", () => {
    expect(recruitmentSeenAmong(undefined, [5])).toEqual([]);
    expect(recruitmentSeenAmong("abc", [5])).toEqual([]);
  });
});

describe("RECRUITMENT_MODAL_COOKIE_MAX_AGE", () => {
  it("vaut sept jours", () => {
    expect(RECRUITMENT_MODAL_INTERVAL_MS).toBe(7 * 24 * 60 * 60 * 1000);
    expect(RECRUITMENT_MODAL_COOKIE_MAX_AGE).toBe(7 * 24 * 60 * 60);
  });
});

describe("RECRUITMENT_BANNER_ROTATION_MS", () => {
  it("laisse le temps de lire, au-delà du seuil où WCAG 2.2.2 exige une pause", () => {
    expect(RECRUITMENT_BANNER_ROTATION_MS).toBeGreaterThan(5_000);
    expect(RECRUITMENT_BANNER_ROTATION_MS).toBeLessThanOrEqual(10_000);
  });
});
