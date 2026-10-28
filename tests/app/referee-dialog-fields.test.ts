import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";

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
