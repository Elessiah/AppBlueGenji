import { describe, expect, it, jest } from "@jest/globals";

jest.mock("next/navigation", () => ({ usePathname: () => "/accessibilite" }));
jest.mock("@/components/cyber/landing/PublicHeader", () => ({
  PublicHeader: () => <header>en-tête</header>,
}));
jest.mock("@/components/cyber/landing/PublicFooter", () => ({
  PublicFooter: () => <footer>pied</footer>,
}));

import { renderToStaticMarkup } from "react-dom/server";
import { FieldErrorText } from "@/components/ui/field-error-text";
import AccessibilityStatementPage from "@/app/accessibilite/page";
import { KNOWN_ISSUES } from "@/lib/shared/accessibility-statement";
import { blockFor, globals, stripComments } from "./_lib/style-sweep";
import { readSource } from "../helpers/read-source";

/** Source sans commentaires : un commentaire qui cite un appel ne le prouve pas. */
const code = (path: string) => stripComments(readSource(path)).replace(/^\s*\/\/.*$/gm, " ");

describe("FieldErrorText", () => {
  it("rend la phrase du refus, masquée à l'œil, sous l'identifiant visé par aria-describedby", () => {
    const html = renderToStaticMarkup(<FieldErrorText fieldId="team-name" message="Ce nom est déjà pris." />);
    expect(html).toBe('<span id="team-name-error" class="sr-only">Ce nom est déjà pris.</span>');
  });

  it("ne rend rien sans message : l'identifiant n'existe que tant que le champ est signalé", () => {
    expect(renderToStaticMarkup(<FieldErrorText fieldId="team-name" message={null} />)).toBe("");
    expect(renderToStaticMarkup(<FieldErrorText fieldId="team-name" message="" />)).toBe("");
  });
});

/**
 * Chaque formulaire câblé : le hook, les attributs du champ, un texte d'erreur
 * par champ, et la levée du signalement à la frappe. Le harnais tourne en
 * environnement `node` : le rendu interactif a été vérifié dans un navigateur,
 * ce balayage garde le câblage.
 */
const WIRED_FORMS: { file: string; fields: string[] }[] = [
  { file: "app/(secured)/equipes/creer/page.tsx", fields: ["name", "tag"] },
  { file: "app/(secured)/equipes/GhostTeamDialog.tsx", fields: ["name", "tag"] },
  { file: "app/(secured)/equipes/[id]/_components/TeamSettings.tsx", fields: ["name", "tag"] },
  { file: "app/(secured)/profil/page.tsx", fields: ["pseudo", "battletag", "discord"] },
  { file: "app/connexion/_components/LoginForm.tsx", fields: ["handle", "code"] },
  {
    file: "app/(secured)/tournois/_components/TournamentForm.tsx",
    fields: [
      "name",
      "maxTeams",
      "matchFormatValue",
      "startVisibilityAt",
      "registrationOpenAt",
      "registrationCloseAt",
      "startAt",
    ],
  },
];

describe("formulaires — erreurs rattachées aux champs", () => {
  it.each(WIRED_FORMS.map((form) => [form.file, form.fields] as [string, string[]]))(
    "%s signale chaque champ que ses refus désignent",
    (file, fields) => {
      const src = code(file);
      expect(src).toMatch(/useFieldErrors\(/);
      for (const field of fields) {
        // `fieldAttrs` : le formulaire de tournoi y joint l'explication du verrou.
        expect(src).toMatch(new RegExp(`fieldErrors\\.aria\\(\\s*"${field}"|fieldAttrs\\("${field}"`));
        expect(src).toContain(`fieldErrors.message("${field}")`);
        expect(src).toMatch(new RegExp(`fieldErrors\\.clear\\("${field}"\\)|set\\("${field}"`));
      }
    },
  );

  it.each(WIRED_FORMS.map((form) => [form.file]))("%s garde la notification", (file) => {
    // Le rattachement au champ s'ajoute à la convention, il ne la remplace pas.
    const src = code(file);
    expect(src).toMatch(/showError\(/);
  });

  it("les pages de tournoi lèvent le code avec sa phrase, pour que le formulaire retrouve le champ", () => {
    for (const file of ["app/(secured)/tournois/creer/page.tsx", "app/(secured)/tournois/[id]/modifier/page.tsx"]) {
      expect(code(file)).toMatch(/throw new CodedError\(code, /);
    }
    // La création affichait le code brut (`INVALID_DATE_ORDER`) : elle traduit.
    expect(code("app/(secured)/tournois/creer/page.tsx")).toContain("mapError(code)");
  });

  it("la connexion associe ses étiquettes à leurs champs", () => {
    const src = code("app/connexion/_components/LoginForm.tsx");
    const labels = src.match(/<label\b[^>]*>/g) ?? [];
    expect(labels.length).toBeGreaterThanOrEqual(4);
    for (const label of labels) expect(label).toMatch(/htmlFor=/);
  });

  it("un champ signalé porte un liseré, qui reste au focus", () => {
    const invalid = blockFor(/\.field textarea\[aria-invalid="true"\],/);
    expect(invalid).toMatch(/border-color:\s*var\(--danger\)/);
    const focused = blockFor(/\.field textarea\[aria-invalid="true"\]:focus,/);
    expect(focused).toMatch(/border-color:\s*var\(--danger\)/);
    // Après la règle de focus ordinaire, à spécificité égale : c'est l'ordre qui
    // la fait gagner.
    const css = stripComments(globals);
    expect(css.indexOf('.field textarea[aria-invalid="true"]:focus')).toBeGreaterThan(css.indexOf(".field textarea:focus"));
  });
});

describe("déclaration d'accessibilité", () => {
  const html = renderToStaticMarkup(<AccessibilityStatementPage />);

  it("porte un titre unique et l'état de conformité", () => {
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toContain("Déclaration d&#x27;accessibilité");
    expect(html).toContain("non conforme");
  });

  it("liste chaque contenu non accessible", () => {
    for (const issue of KNOWN_ISSUES) expect(html).toContain(issue.title.replace(/'/g, "&#x27;"));
  });

  it("donne un contact et les voies de recours", () => {
    expect(html).toMatch(/href="mailto:[^"]+"/);
    expect(html).toContain("Défenseur des droits");
  });

  it("annonce l'ouverture d'un nouvel onglet dans le texte de chaque lien externe", () => {
    const external = html.match(/<a [^>]*target="_blank"[^>]*>[^<]*<\/a>/g) ?? [];
    expect(external.length).toBeGreaterThan(0);
    for (const link of external) expect(link).toContain("(nouvel onglet)");
  });

  it("s'atteint du pied de page public et du menu d'accessibilité", () => {
    expect(code("components/cyber/landing/PublicFooter.tsx")).toMatch(
      /href="\/accessibilite">\{accessibilityFooterLabel\(\)\}/,
    );
    expect(code("components/accessibility/AccessibilityMenu.tsx")).toContain('href="/accessibilite"');
  });
});
