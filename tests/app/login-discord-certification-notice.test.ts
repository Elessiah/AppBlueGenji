import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";

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
 */
const SOURCE = readFileSync(join(process.cwd(), "app/connexion/page.tsx"), "utf8");

describe("connexion Discord — annonce de la certification", () => {
  it("dit que se connecter certifie le tag", () => {
    expect(SOURCE).toMatch(/certifie ce tag/i);
  });

  it("nomme les deux publics, et eux seuls", () => {
    expect(SOURCE).toMatch(/administrateurs/i);
    expect(SOURCE).toMatch(/arbitres/i);
    // « Jamais personne d'autre » : la phrase borne l'exposition au lieu de la
    // laisser deviner. Sans cela, « les administrateurs le voient » se lirait
    // comme un début de liste.
    expect(SOURCE).toMatch(/personne\s+d&apos;autre/i);
  });

  it("nomme le geste d'annulation", () => {
    // Il n'y a pas de route de décertification : modifier le tag *est* le geste.
    // Le taire laisserait le lecteur sans aucune issue.
    expect(SOURCE).toMatch(/annule la\s*\n?\s*certification/i);
  });
});
