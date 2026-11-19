/**
 * Modale « Incarner un rôle » rendue (FR et `/en`,
 * `docs/features/ADMIN_ROLE_IMPERSONATION.md`) : le choix « Joueur (aucun
 * rôle) », une case et un « i » par rôle impersonable, jamais `ADMIN`, le
 * plafond d'heures dans l'aide, la modale du site (portail, `role="dialog"`).
 */
import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";

// Rendu serveur : le premier effet du rendu (le montage de la modale, qui
// arme son portail) est joué une fois, sur-le-champ ; les autres sont ignorés.
const mockMountEffect = { armed: false };
jest.mock("react", () => {
  const actual = jest.requireActual<typeof import("react")>("react");
  return {
    ...actual,
    useEffect: (effect: () => unknown) => {
      if (!mockMountEffect.armed) return;
      mockMountEffect.armed = false;
      effect();
    },
  };
});
jest.mock("react-dom", () => {
  const actual = jest.requireActual<typeof import("react-dom")>("react-dom");
  return { ...actual, createPortal: (node: unknown) => node };
});
jest.mock("@/lib/shared/hooks/useDialogBehavior", () => ({ useDialogBehavior: () => ({ current: null }) }));

import { renderToStaticMarkup } from "react-dom/server";
import { ImpersonateRoleDialog } from "@/components/impersonate-role-dialog";
import { ShellTextProvider } from "@/components/i18n/shell-text";
import { messagesFor } from "@/lib/server/i18n-messages";
import { PLAYER_VIEW_MAX_HOURS } from "@/lib/shared/player-view";
import frShell from "@/messages/fr/shell.json";
import enShell from "@/messages/en/shell.json";
import frImpersonate from "@/messages/fr/impersonate.json";
import enImpersonate from "@/messages/en/impersonate.json";
import { IMPERSONABLE_ROLES } from "@/lib/shared/player-view";
import { readSource } from "../helpers/read-source";

const globals = globalThis as { document?: unknown };
const saved = globals.document;
beforeAll(() => {
  globals.document = { body: {} };
});
afterAll(() => {
  globals.document = saved;
});

function render(locale: "fr" | "en"): string {
  mockMountEffect.armed = true;
  return renderToStaticMarkup(
    <ShellTextProvider locale={locale} messages={locale === "en" ? messagesFor("en").shell : undefined}>
      <ImpersonateRoleDialog onClose={() => undefined} onConfirm={async () => true} />
    </ShellTextProvider>,
  );
}

const count = (html: string, needle: string) => html.split(needle).length - 1;

describe("ImpersonateRoleDialog — français", () => {
  it("render_french_isAModalDialogTitledIncarnerUnRole", () => {
    const html = render("fr");

    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain("Incarner un rôle");
  });

  it("render_french_offersThePlayerChoiceFirst", () => {
    const html = render("fr");

    expect(html).toContain("Joueur (aucun rôle)");
    expect(html.indexOf("Joueur (aucun rôle)")).toBeLessThan(html.indexOf('type="checkbox"'));
  });

  it("render_french_noControlGrabsTheOpeningFocus", () => {
    // Entrée à l'ouverture ne doit rien basculer : le focus va à la modale.
    const source = readSource("components/impersonate-role-dialog.tsx");

    expect(render("fr")).not.toContain("data-autofocus");
    expect(source).toContain('initialFocus: "container"');
  });

  it("render_french_confirmButtonCarriesTheEmptySelectionRule", () => {
    const html = render("fr");
    const confirm = /<button type="submit"[^>]*>/.exec(html)?.[0] ?? "";
    const describedBy = /aria-describedby="([^"]+)"/.exec(confirm)?.[1] ?? "";

    expect(describedBy).toMatch(/-lead$/);
    expect(html).toContain(`id="${describedBy}"`);
  });

  it("css_narrowLabel_isHiddenFromAssistiveTechnology", () => {
    expect(readSource("components/impersonate-role-dialog.module.css")).toContain('content: attr(data-label) " · " / "";');
  });

  it("render_french_checkboxRowsKeepTheHintApart", () => {
    expect(count(render("fr"), 'class="row rowSeparated')).toBeGreaterThanOrEqual(6);
  });

  it("render_french_listsEachImpersonableRoleWithACheckboxAndAHint", () => {
    const html = render("fr");

    for (const label of ["Arbitre", "Caster", "Prod", "Community Manager", "Recruteur", "Développeur"]) {
      expect(html).toContain(label);
    }
    expect(count(html, 'type="checkbox"')).toBe(6);
    expect(count(html, 'role="row"')).toBe(7);
  });

  it("render_french_neverOffersAdmin", () => {
    expect(render("fr")).not.toMatch(/Administrateur/);
  });

  it("render_french_hintGivesTheHourCap", () => {
    expect(render("fr")).toContain(`au plus ${PLAYER_VIEW_MAX_HOURS} heures`);
  });

  it("render_french_bodyScrollsThroughScrollArea", () => {
    const html = render("fr");

    expect(html).toContain("overflow-y:auto");
    expect(readSource("components/impersonate-role-dialog.module.css")).not.toMatch(/overflow(-y)?:\s*auto/);
  });

  it("render_french_scrollAreaWrapsTheBodyOnly", () => {
    const html = render("fr");
    const scroll = scrollAreaMarkup(html);

    expect(scroll).toContain("Joueur (aucun rôle)");
    expect(count(scroll, 'type="checkbox"')).toBe(6);
    expect(scroll).not.toContain("<h3");
    expect(scroll).not.toContain(`>${frImpersonate.cancel}<`);
    expect(scroll).not.toContain(`>${frImpersonate.confirm}<`);
    expect(html).toContain(`>${frImpersonate.cancel}<`);
  });

  it("source_scrollAreaNamedByTheBodyLabel_inFrenchAndEnglish", () => {
    expect(readSource("components/impersonate-role-dialog.tsx")).toContain('ariaLabel={t("bodyLabel")}');
    expect(frImpersonate.bodyLabel).toBe("Rôles à incarner");
    expect(enImpersonate.bodyLabel).toBe("Roles to impersonate");
  });

  it("css_scrollBody_keepsRoomForFocusOutlines", () => {
    expect(readSource("components/impersonate-role-dialog.module.css")).toMatch(/\.body \{[^}]*padding: 4px;/);
  });

  it("render_french_tapZoneOnTheRoleRows", () => {
    expect(render("fr")).toContain("data-tap-zone");
  });
});

