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

  it("render_french_offersThePlayerChoiceFirstWithAutofocus", () => {
    const html = render("fr");

    expect(html).toContain("Joueur (aucun rôle)");
    expect(html.indexOf("data-autofocus")).toBeLessThan(html.indexOf('type="checkbox"'));
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
    expect(scroll).not.toContain(`>${frShell.impersonate.cancel}<`);
    expect(scroll).not.toContain(`>${frShell.impersonate.confirm}<`);
    expect(html).toContain(`>${frShell.impersonate.cancel}<`);
  });

  it("source_scrollAreaNamedByTheBodyLabel_inFrenchAndEnglish", () => {
    expect(readSource("components/impersonate-role-dialog.tsx")).toContain('ariaLabel={t("impersonate.bodyLabel")}');
    expect(frShell.impersonate.bodyLabel).toBe("Rôles à incarner");
    expect(enShell.impersonate.bodyLabel).toBe("Roles to impersonate");
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
  it("shell_impersonateSection_hasSameKeysInBothLanguages", () => {
    expect(Object.keys(enShell.impersonate).sort()).toEqual(Object.keys(frShell.impersonate).sort());
    expect(Object.keys(enShell.impersonate.roles).sort()).toEqual(Object.keys(frShell.impersonate.roles).sort());
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
