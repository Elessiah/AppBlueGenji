import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DISCORD_CERTIFICATION_UNDO,
  DISCORD_LOGIN_TAG_NOTICE,
  DISCORD_TAG_AUDIENCE,
} from "@/lib/shared/identity-sharing";
import { messagesFor } from "@/lib/server/i18n-messages";
import { formatMessage } from "@/lib/shared/message-format";

/**
 * Ce que la connexion Discord fait du tag, dit avant le clic.
 *
 * La connexion certifiait le tag sans qu'on le demande : c'était le seul
 * endroit où un tag s'ouvrait à l'organisation sans geste de son titulaire, et
 * la base « Consentement » annoncée ne tenait pas. Elle l'**enregistre**
 * désormais, non certifié ; la certification est un clic distinct sur
 * `/profil`. La page de connexion doit donc le dire, et dire qui lirait le tag
 * une fois certifié.
 *
 * Assertion sur la **source** faute de pouvoir monter la page : elle tient à ce
 * qu'aucun test ne peut deviner, la présence de la phrase.
 *
 * Depuis que `/profil` énonce la même promesse, la phrase elle-même vit dans
 * `lib/shared/identity-sharing.ts` : le contrôle porte donc sur son contenu
 * *et* sur le fait que la page de connexion l'emploie. C'est plus fort que
 * l'ancienne lecture littérale — deux écrans ne peuvent plus promettre deux
 * choses différentes.
 */
const SOURCE = readFileSync(join(process.cwd(), "app/connexion/_components/LoginForm.tsx"), "utf8");
/** Textes de la page, dans les messages depuis le lot 6 (`messages/<langue>/login.json`). */
const FR = messagesFor("fr").login;

describe("connexion Discord — annonce de l'enregistrement du tag", () => {
  it("dit que se connecter enregistre le tag **sans le certifier**", () => {
    // Se connecter n'est pas consentir à l'exposition : la phrase ne doit plus
    // promettre une certification que la connexion ne fait plus.
    expect(FR.page.tagNotice).toMatch(/enregistre ce tag<\/strong>, sans le certifier/);
    expect(FR.page.tagNotice).not.toMatch(/certifie ce tag/i);
    expect(SOURCE).toContain('text.rich("page.tagNotice"');
  });

  it("dit que la certification se fait ensuite, dans le profil", () => {
    expect(FR.page.tagNotice).toMatch(/Si tu le certifies ensuite\s+dans « Mon profil »/);
  });

  it("la note sous le bouton Discord dit la même chose, et qui lirait le tag", () => {
    expect(DISCORD_LOGIN_TAG_NOTICE).toMatch(/sans le certifier/);
    expect(DISCORD_LOGIN_TAG_NOTICE).toMatch(/invisible de tous, administrateurs compris/);
    expect(DISCORD_LOGIN_TAG_NOTICE).toContain(DISCORD_TAG_AUDIENCE);
    // La note du bouton vient des messages : son français est mot pour mot la phrase partagée.
    expect(formatMessage("fr", FR.oauth.discordNote, { audience: FR.oauth.tagAudience })).toBe(DISCORD_LOGIN_TAG_NOTICE);
    expect(
      readFileSync(join(process.cwd(), "app/connexion/_components/OAuthButtons.tsx"), "utf8"),
    ).toContain('DISCORD: "oauth.discordNote"');
  });

  it("nomme les deux publics, et eux seuls", () => {
    expect(DISCORD_TAG_AUDIENCE).toMatch(/administrateurs/i);
    expect(DISCORD_TAG_AUDIENCE).toMatch(/arbitres/i);
    // « Jamais personne d'autre » : la phrase borne l'exposition au lieu de la
    // laisser deviner. Sans cela, « les administrateurs le voient » se lirait
    // comme un début de liste.
    expect(DISCORD_TAG_AUDIENCE).toMatch(/personne\s+d'autre/i);
    // Le public est la phrase partagée, reprise telle quelle par les messages.
    expect(FR.oauth.tagAudience).toBe(DISCORD_TAG_AUDIENCE);
    expect(SOURCE).toContain('audience: t("oauth.tagAudience")');
  });

  it("garde un geste d'annulation nommé, celui qui existe à l'écran", () => {
    // Il n'y a pas de route de décertification : le retrait du tag l'est.
    expect(DISCORD_CERTIFICATION_UNDO).toMatch(/retire ton tag/i);
  });

  it("ne recopie plus la phrase dans la page", () => {
    // Une copie vaudrait promesse divergente au premier ajustement.
    expect(SOURCE).not.toMatch(/les administrateurs\s*\n?\s*le voient/i);
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
