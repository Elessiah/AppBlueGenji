import { describe, expect, it } from "@jest/globals";
import { PRIVACY_CHANGES } from "@/lib/shared/privacy-changes";
import { PRIVACY_CHANGES_EN } from "@/lib/shared/privacy-changes-en";
import { PROCESSING_ACTIVITIES, PROCESSING_ACTIVITIES_EN, REGISTER_UPDATED_AT } from "@/lib/shared/processing-register";
import { readSource } from "../../helpers/read-source";

/**
 * « Vue joueur » (`docs/features/ADMIN_PLAYER_VIEW.md`, § RGPD) : la bascule
 * d'un titulaire de rôle de plateforme — développeur compris, qui n'est pas du
 * staff — est déclarée dans l'historique, le registre (T01, T05) et `/rgpd`.
 */
const ENTRY_ID = "2026-11-vue-joueur-du-staff";

const frEntry = () => PRIVACY_CHANGES.find((change) => change.id === ENTRY_ID);
const enEntry = () => PRIVACY_CHANGES_EN[ENTRY_ID];

function activity(list: typeof PROCESSING_ACTIVITIES, ref: string) {
  const found = list.find((entry) => entry.ref === ref);
  if (!found) throw new Error(`activité ${ref} absente`);
  return found;
}

/** Le `<p>` d'une langue qui contient `marker`, espaces écrasés. */
function paragraphAround(path: string, marker: string): string {
  const source = readSource(path);
  const at = source.indexOf(marker);
  if (at < 0) throw new Error(`« ${marker} » absent de ${path}`);
  const start = source.lastIndexOf("<p", at);
  return source.slice(start, source.indexOf("</p>", at)).replace(/\s+/g, " ");
}

describe("historique des changements", () => {
  it("privacyChanges_playerViewEntry_followedByPlanningAndDated", () => {
    expect(PRIVACY_CHANGES.at(-2)?.id).toBe(ENTRY_ID);
    // Suivie du planning des casts et arbitres (CAST-PLANNING, 2026-11-21).
    expect(PRIVACY_CHANGES.at(-1)?.id).toBe("2026-11-planning-casts-arbitres");
    expect(frEntry()?.publishedAt).toBe("2026-11-20");
    expect(REGISTER_UPDATED_AT >= "2026-11-20").toBe(true);
    expect(frEntry()?.audience).toBeUndefined();
    expect(frEntry()?.asksTermsAcceptance).toBeUndefined();
  });

  it("privacyChanges_playerViewEntry_hasEnglishWithSameShape", () => {
    expect(enEntry()?.details).toHaveLength(frEntry()?.details.length ?? -1);
    expect(enEntry()?.linkLabels).toHaveLength(1);
    expect(frEntry()?.links?.[0]?.href).toBe("/rgpd/registre#t05");
  });

  it("privacyChanges_playerViewEntry_namesDevelopersCapAndPm2LineInBothLanguages", () => {
    const fr = JSON.stringify(frEntry());
    const en = JSON.stringify(enEntry());

    expect(fr).toContain("membre du staff ou développeur");
    expect(fr).toContain("12 heures au plus");
    expect(fr).toContain("le pseudo et l'identifiant de son auteur");
    expect(fr).toContain("intérêt légitime");
    expect(en).toContain("staff member or developer");
    expect(en).toContain("12 hours at most");
    expect(en).toContain("the username and identifier of its author");
    expect(en).toContain("legitimate interest");
  });
});

describe("registre", () => {
  it("register_t01_describesSessionDeadlineInBothLanguages", () => {
    const fr = JSON.stringify(activity(PROCESSING_ACTIVITIES, "T01").dataCategories);
    const en = JSON.stringify(activity(PROCESSING_ACTIVITIES_EN, "T01").dataCategories);

    expect(fr).toContain("échéance de la « vue joueur » (12 heures au plus");
    expect(fr).toContain("une échéance passée reste sur la session, sans effet), effacée avec la session");
    expect(en).toContain("deadline of the “player view” (12 hours at most");
    expect(en).toContain("a past deadline stays on the session, with no effect), erased with the session");
  });

  it("register_t05_coversDevelopersBasisSubjectsAndCategoriesInBothLanguages", () => {
    const fr = activity(PROCESSING_ACTIVITIES, "T05");
    const en = activity(PROCESSING_ACTIVITIES_EN, "T05");

    expect(JSON.stringify(fr.subPurposes)).toContain("(membre du staff ou développeur) suspend ses droits");
    expect(JSON.stringify(fr.subPurposes)).toContain("une ligne à chaque bascule (activée ou quittée) qui nomme son auteur");
    expect(JSON.stringify(fr.legalBasis)).toContain("du titulaire d'un rôle de plateforme qui passe en vue joueur ou en revient");
    expect(JSON.stringify(fr.dataSubjects)).toContain("Développeurs (rôle de plateforme, hors staff)");
    expect(JSON.stringify(fr.dataCategories)).toContain("pour une vue joueur activée ou quittée : pseudo et identifiant de son auteur");
    expect(JSON.stringify(en.subPurposes)).toContain("(staff member or developer) suspends its rights");
    expect(JSON.stringify(en.legalBasis)).toContain("the holder of a platform role who switches into or out of player view");
    expect(JSON.stringify(en.dataSubjects)).toContain("Developers (platform role, not staff)");
    expect(JSON.stringify(en.dataCategories)).toContain("for a player view switched on or off: username and identifier of its author");
  });
});

describe("/rgpd", () => {
  it("rgpdFr_staffLogsParagraph_describesPlayerViewSwitch", () => {
    const paragraph = paragraphAround("app/rgpd/page.tsx", "Un compte qui porte un rôle de plateforme (développeur compris)");

    expect(paragraph).toContain("{PLAYER_VIEW_MAX_HOURS} heures au plus");
    expect(paragraph).toContain("son pseudo, son identifiant et le sens de la bascule");
    expect(paragraph).toContain("intérêt légitime");
    expect(paragraph).toContain('href="/rgpd/registre#t05"');
  });

  it("rgpdEn_staffLogsParagraph_describesPlayerViewSwitch", () => {
    const paragraph = paragraphAround("app/rgpd/RgpdEn.tsx", "An account holding a platform role (developer included)");

    expect(paragraph).toContain("{PLAYER_VIEW_MAX_HOURS} hours at most");
    expect(paragraph).toContain("its username, its identifier and the direction of the switch");
    expect(paragraph).toContain("legitimate interest");
    expect(paragraph).toContain('href="/rgpd/registre#t05"');
  });

  it("rgpdFrEn_deletionNote_coversBothDirections", () => {
    expect(readSource("app/rgpd/page.tsx")).toContain("ses bascules vers et depuis la vue joueur");
    expect(readSource("app/rgpd/RgpdEn.tsx")).toContain("their switches into and out of player view");
  });
});
