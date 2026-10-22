import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "@jest/globals";
import {
  DISCORD_TAG_LOCKED,
  checkDiscordTagEdit,
  discordTagLockNotice,
  isDiscordTagLocked,
  type DiscordTagLockNotice,
} from "@/lib/shared/discord-tag-lock";

type LockState = Parameters<typeof discordTagLockNotice>[0];

/** Tout ce que dit le champ : la ligne d'état, puis le détail derrière le « i ». */
const all = (notice: DiscordTagLockNotice) => [notice.status, ...notice.details].join(" ");
const lock = (state: LockState) => all(discordTagLockNotice(state));

describe("checkDiscordTagEdit", () => {
  it("laisse saisir tant qu'aucun compte Discord n'est rattaché", () => {
    expect(checkDiscordTagEdit({ linked: false })).toBeNull();
    expect(isDiscordTagLocked({ linked: false })).toBe(false);
  });

  it("refuse la saisie dès qu'un compte Discord est rattaché", () => {
    expect(checkDiscordTagEdit({ linked: true })).toBe("LINKED_ACCOUNT");
    expect(isDiscordTagLocked({ linked: true })).toBe(true);
  });

  it("ne décide que sur le rattachement — ni le tag ni la certification", () => {
    // Un compte rattaché sans tag affichable reste verrouillé : ce qu'il
    // saisirait ne serait de toute façon pas certifiable.
    expect(isDiscordTagLocked({ linked: true })).toBe(true);
  });

  it("verrouille un rattachement **inconnu**, et le distingue d'un rattachement", () => {
    // Le défaut inverse ouvrait le champ au premier rendu et le laissait ouvert
    // quand `GET /api/profile/discord` échouait : le tag alors saisi faisait
    // refuser tout le `PATCH` en 409, pseudo et visibilités emportés avec lui.
    expect(checkDiscordTagEdit({ linked: null })).toBe("UNKNOWN_LINK");
    expect(isDiscordTagLocked({ linked: null })).toBe(true);
  });

  it("traite tout ce qui n'est pas un booléen comme inconnu", () => {
    // L'écran alimente cet état par un `as` sur une réponse JSON que rien ne
    // valide : un corps sans `linked` rend `undefined`. Testé dans l'autre sens
    // (`=== null` d'abord), il glissait entre les branches et **ouvrait** le
    // champ — l'inverse du seul défaut tenable.
    for (const linked of [undefined, "true", 1, {}]) {
      expect(checkDiscordTagEdit({ linked } as never)).toBe("UNKNOWN_LINK");
      expect(isDiscordTagLocked({ linked } as never)).toBe(true);
    }
  });
});

describe("discordTagLockNotice", () => {
  it("dit qu'un tag certifié l'est, et joint la liste de ceux qui le lisent", () => {
    const notice = discordTagLockNotice({ tag: "keryan", verified: true, linked: true });
    expect(notice.status).toContain("rattaché");
    expect(notice.status).toContain("certifié");
    expect(notice.audience).toBe(true);
  });

  it("n'annonce pas une certification que le compte n'a pas", () => {
    // Rattaché, mais jamais certifié : la ligne d'état le dit, et dit que
    // personne ne le voit ; la liste jointe dit ce que la certification ouvrirait.
    const notice = discordTagLockNotice({ tag: "keryan", verified: false, linked: true });
    expect(notice.status).toContain("non certifié");
    expect(notice.status).toContain("personne ne le voit");
    expect(notice.audience).toBe(true);
  });

  it("n'affirme jamais l'origine du tag — elle n'est pas garantie", () => {
    for (const verified of [true, false]) {
      expect(lock({ tag: "keryan", verified, linked: true })).not.toContain("vient de Discord");
    }
  });

  it("dit l'état et le geste sans inventer la cause d'un champ vide", () => {
    // Deux causes mènent ici (tag retiré, pseudo numérique) : la phrase ne
    // choisit pas.
    const notice = discordTagLockNotice({ tag: null, verified: false, linked: true });
    expect(notice.status).toContain("sans pseudo enregistré");
    expect(all(notice)).not.toContain("numérique");
    expect(all(notice)).not.toContain("pseudo certifié");
    expect(notice.audience).toBe(false);
  });

  it("nomme le bouton de l'écran avant la reconnexion, sur un tag absent", () => {
    // L'écran rend « Enregistrer mon tag » dans cet état : renvoyer d'abord
    // vers une reconnexion par Discord, c'est ignorer le geste d'à côté. Les
    // deux repères sont **exigés présents** avant d'être comparés.
    const notice = lock({ tag: null, verified: false, linked: true });
    const button = notice.indexOf("Enregistrer mon tag");
    const reconnect = notice.indexOf("reconnecte-toi");
    expect(button).toBeGreaterThanOrEqual(0);
    expect(reconnect).toBeGreaterThanOrEqual(0);
    expect(button).toBeLessThan(reconnect);
  });

  it("ne nomme que des gestes qui existent à l'écran", () => {
    // « Détache Discord » n'en est pas un pour un compte né par Discord : le
    // bouton y est remplacé par le refus `LAST_CONNECTION`.
    const notices = [
      lock({ tag: "keryan", verified: true, linked: true }),
      lock({ tag: "keryan", verified: false, linked: true }),
      lock({ tag: null, verified: false, linked: true }),
    ];
    for (const notice of notices) {
      expect(notice).toContain("« Mettre à jour mon pseudo »");
      expect(notice).not.toContain("Applications connectées");
      expect(notice).not.toMatch(/détache/i);
    }
  });

  it("nomme le retrait dès qu'un tag est enregistré", () => {
    for (const verified of [true, false]) {
      expect(lock({ tag: "keryan", verified, linked: true })).toMatch(/retire/i);
    }
  });

  it("ne promet de « ne plus être joignable » que sur un tag réellement exposé", () => {
    // Personne ne voit un tag non certifié : proposer d'arrêter une exposition
    // qui n'existe pas pousserait à effacer une donnée sans raison.
    expect(lock({ tag: "keryan", verified: false, linked: true })).not.toContain("ne plus être joignable");
    expect(lock({ tag: "keryan", verified: true, linked: true })).toContain("ne plus être joignable");
  });

  it("nomme le bouton d'enregistrement sans le situer", () => {
    const notice = lock({ tag: null, verified: false, linked: true });
    expect(notice).toContain("Enregistrer mon tag");
    expect(notice).not.toContain("ci-dessous");
    expect(notice).not.toContain("ci-dessus");
  });

  it("garde la ligne d'état courte : le détail passe derrière le « i »", () => {
    const states: LockState[] = [
      { tag: "keryan", verified: true, linked: true },
      { tag: "keryan", verified: false, linked: true },
      { tag: null, verified: false, linked: true },
      { tag: null, verified: false, linked: null },
      { tag: null, verified: false, linked: null, pending: true },
    ];
    for (const state of states) expect(discordTagLockNotice(state).status.length).toBeLessThanOrEqual(120);
  });
});

