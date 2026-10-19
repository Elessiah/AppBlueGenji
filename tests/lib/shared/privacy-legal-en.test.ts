/**
 * Lot 7b-2 : parité de la traduction anglaise de la politique de
 * confidentialité, du registre et des changements publiés avec leur français,
 * qui fait foi (`docs/features/I18N.md` § Textes légaux du site). Chaque
 * élément français a son anglais, au même rang, avec les mêmes nombres
 * (durées, âges, articles) : une durée changée d'un seul côté échoue ici.
 */
import { describe, expect, it } from "@jest/globals";
import { AUDIENCE_OPT_OUT_TEXT_FR } from "@/components/privacy/AudienceOptOutControl";
import { messagesFor } from "@/lib/server/i18n-messages";
import { STREAM_NOTICE_LIVE_EN } from "@/lib/shared/legal-text-en";
import {
  PRIVACY_CHANGES,
  formatPrivacyChangeDate,
  formatPrivacyChangeDateIn,
  privacyChangesHeading,
  privacyPolicyUpdatedLabel,
  privacyPolicyUpdatedLabelIn,
} from "@/lib/shared/privacy-changes";
import { PRIVACY_CHANGES_EN, localizedPrivacyChanges } from "@/lib/shared/privacy-changes-en";
import {
  ALL_TRANSFER_RECIPIENTS,
  PROCESSING_ACTIVITIES,
  TRANSFER_RECIPIENTS,
  registerController,
  type ProcessingActivity,
} from "@/lib/shared/processing-register";
import { PROCESSING_ACTIVITIES_EN, registerControllerEn, transferBasisEn } from "@/lib/shared/processing-register-en";
import { TERMS_SECTIONS_EN } from "@/lib/shared/terms-of-use-en";
import {
  DONNEES_PROFIL,
  DONNEE_CONNEXIONS,
  DONNEE_SAUVEGARDES,
  DONNEE_TOURNOIS,
  DROITS,
  type DonneEntry,
} from "@/lib/shared/rgpd-policy";
import {
  DONNEES_PROFIL_EN,
  DONNEE_CONNEXIONS_EN,
  DONNEE_SAUVEGARDES_EN,
  DONNEE_TOURNOIS_EN,
  DROITS_EN,
  LEGAL_BASE_EN,
} from "@/lib/shared/rgpd-policy-en";
import { formatMessage } from "@/lib/shared/message-format";
import frShell from "@/messages/fr/shell.json";

/** Les nombres d'un texte, triés : la traduction n'en perd ni n'en invente. */
const numbers = (text: string) => (text.match(/\d+/g) ?? []).sort();

const LIST_FIELDS = ["subPurposes", "dataSubjects", "dataCategories", "retention", "recipients", "transfers", "security"] as const;
const TEXT_FIELDS = ["purpose", "legalBasis", "sensitiveData"] as const;

describe("registre des traitements : l'anglais suit le français, fiche par fiche", () => {
  it("mêmes références, dans le même ordre", () => {
    expect(PROCESSING_ACTIVITIES_EN.map((a) => a.ref)).toEqual(PROCESSING_ACTIVITIES.map((a) => a.ref));
  });

  it.each(PROCESSING_ACTIVITIES.map((activity, index) => [activity.ref, activity, index] as [string, ProcessingActivity, number]))(
    "%s : autant d'éléments par rubrique, mêmes nombres",
    (_ref, activity, index) => {
      const en = PROCESSING_ACTIVITIES_EN[index];
      for (const field of LIST_FIELDS) {
        expect([field, en[field].length]).toEqual([field, activity[field].length]);
        activity[field].forEach((item, i) => {
          expect([field, i, numbers(en[field][i])]).toEqual([field, i, numbers(item)]);
        });
      }
      for (const field of TEXT_FIELDS) {
        expect([field, numbers(en[field])]).toEqual([field, numbers(activity[field])]);
      }
    },
  );

  it("les transferts nomment les mêmes destinataires, par le même mécanisme", () => {
    const text = transferBasisEn(ALL_TRANSFER_RECIPIENTS);
    for (const recipient of ALL_TRANSFER_RECIPIENTS) expect(text).toContain(TRANSFER_RECIPIENTS[recipient].name);
    expect(text).toContain("EU-U.S. Data Privacy Framework");
    expect(transferBasisEn([])).toBe("");
  });

  it("le responsable : mêmes nom et siège, contact sans adresse en clair", () => {
    const fr = registerController();
    const en = registerControllerEn();
    expect(en.name).toBe(fr.name);
    expect(en.seat).toBe(fr.seat);
    expect(en.contact).not.toMatch(/@/);
    expect(en.dataContact).toMatch(/not a data protection officer/);
  });
});

