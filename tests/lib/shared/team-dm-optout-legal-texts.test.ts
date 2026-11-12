import { describe, expect, it } from "@jest/globals";
import { PRIVACY_POLICY } from "@/lib/shared/bot-legal-content";
import { PRIVACY_CHANGES } from "@/lib/shared/privacy-changes";
import { PRIVACY_CHANGES_EN } from "@/lib/shared/privacy-changes-en";
import { PROCESSING_ACTIVITIES, PROCESSING_ACTIVITIES_EN } from "@/lib/shared/processing-register";
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
    expect(PRIVACY_CHANGES.at(-1)?.id).toBe(ENTRY_ID);
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
});
