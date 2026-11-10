/**
 * Revue juridique de #560 (CAST-FOLLOWUP-REVIEW, #575) : les textes publiés
 * disaient « un administrateur », « un mode posé par le staff reste au staff »
 * et l'effacement du compte du maître devenu inéligible ; la trace du check-in
 * et sa consigne du vocal étaient décrites trop largement. Deux entrées
 * nouvelles corrigent les annonces publiées (jamais réécrites), et le
 * registre, /rgpd et l'interface disent la règle du code.
 */
import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PRIVACY_CHANGES, privacyChangeReachesAccount, type PrivacyChange } from "@/lib/shared/privacy-changes";
import { PRIVACY_CHANGES_EN } from "@/lib/shared/privacy-changes-en";
import { PROCESSING_ACTIVITIES } from "@/lib/shared/processing-register";
import { PROCESSING_ACTIVITIES_EN } from "@/lib/shared/processing-register-en";
import frActions from "@/messages/fr/tournamentActions.json";
import enActions from "@/messages/en/tournamentActions.json";
import frErrors from "@/messages/fr/tournamentErrors.json";
import enErrors from "@/messages/en/tournamentErrors.json";
import frDialogs from "@/messages/fr/tournamentDialogs.json";
import enDialogs from "@/messages/en/tournamentDialogs.json";

const LIVE_MODE_ID = "2026-11-mode-d-antenne-precisions";
const CHECK_IN_ID = "2026-11-check-in-trace-precisions";

function entry(id: string): PrivacyChange {
  const found = PRIVACY_CHANGES.find((change) => change.id === id);
  if (!found) throw new Error(`entrée ${id} absente`);
  return found;
}

function frText(change: PrivacyChange): string {
  return [change.title, change.summary, ...change.details].join(" ");
}

function enText(id: string): string {
  const english = PRIVACY_CHANGES_EN[id];
  return [english.title, english.summary, ...english.details].join(" ");
}

function activity(ref: string, lang: "fr" | "en"): string {
  const list = lang === "fr" ? PROCESSING_ACTIVITIES : PROCESSING_ACTIVITIES_EN;
  const found = list.find((a) => a.ref === ref);
  if (!found) throw new Error(`activité ${ref} absente`);
  return [...found.subPurposes, ...found.dataCategories, ...found.retention].join(" ");
}

const source = (file: string) => readFileSync(join(__dirname, "..", "..", "..", file), "utf8").replace(/\s+/g, " ");

describe("entrée « mode d'antenne : précisions »", () => {
  it("privacyChanges_liveModeClarifications_standaloneLiveStaffEntryFrAndEn", () => {
    const change = entry(LIVE_MODE_ID);
    const index = PRIVACY_CHANGES.indexOf(change);

    expect(PRIVACY_CHANGES[index - 1].id).toBe("2026-11-lien-de-l-organisation-hors-du-cast");
    expect([change.publishedAt, change.audience, change.asksTermsAcceptance]).toEqual(["2026-11-11", "LIVE_STAFF", undefined]);
    expect(change.links).toEqual([{ href: "/rgpd#retransmission", label: "Lire le paragraphe « Retransmission des matchs »" }]);
    expect(PRIVACY_CHANGES_EN[LIVE_MODE_ID].details).toHaveLength(change.details.length);
    expect(frText(change)).toContain("à la fois la permission d'arbitrage et celle de diffusion, administrateur ou non");
    expect(frText(change)).toContain("un caster du match qui le change en devient le maître");
    expect(frText(change)).toContain("ou, avant le lancement, ne remplit plus la condition");
    expect(frText(change)).toContain("Une fois le match lancé, le caster reste inscrit et garde le mode");
    expect(frText(change)).toContain("quand le dernier caster quitte le match sans qu'aucun stream reste");
    expect(enText(LIVE_MODE_ID)).toContain("both the refereeing and the streaming permissions, administrator or not");
    expect(enText(LIVE_MODE_ID)).toContain("a caster of the match who changes it becomes its holder");
    expect(enText(LIVE_MODE_ID)).toContain("Before launch, a caster who no longer meets the requirements is no longer treated as the holder");
    expect(enText(LIVE_MODE_ID)).toContain("the caster stays registered and keeps the mode");
    expect(enText(LIVE_MODE_ID)).toContain("when the last caster leaves");
  });

  it("privacyChanges_liveModeClarifications_reachesOnlyLiveStaff", () => {
    const change = entry(LIVE_MODE_ID);

    expect(privacyChangeReachesAccount(change, {})).toBe(false);
    expect(privacyChangeReachesAccount(change, { liveStaff: true })).toBe(true);
  });
});

