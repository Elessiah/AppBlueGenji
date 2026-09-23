import { describe, expect, it } from "@jest/globals";
import {
  DISCORD_TAG_LOCKED,
  checkDiscordTagEdit,
  discordTagLockNotice,
  isDiscordTagLocked,
} from "@/lib/shared/discord-tag-lock";

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
  it("dit qui lit un tag certifié, plutôt que d'où il vient", () => {
    const notice = discordTagLockNotice({ tag: "keryan", verified: true, linked: true });
    expect(notice).toContain("rattaché");
    expect(notice).toContain("certifié");
    expect(notice).toContain("administrateurs");
  });

  it("n'annonce pas une certification que le compte n'a pas", () => {
    // Le rattachement ne la garantit pas : `linkOAuthIdentity` n'écrit le
    // pseudo que si Discord en donne un affichable, si bien qu'un compte lié
    // peut porter un tag saisi à la main. L'annoncer certifié contredirait la
    // pastille absente d'à côté.
    const notice = discordTagLockNotice({ tag: "keryan", verified: false, linked: true });
    expect(notice).toContain("n'est pas certifié");
    expect(notice).toContain("personne ne le voit");
  });

  it("n'affirme jamais l'origine du tag — elle n'est pas garantie", () => {
    for (const verified of [true, false]) {
      expect(discordTagLockNotice({ tag: "keryan", verified, linked: true })).not.toContain("vient de Discord");
    }
  });

  it("dit l'état et le geste sans inventer la cause d'un champ vide", () => {
    // Deux causes y mènent — un tag retiré, ou un pseudo Discord numérique —
    // et l'écran ne peut pas les distinguer : le joueur qui vient de retirer
    // son tag n'a pas à lire une explication fausse.
    const notice = discordTagLockNotice({ tag: null, verified: false, linked: true });
    expect(notice).toContain("aucun pseudo n'est enregistré");
    expect(notice).not.toContain("numérique");
    expect(notice).not.toContain("est certifié");
  });

  it("nomme le bouton de l'écran avant la reconnexion, sur un tag absent", () => {
    // L'écran rend « Enregistrer mon tag » dans cet état : renvoyer d'abord
    // vers une reconnexion par Discord, c'est ignorer le geste d'à côté.
    //
    // Les deux repères sont **exigés présents** avant d'être comparés : cette
    // assertion a longtemps cherché une chaîne que la phrase ne contenait pas,
    // si bien qu'`indexOf` rendait -1 et que le test passait quoi qu'il
    // arrive — intervertir les deux gestes ne l'aurait pas fait tomber.
    const notice = discordTagLockNotice({ tag: null, verified: false, linked: true });
    const button = notice.indexOf("Enregistrer mon tag");
    const reconnect = notice.indexOf("reconnecte-toi");
    expect(button).toBeGreaterThanOrEqual(0);
    expect(reconnect).toBeGreaterThanOrEqual(0);
    expect(button).toBeLessThan(reconnect);
  });

  it("ne nomme que des gestes qui existent à l'écran", () => {
    // « Détache Discord » n'en est pas un pour un compte né par Discord : le
    // bouton y est remplacé par le refus `LAST_CONNECTION`, faute d'une autre
    // porte. Le nommer enverrait chercher un contrôle absent.
    const notices = [
      discordTagLockNotice({ tag: "keryan", verified: true, linked: true }),
      discordTagLockNotice({ tag: "keryan", verified: false, linked: true }),
      discordTagLockNotice({ tag: null, verified: false, linked: true }),
    ];
    for (const notice of notices) {
      expect(notice.toLowerCase()).toContain("reconnecte-toi");
      expect(notice).not.toContain("Applications connectées");
    }
  });

  it("nomme le retrait dès qu'un tag est enregistré", () => {
    for (const verified of [true, false]) {
      expect(discordTagLockNotice({ tag: "keryan", verified, linked: true })).toMatch(/retire/i);
    }
  });

  it("ne promet de « cesser d'être joignable » que sur un tag réellement exposé", () => {
    // Un tag non certifié n'est vu de personne : proposer d'arrêter une
    // exposition qui n'existe pas pousse à effacer une donnée sans raison.
    const uncertified = discordTagLockNotice({ tag: "keryan", verified: false, linked: true });
    const certified = discordTagLockNotice({ tag: "keryan", verified: true, linked: true });
    expect(uncertified).not.toContain("cesser d'être joignable");
    expect(certified).toContain("cesser d'être joignable");
  });

  it("nomme le bouton d'enregistrement sans le situer", () => {
    // Le bouton est rendu **au-dessus** du paragraphe ; et un module pur n'a de
    // toute façon pas à connaître la mise en page de ses lecteurs.
    const notice = discordTagLockNotice({ tag: null, verified: false, linked: true });
    expect(notice).toContain("Enregistrer mon tag");
    expect(notice).not.toContain("ci-dessous");
    expect(notice).not.toContain("ci-dessus");
  });
});

describe("discordTagLockNotice — rattachement inconnu", () => {
  const notice = discordTagLockNotice({ tag: null, verified: false, linked: null });

  it("dit la même chose sur n'importe quelle valeur non booléenne", () => {
    expect(
      discordTagLockNotice({ tag: null, verified: false, linked: undefined } as never),
    ).toBe(notice);
  });

  it("n'affirme ni le rattachement ni son absence", () => {
    expect(notice).not.toContain("est rattaché");
    expect(notice).not.toContain("certifié");
  });

  it("nomme le verrou, sa raison et sa sortie", () => {
    expect(notice).toContain("lecture seule");
    expect(notice.toLowerCase()).toContain("réessaie");
    expect(notice.toLowerCase()).toContain("recharge la page");
  });
});

describe("discordTagLockNotice — lecture en cours", () => {
  /**
   * « Pas encore lu » et « lecture échouée » se confondaient en un seul
   * `linked: null` : la phrase annonçait une panne pendant le temps normal d'un
   * aller-retour, le profil se rendant dès que `GET /api/profile` répond — ce
   * qui arrive régulièrement avant `GET /api/profile/discord`.
   */
  const pending = discordTagLockNotice({
    tag: null,
    verified: false,
    linked: null,
    pending: true,
  });

  it("n'annonce aucune panne et ne propose rien à réessayer", () => {
    expect(pending).not.toContain("Impossible");
    expect(pending.toLowerCase()).not.toContain("réessaie");
    expect(pending.toLowerCase()).not.toContain("recharge");
  });

  it("dit tout de même pourquoi le champ est fermé", () => {
    expect(pending).toContain("lecture seule");
  });

  it("se distingue de l'échec, qui garde sa sortie", () => {
    const failed = discordTagLockNotice({ tag: null, verified: false, linked: null });
    expect(failed).not.toBe(pending);
    expect(failed.toLowerCase()).toContain("réessaie");
  });

  it("s'efface dès que l'état est connu — un rattachement lu n'attend plus rien", () => {
    // Le drapeau ne doit pas masquer un état déjà établi : une seconde lecture
    // lancée à la main ne doit pas faire régresser la phrase.
    const linked = discordTagLockNotice({
      tag: "keryan",
      verified: true,
      linked: true,
      pending: true,
    });
    expect(linked).toContain("certifié");
    expect(linked).not.toContain("Lecture de l'état");
  });
});

describe("DISCORD_TAG_LOCKED", () => {
  it("est le code que la route rend en 409", () => {
    expect(DISCORD_TAG_LOCKED).toBe("DISCORD_TAG_LOCKED");
  });
});
