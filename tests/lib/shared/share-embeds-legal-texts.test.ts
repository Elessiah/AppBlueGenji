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

describe("entrée « liens partagés » : déclencheur et droits", () => {
  it("dit que le résultat est retenu, pas la map", () => {
    expect(entry?.summary).toContain("ou que le résultat est retenu");
    expect(entry?.summary).not.toContain("enregistrée par l'arbitrage ou retenue");
    expect(entryEn?.summary).toContain("or the result is retained");
    expect(entryEn?.summary).not.toContain("recorded by the referees or retained");
  });

  it("mène à la section des droits, avec un libellé anglais par lien", () => {
    expect(entry?.links?.map((link) => link.href)).toContain("/rgpd#vos-droits");
    expect(entryEn?.linkLabels).toHaveLength(entry?.links?.length ?? -1);
  });

  it("dit que l'adresse IP reste deux minutes après la dernière requête", () => {
    expect(frText).toContain("deux minutes au plus après sa dernière requête");
    expect(enText).toContain("two minutes at most after its last request");
  });
});

describe("registre T03", () => {
  it("vise tout lecteur, connecté ou non, des règles et des aperçus compris", () => {
    expect(t03).toContain("Lecteurs, connectés ou non, de la fiche publique d'un tournoi, de ses règles");
    expect(t03).toContain("Readers, signed in or not, of a tournament's public page, its rules");
  });

  it("déclare la mesure de charge et la durée après la dernière requête", () => {
    expect(t03).toContain("sa part dans la mesure de la charge du serveur");
    expect(t03).toContain("their share in the measure of the server's load");
    expect(t03).toContain("deux minutes au plus après sa dernière requête");
    expect(t03).toContain("two minutes at most after its last request");
  });

  it("ne tranche pas l'absence de transfert : renvoie aux règles des services d'aperçu", () => {
    expect(t03).not.toContain("aucun transfert hors UE de sa part");
    expect(t03).not.toContain("no transfer outside the EU on its part");
    expect(t03).toContain("hors UE pour certains, comme X ou Discord");
    expect(t03).toContain("outside the EU for some, such as X or Discord");
  });

  it("fonde les plafonds par adresse IP sur la sécurité du service", () => {
    expect(t03).toContain("pour l'adresse IP des lecteurs, intérêt légitime à la sécurité et à la disponibilité du service (art. 32)");
    expect(t03).toContain("for the readers' IP address, legitimate interest in the security and availability of the service (art. 32)");
    expect(t03).toContain("Protéger la fiche publique, les règles d'un tournoi et les images d'aperçu contre les abus");
  });

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

  it("déclare la mesure de charge et la durée après la dernière requête", () => {
    expect(fr).toMatch(/mesurer la charge du\s+serveur/);
    expect(fr).toMatch(/deux minutes au plus après sa dernière requête/);
    expect(en).toMatch(/measure the server&apos;s load/);
    expect(en).toMatch(/two minutes at most after its last request/);
  });
});

describe("entrée « liens partagés » : portée complète", () => {
  it("nomme les règles d'un tournoi et la mesure de charge", () => {
    expect(frText).toContain("/regles/…?tournoi=…");
    expect(frText).toContain("mesurer la charge du serveur");
    expect(enText).toContain("/regles/…?tournoi=…");
    expect(enText).toContain("measure the server's load");
  });

  it("dit que l'ancienne durée annoncée (une minute) n'était pas tenue", () => {
    expect(frText).toContain("pour une minute, alors que l'adresse restait en mémoire plus longtemps");
    expect(enText).toContain("for one minute, while the address stayed in memory longer");
  });

  it("ne dit plus que rien de plus n'est collecté", () => {
    expect(frText).not.toContain("rien de plus n'est collecté");
    expect(enText).not.toContain("nothing more is collected");
    expect(frText).toContain("rien de nouveau n'est écrit sur toi en base ni dans un journal");
    expect(enText).toContain("nothing new about you is written to the database or to a log");
  });

  it("annonce les autres plafonds par adresse IP et leurs durées", () => {
    expect(frText).toContain("trente et une minutes pour un signalement sans compte");
    expect(frText).toContain("seize pour un code de connexion Discord");
    expect(enText).toContain("thirty-one minutes for a report without an account");
    expect(enText).toContain("sixteen for a Discord login code");
  });
});

describe("autres plafonds par adresse IP au registre", () => {
  const byRef = (ref: string) => JSON.stringify([
    PROCESSING_ACTIVITIES.find((activity) => activity.ref === ref),
    PROCESSING_ACTIVITIES_EN.find((activity) => activity.ref === ref),
  ]);

  it("T17 déclare les plafonds en mémoire et leurs durées", () => {
    const t17 = byRef("T17");
    expect(t17).toContain("deux minutes au plus après sa dernière requête ; trente et une minutes pour un signalement sans compte, seize pour un code de connexion Discord");
    expect(t17).toContain("two minutes at most after its last request; thirty-one minutes for a report without an account, sixteen for a Discord login code");
    expect(t17).toContain("tant que le flux reste ouvert");
  });

  it("T02 déclare la durée de l'adresse IP des essais de code", () => {
    expect(byRef("T02")).toContain("seize minutes au plus après sa dernière requête (T17)");
    expect(byRef("T02")).toContain("sixteen minutes at most after its last request (T17)");
  });

  it("T11 déclare l'adresse IP du signalant sans compte", () => {
    expect(byRef("T11")).toContain("Adresse IP du signalant sans compte, en mémoire seulement");
    expect(byRef("T11")).toContain("IP address of a reporter without an account, in memory only");
  });
});

describe("/rgpd : plafonds par adresse IP et section des droits", () => {
  const fr = readSource("app/rgpd/page.tsx");
  const en = readSource("app/rgpd/RgpdEn.tsx");

  it("décrit les autres plafonds par adresse IP, FR et EN", () => {
    expect(fr).toMatch(/trente et une minutes pour un signalement sans\s+compte/);
    expect(en).toMatch(/thirty-one\s+minutes for a report without an account/);
  });

  it("porte l'ancre de la section « Vos droits » visée par l'entrée", () => {
    expect(fr).toContain('<section id="vos-droits"');
    expect(en).toContain('<section id="vos-droits"');
  });
});
