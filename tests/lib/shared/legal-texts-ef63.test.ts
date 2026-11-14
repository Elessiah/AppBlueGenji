/**
 * ERREUR-FIX EF-63 : textes juridiques alignés sur le code — « Prêt » de
 * l'arbitre (relevé, page du match, état public du lancement), BattleTag tapé
 * des comptes rattachés avant le 31 octobre 2026, lien de stream des casters,
 * BattleTag de cast, motif d'un retrait d'arbitrage sur opposition.
 *
 * Chaque phrase gardée ici dit un fait du code, en français et en anglais.
 */
import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PROCESSING_ACTIVITIES } from "@/lib/shared/processing-register";
import { PROCESSING_ACTIVITIES_EN } from "@/lib/shared/processing-register-en";
import frActions from "@/messages/fr/tournamentActions.json";
import enActions from "@/messages/en/tournamentActions.json";

const source = (path: string) => readFileSync(join(__dirname, "..", "..", "..", path), "utf8").replace(/\s+/g, " ");
const fr = source("app/rgpd/page.tsx");
const en = source("app/rgpd/RgpdEn.tsx");
const registerFr = JSON.stringify(PROCESSING_ACTIVITIES);
const registerEn = JSON.stringify(PROCESSING_ACTIVITIES_EN);

describe("/rgpd — arbitre désigné", () => {
  it("rgpdPage_refereeReady_recordReadOnMatchPageAndLaunchStateCaveat", () => {
    expect(fr).toContain(
      "en lisent le relevé, dans les fenêtres « Contacts » et de lancement et sur la page du match — l&apos;état du lancement, public, peut toutefois laisser deviner s&apos;il est prêt.",
    );
    expect(en).toContain(
      "read the record of it, in the “Contacts” and launch windows and on the match page — the state of the launch, which is public, may still let one guess whether they are ready.",
    );
  });
});

describe("/rgpd — BattleTag tapé", () => {
  it("rgpdPage_typedBattletag_reservationForEarlierLinkedAccounts", () => {
    expect(fr).toContain(
      "pour un Battle.net déjà rattaché avec un BattleTag avant ce changement (31 octobre 2026), à partir de votre prochaine connexion par Battle.net",
    );
    expect(en).toContain(
      "for a Battle.net account already linked with a BattleTag before this change (October 31, 2026), from your next login with Battle.net",
    );
  });
});

describe("/rgpd — retransmission", () => {
  it("rgpdPage_streaming_linkRequiredToOpenAndConfigByOrganisation", () => {
    expect(fr).toContain("avec le lien de sa chaîne (obligatoire pour l&apos;ouvrir)");
    // Seul le lien **de l'organisation** reste : la chaîne propre d'un membre part avec son compte.
    expect(fr).toContain("seul le lien de l&apos;organisation, posé dans la configuration du direct du match par l&apos;un de ses membres, reste au match.");
    expect(fr).not.toContain("seul le lien posé dans la configuration");
    expect(fr).not.toContain("ou un caster) reste au match");
    expect(fr).not.toContain("là ou en ouvrant");
    expect(en).toContain("with their channel link (required to open it)");
    expect(en).toContain("only the organizers&apos; link, set in the match&apos;s live configuration by one of their members, stays with the match.");
    expect(en).not.toContain("only the link set in the match");
    expect(en).not.toContain("or a caster) stays with the match");
    expect(en).not.toContain("there or when opening their stream");
  });

  it("rgpdPage_castBattletag_readersIncludeOtherCastersAndErasedAtDeletion", () => {
    expect(fr).toContain("parties du match, ses autres casters et arbitres");
    expect(fr).toContain("part avec elle et à la suppression du compte");
    expect(en).toContain("parties to the match, its other casters and referees");
    expect(en).toContain("goes with it and when the account is deleted");
  });
});

describe("registre des traitements", () => {
  it("register_T04_refereeReadyRecordOnMatchPage", () => {
    expect(registerFr).toContain(
      "dont seules ses parties et les arbitres lisent le relevé, dans les fenêtres « Contacts » et de lancement et sur la page du match (l'état du lancement, public, peut laisser deviner s'il est prêt)",
    );
    expect(registerEn).toContain(
      "the record of which only its parties and the referees read, in the “Contacts” and launch windows and on the match page (the state of the launch, which is public, may let one guess whether they are ready)",
    );
  });

  it("register_refereeRemovalReason_objectionUpheldWritesNoPerMatchLine", () => {
    expect(registerFr).toContain("sauf l'opposition retenue, qui n'y écrit aucune ligne par match");
    expect(registerEn).toContain("except an upheld objection, which writes no line per match there");
  });

  it("register_casterLink_onlyWhenOpeningStream", () => {
    expect(registerFr).not.toContain("en ouvrant son stream ou dans cette configuration");
    expect(registerFr).not.toContain("là ou en ouvrant son stream");
    expect(registerEn).not.toContain("when opening their stream or in that configuration");
    expect(registerEn).not.toContain("there or when opening their stream");
  });
});

describe("Fenêtre « Caster » — aide du lien", () => {
  it("castSettingsUrlHint_linkAlsoGoesWithStream", () => {
    expect(frActions.cardActions.castSettings.urlHint).toContain("ou avec ton stream quand plus aucun caster ne le tient");
    expect(enActions.cardActions.castSettings.urlHint).toContain("or with your stream once no caster holds it any more");
  });
});
