import { PRIVACY_CHANGES_ANSWERED_EVENT, privacyAnsweredEvent, privacyFollowedLink } from "@/lib/shared/privacy-changes";
import { describe, expect, it } from "@jest/globals";
import {
  CERTIFY_PROFILE_HREF,
  CERTIFY_PROMPT_DOORS,
  certifyPromptDoor,
  certifyPromptFor,
  parseCertifyPromptAction,
  wantsCertifyDialog,
  certifiedFromProfile,
  certifiedFromProfileEvent,
} from "@/lib/shared/discord-certify-prompt";
import { DISCORD_CERTIFIED_EVENT } from "@/lib/shared/discord-certify-events";
import { CONNECTION_LOG_EVENTS } from "@/lib/shared/connection-logs";
import {
  certifyPromptOpen,
  certifyPromptSilencedOn,
  LOGIN_PATH,
  recruitmentModalSilenced,
  LEGAL_PAGE_PATHS,
  termsModalSilencedOn,
} from "@/lib/shared/global-modals";
import { TERMS_PATH } from "@/lib/shared/terms-of-use";

/** Fenêtre « Certifier ton tag Discord ? » (`docs/features/DISCORD_CERTIFY_PROMPT.md`) : décisions pures. */

describe("certifyPromptDoor — portes qui la déclenchent", () => {
  it("Discord (bouton et code) et Blizzard, jamais Google", () => {
    expect(CERTIFY_PROMPT_DOORS).toEqual(["LOGIN_DISCORD", "LOGIN_DISCORD_CODE", "LOGIN_BLIZZARD"]);
    expect(CONNECTION_LOG_EVENTS.filter(certifyPromptDoor).sort()).toEqual([...CERTIFY_PROMPT_DOORS].sort());
    expect(certifyPromptDoor("LOGIN_GOOGLE")).toBe(false);
  });
});

describe("certifyPromptFor — parcours du bouton principal", () => {
  const base = { discordId: "123456789012345678", discordPseudo: "keryan", pseudoFromDiscord: true };

  it("certifie d'un clic un tag nommé par Discord sur un compte rattaché", () => {
    expect(certifyPromptFor(base)).toEqual({ mode: "ONE_CLICK", tag: "keryan" });
  });

  it("mène au dialogue sans Discord rattaché (connexion Blizzard)", () => {
    expect(certifyPromptFor({ ...base, discordId: null })).toEqual({ mode: "DIALOG", hasTag: true });
    expect(certifyPromptFor({ discordId: null, discordPseudo: null, pseudoFromDiscord: false })).toEqual({ mode: "DIALOG", hasTag: false });
  });

  it("mène au dialogue pour un tag tapé à la main, absent ou numérique", () => {
    expect(certifyPromptFor({ ...base, pseudoFromDiscord: false })).toEqual({ mode: "DIALOG", hasTag: true });
    expect(certifyPromptFor({ ...base, discordPseudo: null })).toEqual({ mode: "DIALOG", hasTag: false });
    expect(certifyPromptFor({ ...base, discordPseudo: "   " })).toEqual({ mode: "DIALOG", hasTag: false });
    expect(certifyPromptFor({ ...base, discordPseudo: "123456789012345678" })).toEqual({ mode: "DIALOG", hasTag: true });
  });
});

describe("parseCertifyPromptAction", () => {
  it("n'admet que LATER et NEVER", () => {
    expect(parseCertifyPromptAction("LATER")).toBe("LATER");
    expect(parseCertifyPromptAction("NEVER")).toBe("NEVER");
    for (const value of ["later", "CERTIFY", "", null, undefined, 1, {}]) {
      expect(parseCertifyPromptAction(value)).toBeNull();
    }
  });
});

describe("wantsCertifyDialog — /profil?certifier=discord", () => {
  it("lit le paramètre exact", () => {
    expect(CERTIFY_PROFILE_HREF).toBe("/profil?certifier=discord");
    expect(wantsCertifyDialog("?certifier=discord")).toBe(true);
    expect(wantsCertifyDialog("?connected=discord&certifier=discord")).toBe(true);
    expect(wantsCertifyDialog("?certifier=autre")).toBe(false);
    expect(wantsCertifyDialog("")).toBe(false);
    expect(wantsCertifyDialog(null)).toBe(false);
  });
});

describe("certifyPromptOpen — jamais par-dessus une autre modale", () => {
  const base = { due: true, privacyPending: false, termsPending: false, pathname: "/tournois" };

  it("s'ouvre quand elle est due et que rien n'attend", () => {
    expect(certifyPromptOpen(base)).toBe(true);
    expect(certifyPromptOpen({ ...base, pathname: "/" })).toBe(true);
    expect(certifyPromptOpen({ ...base, pathname: "/profil" })).toBe(true);
  });

  it("attend la confidentialité et les conditions", () => {
    expect(certifyPromptOpen({ ...base, privacyPending: true })).toBe(false);
    expect(certifyPromptOpen({ ...base, termsPending: true })).toBe(false);
  });

  it("ne s'ouvre pas quand rien n'est dû", () => {
    expect(certifyPromptOpen({ ...base, due: false })).toBe(false);
  });

  it("se tait sur la connexion, les conditions et les pages légales", () => {
    for (const path of [LOGIN_PATH, TERMS_PATH, "/rgpd", "/rgpd/registre", "/mentions-legales", "/accessibilite", "/privacy-policy-bot", "/terms-of-service-bot"]) {
      expect([path, certifyPromptSilencedOn(path)]).toEqual([path, true]);
      expect(certifyPromptOpen({ ...base, pathname: path })).toBe(false);
    }
    expect(certifyPromptSilencedOn("/rgpdx")).toBe(false);
    expect(certifyPromptSilencedOn(null)).toBe(false);
  });

  it("se tait sur toute page légale, celles des conditions comprises (une seule liste)", () => {
    for (const path of LEGAL_PAGE_PATHS) {
      expect([path, certifyPromptSilencedOn(path), termsModalSilencedOn(path)]).toEqual([path, true, true]);
    }
    // Pages libres des conditions mais pas légales : la proposition y a sa place.
    for (const path of ["/regles", "/signalements", "/profil"]) {
      expect([path, certifyPromptSilencedOn(path)]).toEqual([path, false]);
    }
    expect(recruitmentModalSilenced({ privacyPending: false, termsModalDue: false, pathname: "/" })).toBe(false);
  });
});

describe("fermeture de la modale de confidentialité par un lien d'action", () => {
  it("l'événement le dit dans `detail`, lu par privacyFollowedLink", () => {
    expect(privacyAnsweredEvent(true).type).toBe(PRIVACY_CHANGES_ANSWERED_EVENT);
    expect(privacyFollowedLink(privacyAnsweredEvent(true))).toBe(true);
    expect(privacyFollowedLink(privacyAnsweredEvent(false))).toBe(false);
    // Un émetteur plus ancien (événement nu) : pas un lien suivi.
    expect(privacyFollowedLink(new Event(PRIVACY_CHANGES_ANSWERED_EVENT))).toBe(false);
  });
});

describe("DISCORD_CERTIFIED_EVENT venu du dialogue de /profil", () => {
  it("se reconnaît à son detail ; l'événement nu de la fenêtre, non", () => {
    expect(certifiedFromProfileEvent().type).toBe(DISCORD_CERTIFIED_EVENT);
    expect(certifiedFromProfile(certifiedFromProfileEvent())).toBe(true);
    expect(certifiedFromProfile(new Event(DISCORD_CERTIFIED_EVENT))).toBe(false);
  });
});
