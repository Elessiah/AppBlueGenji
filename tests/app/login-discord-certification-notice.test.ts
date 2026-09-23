import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DISCORD_CERTIFICATION_UNDO,
  DISCORD_TAG_AUDIENCE,
} from "@/lib/shared/identity-sharing";

/**
 * L'exposition doit être annoncée sur **les deux** chemins de certification.
 *
 * Celui de `/profil` passe par un dialogue qui l'énonce public par public
 * (`DISCORD_VERIFICATION_EXPOSURE`). L'autre est la connexion Discord, qui
 * certifie le tag sans qu'on le demande : entrer par cette porte *est* la preuve
 * que la certification réclame. C'était donc le seul endroit où un tag
 * s'ouvrait à l'organisation sans un mot — un membre qui n'avait jamais rempli
 * le champ « Pseudo Discord » voyait son handle devenir lisible par les
 * administrateurs et les arbitres, sans rien en savoir.
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
const SOURCE = readFileSync(join(process.cwd(), "app/connexion/page.tsx"), "utf8");

describe("connexion Discord — annonce de la certification", () => {
  it("dit que se connecter certifie le tag", () => {
    expect(SOURCE).toMatch(/certifie ce tag/i);
  });

  it("nomme les deux publics, et eux seuls", () => {
    expect(DISCORD_TAG_AUDIENCE).toMatch(/administrateurs/i);
    expect(DISCORD_TAG_AUDIENCE).toMatch(/arbitres/i);
    // « Jamais personne d'autre » : la phrase borne l'exposition au lieu de la
    // laisser deviner. Sans cela, « les administrateurs le voient » se lirait
    // comme un début de liste.
    expect(DISCORD_TAG_AUDIENCE).toMatch(/personne\s+d'autre/i);
    expect(SOURCE).toContain("DISCORD_TAG_AUDIENCE");
  });

  it("nomme le geste d'annulation, et celui qui existe à l'écran", () => {
    // Il n'y a pas de route de décertification, et le taire laisserait le
    // lecteur sans aucune issue. Mais se connecter par Discord **rattache** le
    // compte, ce qui met le champ de `/profil` en lecture seule : « modifie ton
    // tag » désignait alors le seul geste que ce lecteur ne peut plus faire.
    expect(DISCORD_CERTIFICATION_UNDO).toMatch(/retire ton tag/i);
    expect(SOURCE).toContain("DISCORD_CERTIFICATION_UNDO");
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
