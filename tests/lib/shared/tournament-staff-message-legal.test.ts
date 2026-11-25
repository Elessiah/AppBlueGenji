import { describe, expect, it } from "@jest/globals";
import { PRIVACY_POLICY } from "@/lib/shared/bot-legal-content";
import { PRIVACY_CHANGES } from "@/lib/shared/privacy-changes";
import { PRIVACY_CHANGES_EN } from "@/lib/shared/privacy-changes-en";
import { PROCESSING_ACTIVITIES, PROCESSING_ACTIVITIES_EN, type ProcessingActivity } from "@/lib/shared/processing-register";
import { readSource } from "../../helpers/read-source";

/**
 * TOURNAMENT-DM, cycle juridique : la ligne du journal du staff (T05, un an),
 * le plafond d'appels en mémoire, ce que voit l'auteur, qui peut lancer la
 * commande et la durée réelle du panneau du bot sont déclarés, en français et
 * en anglais (registre, politique du bot, PRIVACY_CHANGES, /rgpd anglais — le
 * français de /rgpd et du registre est figé par `tests/fixtures/legal-fr/`).
 */
const ENTRY_ID = "2026-11-message-du-staff-tournoi";

function activity(list: readonly ProcessingActivity[], ref: string): ProcessingActivity {
  const found = list.find((a) => a.ref === ref);
  if (!found) throw new Error(`fiche ${ref} absente`);
  return found;
}

const t04 = activity(PROCESSING_ACTIVITIES, "T04");
const t04En = activity(PROCESSING_ACTIVITIES_EN, "T04");
const t05 = activity(PROCESSING_ACTIVITIES, "T05");
const t05En = activity(PROCESSING_ACTIVITIES_EN, "T05");
const t08 = activity(PROCESSING_ACTIVITIES, "T08");
const t08En = activity(PROCESSING_ACTIVITIES_EN, "T08");

describe("registre : message du staff d'un tournoi", () => {
  it("registerT05_staffMessageLine_declaredFrEn", () => {
    expect(t05.subPurposes.join(" ")).toContain(
      "Message du staff d'un tournoi à ses participants : une ligne par envoi",
    );
    expect(t05.subPurposes.join(" ")).toContain("sans nommer son auteur ni citer le texte");
    expect(t05En.subPurposes.join(" ")).toContain("Tournament staff message to its participants: one line per sending");
    expect(t05En.subPurposes.join(" ")).toContain("without naming its author or quoting the text");
    expect(t05.dataCategories.join(" ")).toContain(
      "pour un message du staff d'un tournoi à ses participants : pseudo et identifiant de son auteur, la ligne du journal du staff, le numéro du tournoi et la longueur du texte, jamais le texte",
    );
    expect(t05En.dataCategories.join(" ")).toContain(
      "for a tournament staff message to its participants: username and identifier of its author, the staff log line, the tournament number and the length of the text, never the text",
    );
  });

  it("registerT04Retention_staffLogOneYearAndCallCap_declaredFrEn", () => {
    const fr = t04.retention.join(" ");
    const en = t04En.retention.join(" ");

    expect(fr).toContain("gardé selon la durée de ce journal (un an, traitement T05)");
    expect(fr).toContain("onze minutes au plus après son premier appel de la fenêtre");
    expect(en).toContain("kept for that log's duration (one year, processing activity T05)");
    expect(en).toContain("eleven minutes at most after its first call of the window");
  });

  it("registerT04DataCategories_inMemoryCallCap_declaredFrEn", () => {
    expect(t04.dataCategories.join(" ")).toContain(
      "en mémoire seulement, pour plafonner les appels, l'identifiant Discord de qui lance la commande ou le numéro du compte de l'auteur sur le site",
    );
    expect(t04En.dataCategories.join(" ")).toContain(
      "in memory only, to cap the calls, the Discord identifier of whoever runs the command or the author's account number on the site",
    );
  });

  it("registerT04Recipients_authorSeesOnlyCounts_declaredFrEn", () => {
    expect(t04.recipients.join(" ")).toContain(
      "l'auteur ne voit que des nombres (visés, joignables en message privé, sans Discord, sujet coupé), jamais leurs noms",
    );
    expect(t04En.recipients.join(" ")).toContain(
      "the author only sees numbers (targeted, reachable by direct message, without Discord, topic turned off), never their names",
    );
  });

  it("registerT04_authorAndAnyCaller_coveredByBasisAndSubjectsFrEn", () => {
    expect(t04.legalBasis).toContain("à l'égard de l'auteur du message et de quiconque lance /message-tournoi");
    expect(t04En.legalBasis).toContain("with regard to the author of the message and to anyone who runs /message-tournoi");
    expect(t04.dataSubjects.join(" ")).toContain("quiconque lance la commande /message-tournoi (refusé par le site");
    expect(t04En.dataSubjects.join(" ")).toContain("anyone who runs the /message-tournoi command (refused by the site");
  });

  it("registerT08_messageTournoi_forwardRefusalPreviewTenMinutesFrEn", () => {
    const fr = [...t08.subPurposes, ...t08.dataCategories, ...t08.retention].join(" ");
    const en = [...t08En.subPurposes, ...t08En.dataCategories, ...t08En.retention].join(" ");

    expect(fr).toContain("pour qui la lance (le site refuse qui n'a pas de compte rattaché ayant la permission de gérer les tournois)");
    expect(fr).toContain("se ferme au plus tard dix minutes après la commande");
    expect(fr).not.toContain("cinq minutes au plus");
    expect(en).toContain("for whoever runs it (the site refuses anyone without a linked account holding the permission to manage tournaments)");
    expect(en).toContain("closes at the latest ten minutes after the command");
    expect(en).not.toContain("five minutes at most");
  });
});

