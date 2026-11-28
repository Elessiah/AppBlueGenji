import { describe, expect, it } from "@jest/globals";
import { formatPlanningSoloCasterDm } from "@/lib/shared/planning-notices";
import { PRIVACY_CHANGES } from "@/lib/shared/privacy-changes";
import { PRIVACY_CHANGES_EN } from "@/lib/shared/privacy-changes-en";
import { PROCESSING_ACTIVITIES, PROCESSING_ACTIVITIES_EN, REGISTER_UPDATED_AT } from "@/lib/shared/processing-register";
import { planningSoloCasterPush } from "@/lib/shared/push-messages";
import { readSource } from "../../helpers/read-source";

/**
 * NOTIFY-SOLO-REDIFF (`docs/features/CAST_PLANNING.md`, `MATCH_REPLAYS.md`) :
 * l'avis au caster autonome et la rediffusion au journal du staff, tels que
 * l'historique, le registre (T05, T20) et `/rgpd` (FR et EN) les déclarent.
 */
const ENTRY_ID = "2026-11-caster-autonome-rediff";

function frEntry() {
  const found = PRIVACY_CHANGES.find((change) => change.id === ENTRY_ID);
  if (!found) throw new Error(`entrée ${ENTRY_ID} absente`);
  return found;
}

const frText = () => [frEntry().summary, ...frEntry().details].join(" ");
const enText = () => [PRIVACY_CHANGES_EN[ENTRY_ID].summary, ...PRIVACY_CHANGES_EN[ENTRY_ID].details].join(" ");

function activity(list: typeof PROCESSING_ACTIVITIES, ref: string): string {
  const found = list.find((entry) => entry.ref === ref);
  if (!found) throw new Error(`${ref} absente`);
  return JSON.stringify(found);
}

/** Source d'une page `/rgpd`, espaces écrasés. */
const page = (path: string) => readSource(path).replace(/\s+/g, " ");
const FR_PAGE = "app/rgpd/page.tsx";
const EN_PAGE = "app/rgpd/RgpdEn.tsx";

describe("historique des changements — caster autonome et rediffusions", () => {
  it("soloRediffEntry_beforeProdEntry_datedWithRegisterAndStaffAudience", () => {
    expect(PRIVACY_CHANGES.at(-6)?.id).toBe(ENTRY_ID);
    expect(frEntry().publishedAt).toBe("2026-11-21");
    expect(REGISTER_UPDATED_AT >= "2026-11-21").toBe(true);
    expect(frEntry().audience).toBe("LIVE_STAFF");
    expect(frEntry().asksTermsAcceptance).toBeUndefined();
  });

  it("soloRediffEntry_english_sameShape", () => {
    expect(PRIVACY_CHANGES_EN[ENTRY_ID].details).toHaveLength(frEntry().details.length);
    expect(PRIVACY_CHANGES_EN[ENTRY_ID].linkLabels).toHaveLength(frEntry().links?.length ?? -1);
  });

  it("soloRediffEntry_casterNotice_statesChannelConditions", () => {
    expect(frText()).toContain("en message privé Discord (seulement si son tag Discord est certifié) et en notification push (sur ses appareils abonnés)");
    expect(enText()).toContain("by Discord direct message (only if their Discord tag is certified) and push notification (on their subscribed devices)");
  });

  it("soloRediffEntry_logs_staffLogAndAccountConcerned", () => {
    expect(frText()).toContain("tous deux au journal du staff ; les journaux du serveur gardent leur auteur et, pour le statut, le compte visé");
    expect(enText()).toContain("both in the staff log; the server logs keep their author and, for the status, the account concerned");
    expect(frText()).not.toContain("journal d'arbitrage");
    expect(enText()).not.toContain("refereeing log");
  });
});