describe("ImpersonateRoleDialog — anglais", () => {
  it("render_english_isTranslated", () => {
    const html = render("en");

    expect(html).toContain("Impersonate a role");
    expect(html).toContain("Player (no role)");
    expect(html).toContain("Referee");
    expect(html).toContain("Cancel");
    expect(html).not.toContain("Joueur (aucun rôle)");
  });

  it("render_english_hintGivesTheHourCap", () => {
    expect(render("en")).toContain(`for ${PLAYER_VIEW_MAX_HOURS} hours at most`);
  });
});

describe("textes FR = EN", () => {
  it("impersonateDialogTexts_haveSameKeysInBothLanguages", () => {
    expect(Object.keys(enImpersonate).sort()).toEqual(Object.keys(frImpersonate).sort());
    expect(Object.keys(enImpersonate.roles).sort()).toEqual(Object.keys(frImpersonate.roles).sort());
  });

  it("impersonateDialogTexts_describeEveryImpersonableRole_andNoOther", () => {
    for (const messages of [frImpersonate, enImpersonate]) {
      expect(Object.keys(messages.roles).sort()).toEqual([...IMPERSONABLE_ROLES].sort());
      for (const role of IMPERSONABLE_ROLES) {
        const entry = messages.roles[role as keyof typeof messages.roles];
        expect(entry.opens.length).toBeGreaterThan(0);
        expect(entry.hint.length).toBeGreaterThan(0);
      }
    }
  });

  it("shellBannerRoleLabels_existForEveryImpersonableRole_inBothLanguages", () => {
    // La bannière (mise en page racine, toutes les pages) nomme chaque rôle
    // par la coquille : un rôle sans nom y afficherait la clé brute.
    for (const messages of [frShell, enShell]) {
      expect(Object.keys(messages.impersonate.roles).sort()).toEqual([...IMPERSONABLE_ROLES].sort());
      for (const role of IMPERSONABLE_ROLES) {
        expect(messages.impersonate.roles[role as keyof typeof messages.impersonate.roles].label.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("poids de la coquille", () => {
  it("shellMessages_carryOnlyTheBannerRoleLabels_notTheDialogTexts", () => {
    // Les textes de la modale partent avec son morceau (chargé à l'ouverture),
    // ni dans le paquet commun ni dans la charge utile des pages `/en`.
    for (const messages of [frShell, enShell]) {
      expect(Object.keys(messages.impersonate)).toEqual(["roles"]);
      for (const entry of Object.values(messages.impersonate.roles)) expect(Object.keys(entry)).toEqual(["label"]);
    }
  });

  it("shellText_neverImportsTheDialogTexts", () => {
    expect(readSource("lib/shared/shell-text.ts")).not.toContain("impersonate");
    expect(readSource("components/player-view.tsx")).not.toContain("impersonate-role-text");
    expect(readSource("components/impersonate-role-text.ts")).toContain("@/messages/fr/impersonate.json");
  });
});

/** Le balisage de la zone défilante (`<ScrollArea>`, un `div`), balise fermante comprise. */
function scrollAreaMarkup(html: string): string {
  const start = html.lastIndexOf("<div", html.indexOf("scroll-area"));
  let depth = 0;
  const tags = /<div[\s>]|<\/div>/g;
  tags.lastIndex = start;
  for (let match = tags.exec(html); match; match = tags.exec(html)) {
    depth += match[0] === "</div>" ? -1 : 1;
    if (depth === 0) return html.slice(start, tags.lastIndex);
  }
  return html.slice(start);
}
