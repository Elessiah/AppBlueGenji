import { describe, expect, it } from "@jest/globals";
import { PRIVACY_CHANGES } from "@/lib/shared/privacy-changes";
import { PRIVACY_CHANGES_EN } from "@/lib/shared/privacy-changes-en";
import { PROCESSING_ACTIVITIES, PROCESSING_ACTIVITIES_EN } from "@/lib/shared/processing-register";
import { readSource } from "../../helpers/read-source";

/**
 * Revue juridique du lot SHARE-EMBEDS : ce que disent l'entrée de
 * PRIVACY_CHANGES, le registre (T03) et /rgpd des codes de replay rendus
 * publics, des aperçus partagés et de l'adresse IP gardée pour leurs plafonds.
 */
const ID = "2026-11-apercus-partage-codes-replay";
const entry = PRIVACY_CHANGES.find((change) => change.id === ID);
const entryEn = PRIVACY_CHANGES_EN[ID];
const frText = entry ? [entry.summary, ...entry.details].join(" ") : "";
const enText = entryEn ? [entryEn.summary, ...entryEn.details].join(" ") : "";
const t03 = JSON.stringify([
  PROCESSING_ACTIVITIES.find((activity) => activity.ref === "T03"),
  PROCESSING_ACTIVITIES_EN.find((activity) => activity.ref === "T03"),
]);

describe("entrée « liens partagés » de PRIVACY_CHANGES", () => {
  it("ne dit plus que le score de chaque map était réservé aux membres", () => {
    expect(frText).not.toMatch(/score de chaque map et son code de replay, jusqu'ici réservés/);
    expect(enText).not.toMatch(/score of each map and its replay code, until now reserved/);
  });

  it("dit que les codes déjà enregistrés deviennent publics et comment s'y opposer", () => {
    expect(frText).toContain("Les codes déjà enregistrés deviennent publics");
    expect(frText).toContain("t'opposer à la publication du code");
    expect(enText).toContain("Codes already recorded become public");
    expect(enText).toContain("object to the publication of the code");
  });

  it("dit qu'un code devient public map par map, avant la fin du match", () => {
    expect(frText).toContain("map par map");
    expect(frText).toContain("avant même la fin du match");
    expect(enText).toContain("map by map");
    expect(enText).toContain("even before the match ends");
  });

  it("déclare l'adresse IP gardée deux minutes au plus pour les images d'aperçu", () => {
    expect(frText).toMatch(/adresse IP[^.]*deux minutes au plus/);
    expect(enText).toMatch(/IP address[^.]*two minutes at most/);
  });

  it("nomme la description du tournoi dans l'aperçu", () => {
    expect(frText).toContain("sa description publiée par l'organisation");
    expect(enText).toContain("its description published by the organizers");
  });
});

describe("registre T03", () => {
  it("garde l'adresse IP d'un visiteur sans compte deux minutes au plus, pour les lectures et les aperçus", () => {
    expect(t03).toContain("deux minutes au plus");
    expect(t03).toContain("two minutes at most");
    expect(t03).toContain("rendus d'images d'aperçu");
    expect(t03).not.toContain("plafond de lecture (une minute)");
  });

  it("nomme les services où un lien partagé est collé parmi les destinataires", () => {
    expect(t03).toContain("Les services où un visiteur colle un lien partagé (Discord, X, une messagerie)");
    expect(t03).toContain("The services where a visitor pastes a shared link (Discord, X, a messaging app)");
  });
});

describe("/rgpd", () => {
  const fr = readSource("app/rgpd/page.tsx");
  const en = readSource("app/rgpd/RgpdEn.tsx");

  it("dit que le score de chaque map était déjà public et ouvre l'opposition aux codes", () => {
    expect(fr).toContain("Le score de chaque map y");
    expect(fr).toMatch(/opposer à la\s+publication du code de replay/);
    expect(en).toContain("The score of each map is shown there");
    expect(en).toMatch(/object to\s+the publication of the replay code/);
  });

  it("nomme la page publique d'un match et la durée de l'adresse IP", () => {
    expect(fr).toContain("/suivre/tournois/…/matchs/…");
    expect(fr).toMatch(/deux minutes au\s+plus/);
    expect(en).toContain("/suivre/tournois/…/matchs/…");
    expect(en).toMatch(/two minutes at most/);
  });
});