describe("politique de confidentialité du bot : /message-tournoi", () => {
  it("botPrivacyPolicy_messageTournoi_anyCallerNeverANameTenMinutesFrEn", () => {
    const fr = JSON.stringify(PRIVACY_POLICY.fr);
    const en = JSON.stringify(PRIVACY_POLICY.en);

    expect(fr).toContain("Quand quelqu'un utilise **/message-tournoi**, réservée au staff des tournois du site");
    expect(fr).toContain("que des nombres (destinataires, messages remis), jamais un nom");
    expect(fr).toContain("au plus tard dix minutes après la commande");
    expect(fr).not.toContain("cinq minutes après la commande");
    expect(en).toContain("When someone uses **/message-tournoi**, reserved for the website's tournament staff");
    expect(en).toContain("only returns numbers (recipients, messages delivered), never a name");
    expect(en).toContain("at the latest ten minutes after the command");
    expect(en).not.toContain("five minutes after the command");
  });
});

describe("PRIVACY_CHANGES : message du staff d'un tournoi", () => {
  it("privacyChangeEntry_staffMessage_oneYearAndCallCapFrEn", () => {
    const fr = PRIVACY_CHANGES.find((c) => c.id === ENTRY_ID)?.details.join(" ") ?? "";
    const en = PRIVACY_CHANGES_EN[ENTRY_ID]?.details.join(" ") ?? "";

    expect(fr).toContain("noté au journal du staff sur Discord, gardé un an");
    expect(fr).toContain("en mémoire seulement, onze minutes au plus, pour plafonner les appels");
    expect(en).toContain("noted in the staff log on Discord, kept for a year");
    expect(en).toContain("in memory only, eleven minutes at most, to cap the calls");
  });
});

describe("/rgpd anglais : message du staff d'un tournoi", () => {
  it("rgpdEn_staffMessageParagraph_oneYearCountsAndT05Link", () => {
    const source = readSource("app/rgpd/RgpdEn.tsx");
    const paragraph = source.slice(source.indexOf('<p id="message-du-staff">'), source.indexOf('<p id="test-messages-prives">'));

    expect(paragraph).toContain("staff log on Discord, kept for a year");
    expect(paragraph).toContain("including how many have no Discord or turned these");
    expect(paragraph).toContain('href="/rgpd/registre#t05"');
  });
});