describe("entrée « check-in : trace et consigne du vocal »", () => {
  it("privacyChanges_checkInRecordClarifications_followsLiveModeEntryForAllAccountsFrAndEn", () => {
    const change = entry(CHECK_IN_ID);
    const index = PRIVACY_CHANGES.indexOf(change);

    // Datées de la mise en ligne du 11 novembre 2026, avant les entrées du 12.
    expect(PRIVACY_CHANGES[index - 1].id).toBe(LIVE_MODE_ID);
    expect(PRIVACY_CHANGES[index + 1].id).toBe("2026-11-empreinte-avatar-supprime");
    expect([change.publishedAt, change.audience, change.asksTermsAcceptance]).toEqual(["2026-11-11", undefined, undefined]);
    expect(change.links?.map((link) => link.href)).toEqual(["/rgpd#messages-de-match"]);
    expect(privacyChangeReachesAccount(change, {})).toBe(true);
    expect(PRIVACY_CHANGES_EN[CHECK_IN_ID].details).toHaveLength(change.details.length);
    expect(frText(change)).toContain("l'engagée et la date de l'envoi");
    expect(frText(change)).toContain("quand le tableau à élimination de la phase (ou du tournoi) est reconstruit parce que le nombre d'engagées a changé");
    expect(frText(change)).toContain("Un retour arrière, lui, la garde.");
    expect(frText(change)).toContain("que dans un tournoi qui a l'option « Salons vocaux d'équipe »");
    expect(enText(CHECK_IN_ID)).toContain("the entrant and the date it was sent");
    expect(enText(CHECK_IN_ID)).toContain("is rebuilt because the number of entrants changed");
    expect(enText(CHECK_IN_ID)).toContain("A rollback, however, keeps it.");
    expect(enText(CHECK_IN_ID)).toContain("in a tournament with the “Team voice channels” option");
  });
});

describe("registre des traitements", () => {
  it("processingRegister_t16_liveModeHolderAndStaffPermissionsFrAndEn", () => {
    const fr = activity("T16", "fr");
    const en = activity("T16", "en");

    expect(fr).toContain("le staff qui a à la fois la permission d'arbitrage et celle de diffusion");
    expect(fr).toContain("ou qui change un mode sans maître — en devient le maître");
    expect(fr).toContain("avant le lancement, un caster qui ne remplit plus la condition n'est plus tenu pour le maître");
    expect(fr).toContain("y compris après le lancement, même s'il ne remplit plus la condition");
    expect(fr).toContain("il part aussi quand le dernier caster quitte le match sans qu'aucun stream reste");
    expect(fr).not.toContain("un administrateur le changent");
    expect(fr).not.toContain("un mode posé par le staff reste au staff");
    expect(en).toContain("the staff who hold both the refereeing and the streaming permissions");
    expect(en).toContain("or who changes a mode with no holder — becomes its holder");
    expect(en).toContain("including after launch, even if they no longer meet the requirements");
    expect(en).toContain("when the last caster leaves");
    expect(en).not.toContain("an administrator change");
    expect(en).not.toContain("a mode set by the staff stays with the staff");
  });

  it("processingRegister_t04_checkInRecordAndConditionalVoiceFrAndEn", () => {
    const fr = activity("T04", "fr");
    const en = activity("T04", "en");

    expect(fr).toContain("l'engagée et la date de l'envoi) : conservées avec le tournoi");
    expect(fr).toContain("est reconstruit parce que le nombre d'engagées a changé");
    expect(fr).toContain("salon vocal de son équipe (dans un tournoi qui a l'option « Salons vocaux d'équipe »");
    expect(en).toContain("the entrant and the date it was sent): kept with the tournament");
    expect(en).toContain("is rebuilt because the number of entrants changed");
    expect(en).toContain("voice channel (in a tournament with the “Team voice channels” option");
  });
});

describe("/rgpd", () => {
  it("rgpdPage_liveModeAndCheckInVoice_frAndEn", () => {
    const fr = source("app/rgpd/page.tsx");
    const en = source("app/rgpd/RgpdEn.tsx");

    expect(fr).toContain("le staff qui a à la fois la permission d&apos;arbitrage et celle de diffusion");
    expect(fr).toContain("un caster qui ne remplit plus la condition n&apos;est plus tenu pour le maître");
    expect(fr).toContain("ou après le lancement, même s&apos;il ne remplit plus la condition");
    expect(fr).toContain("il part aussi quand le dernier caster quitte le match");
    expect(fr).toContain("jamais en tournoi individuel ni contre une équipe fantôme");
    expect(fr).toContain("appartient au caster du match qui le pose, ou qui change un mode sans maître");
    expect(fr).toContain("rejoindre le salon vocal de votre équipe — dans un tournoi qui a l&apos;option « Salons vocaux d&apos;équipe »");
    expect(fr).not.toContain("un mode posé par le staff reste au staff");
    expect(en).toContain("the staff who hold both the refereeing and the streaming permissions");
    expect(en).toContain("a caster who no longer meets the requirements is no longer treated as the holder");
    expect(en).toContain("or after launch, even if they no longer meet the requirements");
    expect(en).toContain("it also goes when the last caster leaves the match");
    expect(en).toContain("joining your team&apos;s voice channel — in a tournament with the “Team voice channels” option");
    expect(en).not.toContain("a mode set by the staff stays with the staff");
  });
});

describe("interface : le mode d'antenne verrouillé", () => {
  it("liveModeUiTexts_noAdminWording_frAndEn", () => {
    const fr = [frActions.cardActions.castSettings.triggerLockedHint, frErrors.codes.LIVE_TRIGGER_NOT_OWNED, frDialogs.live.urlLocked];
    const en = [enActions.cardActions.castSettings.triggerLockedHint, enErrors.codes.LIVE_TRIGGER_NOT_OWNED, enDialogs.live.urlLocked];

    for (const text of fr) expect(text).toContain("le staff (arbitrage et diffusion)");
    for (const text of en) expect(text).toContain("staff with refereeing and streaming permissions");
    expect(fr[0]).toContain("les casters du match aussi le changent quand aucun caster ne le tient");
    expect(en[0]).toContain("the match's casters can also change it when no caster holds it");
    expect(fr[2]).toContain("le mode du caster qui le tient");
    expect([...fr, ...en].join(" ")).not.toMatch(/\badmin\b/);
  });
});
