import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REGISTER_SCOPE_DETAIL, REGISTER_SCOPE } from "@/lib/shared/processing-register";

/**
 * `/rgpd` ne couvrait qu'une partie du registre (journal Discord, bénévoles,
 * codes de connexion, « Prêt », conditions d'utilisation… n'y figuraient pas),
 * et les deux pages se disaient exhaustives. La politique lit désormais ses
 * rubriques **du registre** : une fiche ajoutée y paraît d'elle-même.
 */
const page = readFileSync(join(process.cwd(), "app/rgpd/page.tsx"), "utf8");
const registerPage = readFileSync(join(process.cwd(), "app/rgpd/registre/page.tsx"), "utf8");

describe("/rgpd — couverture du registre", () => {
  it("rend une ligne par fiche, lue du registre et non recopiée", () => {
    expect(page).toMatch(/PROCESSING_ACTIVITIES\.map\(\(activity\) =>/);
    expect(page).toContain("{activity.legalBasis}");
    expect(page).toContain('{activity.retention.join(" ; ")}');
    expect(page).toContain("/rgpd/registre#${activity.ref.toLowerCase()}");
  });

  it("ne se dit plus exhaustif, ni ici ni sur la page du registre", () => {
    for (const source of [page, registerPage]) {
      expect(source).not.toMatch(/tout ce que BlueGenji fait de données personnelles/);
      expect(source).toContain("{REGISTER_SCOPE}");
      expect(source).toContain("{REGISTER_SCOPE_DETAIL}");
    }
  });

  it("nomme ce qui entoure le site, et dit les adhésions hors de son registre", () => {
    expect(REGISTER_SCOPE).toMatch(/site et du bot Discord/);
    for (const activity of ["journaux techniques du serveur web", "Spiceworks", "retransmission des matchs"]) {
      expect(REGISTER_SCOPE_DETAIL).toContain(activity);
    }
    expect(REGISTER_SCOPE_DETAIL).toMatch(/adhésions à l'association ne relève pas du site/);
  });

  it("nomme Google (Gmail), Spiceworks et les plateformes de diffusion parmi les destinataires", () => {
    const destinataires = page.slice(page.indexOf('id="destinataires"'), page.indexOf('id="exercer-vos-droits"'));
    expect(destinataires).toMatch(/<strong>Google<\/strong> \(Gmail\)/);
    expect(destinataires).toMatch(/<strong>Spiceworks<\/strong>/);
    expect(destinataires).toMatch(/<strong>YouTube, Twitch ou Kick<\/strong>/);
    expect(destinataires).not.toMatch(/en cours de vérification/);
  });

  it("applique aux demandes adressées à l'association la durée des demandes RGPD", () => {
    expect(page).toMatch(/adressée au courriel \(Gmail\) ou au téléphone\s+de l&apos;association/);
  });

  it("rend les bases supplémentaires d'une donnée à côté de sa base principale", () => {
    expect(page).toContain("d.extraBases?.map((extra) =>");
  });

  it("dit ce que le journal des connexions ne garde pas", () => {
    const connexions = page.slice(page.indexOf('id="donnees-connexion"'));
    expect(connexions).toMatch(/ni le port source de la connexion/);
    expect(connexions).toMatch(/ni la\s+création ou la modification d&apos;un contenu/);
  });

  it("ne réserve plus le « aucun nom réel » qu'au compte joueur, exceptions nommées", () => {
    expect(page).not.toMatch(/BlueGenji ne demande aucun nom réel/);
    expect(page).toMatch(/Le compte joueur ne demande aucun nom réel/);
    expect(page).toMatch(/signalement de droit d&apos;auteur indique le nom/);
    expect(page).toMatch(/bénévoles présentés sur le site y figurent sous leur nom/);
  });

  it("ne présente plus le portail Spiceworks comme un service tiers à ses propres conditions", () => {
    expect(page).not.toMatch(/qui a ses propres conditions/);
  });

  it("remplace « applicable depuis la création » par l'historique des versions", () => {
    expect(page).not.toMatch(/· Applicable depuis la création de la plateforme/);
    expect(page).toContain("publishedPrivacyChanges(today).filter((change) => !change.audience)");
    expect(page).toContain("Historique des versions");
    // La date et l'historique lisent la même liste.
    expect(page).toContain("privacyPolicyUpdatedLabel(today, history)");
  });
});
