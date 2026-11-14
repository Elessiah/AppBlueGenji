import { describe, expect, it } from "@jest/globals";
import frDialogs from "@/messages/fr/tournamentDialogs.json";
import enDialogs from "@/messages/en/tournamentDialogs.json";
import { PROCESSING_ACTIVITIES, PROCESSING_ACTIVITIES_EN } from "@/lib/shared/processing-register";
import { PRIVACY_CHANGES } from "@/lib/shared/privacy-changes";
import { PRIVACY_CHANGES_EN } from "@/lib/shared/privacy-changes-en";
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

    expect(fr).toContain("aux équipes du match, aux arbitres et aux administrateurs du site dès que les deux adversaires sont connus et jusqu'à sa fin (à ses casters le temps du match)");
    expect(en).toContain("to the match's teams and the site's referees and admins from the moment both opponents are known until it ends (to its casters while it is played)");
  });

  it("registerT10_frAndEn_saysAtMostOnceByDmAndPushWithTitlesOnlyAndNoResend", () => {
    expect(t10Fr).toContain("Annoncer chaque changement une fois, en message privé Discord et, sur un appareil abonné, en notification push");
    expect(t10Fr).toContain("ne donne que les titres, ou nomme ce qui tient et compte le reste, annoncé au message suivant");
    expect(t10Fr).toContain("une annonce réservée puis interrompue (arrêt du site pendant l'envoi) n'est pas renvoyée");
    expect(t10En).toContain("Announcing each change once, by Discord direct message and, on a subscribed device, by push notification");
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

describe("EF-63 — revue juridique, cycle 2", () => {
  const entry = PRIVACY_CHANGES.find((change) => change.id === "2026-11-marque-de-session-rectificatif")!;
  const english = PRIVACY_CHANGES_EN["2026-11-marque-de-session-rectificatif"]!;

  it("registerT10_frAndEn_saysPushMayRepeatWhenBotUnreachable", () => {
    expect(t10Fr).toContain("si le message privé n'a pas pu partir (bot injoignable), l'annonce est refaite à un balayage suivant, et la notification push peut alors arriver de nouveau");
    expect(t10En).toContain("if the direct message could not be sent (bot unreachable), the announcement is made again at a later sweep, and the push notification may then arrive again");
    expect(t10Fr).not.toContain("au plus une fois");
    expect(t10En).not.toContain("at most once");
  });

  it("registerT10_frAndEn_saysNotBeforeAWeekSinceOldestDueChange", () => {
    expect(t10Fr).toContain("pas avant qu'une semaine ait passé depuis la publication du plus ancien changement à annoncer (ceux publiés depuis partent avec lui)");
    expect(t10En).toContain("not before a week has passed since the publication of the oldest change to announce (those published since go with it)");
    expect(t10Fr).not.toContain("une semaine après sa publication");
  });

  it("rectificatifSummary_frAndEn_onlyExceptionLaterClearsIfReceivedAndNotRefused", () => {
    expect(entry.summary).toContain("ou la refuse, la marque de ta session reste");
    expect(entry.summary).toContain("Seule exception : la certification refusée parce que ton tag ne peut plus être certifié");
    expect(english.summary).toContain("or refuses it, your session's mark stays");
    expect(english.summary).toContain("The only exception: a verification refused because your tag can no longer be verified");
    expect(entry.summary).not.toContain("que s'il est reçu)");
  });

  it("rectificatifDetails1_frAndEn_namesMatchCardContactsWindow", () => {
    expect(entry.details[1]).toContain("dans la fenêtre « Contacts » de la carte du match, dès que ses deux adversaires sont connus");
    expect(english.details[1]).toContain("in the match card's “Contacts” window, as soon as both its opponents are known");
  });

  it("matchesDoesNot_frAndEn_namesTeamsRefereesAdminsAndCastersDuringMatch", () => {
    expect(frDialogs.certification.rows.matches.doesNot).toContain("il est montré même masqué aux équipes du match, aux arbitres et aux administrateurs du site dès que les deux adversaires sont connus et jusqu'à sa fin (à ses casters le temps du match)");
    expect(enDialogs.certification.rows.matches.doesNot).toContain("it appears even if hidden to the match's teams and the site's referees and admins from the moment both opponents are known until it ends (to its casters while it is played)");
  });
});
