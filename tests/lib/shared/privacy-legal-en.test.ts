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
