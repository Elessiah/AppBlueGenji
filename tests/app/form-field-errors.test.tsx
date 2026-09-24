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
import { PlayerPseudoCombobox } from "@/app/(secured)/equipes/[id]/_components/PlayerPseudoCombobox";
import { PhaseCard } from "@/app/(secured)/tournois/creer/PhaseCard";
import { fieldAria } from "@/lib/shared/field-errors";
import type { PhaseConfig, PhaseIssueField } from "@/lib/shared/tournament-phases";
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
  { file: "app/(secured)/equipes/[id]/_components/MembersSection.tsx", fields: ["pseudo"] },
  { file: "app/(secured)/equipes/[id]/_components/ClaimGhostTeamDialog.tsx", fields: ["pseudo"] },
  { file: "app/(secured)/profil/DiscordVerificationDialog.tsx", fields: ["handle", "code"] },
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

describe("pseudo d'un joueur — liste de suggestions et focus ramené", () => {
  const COMBOBOX = "app/(secured)/equipes/[id]/_components/PlayerPseudoCombobox.tsx";

  it("le hook ramène le focus par la fonction qui le marque", () => {
    const src = code("lib/shared/hooks/useFieldErrors.ts");
    expect(src).toContain("focusFlaggedField(");
    expect(src).not.toMatch(/\.focus\(\)/);
  });

  it("la liste ne s'ouvre pas sur le focus ramené par un refus", () => {
    const src = code(COMBOBOX);
    expect(src).toMatch(/onFocus=\{\(e\) => \{\s*if \(!isFieldErrorFocus\(e\.currentTarget\)\) setOpen\(true\);/);
  });

  it("le champ reçoit aria-invalid et la phrase du refus avec son aide", () => {
    const html = renderToStaticMarkup(
      <PlayerPseudoCombobox
        id="team-invite-pseudo"
        value="Nova"
        onChange={() => {}}
        aria={fieldAria("team-invite-pseudo", true, "team-invite-help")}
      />,
    );
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('aria-describedby="team-invite-pseudo-error team-invite-help"');
  });

  it("sans refus, le champ garde sa seule aide", () => {
    const html = renderToStaticMarkup(
      <PlayerPseudoCombobox
        id="claim-pseudo"
        value=""
        onChange={() => {}}
        aria={fieldAria("claim-pseudo", false, "claim-pseudo-help")}
      />,
    );
    expect(html).not.toContain("aria-invalid");
    expect(html).toContain('aria-describedby="claim-pseudo-help"');
  });

  it("l'invitation reçoit le code du refus, que le hook des gestes lui transmet", () => {
    const hook = code("app/(secured)/equipes/[id]/_hooks/useMemberManagement.ts");
    expect(hook).toMatch(/onRefused\?\.\(code, message\)/);
    expect(code("app/(secured)/equipes/[id]/_components/MembersSection.tsx")).toContain(
      "addMember(memberPseudo.trim(), memberRoles, fieldErrors.report)",
    );
  });
});

describe("phases d'un tournoi multi-phases", () => {
  const phase: PhaseConfig = {
    position: 2,
    format: "SURVIVAL",
    name: null,
    qualifierMode: "COUNT",
    qualifierValue: 8,
    hasThirdPlaceMatch: false,
    swissTotalRounds: null,
    survivalRoundsBeforeFirstCut: 0,
    survivalRoundsPerCut: 3,
  };
  const render = (issue: { field: PhaseIssueField; message: string } | null) =>
    renderToStaticMarkup(
      <PhaseCard
        phase={phase}
        isLast={false}
        isExpanded
        totalPhases={3}
        maxTeams={16}
        issue={issue}
        onToggleExpand={() => {}}
        onMoveUp={() => {}}
        onMoveDown={() => {}}
        onRemove={() => {}}
        onUpdate={() => {}}
      />,
    );
  /** Balise ouvrante du contrôle portant cet `id`. */
  const control = (html: string, id: string) => html.match(new RegExp(`<(?:input|select)[^>]*id="${id}"[^>]*>`))?.[0] ?? "";

  it("signale le réglage désigné, avec la phrase du défaut puis son aide", () => {
    const html = render({ field: "survivalRoundsBeforeFirstCut", message: "Phase 2 — Cadence invalide." });
    const input = control(html, "phase-survival-before-2");
    expect(input).toContain('aria-invalid="true"');
    expect(input).toContain('aria-describedby="phase-survival-before-2-error phase-survival-before-2-help"');
    expect(html).toContain('<span id="phase-survival-before-2-error" class="sr-only">Phase 2 — Cadence invalide.</span>');
  });

  it("ne signale que ce réglage", () => {
    const html = render({ field: "survivalRoundsBeforeFirstCut", message: "Phase 2 — Cadence invalide." });
    for (const id of ["phase-format-2", "phase-qualifier-2", "phase-survival-per-2"]) {
      expect(control(html, id)).not.toContain("aria-invalid");
    }
  });

  it("montre la valeur refusée, pas une valeur par défaut", () => {
    // `|| 3` affichait « 3 » pour une cadence à 0 : le champ signalé aurait
    // montré une valeur valide.
    expect(control(render(null), "phase-survival-before-2")).toContain('value="0"');
  });

  it("sans défaut, aucun champ n'est signalé", () => {
    const html = render(null);
    expect(html).not.toContain("aria-invalid");
    expect(html).not.toContain("sr-only");
  });

  it("l'envoi refusé demande le focus, que le constructeur porte au réglage fautif", () => {
    const form = code("app/(secured)/tournois/_components/TournamentForm.tsx");
    expect(form).toMatch(/findPhaseIssue\(phases\)/);
    expect(form).toContain("setPhaseFocusRequest((n) => n + 1)");
    expect(code("app/(secured)/tournois/_components/FormatSettings.tsx")).toContain(
      "focusRequest={phaseFocusRequest}",
    );
    const builder = code("app/(secured)/tournois/creer/PhaseBuilder.tsx");
    expect(builder).toContain("setExpandedIndex(current.phaseIndex)");
    expect(builder).toContain("phaseFieldId(current.phaseIndex + 1, current.field)");
    // Même geste que `useFieldErrors` : le focus est marqué.
    expect(builder).toContain("focusFlaggedField(document.getElementById(pendingFocusId))");
    expect(builder).not.toMatch(/\.focus\(\)/);
  });

  it("une demande déjà servie n'est pas rejouée quand le constructeur se remonte", () => {
    // Quitter le format multi-phases puis y revenir démonte et remonte le
    // constructeur : la dernière demande, relevée au montage, ne vaut pas une
    // nouvelle.
    const builder = code("app/(secured)/tournois/creer/PhaseBuilder.tsx");
    expect(builder).toContain("const handledRequest = useRef(focusRequest)");
    expect(builder).toMatch(/if \(focusRequest === handledRequest\.current\) return;\s*handledRequest\.current = focusRequest;/);
  });

  it("un plan figé par la fenêtre d'édition ne demande pas de focus", () => {
    // Ses champs sont désactivés : le focus n'irait nulle part.
    expect(code("app/(secured)/tournois/_components/TournamentForm.tsx")).toContain(
      'if (!locked("phases")) setPhaseFocusRequest((n) => n + 1)',
    );
  });
});

describe("certification Discord — code refusé", () => {
  it("la seconde étape offre de redemander un code, geste que nomme le refus d'un code brûlé", () => {
    const src = code("app/(secured)/profil/DiscordVerificationDialog.tsx");
    expect(src).toMatch(/onClick=\{restartVerification\}>\s*Nouveau code/);
    expect(src).toMatch(/const restartVerification = \(\) => \{\s*setDiscordId\(""\);\s*setCode\(""\);\s*fieldErrors\.clear\(\);/);
  });

  it("changer d'étape porte le focus sur le champ de la nouvelle étape, jamais au montage", () => {
    // Le bouton activé se démonte avec son étape : sans relais, le focus
    // tomberait sur `<body>`.
    const src = code("app/(secured)/profil/DiscordVerificationDialog.tsx");
    expect(src).toContain("const previousStep = useRef(awaitingCode)");
    expect(src).toMatch(/if \(previousStep\.current === awaitingCode\) return;/);
    expect(src).toContain("getElementById(awaitingCode ? FIELD_IDS.code : FIELD_IDS.handle)?.focus()");
  });

  it("la rangée de trois boutons passe à la ligne plutôt que de déborder", () => {
    const src = code("app/(secured)/profil/DiscordVerificationDialog.tsx");
    const row = src.slice(0, src.indexOf("Nouveau code"));
    expect(row.slice(row.lastIndexOf("<div style="))).toContain('flexWrap: "wrap"');
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
    const menu = code("components/accessibility/AccessibilityMenu.tsx");
    expect(menu).toContain('href="/accessibilite"');
    // La mise en page racine persiste d'une page à l'autre : suivre le lien doit
    // refermer le panneau, sans quoi il couvrirait la page d'arrivée.
    expect(menu).toMatch(/href="\/accessibilite"[^>]*onClick=\{onNavigate\}/);
    expect(menu).toContain("onNavigate={() => setOpen(false)}");
  });
});
