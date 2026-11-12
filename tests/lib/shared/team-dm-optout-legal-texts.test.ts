import { describe, expect, it } from "@jest/globals";
import { PRIVACY_POLICY } from "@/lib/shared/bot-legal-content";
import { PRIVACY_CHANGES } from "@/lib/shared/privacy-changes";
import { PRIVACY_CHANGES_EN } from "@/lib/shared/privacy-changes-en";
import { PROCESSING_ACTIVITIES, PROCESSING_ACTIVITIES_EN } from "@/lib/shared/processing-register";
import { DONNEES_PROFIL, DROITS } from "@/lib/shared/rgpd-policy";
import { DROITS_EN } from "@/lib/shared/rgpd-policy-en";
import { readSource } from "../../helpers/read-source";

/**
 * TEAM-DM-OPTOUT (décision D68) : la case « Messages privés Discord de mes
 * matchs et de mes équipes » coupe aussi les messages privés d'équipe — la
 * politique, le registre, la politique du bot et une entrée de PRIVACY_CHANGES
 * le disent.
 */
const ENTRY_ID = "2026-11-messages-d-equipe-reglage-du-profil";
const entryFr = PRIVACY_CHANGES.find((c) => c.id === ENTRY_ID);
const entryEn = PRIVACY_CHANGES_EN[ENTRY_ID];
const teamParagraph = (source: string) =>
  source.slice(source.indexOf('<p id="messages-d-equipe">'), source.indexOf('<p id="arbitre-designe">'));

describe("entrée PRIVACY_CHANGES du réglage des messages d'équipe", () => {
  it("privacyChange_teamDmOptOut_lastEntryDated20261113ForAllAccounts", () => {
    expect(PRIVACY_CHANGES.at(-2)?.id).toBe(ENTRY_ID);
    expect(entryFr?.publishedAt).toBe("2026-11-13");
    expect(entryFr?.audience).toBeUndefined();
    expect(entryFr?.asksTermsAcceptance).toBeUndefined();
    expect(entryEn?.details).toHaveLength(entryFr?.details.length ?? -1);
    expect(entryFr?.links?.[0]).toEqual({ href: "/profil#notifications", label: "Ouvrir le réglage dans « Mon profil »" });
  });

  it("privacyChange_teamDmOptOut_earlierUntickAlsoStopsTeamDmsFrAndEn", () => {
    const fr = entryFr?.details.join(" ") ?? "";
    const en = entryEn?.details.join(" ") ?? "";
    expect(fr).toContain("Si tu avais déjà décoché la case, tes messages privés d'équipe s'arrêtent aussi.");
    expect(fr).toContain("seule la notification push part");
    expect(en).toContain("If you had already unticked the box, your team direct messages stop too.");
    expect(en).toContain("only the push notification is sent");
  });

  it("privacyChange_teamDmOptOut_noLongerPointsToExerciseRightsFrAndEn", () => {
    // /rgpd § messages-d-equipe ne mène plus qu'à la case de « Mon profil ».
    expect(entryFr?.details.join(" ")).not.toContain("Exercer vos droits");
    expect(entryEn?.details.join(" ")).not.toContain("Exercising your rights");
  });

  it("privacyChange_teamNoticeCaps_objectionThroughProfileBoxFrAndEn", () => {
    const id = "2026-11-avis-d-equipe-plafonds-et-base";
    const fr = PRIVACY_CHANGES.find((c) => c.id === id)?.details.join(" ") ?? "";
    const en = PRIVACY_CHANGES_EN[id]?.details.join(" ") ?? "";
    expect(fr).toContain("Pour t'y opposer, décoche « Messages privés Discord de mes matchs et de mes équipes » dans « Mon profil »");
    expect(fr).not.toContain("Exercer vos droits");
    expect(en).toContain("To object, untick “Discord direct messages about my matches and teams” in “My profile”");
    expect(en).not.toContain("Exercising your rights");
  });

  it("privacyChange_teamNoticeCaps_linksTheProfileSettingFrAndEn", () => {
    const id = "2026-11-avis-d-equipe-plafonds-et-base";
    expect(PRIVACY_CHANGES.find((c) => c.id === id)?.links?.at(-1)).toEqual({ href: "/profil#notifications", label: "Ouvrir le réglage dans « Mon profil »" });
    expect(PRIVACY_CHANGES_EN[id]?.linkLabels).toHaveLength(PRIVACY_CHANGES.find((c) => c.id === id)?.links?.length ?? -1);
    expect(PRIVACY_CHANGES_EN[id]?.linkLabels?.at(-1)).toBe("Open the setting in “My profile”");
  });
});

