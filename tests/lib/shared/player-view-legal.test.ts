import { describe, expect, it } from "@jest/globals";
import { PRIVACY_CHANGES } from "@/lib/shared/privacy-changes";
import { PRIVACY_CHANGES_EN } from "@/lib/shared/privacy-changes-en";
import { PROCESSING_ACTIVITIES, PROCESSING_ACTIVITIES_EN, REGISTER_UPDATED_AT } from "@/lib/shared/processing-register";
import { readSource } from "../../helpers/read-source";

/**
 * « Incarner un rôle » (`docs/features/ADMIN_ROLE_IMPERSONATION.md`, § RGPD) :
 * la bascule d'un administrateur vers les rôles qu'il choisit — et, avant
 * elle, la vue joueur de tout titulaire d'un rôle de plateforme — est
 * déclarée dans l'historique, le registre (T01, T05) et `/rgpd`.
 */
const LEGACY_ID = "2026-11-vue-joueur-du-staff";
const ENTRY_ID = "2026-11-incarner-un-role";

const entryFr = (id: string) => PRIVACY_CHANGES.find((change) => change.id === id);
const entryEn = (id: string) => PRIVACY_CHANGES_EN[id];

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

describe("historique des changements — vue joueur (2026-11-20)", () => {
  it("privacyChanges_legacyEntry_keptBeforeThePlanningEntries", () => {
    expect(PRIVACY_CHANGES.at(-9)?.id).toBe(LEGACY_ID);
    expect(PRIVACY_CHANGES.at(-8)?.id).toBe("2026-11-planning-casts-arbitres");
    expect(PRIVACY_CHANGES.at(-7)?.id).toBe("2026-11-planning-notifications-desistements");
    expect(entryFr(LEGACY_ID)?.publishedAt).toBe("2026-11-20");
  });

  it("privacyChanges_legacyEntry_keepsItsHistoricalTextInBothLanguages", () => {
    const fr = JSON.stringify(entryFr(LEGACY_ID));
    const en = JSON.stringify(entryEn(LEGACY_ID));

    expect(fr).toContain("membre du staff ou développeur");
    expect(fr).toContain("12 heures au plus");
    expect(en).toContain("staff member or developer");
    expect(en).toContain("12 hours at most");
    expect(entryEn(LEGACY_ID)?.details).toHaveLength(entryFr(LEGACY_ID)?.details.length ?? -1);
  });
});

describe("historique des changements — incarner un rôle", () => {
  it("privacyChanges_impersonateEntry_followedByGuestsAndDated", () => {
    expect(PRIVACY_CHANGES.at(-5)?.id).toBe(ENTRY_ID);
    // Suivie des invités du planning (PLANNING-GUESTS, 2026-11-22), puis du
    // caster autonome et des rediffusions au journal (NOTIFY-SOLO-REDIFF).
    expect(PRIVACY_CHANGES.at(-4)?.id).toBe("2026-11-planning-invites");
    expect(PRIVACY_CHANGES.at(-3)?.id).toBe("2026-11-caster-autonome-rediff");
    expect(entryFr(ENTRY_ID)?.publishedAt).toBe("2026-11-21");
    expect(REGISTER_UPDATED_AT >= "2026-11-21").toBe(true);
    expect(entryFr(ENTRY_ID)?.audience).toBeUndefined();
    expect(entryFr(ENTRY_ID)?.asksTermsAcceptance).toBeUndefined();
  });

  it("privacyChanges_impersonateEntry_hasEnglishWithSameShape", () => {
    expect(entryEn(ENTRY_ID)?.details).toHaveLength(entryFr(ENTRY_ID)?.details.length ?? -1);
    expect(entryEn(ENTRY_ID)?.linkLabels).toHaveLength(entryFr(ENTRY_ID)?.links?.length ?? -1);
  });

  it("privacyChanges_impersonateEntry_linksT01AndT05", () => {
    expect(entryFr(ENTRY_ID)?.links?.map((link) => link.href)).toEqual(["/rgpd/registre#t01", "/rgpd/registre#t05"]);
    expect(entryEn(ENTRY_ID)?.linkLabels).toEqual(["Read record T01 of the register", "Read record T05 of the register"]);
  });

  it("privacyChanges_impersonateEntry_erasedOnReturnBeforeDeadlineOtherwiseWithSession", () => {
    expect(entryFr(ENTRY_ID)?.details[0]).toContain("effacés au retour fait avant l'échéance, sinon au plus tard avec la session");
    expect(entryEn(ENTRY_ID)?.details[0]).toContain("erased on a return made before the deadline, otherwise at the latest with the session");
  });

  it("privacyChanges_impersonateEntry_namesAdminsRolesCapAndBasisInBothLanguages", () => {
    const fr = JSON.stringify(entryFr(ENTRY_ID));
    const en = JSON.stringify(entryEn(ENTRY_ID));

    expect(fr).toContain("Seul un administrateur");
    expect(fr).toContain("12 heures au plus");
    expect(fr).toContain("les rôles incarnés");
    expect(fr).toContain("intérêt légitime");
    expect(en).toContain("Only an administrator");
    expect(en).toContain("12 hours at most");
    expect(en).toContain("the roles impersonated");
    expect(en).toContain("legitimate interest");
  });

  it("privacyChanges_impersonateEntry_summaryPutsRolesOnTheEntryOnly", () => {
    expect(entryFr(ENTRY_ID)?.summary).toContain("l'entrée avec les rôles incarnés");
    expect(entryFr(ENTRY_ID)?.summary).not.toContain("à son nom et avec les rôles incarnés");
    expect(entryEn(ENTRY_ID)?.summary).toContain("the entry with the roles impersonated");
    expect(entryEn(ENTRY_ID)?.summary).not.toContain("under their name and with the roles impersonated");
  });

  it("privacyChanges_impersonateEntry_noStartupSweepMechanics", () => {
    const fr = JSON.stringify(entryFr(ENTRY_ID));
    const en = JSON.stringify(entryEn(ENTRY_ID));

    expect(fr).not.toContain("démarrage");
    expect(fr).not.toContain("ligne sans nom");
    expect(en).not.toContain("next start");
    expect(en).not.toContain("naming no one");
  });

  it("privacyChanges_impersonateEntry_forcedReturnMayNameRemoverWithAccountAndSessionCount", () => {
    expect(entryFr(ENTRY_ID)?.details[0]).toContain("peut nommer l'administrateur qui l'a retirée, avec l'identifiant du compte et le nombre de sessions");
    expect(entryEn(ENTRY_ID)?.details[0]).toContain("may name the administrator who removed it, with the identifier of the account and the number of sessions");
  });

  it("privacyChanges_impersonateEntry_maintenanceCommentListsT20", () => {
    expect(readSource("lib/shared/privacy-changes.ts")).toContain("Registre T01, T05 et T20");
  });
});

