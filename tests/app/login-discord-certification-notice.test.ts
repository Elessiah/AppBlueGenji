import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DISCORD_CERTIFICATION_UNDO,
  DISCORD_LOGIN_TAG_DETAILS,
  DISCORD_LOGIN_TAG_NOTICE,
  DISCORD_TAG_AUDIENCE,
} from "@/lib/shared/identity-sharing";
import { discordAudienceLines } from "@/lib/shared/identity-audience";
import { messagesFor } from "@/lib/server/i18n-messages";
import { scopedText } from "@/lib/shared/scoped-text";

/**
 * Ce que la connexion Discord fait du tag, dit avant le clic.
 *
 * La connexion **enregistre** le tag, non certifié ; la certification est un
 * clic distinct sur `/profil`. La page de connexion doit donc le dire — une
 * ligne visible —, et dire qui lirait le tag une fois certifié, derrière le
 * bouton « i » (`docs/features/INFO_HINTS.md`).
 *
 * Assertion sur la **source** faute de pouvoir monter la page : elle tient à ce
 * qu'aucun test ne peut deviner, la présence de la phrase. La promesse vit dans
 * `lib/shared/identity-sharing.ts`, partagée avec `/profil`.
 */
const SOURCE = readFileSync(join(process.cwd(), "app/connexion/_components/LoginForm.tsx"), "utf8");
const OAUTH_SOURCE = readFileSync(join(process.cwd(), "app/connexion/_components/OAuthButtons.tsx"), "utf8");
/** Textes de la page, dans les messages depuis le lot 6 (`messages/<langue>/login.json`). */
const FR = messagesFor("fr").login;
const FR_TEXT = scopedText("fr", FR);

describe("connexion Discord — annonce de l'enregistrement du tag", () => {
  it("dit que se connecter enregistre le tag **sans le certifier**", () => {
    // Se connecter n'est pas consentir à l'exposition : la phrase ne doit plus
    // promettre une certification que la connexion ne fait plus.
    expect(FR.page.tagNotice).toMatch(/enregistre ce tag<\/strong>, sans le certifier/);
    expect(FR.page.tagNotice).not.toMatch(/certifie ce tag/i);
    expect(SOURCE).toContain('text.rich("page.tagNotice"');
  });

  it("dit où certifier ensuite — profil ou fenêtre après connexion — derrière le « i »", () => {
    expect(FR.oauth.discordDetails).toBe(DISCORD_LOGIN_TAG_DETAILS);
    expect(DISCORD_LOGIN_TAG_DETAILS).toMatch(/dans « Mon profil » ou dans la fenêtre proposée après une connexion par Discord ou Blizzard/);
    // Le code par message privé comme le bouton : même détail, même liste.
    expect(SOURCE).toContain('<InfoHint id="login-discord-tag-more"');
    expect(SOURCE).toContain('t("oauth.discordDetails")');
    expect(OAUTH_SOURCE).toContain('t("oauth.discordDetails")');
  });

  it("la note sous le bouton Discord dit la même chose, et qui lirait le tag", () => {
    expect(DISCORD_LOGIN_TAG_NOTICE).toMatch(/sans le certifier/);
    expect(DISCORD_LOGIN_TAG_NOTICE).toMatch(/personne ne le voit/);
    // La note du bouton vient des messages : son français est mot pour mot la phrase partagée.
    expect(FR.oauth.discordNote).toBe(DISCORD_LOGIN_TAG_NOTICE);
    expect(OAUTH_SOURCE).toContain('DISCORD: "oauth.discordNote"');
    expect(OAUTH_SOURCE).toContain("<AudienceList lines={discordAudienceLines(t)} />");
  });

  it("nomme les publics, et eux seuls", () => {
    const lines = discordAudienceLines(FR_TEXT.t);
    // Le public est la liste partagée, reprise telle quelle par les messages.
    expect(lines).toEqual(DISCORD_TAG_AUDIENCE);
    expect(lines.items.join(" ")).toMatch(/administrateurs/);
    expect(lines.items.join(" ")).toMatch(/arbitres/);
    // « Personne d'autre » borne l'exposition au lieu de la laisser deviner.
    expect(lines.footer).toMatch(/personne\s+d'autre/i);
    expect(SOURCE).toContain("<AudienceList lines={discordAudienceLines(t)} />");
  });

  it("garde un geste d'annulation nommé, celui qui existe à l'écran", () => {
    // Il n'y a pas de route de décertification : le retrait du tag l'est.
    expect(DISCORD_CERTIFICATION_UNDO).toMatch(/retire ton tag/i);
  });

  it("ne recopie plus la phrase dans la page", () => {
    // Une copie vaudrait promesse divergente au premier ajustement.
    expect(SOURCE).not.toMatch(/les administrateurs\s*\n?\s*le voient/i);
    expect(SOURCE).not.toMatch(/administrateurs, à tout moment/);
  });
});

describe("annonce réservée à une saisie certifiable", () => {
  it("n'annonce rien quand la saisie est un identifiant numérique", () => {
    // Le repli par identifiant ne certifie **rien** (`normalizeDiscordHandle`
    // rend `null`) : promettre une certification qui n'aura pas lieu est pire
    // que se taire. La condition passe par le prédicat partagé, pas par une
    // seconde lecture du motif.
    expect(SOURCE).toMatch(/isCertifiableDiscordHandle\(handle\)/);
    expect(SOURCE).toMatch(/from "@\/lib\/shared\/discord-identity"/);
    // Aucun motif de chiffres recopié sur place à côté de l'annonce.
    expect(SOURCE).not.toMatch(/\d\{5,32\}/);
  });
});
