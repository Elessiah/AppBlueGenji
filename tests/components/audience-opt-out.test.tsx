import { afterEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/components/ui/toast", () => ({
  useToast: () => ({ showError: jest.fn(), showSuccess: jest.fn() }),
}));

import { renderToStaticMarkup } from "react-dom/server";
import { AudienceOptOutControl, audienceOptOutStatus } from "@/components/privacy/AudienceOptOutControl";
import { browserAudienceOptOut } from "@/components/visit-tracker";
import { readSource } from "../helpers/read-source";

const globals = globalThis as unknown as { window?: unknown; document?: unknown };

function stubBrowser(navigator: Record<string, unknown>, cookie = "", extra: Record<string, unknown> = {}) {
  globals.window = { navigator, ...extra };
  globals.document = { cookie };
}

afterEach(() => {
  delete globals.window;
  delete globals.document;
});

describe("browserAudienceOptOut", () => {
  it("lit Global Privacy Control, Do Not Track puis le choix", () => {
    stubBrowser({ globalPrivacyControl: true });
    expect(browserAudienceOptOut()).toBe("GPC");
    stubBrowser({ doNotTrack: "1" });
    expect(browserAudienceOptOut()).toBe("DNT");
    // Ancienne propriété de fenêtre (Safari, IE).
    stubBrowser({ doNotTrack: null }, "", { doNotTrack: "1" });
    expect(browserAudienceOptOut()).toBe("DNT");
    stubBrowser({}, "bg_audience_optout=1");
    expect(browserAudienceOptOut()).toBe("CHOICE");
  });

  it("garde GPC et DNT quand les cookies sont illisibles", () => {
    globals.window = { navigator: { globalPrivacyControl: true } };
    globals.document = {
      get cookie(): string {
        throw new Error("SecurityError");
      },
    };
    expect(browserAudienceOptOut()).toBe("GPC");
  });

  it("n'efface pas au montage un refus lu par le serveur", () => {
    const source = readSource("components/privacy/AudienceOptOutControl.tsx");
    expect(source).toContain("if (browser) setReason(browser);");
    // L'écriture du cookie refusée se dit, au lieu d'échouer en silence.
    expect(source).toMatch(/try \{\s+document\.cookie = audienceOptOutCookieString/);
  });

  it("mesure sans signal ni choix", () => {
    stubBrowser({ doNotTrack: "unspecified", globalPrivacyControl: false }, "bg_session=x");
    expect(browserAudienceOptOut()).toBeNull();
  });
});

describe("VisitTracker", () => {
  it("n'envoie rien quand la visite est refusée", () => {
    const source = readSource("components/visit-tracker.tsx");
    expect(source).toContain("if (browserAudienceOptOut() || pingedRecently()) return;");
    // Le refus précède l'appel : rien n'est signalé au serveur.
    expect(source.indexOf("browserAudienceOptOut() ||")).toBeLessThan(source.indexOf('fetch("/api/visits"'));
  });
});

describe("AudienceOptOutControl", () => {
  it("offre l'opposition quand la mesure est active", () => {
    const html = renderToStaticMarkup(<AudienceOptOutControl initialReason={null} />);
    expect(html).toContain("M&#x27;opposer à la mesure d&#x27;audience");
    expect(html).toContain("actuellement mesurées");
  });

  it("offre le retour une fois l'opposition choisie", () => {
    const html = renderToStaticMarkup(<AudienceOptOutControl initialReason="CHOICE" />);
    expect(html).toContain("Réactiver la mesure d&#x27;audience");
  });

  it("n'offre aucun bouton sous un signal du navigateur, qui ne se lève pas d'ici", () => {
    for (const reason of ["GPC", "DNT"] as const) {
      const html = renderToStaticMarkup(<AudienceOptOutControl initialReason={reason} />);
      expect(html).not.toContain("<button");
      expect(html).toContain("se règle dans votre navigateur");
    }
  });

  it("nomme chaque état", () => {
    expect(audienceOptOutStatus("GPC")).toContain("Global Privacy Control");
    expect(audienceOptOutStatus("DNT")).toContain("Do Not Track");
    expect(audienceOptOutStatus("CHOICE")).toContain("ni signalées au serveur, ni enregistrées");
    expect(audienceOptOutStatus(null)).toContain("mesurées");
  });
});
