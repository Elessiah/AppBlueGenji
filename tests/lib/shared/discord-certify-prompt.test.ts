import { describe, expect, it } from "@jest/globals";
import {
  CERTIFY_PROFILE_HREF,
  CERTIFY_PROMPT_DOORS,
  certifyPromptDoor,
  certifyPromptFor,
  parseCertifyPromptAction,
  wantsCertifyDialog,
} from "@/lib/shared/discord-certify-prompt";
import { CONNECTION_LOG_EVENTS } from "@/lib/shared/connection-logs";
import {
  certifyPromptOpen,
  certifyPromptSilencedOn,
  LOGIN_PATH,
  recruitmentModalSilenced,
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
    expect(certifyPromptFor({ ...base, discordId: null })).toEqual({ mode: "DIALOG" });
    expect(certifyPromptFor({ discordId: null, discordPseudo: null, pseudoFromDiscord: false })).toEqual({ mode: "DIALOG" });
  });

  it("mène au dialogue pour un tag tapé à la main, absent ou numérique", () => {
    expect(certifyPromptFor({ ...base, pseudoFromDiscord: false })).toEqual({ mode: "DIALOG" });
    expect(certifyPromptFor({ ...base, discordPseudo: null })).toEqual({ mode: "DIALOG" });
    expect(certifyPromptFor({ ...base, discordPseudo: "   " })).toEqual({ mode: "DIALOG" });
    expect(certifyPromptFor({ ...base, discordPseudo: "123456789012345678" })).toEqual({ mode: "DIALOG" });
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

  it("fait taire la modale d'arrivée du recrutement tant qu'elle est due", () => {
    const quiet = { privacyPending: false, termsModalDue: false, pathname: "/" };
    expect(recruitmentModalSilenced(quiet)).toBe(false);
    expect(recruitmentModalSilenced({ ...quiet, certifyPromptDue: false })).toBe(false);
    expect(recruitmentModalSilenced({ ...quiet, certifyPromptDue: true })).toBe(true);
  });
});