describe("politique : tableau des données et droits", () => {
  const pairs: [DonneEntry, DonneEntry][] = [
    ...DONNEES_PROFIL.map((entry, index) => [entry, DONNEES_PROFIL_EN[index]] as [DonneEntry, DonneEntry]),
    [DONNEE_TOURNOIS, DONNEE_TOURNOIS_EN],
    [DONNEE_SAUVEGARDES, DONNEE_SAUVEGARDES_EN],
    [DONNEE_CONNEXIONS, DONNEE_CONNEXIONS_EN],
  ];

  it("une ligne anglaise par ligne française, même base légale", () => {
    expect(DONNEES_PROFIL_EN).toHaveLength(DONNEES_PROFIL.length);
    for (const [fr, en] of pairs) {
      expect([fr.donnee, en.base]).toEqual([fr.donnee, fr.base]);
      expect([fr.donnee, en.extraBases?.map((b) => b.base)]).toEqual([fr.donnee, fr.extraBases?.map((b) => b.base)]);
      expect([fr.donnee, numbers(en.finalite), numbers(en.duree)]).toEqual([fr.donnee, numbers(fr.finalite), numbers(fr.duree)]);
    }
  });

  it("chaque ligne du profil est traduite : finalité, durée et portée des bases", () => {
    DONNEES_PROFIL.forEach((fr, index) => {
      const en = DONNEES_PROFIL_EN[index];
      expect([fr.donnee, en.finalite]).not.toEqual([fr.donnee, fr.finalite]);
      expect([fr.donnee, en.duree]).not.toEqual([fr.donnee, fr.duree]);
      expect(en.extraBases?.map((b) => b.scope)).not.toEqual(fr.extraBases?.map((b) => b.scope) ?? ["__none__"]);
    });
  });

  it("chaque base légale a son anglais", () => {
    for (const [fr] of pairs) expect(LEGAL_BASE_EN[fr.base]).toBeTruthy();
  });

  it("les mêmes droits, dans le même ordre", () => {
    expect(DROITS_EN).toHaveLength(DROITS.length);
    DROITS.forEach((droit, index) => expect([index, numbers(DROITS_EN[index].text)]).toEqual([index, numbers(droit.text)]));
  });
});

describe("changements publiés : chaque entrée a son anglais", () => {
  it("aucune entrée sans traduction, aucune traduction sans entrée", () => {
    expect(Object.keys(PRIVACY_CHANGES_EN).sort()).toEqual(PRIVACY_CHANGES.map((change) => change.id).sort());
  });

  it.each(PRIVACY_CHANGES.map((change) => [change.id, change] as [string, (typeof PRIVACY_CHANGES)[number]]))(
    "%s : même nombre de détails et de liens, mêmes nombres",
    (id, change) => {
      const en = PRIVACY_CHANGES_EN[id];
      expect(en.details).toHaveLength(change.details.length);
      expect(en.linkLabels?.length ?? 0).toBe(change.links?.length ?? 0);
      expect(numbers(en.title)).toEqual(numbers(change.title));
      expect(numbers(en.summary)).toEqual(numbers(change.summary));
      change.details.forEach((detail, index) => expect([index, numbers(en.details[index])]).toEqual([index, numbers(detail)]));
    },
  );

  it("la version anglaise garde identifiant, date, public et cibles des liens", () => {
    const english = localizedPrivacyChanges(PRIVACY_CHANGES, "en");
    english.forEach((change, index) => {
      const fr = PRIVACY_CHANGES[index];
      expect([change.id, change.publishedAt, change.audience]).toEqual([fr.id, fr.publishedAt, fr.audience]);
      expect(change.links?.map((link) => link.href)).toEqual(fr.links?.map((link) => link.href));
      expect(change.title).toBe(PRIVACY_CHANGES_EN[fr.id].title);
    });
    expect(localizedPrivacyChanges(PRIVACY_CHANGES, "fr")).toEqual([...PRIVACY_CHANGES]);
  });

  it("dates et mois de mise à jour dans chaque langue, le français inchangé", () => {
    expect(formatPrivacyChangeDateIn("2026-09-23", "fr")).toBe(formatPrivacyChangeDate("2026-09-23"));
    expect(formatPrivacyChangeDateIn("2026-09-23", "en")).toBe("September 23, 2026");
    expect(privacyPolicyUpdatedLabelIn("2026-10-07", "fr")).toBe(privacyPolicyUpdatedLabel("2026-10-07"));
    expect(privacyPolicyUpdatedLabelIn("2026-10-07", "en")).toBe("October 2026");
    expect(privacyPolicyUpdatedLabelIn("2000-01-01", "en")).toBeNull();
  });
});