describe("politique et registre", () => {
  it("rgpdTeamParagraph_namesTheProfileBoxFrAndEn", () => {
    const fr = teamParagraph(readSource("app/rgpd/page.tsx"));
    const en = teamParagraph(readSource("app/rgpd/RgpdEn.tsx"));
    expect(fr).toContain("« Messages privés Discord de mes matchs et de mes équipes »");
    expect(fr).toContain('<Link href="/profil#notifications">Mon profil</Link>');
    expect(fr).not.toContain("Exercer vos droits");
    expect(en).toContain("“Discord direct messages about my matches and teams”");
    expect(en).toContain('<EnglishLegalLink href="/profil#notifications">My profile</EnglishLegalLink>');
    expect(en).not.toContain("Exercising your rights");
  });

  it("donneesProfilMatchDmRow_frAndEn_teamReachLinkedOrCertified", () => {
    // Les messages d'équipe partent à un compte Discord lié OU un tag certifié
    // (`teamInviteNoticeRecipient`) ; ceux de match, au seul tag certifié.
    const fr = DONNEES_PROFIL.find((d) => d.finalite.includes("pour tes équipes"))?.finalite ?? "";
    const en = readSource("lib/shared/rgpd-policy-en.ts");
    expect(fr).toContain("demande d'adhésion à une équipe que tu gères), si ton compte Discord est lié ou ton tag certifié ;");
    expect(en).toContain("request to join a team you manage), if your Discord account is linked or your tag certified;");
  });

  it("registerT03_legalBasis_namesTheProfileBoxFrAndEn", () => {
    const fr = PROCESSING_ACTIVITIES.find((a) => a.ref === "T03")?.legalBasis ?? "";
    const en = PROCESSING_ACTIVITIES_EN.find((a) => a.ref === "T03")?.legalBasis ?? "";
    expect(fr).toContain("honoré par la case « Messages privés Discord de mes matchs et de mes équipes » de « Mon profil »");
    expect(en).toContain("honoured by the “Discord direct messages about my matches and teams” box in “My profile”");
  });

  it("botPrivacyPolicy_teamDms_objectedWithTheProfileSwitchFrAndEn", () => {
    const fr = JSON.stringify(PRIVACY_POLICY.fr);
    const en = JSON.stringify(PRIVACY_POLICY.en);
    expect(fr).toContain("la même case coupe ses messages privés d'équipe");
    expect(fr).toContain("auxquels chacun s'oppose par le même interrupteur de « Mon profil »");
    expect(en).toContain("the same box turns off their team direct messages");
    expect(en).toContain("which anyone objects to with the same switch in “My profile”");
  });

  it("profileNotificationsLead_namesMatchesAndTeamsFrAndEn", () => {
    expect(readSource("messages/fr/profile.json")).toContain("et messages privés du bot pour tes matchs et tes équipes.");
    expect(readSource("messages/en/profile.json")).toContain("and bot direct messages about your matches and teams.");
  });

  it("profileHint_messagesItSaysTheBoxDoesNotCover_neverReadTheOptOut", () => {
    // L'aide de la case cite ces messages comme indépendants d'elle : aucun ne
    // passe par l'opposition (`matchDm` ou `withoutOptedOutDiscord`).
    const optOut = /matchDm|withoutOptedOutDiscord/;
    expect(readSource("lib/server/privacy-change-notifications.ts")).not.toMatch(optOut);
    expect(readSource("lib/server/account-suspensions.ts")).not.toMatch(optOut);
    expect(readSource("lib/server/content-reports.ts")).not.toMatch(optOut);
    expect(readSource("lib/server/logo-quarantine.ts")).not.toMatch(optOut);
  });

  it("botPrivacyPolicy_teamDms_formingTeamsPurposeAndNoRequestRouteFrAndEn", () => {
    const fr = JSON.stringify(PRIVACY_POLICY.fr);
    const en = JSON.stringify(PRIVACY_POLICY.en);
    expect(fr).toContain("intérêt légitime (constitution des équipes, registre du site T03) pour les messages privés d'équipe");
    expect(fr).toContain("auxquels chacun s'oppose par le même interrupteur de « Mon profil » ; exécution du service");
    expect(en).toContain("legitimate interest (forming teams, the website's register T03) for team direct messages");
    expect(en).toContain("which anyone objects to with the same switch in “My profile”; performance of the service");
  });

  it("droitsOpposition_teamDmList_parenthesisedSoTheAsideStaysPairedFrAndEn", () => {
    const fr = DROITS.find((d) => d.title === "Droit d'opposition")?.text ?? "";
    const en = DROITS_EN.find((d) => d.title === "Right to object")?.text ?? "";
    expect(fr).toContain("demande d'adhésion à une équipe que vous gérez) — ces messages privés de match et d'équipe se coupent directement");
    expect(en).toContain("request to join a team you manage) — these match and team direct messages are turned off directly");
  });
});
