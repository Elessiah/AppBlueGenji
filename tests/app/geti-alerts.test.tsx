/**
 * Fenêtre « Alertes d'annonces » (`components/geti/GetiAlerts.tsx`) : ce
 * qu'elle rend selon la session et les alertes du compte (rendu serveur,
 * portail remplacé par son contenu). Les gestes (créer, mettre en pause,
 * supprimer) sont joués de bout en bout par `e2e/geti-info.spec.ts`.
 */
import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";

jest.mock("react-dom", () => {
  const actual = jest.requireActual<typeof import("react-dom")>("react-dom");
  return { ...actual, createPortal: (node: unknown) => node };
});
jest.mock("@/lib/shared/hooks/useDialogBehavior", () => ({ useDialogBehavior: () => ({ current: null }) }));

import { renderToStaticMarkup } from "react-dom/server";
import { GetiAlerts, GetiAlertsDialog, type GetiAlertsProps } from "@/components/geti/GetiAlerts";
import { AppLocaleProvider } from "@/components/i18n/locale-context";
import { ShellTextProvider } from "@/components/i18n/shell-text";
import { ToastProvider } from "@/components/ui/toast";
import { GETI_ALERT_MAX_PER_USER, type GetiAlert } from "@/lib/shared/geti/alerts";
import type { Locale } from "@/lib/shared/locales";
import enGeti from "@/messages/en/geti.json";
import enShell from "@/messages/en/shell.json";
import frGeti from "@/messages/fr/geti.json";
import { readSource } from "../helpers/read-source";

const globalWithDocument = globalThis as { document?: unknown };
const hadDocument = "document" in globalWithDocument;
beforeAll(() => {
  if (!hadDocument) globalWithDocument.document = { body: {} };
});
afterAll(() => {
  if (!hadDocument) delete globalWithDocument.document;
});

const CATEGORY_TITLES = {
  lfp: "Je cherche un joueur",
  lft: "Je cherche une équipe",
  lfsub: "Je cherche un remplaçant",
  lfstaff: "Je cherche un staff",
  lfs: "Je cherche un scrim",
  lfcast: "Je cherche un cast",
};

function alert(overrides: Partial<GetiAlert> = {}): GetiAlert {
  return { id: 7, category: "lfp", name: "Tank EU", search: "?role=tank", paused: false, createdAt: "2026-11-27T10:00:00.000Z", ...overrides };
}

function props(overrides: Partial<GetiAlertsProps> = {}): GetiAlertsProps {
  return {
    text: frGeti.alerts,
    category: "lfp",
    search: "?role=tank&reg=eu",
    categoryTitles: CATEGORY_TITLES,
    signedIn: true,
    initialAlerts: [],
    ...overrides,
  };
}

function renderDialog(overrides: Partial<GetiAlertsProps> = {}, locale: Locale = "fr"): string {
  const all = props(overrides);
  return renderToStaticMarkup(
    <AppLocaleProvider locale={locale}>
      <ShellTextProvider locale={locale} messages={locale === "en" ? enShell : undefined}>
        <ToastProvider>
          <GetiAlertsDialog {...all} alerts={all.initialAlerts} setAlerts={() => undefined} onClose={() => undefined} />
        </ToastProvider>
      </ShellTextProvider>
    </AppLocaleProvider>,
  );
}

describe("GetiAlerts", () => {
  it("GetiAlerts_closed_rendersOnlyTheButtonThatOpensADialog", () => {
    const html = renderToStaticMarkup(
      <AppLocaleProvider locale="fr">
        <ToastProvider>
          <GetiAlerts {...props()} />
        </ToastProvider>
      </AppLocaleProvider>,
    );

    expect(html).toContain("Créer une alerte");
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).not.toContain('role="dialog"');
  });
});

describe("GetiAlertsDialog", () => {
  it("GetiAlertsDialog_signedOut_leadsToTheLoginPageWithoutAForm", () => {
    const html = renderDialog({ signedIn: false });

    expect(html).toContain("Connecte-toi pour créer une alerte");
    expect(html).toContain('href="/connexion"');
    expect(html).not.toContain("<form");
  });

  it("GetiAlertsDialog_signedIn_saysWhatTheAlertWillKeepAndLabelsTheNameField", () => {
    const html = renderDialog();

    expect(html).toContain("Je cherche un joueur — 2 filtres actifs");
    expect(html).toMatch(/<label for="([^"]+)"[^>]*>Nom de l(?:&#x27;|')alerte \(facultatif\)<\/label><input id="\1"/);
    expect(html).toContain('maxLength="60"');
  });

  it("GetiAlertsDialog_searchWithoutFilter_saysEveryNewPostMatches", () => {
    const html = renderDialog({ search: "" });

    expect(html).toContain("sans filtre : toutes les nouvelles annonces");
  });

  it("GetiAlertsDialog_noAlertYet_showsTheEmptyListAndTheCount", () => {
    const html = renderDialog();

    expect(html).toContain("Mes alertes (0/10)");
    expect(html).toContain("Aucune alerte pour l&#x27;instant.");
  });

  it("GetiAlertsDialog_activeAndPausedAlerts_showStateActionsAndLinkToTheirSearch", () => {
    const html = renderDialog({ initialAlerts: [alert(), alert({ id: 8, category: "lft", name: null, search: "", paused: true })] });

    expect(html).toContain("Mes alertes (2/10)");
    expect(html).toContain('href="/geti-info/lfp?role=tank"');
    expect(html).toContain("Mettre en pause<span class=\"sr-only\"> — Tank EU</span>");
    // Une alerte sans nom porte le titre de sa catégorie ; en pause, elle propose de la relancer.
    expect(html).toContain("Relancer<span class=\"sr-only\"> — Je cherche une équipe</span>");
    expect(html).toContain("En pause");
  });

  it("GetiAlertsDialog_accountAtTheLimit_disarmsCreationAndSaysWhy", () => {
    const full = Array.from({ length: GETI_ALERT_MAX_PER_USER }, (_, index) => alert({ id: index + 1 }));

    const html = renderDialog({ initialAlerts: full });

    expect(html).toMatch(/<button[^>]*type="submit"[^>]*aria-disabled="true"/);
    expect(html).toContain("Tu as déjà 10 alertes");
  });

  it("GetiAlertsDialog_belowTheLimit_keepsCreationArmed", () => {
    const html = renderDialog();

    expect(html).not.toMatch(/<button[^>]*type="submit"[^>]*aria-disabled="true"/);
  });

  it("GetiAlertsDialog_english_isFullyTranslatedWithPrefixedLinks", () => {
    const html = renderDialog({ text: enGeti.alerts, initialAlerts: [alert()] }, "en");

    expect(html).toContain("My alerts (1/10)");
    expect(html).toContain('href="/en/geti-info/lfp?role=tank"');
    expect(html).not.toContain("Mes alertes");
  });
});

describe("textes des alertes", () => {
  it("getiAlertsMessages_frenchAndEnglish_haveTheSameKeys", () => {
    expect(Object.keys(enGeti.alerts)).toEqual(Object.keys(frGeti.alerts));
    expect(Object.keys(enGeti.alerts.errors)).toEqual(Object.keys(frGeti.alerts.errors));
  });

  it("getiAlerts_deletion_goesThroughTheConfirmationDialogNeverWindowConfirm", () => {
    const code = readSource("components/geti/GetiAlerts.tsx");

    expect(code).toContain("<ConfirmActionDialog");
    expect(code).not.toContain("window.confirm");
  });
});