describe("habillage des fenêtres et contrôles : le français d'avant, en messages", () => {
  it("le titre de la fenêtre des changements reprend `privacyChangesHeading`", () => {
    for (const count of [1, 2, 25]) {
      expect(formatMessage("fr", frShell.privacyModal.heading, { count })).toBe(privacyChangesHeading(count));
    }
  });

  it("le contrôle d'opposition embarque le même français que `legal.audience`", () => {
    expect(AUDIENCE_OPT_OUT_TEXT_FR).toEqual(messagesFor("fr").legal.audience);
  });
});

describe("register (EN): #live username, match DMs, refereeing schedule basis", () => {
  const sheet = (ref: string) => PROCESSING_ACTIVITIES_EN.find((a) => a.ref === ref)!;

  it("declares the same items as the French register", () => {
    expect(sheet("T16").dataCategories.join(" ")).toMatch(/Public BlueGenji username of the players of a solo tournament, posted in the #live announcement/);
    expect(sheet("T04").subPurposes.join(" ")).toMatch(/the notice that a match leaves their schedule/);
    expect(sheet("T04").legalBasis).toMatch(/legitimate interest \(smooth running of tournaments\) remaining the basis with regard to the players and teams they mention/);
    expect(sheet("T01").retention.join(" ")).toMatch(/#live announcements of a solo tournament keep the username in the Discord channel until they are deleted on request, and the AutoMod alert for such an announcement when blocked or flagged keeps it in the moderators' alert channel until they delete it or on request \(T16\)/);
    expect(sheet("T08").subPurposes.join(" ")).toMatch(/#live channel of the association's server, with an @everyone mention \(team names or, in a solo tournament, the players' public BlueGenji username/);
    expect(sheet("T16").subPurposes.join(" ")).toMatch(/or even the Google account name for a Google account created before September 30, 2026; never the numeric Discord identifier/);
    expect(sheet("T08").retention.join(" ")).toMatch(/#live announcements: in the channel as long as it exists, even after the player's account is deleted/);
    expect(sheet("T08").retention).toHaveLength(PROCESSING_ACTIVITIES.find((x) => x.ref === "T08")!.retention.length);
    expect(sheet("T16").subPurposes.join(" ")).toMatch(/editable in My profile, with no effect on an evening message that is no longer edited/);
    expect(sheet("T16").legalBasis).toMatch(/performance of the service requested by the player \(GDPR, art\. 6\.1\.b — terms of use\) for their public username in the #live announcement of a solo tournament/);
    expect(sheet("T16").recipients.join(" ")).toMatch(/if a Discord AutoMod rule blocks or flags a #live announcement, its text \(including the public username in a solo tournament\) may reach the server's moderation alert channel/);
    expect(sheet("T16").recipients).toHaveLength(PROCESSING_ACTIVITIES.find((x) => x.ref === "T16")!.recipients.length);
    expect(sheet("T04").legalBasis).toMatch(/legitimate interest, the player's own, for keeping their choice about match direct messages/);
    expect(sheet("T04").legalBasis).toMatch(/for match time notices, the notice that a match leaves their schedule and match reminders sent to players/);
    expect(sheet("T04").dataSubjects).toContain("Any account holder, for their match direct messages choice");
    expect(sheet("T08").recipients).toHaveLength(PROCESSING_ACTIVITIES.find((x) => x.ref === "T08")!.recipients.length);
    expect(sheet("T05").legalBasis).toMatch(/sending the refereeing schedule to referees and administrators falls under performance of the service \(T04\)/);
  });
});

describe("terms of use (EN): #live announcement of a solo tournament", () => {
  it("states that the neutral name does not cover it, like the French terms", () => {
    const section = TERMS_SECTIONS_EN.find((s) => s.id === "retransmission")!;
    expect(section.paragraphs.join(" ")).toContain(STREAM_NOTICE_LIVE_EN);
    expect(STREAM_NOTICE_LIVE_EN).toMatch(/That announcement is part of the solo tournament the player registers for \(performance of the service, not legitimate interest\): the neutral name does not apply to it, and a player who does not want to be named in it does not register/);
  });
});
