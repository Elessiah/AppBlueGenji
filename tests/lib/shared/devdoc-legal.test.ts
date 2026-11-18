import { describe, expect, it } from "@jest/globals";
import { PRIVACY_CHANGES } from "@/lib/shared/privacy-changes";
import { PRIVACY_CHANGES_EN } from "@/lib/shared/privacy-changes-en";
import { PROCESSING_ACTIVITIES, PROCESSING_ACTIVITIES_EN } from "@/lib/shared/processing-register";
import { readSource } from "../../helpers/read-source";

/**
 * Rôle « développeur » (DEVDOC-PAGE) : le titre d'un rôle de plateforme est
 * public sur la fiche du joueur (rectification, registre T01 et `/rgpd`), le
 * rôle développeur n'y paraît pas.
 */
const ENTRY_ID = "2026-11-roles-de-plateforme-fiche";

const frEntry = () => PRIVACY_CHANGES.find((change) => change.id === ENTRY_ID);
const enEntry = () => PRIVACY_CHANGES_EN[ENTRY_ID];

function t01Recipients(list: typeof PROCESSING_ACTIVITIES): string {
  const found = list.find((entry) => entry.ref === "T01");
  if (!found) throw new Error("activité T01 absente");
  return JSON.stringify(found.recipients);
}

/** Le paragraphe des rôles de plateforme d'une langue : de la phrase d'attribution à la fin du `<p>`. */
function rolesParagraph(path: string, marker: string): string {
  const source = readSource(path);
  const start = source.indexOf(marker);
  return source.slice(start, source.indexOf("</p>", start)).replace(/\s+/g, " ");
}

describe("historique des changements", () => {
  it("privacyChanges_rolesEntry_isListedAndDated", () => {
    expect(frEntry()?.id).toBe(ENTRY_ID);
    expect(frEntry()?.publishedAt).toBe("2026-11-20");
    expect(frEntry()?.audience).toBeUndefined();
    expect(frEntry()?.asksTermsAcceptance).toBeUndefined();
  });

  it("privacyChanges_rolesEntry_hasEnglishWithSameShape", () => {
    expect(enEntry()?.details).toHaveLength(frEntry()?.details.length ?? -1);
    expect(enEntry()?.linkLabels).toHaveLength(1);
    expect(frEntry()?.links?.[0]?.href).toBe("/rgpd/registre#t01");
  });

  it("privacyChanges_rolesEntry_saysTitlePublicAndDevHiddenInBothLanguages", () => {
    const fr = JSON.stringify(frEntry());
    const en = JSON.stringify(enEntry());

    expect(fr).toContain("quels que soient ses réglages de visibilité");
    expect(fr).toContain("développeur, n'y paraît pas");
    expect(en).toContain("whatever their visibility settings");
    expect(en).toContain("developer, does not appear there");
  });
});

describe("registre T01", () => {
  it("register_t01_listsPublicRoleTitleWithoutDeveloperInBothLanguages", () => {
    expect(t01Recipients(PROCESSING_ACTIVITIES)).toContain(
      "titre de rôle de plateforme (administrateur, arbitre, caster, community manager, recruteur) sur la fiche du joueur",
    );
    expect(t01Recipients(PROCESSING_ACTIVITIES)).toContain("jamais le rôle développeur");
    expect(t01Recipients(PROCESSING_ACTIVITIES_EN)).toContain(
      "platform role title (administrator, referee, caster, community manager, recruiter) on the player page",
    );
    expect(t01Recipients(PROCESSING_ACTIVITIES_EN)).toContain("never the developer role");
  });
});

describe("/rgpd", () => {
  it("rgpdFr_platformRolesParagraph_mentionsPublicTitleAndDevHidden", () => {
    const paragraph = rolesParagraph("app/rgpd/page.tsx", "Quand un administrateur attribue ou retire un rôle de plateforme");

    expect(paragraph).toContain("développeur");
    expect(paragraph).toContain("comme un titre (administrateur, arbitre…) sur votre fiche de joueur");
    expect(paragraph).toContain("n&apos;y paraît pas");
    expect(paragraph).toContain('href="/rgpd/registre#t01"');
  });

  it("rgpdEn_platformRolesParagraph_mentionsPublicTitleAndDevHidden", () => {
    const paragraph = rolesParagraph("app/rgpd/RgpdEn.tsx", "When an administrator grants or removes a platform role");

    expect(paragraph).toContain("developer");
    expect(paragraph).toContain("shown as a title (administrator, referee…) on your player page");
    expect(paragraph).toContain("does not appear there");
    expect(paragraph).toContain('href="/rgpd/registre#t01"');
  });
});