describe("registre", () => {
  it("register_t01_describesImpersonationOnTheSessionInBothLanguages", () => {
    const fr = JSON.stringify(activity(PROCESSING_ACTIVITIES, "T01").dataCategories);
    const en = JSON.stringify(activity(PROCESSING_ACTIVITIES_EN, "T01").dataCategories);

    expect(fr).toContain("échéance de l'incarnation (12 heures au plus");
    expect(fr).toContain("rôles de plateforme incarnés (aucun pour la « vue joueur »)");
    expect(fr).toContain("effacés avec la session");
    expect(en).toContain("deadline of the impersonation (12 hours at most");
    expect(en).toContain("platform roles impersonated (none for the “player view”)");
    expect(en).toContain("erased with the session");
  });

  it("register_t01_pastDeadlineIncludingFormerPlayerViewMayStay", () => {
    const fr = JSON.stringify(activity(PROCESSING_ACTIVITIES, "T01").dataCategories);
    const en = JSON.stringify(activity(PROCESSING_ACTIVITIES_EN, "T01").dataCategories);

    expect(fr).toContain("une échéance passée (même celle de la vue joueur ouverte, avant « Incarner un rôle »");
    expect(fr).toContain("ou celle d'un compte qui n'est plus administrateur, peut rester sur la session, sans effet");
    expect(fr).not.toContain("remise à vide échoue");
    expect(en).toContain("a past deadline (even one of the player view open, before “Impersonate a role”");
    expect(en).toContain("or one on an account that is no longer an administrator, may stay on the session, with no effect");
    expect(en).not.toContain("clearing fails");
  });

  it("register_t01_framedOnTheSessionNotOnAdministratorsOnly", () => {
    const fr = JSON.stringify(activity(PROCESSING_ACTIVITIES, "T01").dataCategories);
    const en = JSON.stringify(activity(PROCESSING_ACTIVITIES_EN, "T01").dataCategories);

    expect(fr).toContain("Sur la session de connexion, quand un administrateur incarne un rôle : échéance");
    expect(fr).not.toContain("Sur la session de connexion d'un administrateur qui incarne un rôle");
    expect(en).toContain("On the login session, when an administrator impersonates a role: deadline");
    expect(en).not.toContain("On the login session of an administrator impersonating a role");
  });

  it("register_t05_strayOnNonAdminAccountHasNoEffect", () => {
    const fr = JSON.stringify(activity(PROCESSING_ACTIVITIES, "T05").subPurposes);
    const en = JSON.stringify(activity(PROCESSING_ACTIVITIES_EN, "T05").subPurposes);

    expect(fr).toContain("une fois passés ou sur un compte qui n'est plus administrateur, jusqu'à l'effacement de la session");
    expect(fr).not.toContain("remise à vide échoue");
    expect(en).toContain("once passed or on an account that is no longer an administrator, until the session is erased");
    expect(en).not.toContain("clearing fails");
  });

  it("register_t05_dataCategoryPutsRolesOnTheEntryOnly", () => {
    const fr = JSON.stringify(activity(PROCESSING_ACTIVITIES, "T05").dataCategories);
    const en = JSON.stringify(activity(PROCESSING_ACTIVITIES_EN, "T05").dataCategories);

    expect(fr).toContain("sens de la bascule et, à l'entrée, rôles incarnés");
    expect(en).toContain("direction of the switch and, on entry, roles impersonated");
  });

  it("register_t05_legacyWordingIsDateIndependentInBothLanguages", () => {
    const fr = JSON.stringify(activity(PROCESSING_ACTIVITIES, "T05"));
    const en = JSON.stringify(activity(PROCESSING_ACTIVITIES_EN, "T05"));

    expect(fr).toContain("avant l'arrivée d'« Incarner un rôle », la seule vue joueur");
    expect(fr).not.toContain("jusqu'en novembre 2026");
    expect(en).toContain("until “Impersonate a role” arrived, the player view alone");
    expect(en).not.toContain("until November 2026");
  });

  it("register_t05_memoryCountsEachSwitchRequest", () => {
    const fr = activity(PROCESSING_ACTIVITIES, "T05");
    const en = activity(PROCESSING_ACTIVITIES_EN, "T05");

    expect(JSON.stringify(fr.subPurposes)).toContain("l'heure de chaque demande de bascule, pour leur plafond");
    expect(JSON.stringify(fr.dataCategories)).toContain("l'heure de chaque demande de bascule et l'empreinte de la session");
    expect(JSON.stringify(en.subPurposes)).toContain("the time of each switch request, for their cap");
    expect(JSON.stringify(en.dataCategories)).toContain("the time of each switch request and the hash of the session");
  });

  it("register_t05_forcedReturnMayNameRemoverWithAccountAndSessionCount", () => {
    const fr = activity(PROCESSING_ACTIVITIES, "T05");
    const en = activity(PROCESSING_ACTIVITIES_EN, "T05");

    expect(JSON.stringify(fr.subPurposes)).toContain("peut nommer à la place l'administrateur qui l'a retirée, avec le numéro du compte et le nombre de sessions");
    expect(JSON.stringify(fr.dataCategories)).toContain("identifiant du compte concerné et nombre de sessions");
    expect(JSON.stringify(en.subPurposes)).toContain("may instead name the administrator who removed it, with the account number and the number of sessions");
    expect(JSON.stringify(en.dataCategories)).toContain("identifier of the account concerned and number of sessions");
  });

  it("register_t05_promotionLineSaysItFollowsGrantedRoleLine", () => {
    const fr = activity(PROCESSING_ACTIVITIES, "T05");
    const en = activity(PROCESSING_ACTIVITIES_EN, "T05");

    expect(JSON.stringify(fr.subPurposes)).toContain("levée à la promotion du compte, elle suit la ligne du rôle accordé, qui désigne le compte");
    expect(JSON.stringify(fr.dataCategories)).toContain("le seul nombre de sessions, sans nom (levée à la promotion du compte, la ligne suit celle du rôle accordé, qui désigne le compte)");
    expect(JSON.stringify(en.subPurposes)).toContain("when lifted on the account's promotion, it follows the line of the role granted, which identifies the account");
    expect(JSON.stringify(en.dataCategories)).toContain("the number of sessions alone, naming no one (when lifted on the account's promotion, the line follows that of the role granted, which identifies the account)");
  });

  it("register_t05_coversAdminsBasisLegacySubjectsAndCategoriesInBothLanguages", () => {
    const fr = activity(PROCESSING_ACTIVITIES, "T05");
    const en = activity(PROCESSING_ACTIVITIES_EN, "T05");

    expect(JSON.stringify(fr.subPurposes)).toContain("Incarner un rôle : un administrateur réduit ses droits");
    expect(JSON.stringify(fr.legalBasis)).toContain("de l'administrateur qui incarne un rôle ou en revient");
    expect(JSON.stringify(fr.dataSubjects)).toContain("Développeurs (rôle de plateforme, hors staff) passés en vue joueur ou revenus avant l'arrivée d'« Incarner un rôle »");
    expect(JSON.stringify(fr.dataCategories)).toContain("pour une incarnation d'un rôle entrée ou quittée : pseudo et identifiant de son auteur");
    expect(JSON.stringify(en.subPurposes)).toContain("Impersonate a role: an administrator narrows their rights");
    expect(JSON.stringify(en.legalBasis)).toContain("the administrator who impersonates a role or switches back");
    expect(JSON.stringify(en.dataSubjects)).toContain("Developers (platform role, not staff) who switched into or out of player view until “Impersonate a role” arrived");
    expect(JSON.stringify(en.dataCategories)).toContain("for an impersonation of a role switched on or off: username and identifier of its author");
    // La vue joueur ouverte à tout rôle (#627) n'a vécu qu'en novembre 2026 : « avant novembre » ne couvrirait aucune bascule.
    expect(JSON.stringify(fr)).not.toContain("avant novembre 2026, aussi");
    expect(JSON.stringify(fr)).not.toContain("revenus avant novembre 2026");
    expect(JSON.stringify(en)).not.toContain("before November 2026");
  });
});