describe("discordTagLockNotice — rattachement inconnu", () => {
  const notice = discordTagLockNotice({ tag: null, verified: false, linked: null });

  it("dit la même chose sur n'importe quelle valeur non booléenne", () => {
    expect(discordTagLockNotice({ tag: null, verified: false, linked: undefined } as never)).toEqual(notice);
  });

  it("n'affirme ni le rattachement ni son absence", () => {
    expect(all(notice)).not.toContain("rattaché");
    expect(all(notice)).not.toContain("certifié");
    expect(notice.audience).toBe(false);
  });

  it("nomme le verrou et sa sortie", () => {
    expect(notice.status).toContain("lecture seule");
    expect(notice.status.toLowerCase()).toContain("réessaie");
    expect(notice.status.toLowerCase()).toContain("recharge la page");
  });
});

describe("discordTagLockNotice — lecture en cours", () => {
  /**
   * « Pas encore lu » et « lecture échouée » se confondaient en un seul
   * `linked: null` : la phrase annonçait une panne pendant le temps normal d'un
   * aller-retour.
   */
  const pending = discordTagLockNotice({ tag: null, verified: false, linked: null, pending: true });

  it("n'annonce aucune panne et ne propose rien à réessayer", () => {
    expect(all(pending)).not.toContain("illisible");
    expect(all(pending).toLowerCase()).not.toContain("réessaie");
    expect(all(pending).toLowerCase()).not.toContain("recharge");
  });

  it("dit tout de même pourquoi le champ est fermé", () => {
    expect(pending.status).toContain("lecture seule");
  });

  it("se distingue de l'échec, qui garde sa sortie", () => {
    const failed = discordTagLockNotice({ tag: null, verified: false, linked: null });
    expect(failed).not.toEqual(pending);
    expect(failed.status.toLowerCase()).toContain("réessaie");
  });

  it("s'efface dès que l'état est connu — un rattachement lu n'attend plus rien", () => {
    const linked = discordTagLockNotice({ tag: "keryan", verified: true, linked: true, pending: true });
    expect(linked.status).toContain("certifié");
    expect(linked.status).not.toContain("Lecture");
  });
});

describe("DISCORD_TAG_LOCKED", () => {
  it("est le code que la route rend en 409", () => {
    expect(DISCORD_TAG_LOCKED).toBe("DISCORD_TAG_LOCKED");
  });
});

describe("discordTagLockNotice — la promesse d'exposition n'est rédigée qu'une fois", () => {
  // `/connexion` et `/profil` annoncent le même public : le verrou dit
  // seulement s'il faut joindre la liste partagée (`DISCORD_TAG_AUDIENCE`).
  it("n'écrit pas le public en dur", () => {
    const source = readFileSync(join(__dirname, "..", "..", "..", "lib", "shared", "discord-tag-lock.ts"), "utf8");
    expect(source).not.toMatch(/administrateurs, à tout moment/);
    expect(source).not.toMatch(/les administrateurs le voient/);
  });
});
