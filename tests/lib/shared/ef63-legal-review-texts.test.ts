import { describe, expect, it } from "@jest/globals";
import frDialogs from "@/messages/fr/tournamentDialogs.json";
import enDialogs from "@/messages/en/tournamentDialogs.json";
import { PROCESSING_ACTIVITIES, PROCESSING_ACTIVITIES_EN } from "@/lib/shared/processing-register";
import { readSource } from "../../helpers/read-source";

/**
 * Revue juridique EF-63 (cycle 1) : textes rendus exacts — public du BattleTag
 * masqué dans la proposition de certification, canaux et limites de T10, lien
 * de chaîne posé dans « Configurer ma diffusion ».
 */
const t10Fr = JSON.stringify(PROCESSING_ACTIVITIES.find((activity) => activity.ref === "T10"));
const t10En = JSON.stringify(PROCESSING_ACTIVITIES_EN.find((activity) => activity.ref === "T10"));

describe("EF-63 — revue juridique, cycle 1", () => {
  it("doesNotBattletagPending_frAndEn_namesTeamsAndCastersAudiences", () => {
    const fr = JSON.stringify(frDialogs);
    const en = JSON.stringify(enDialogs);

    expect(fr).toContain("aux équipes du match dès que les deux adversaires sont connus et jusqu'à sa fin (à ses casters le temps du match)");
    expect(en).toContain("to the match's teams from the moment both opponents are known until it ends (to its casters while it is played)");
  });

  it("registerT10_frAndEn_saysAtMostOnceByDmAndPushWithTitlesOnlyAndNoResend", () => {
    expect(t10Fr).toContain("Annoncer chaque changement au plus une fois, en message privé Discord et, sur un appareil abonné, en notification push");
    expect(t10Fr).toContain("ne donne que les titres, ou nomme ce qui tient et compte le reste, annoncé au message suivant");
    expect(t10Fr).toContain("une annonce réservée puis interrompue (arrêt du site pendant l'envoi) n'est pas renvoyée");
    expect(t10En).toContain("Announcing each change at most once, by Discord direct message and, on a subscribed device, by push notification");
    expect(t10En).toContain("is not sent again (the change is still presented by the site's window)");
    expect(t10Fr).not.toContain("Annoncer chaque changement une fois en message privé Discord aux comptes");
  });

  it("casterLinkClause_rgpdAndRegister_namesConfigureMyBroadcast", () => {
    expect(readSource("app/rgpd/page.tsx")).toContain("son stream ou dans « Configurer ma diffusion » part aussi");
    expect(readSource("app/rgpd/RgpdEn.tsx")).toContain("when opening their stream or in “Configure my broadcast” also goes");
    const register = readSource("lib/shared/processing-register.ts");
    expect(register).toContain("le lien qu'un caster a fourni (en ouvrant son stream ou dans « Configurer ma diffusion ») part");
    expect(register).toContain("le lien qu'un caster a fourni en ouvrant son stream ou dans « Configurer ma diffusion » part à la suppression");
    expect(register).toContain("the link a caster provided (when opening their stream or in “Configure my broadcast”) goes");
    expect(register).toContain("the link a caster provided when opening their stream or in “Configure my broadcast” goes when");
  });
});
