import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LAUNCH_ERROR_MESSAGES } from "@/lib/shared/match-launch";
import { REFEREE_INELIGIBILITIES } from "@/lib/shared/match-referee";

/**
 * Fenêtre « Arbitrage » (`RefereeDialog`) : la liste des arbitres et le champ
 * de la première carte prennent l'habillage commun des champs (`.field` de
 * `app/globals.css` : fond sombre, texte clair, anneau au focus). Hors d'un
 * `.field`, le navigateur les rendait en blanc sur noir, sans l'anneau du site.
 *
 * Contrôle au niveau de la source, faute de pouvoir monter la cascade en test.
 */
const source = readFileSync(
  join(process.cwd(), "app/(secured)/tournois/[id]/_components/RefereeDialog.tsx"),
  "utf8",
);

/** Ce qui précède le contrôle, depuis le `<form` qui le contient. */
function wrapperBefore(tag: string): string {
  const at = source.indexOf(tag);
  expect(at).toBeGreaterThanOrEqual(0);
  return source.slice(source.lastIndexOf("<form", at), at);
}

describe("RefereeDialog — champs habillés", () => {
  for (const tag of ["<select", "<input"]) {
    it(`${tag} vit dans un \`.field\`, avec son libellé`, () => {
      const before = wrapperBefore(tag);
      expect(before).toMatch(/<div className=\{`field /);
      expect(before).toMatch(/<label htmlFor=/);
    });
  }

  it("l'erreur de la carte reste sous son champ, dans le même `.field`", () => {
    const field = source.slice(source.indexOf("<input"), source.indexOf("refereeDialog.mapSave\")"));
    expect(field).toContain("<FieldErrorText fieldId={mapId}");
    expect(field.indexOf("<FieldErrorText")).toBeLessThan(field.indexOf("</div>"));
  });

  it("n'habille plus les champs à la main dans le module CSS", () => {
    const css = readFileSync(
      join(process.cwd(), "app/(secured)/tournois/[id]/_components/RefereeDialog.module.css"),
      "utf8",
    );
    expect(css).not.toMatch(/\.row (select|input)/);
  });
});

describe("RefereeDialog — gestes qui ne perdent rien", () => {
  it("la carte saisie survit aux autres gestes : seules l'ouverture et son enregistrement la relisent", () => {
    expect(source).toMatch(/async \(initial = false, resetMap = initial\)/);
    expect(source).toMatch(/if \(resetMap\) setMap\(/);
    expect(source).toMatch(/await load\(false, resetMap\)/);
    expect(source).toMatch(/refereeDialog\.mapSaved"\), true\)/);
  });

  it("le focus suit `refereeFocusTarget`, relevé avant l'envoi et rendu après la confirmation", () => {
    expect(source).toMatch(/<p ref=\{statusRef\} tabIndex=\{-1\}/);
    expect(source).toMatch(/triggerRef\.current = document\.activeElement/);
    expect(source).toMatch(/if \(busy \|\| confirm !== null\) return;/);
  });
});

describe("RefereeDialog — levée d'une opposition", () => {
  const fr = JSON.parse(readFileSync(join(process.cwd(), "messages/fr/tournamentActions.json"), "utf8"));
  const en = JSON.parse(readFileSync(join(process.cwd(), "messages/en/tournamentActions.json"), "utf8"));

  it("« Lever » ouvre une confirmation au lieu de lever l'opposition d'un clic", () => {
    const button = source.slice(source.indexOf("objection.liftAria"), source.indexOf("objection.lift\")"));
    expect(button).toContain('setConfirm("liftObjection")');
    expect(button).not.toContain("upheld: false");
  });

  it("la confirmation rappelle, en français et en anglais, qu'on ne lève qu'à la demande de l'arbitre", () => {
    expect(fr.cardActions.refereeDialog.objection.liftConfirm.body).toContain("qu'à sa demande");
    expect(en.cardActions.refereeDialog.objection.liftConfirm.body).toContain("Only at their request");
  });
});

describe("RefereeDialog — gestes et textes (EF-30)", () => {
  const fr = JSON.parse(readFileSync(join(process.cwd(), "messages/fr/tournamentActions.json"), "utf8"));
  const en = JSON.parse(readFileSync(join(process.cwd(), "messages/en/tournamentActions.json"), "utf8"));

  it("RefereeDialog_assignSucceeded_resetsPick", () => {
    const assign = source.slice(source.indexOf("const assign ="), source.indexOf("const saveMap ="));
    expect(assign).toContain('if (done) setPick("")');
    // Un choix qui n'est plus proposé (le compte désigné a quitté la liste) n'envoie rien.
    expect(assign).toContain("if (!pickOffered) return;");
    expect(source).toContain("disabled={busy || !pickOffered}");
  });

  it("RefereeDialog_noCandidate_saysWhyInsteadOfEmptyList", () => {
    expect(source).toMatch(/actions\.candidates\.length === 0 \? \(\s*<p className=\{styles\.muted\}>\{t\("cardActions\.refereeDialog\.noCandidate"\)\}<\/p>/);
    expect(fr.cardActions.refereeDialog.noCandidate).toBe("Aucun autre compte ne peut arbitrer ce match.");
    expect(en.cardActions.refereeDialog.noCandidate).toBe("No other account can referee this match.");
  });

  it("RefereeDialog_roundGestures_offeredOnlyWhenUseful", () => {
    expect(source).toMatch(/\{actions\.roundOn && \(\s*<button[^\n]*setConfirm\("roundOn"\)/);
    expect(source).toMatch(/\{actions\.roundOff && \(\s*<button[^\n]*setConfirm\("roundOff"\)/);
    expect(source).toContain('roundDone(t("cardActions.refereeDialog.roundOn"))');
    expect(source).toContain('roundDone(t("cardActions.refereeDialog.roundOff"))');
    expect(fr.cardActions.refereeDialog.roundUnchanged).toBe("Rien à changer : la manche était déjà dans cet état.");
    expect(en.cardActions.refereeDialog.roundUnchanged).toBe("Nothing to change: the round was already in that state.");
  });

  it("RefereeDialog_confirmations_toneFromGesture", () => {
    expect(source).toContain('tone={panel ? refereeConfirmTone(confirm ?? "removeReferee", panel) : "danger"}');
  });

  it("RefereeDialog_takeBlocked_saysWhyWithServerMessage", () => {
    expect(source).toContain("{actions.takeBlocked && <p className={styles.muted}>{errorText(actions.takeBlocked)}</p>}");
  });

  it("RefereeDialog_ineligibleReason_everyCodeInFrenchAndEnglish", () => {
    expect(fr.cardActions.refereeDialog.ineligible).toBe("(ne peut plus arbitrer : {reason})");
    expect(en.cardActions.refereeDialog.ineligible).toBe("(can no longer referee: {reason})");
    for (const code of REFEREE_INELIGIBILITIES) {
      expect(typeof fr.cardActions.refereeDialog.ineligibleReason[code]).toBe("string");
      expect(typeof en.cardActions.refereeDialog.ineligibleReason[code]).toBe("string");
    }
  });

  it("RefereeDialog_viewerBlockCodes_haveLaunchErrorMessages", () => {
    for (const code of ["NOT_REFEREE", "REFEREE_IDENTITY_REQUIRED", "REFEREE_IS_PLAYER", "REFEREE_OBJECTION"]) {
      expect(Object.hasOwn(LAUNCH_ERROR_MESSAGES, code)).toBe(true);
    }
  });
});