describe("/rgpd", () => {
  it("rgpdFr_staffLogsParagraph_describesImpersonation", () => {
    const paragraph = paragraphAround("app/rgpd/page.tsx", "Un administrateur peut réduire ses droits sur une de ses sessions");

    expect(paragraph).toContain("{PLAYER_VIEW_MAX_HOURS} heures au plus");
    expect(paragraph).toContain("son pseudo, son identifiant, le sens de la bascule (entrée ou retour) et, à l&apos;entrée, les rôles incarnés");
    expect(paragraph).toContain("intérêt légitime");
    expect(paragraph).toContain('href="/rgpd/registre#t05"');
  });

  it("rgpdEn_staffLogsParagraph_describesImpersonation", () => {
    const paragraph = paragraphAround("app/rgpd/RgpdEn.tsx", "An administrator can narrow their rights on one of their sessions");

    expect(paragraph).toContain("{PLAYER_VIEW_MAX_HOURS} hours at most");
    expect(paragraph).toContain("their username, their identifier, the direction of the switch (in or back) and, on entry, the roles impersonated");
    expect(paragraph).toContain("legitimate interest");
    expect(paragraph).toContain('href="/rgpd/registre#t05"');
  });

  it("rgpdFrEn_deletionNote_coversImpersonationsAndLegacySwitches", () => {
    expect(readSource("app/rgpd/page.tsx")).toContain("ses incarnations d&apos;un rôle");
    expect(readSource("app/rgpd/page.tsx")).toContain("ses bascules vers et depuis la vue joueur");
    expect(readSource("app/rgpd/RgpdEn.tsx")).toContain("their impersonations of a role");
    expect(readSource("app/rgpd/RgpdEn.tsx")).toContain("their switches into and out of player view");
  });

  it("rgpdFrEn_deletionNote_legacyWordingIsDateIndependent", () => {
    expect(readSource("app/rgpd/page.tsx")).toContain("ses incarnations d&apos;un rôle (et, avant l&apos;arrivée d&apos;« Incarner un rôle », pour tout titulaire");
    expect(readSource("app/rgpd/page.tsx")).not.toContain("jusqu&apos;en novembre 2026, pour tout titulaire");
    expect(readSource("app/rgpd/RgpdEn.tsx")).toContain("their impersonations of a role (and, until “Impersonate a role” arrived, for any holder");
    expect(readSource("app/rgpd/RgpdEn.tsx")).not.toContain("until November 2026, for any holder");
  });

  it("rgpdFr_staffLogsParagraph_mayNameRemoverAndHasNoStartupSweep", () => {
    const paragraph = paragraphAround("app/rgpd/page.tsx", "Un administrateur peut réduire ses droits sur une de ses sessions");

    expect(paragraph).toContain("peut nommer l&apos;administrateur qui l&apos;a retirée, avec l&apos;identifiant du compte et le nombre de sessions");
    expect(paragraph).toContain("s&apos;effacent au retour fait avant l&apos;échéance, sinon au plus tard avec la session");
    expect(paragraph).not.toContain("démarrage suivant");
  });

  it("rgpdEn_staffLogsParagraph_mayNameRemoverAndHasNoStartupSweep", () => {
    const paragraph = paragraphAround("app/rgpd/RgpdEn.tsx", "An administrator can narrow their rights on one of their sessions");

    expect(paragraph).toContain("may name the administrator who removed it, with the identifier of the account and the number of sessions");
    expect(paragraph).toContain("are erased on a return made before the deadline, otherwise at the latest with the session");
    expect(paragraph).not.toContain("next start");
  });

  it("rgpdFrEn_cookieParagraph_pastDeadlineMayStay", () => {
    expect(readSource("app/rgpd/page.tsx")).toContain("une échéance passée, même d&apos;une ancienne vue joueur, ou celle d&apos;un compte qui n&apos;est plus administrateur, peut y rester, sans effet");
    expect(readSource("app/rgpd/RgpdEn.tsx")).toContain("a past deadline, even one of the former player view, or one on an account that is no longer an administrator, may stay there, with no effect");
  });
});