describe("/rgpd — caster autonome et rediffusions", () => {
  it("rgpdT05Paragraph_replay_staffLogPublicVideoAndAccountConcerned", () => {
    expect(page(FR_PAGE)).toContain("Une rediffusion posée, changée ou retirée est notée au journal du staff sur Discord");
    expect(page(FR_PAGE)).toContain("le lien de la vidéo, publique, qui montre la chaîne qui l&apos;a diffusée) sans nommer son auteur");
    expect(page(FR_PAGE)).toContain("l&apos;auteur de ces deux gestes et, pour le second, le compte visé");
    expect(page(EN_PAGE)).toContain("A replay set, changed or removed is noted in the staff log on Discord");
    expect(page(EN_PAGE)).toContain("the link to the video, which is public and shows the channel that streamed it) without naming its author");
    expect(page(EN_PAGE)).toContain("the author of both actions and, for the second, the account concerned");
  });

  it("rgpdPushParagraph_casterTopics_includeSoloCasterStatus", () => {
    expect(page(FR_PAGE)).toContain("sur ses créneaux confirmés, et, caster, son statut de caster autonome changé par le staff)");
    expect(page(EN_PAGE)).toContain("on their confirmed slots, and, for a caster, their solo caster status changed by the staff)");
  });

  it("rgpdPlanningParagraph_dmList_includesSoloCasterNotice", () => {
    expect(page(FR_PAGE)).toContain("confirmée, un caster aussi de son statut de caster autonome changé par le staff ;");
    expect(page(EN_PAGE)).toContain("is confirmed, a caster also of their solo caster status changed by the staff;");
  });

  it("suspensionClauses_withheldNotices_includeSoloCasterStatus", () => {
    expect(page(FR_PAGE)).toContain("diffusions perdues, statut de caster autonome) et ne peut plus y être dit caster autonome");
    expect(page(EN_PAGE)).toContain("lost streams, solo caster status) and can no longer be made a solo caster");
  });
});

describe("registre — T05 et T20", () => {
  it("registerT20_notifyPurpose_includesSoloCasterNotice", () => {
    expect(activity(PROCESSING_ACTIVITIES, "T20")).toContain("et un caster de son statut de caster autonome changé par le staff ; prévenir le staff des tournois");
    expect(activity(PROCESSING_ACTIVITIES_EN, "T20")).toContain("and a caster of their solo caster status changed by the staff; notifying the tournament staff");
  });

  it("registerSuspension_withheldNotices_includeSoloCasterStatus", () => {
    const fr = PROCESSING_ACTIVITIES.map((entry) => JSON.stringify(entry)).join(" ");
    const en = PROCESSING_ACTIVITIES_EN.map((entry) => JSON.stringify(entry)).join(" ");
    expect(fr).toContain("places à pourvoir, diffusions perdues, statut de caster autonome) et ne peut plus y être dit caster autonome");
    expect(en).toContain("open slots, lost streams, solo caster status) and can no longer be made a solo caster");
    expect(fr).not.toContain("diffusions perdues) et ne peut plus");
  });

  it("registerT05_replayLine_publicVideoAndTargetAccount", () => {
    expect(activity(PROCESSING_ACTIVITIES, "T05")).toContain("et le lien de la vidéo (publique, elle montre la chaîne qui l'a diffusée), sans nommer son auteur");
    expect(activity(PROCESSING_ACTIVITIES, "T05")).toContain("et, pour le second, l'identifiant du compte visé");
    expect(activity(PROCESSING_ACTIVITIES_EN, "T05")).toContain("and the link to the video (public, it shows the channel that streamed it), without naming its author");
    expect(activity(PROCESSING_ACTIVITIES_EN, "T05")).toContain("and, for the second, the identifier of the account concerned");
  });
});

describe("avis de caster autonome coupé", () => {
  it("soloCasterOffNotice_dm_saysProdNeeded", () => {
    expect(formatPlanningSoloCasterDm(false, "https://bluegenji.test", "fr")).toContain("un prod doit désormais t'accompagner pour diffuser.");
    expect(formatPlanningSoloCasterDm(false, "https://bluegenji.test", "en")).toContain("you now need a prod to stream.");
  });

  it("soloCasterOffNotice_push_saysProdNeeded", () => {
    expect(planningSoloCasterPush(false, "fr").body).toBe("Le staff a désactivé ton statut de caster autonome : un prod doit désormais t'accompagner pour diffuser.");
    expect(planningSoloCasterPush(false, "en").body).toBe("The staff turned off your solo caster status: you now need a prod to stream.");
  });
});
