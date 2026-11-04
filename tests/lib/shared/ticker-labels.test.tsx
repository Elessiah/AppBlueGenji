/**
 * EF-17 — le bandeau ne lit plus le dictionnaire de l'accueil : ses libellés
 * français vivent dans un petit module, les autres langues lui sont passées.
 */
import { describe, expect, it } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import frLanding from "@/messages/fr/landing.json";
import enLanding from "@/messages/en/landing.json";
import { Ticker } from "@/components/cyber/Ticker";
import { LandingTicker } from "@/components/cyber/landing/LandingTicker";
import { LandingTextProvider } from "@/components/i18n/landing-text";
import { landingClientMessages } from "@/lib/shared/landing-text";
import { FR_TICKER_LABELS, tickerControls } from "@/lib/shared/ticker-labels";
import { readSource } from "../../helpers/read-source";

describe("FR_TICKER_LABELS", () => {
  it("FR_TICKER_LABELS_matchesFrenchLanding_equalsFiveTickerKeys", () => {
    expect(FR_TICKER_LABELS).toEqual(tickerControls(frLanding.ticker));
  });
});

describe("tickerControls", () => {
  it("tickerControls_englishLandingTicker_picksFiveLabelsOnly", () => {
    expect(tickerControls(enLanding.ticker)).toEqual({
      label: enLanding.ticker.label,
      resume: enLanding.ticker.resume,
      pause: enLanding.ticker.pause,
      resumeShort: enLanding.ticker.resumeShort,
      pauseShort: enLanding.ticker.pauseShort,
    });
  });
});

describe("Ticker", () => {
  it("Ticker_noLabels_rendersFrenchLabels", () => {
    const html = renderToStaticMarkup(<Ticker items={["Alpha"]} />);
    expect(html).toContain('aria-label="Fil d&#x27;actualité"');
    expect(html).toContain('aria-label="Mettre en pause le défilement du bandeau"');
    expect(html).toContain('title="Pause"');
  });

  it("Ticker_englishLabels_rendersGivenLabels", () => {
    const html = renderToStaticMarkup(<Ticker items={["Alpha"]} labels={tickerControls(enLanding.ticker)} />);
    expect(html).toContain(`aria-label="${enLanding.ticker.label}"`);
    expect(html).toContain(`aria-label="${enLanding.ticker.pause}"`);
  });

  it("Ticker_source_doesNotImportLandingText", () => {
    const source = readSource("components/cyber/Ticker.tsx");
    expect(source).not.toContain("useLandingText");
    expect(source).not.toContain("landing-text");
    expect(source).not.toContain("landing.json");
  });
});

describe("LandingTicker", () => {
  it("LandingTicker_englishProvider_passesLandingLabels", () => {
    const html = renderToStaticMarkup(
      <LandingTextProvider locale="en" messages={landingClientMessages(enLanding)}>
        <LandingTicker items={["Alpha"]} />
      </LandingTextProvider>,
    );
    expect(html).toContain(`aria-label="${enLanding.ticker.label}"`);
  });

  it("LandingTicker_noProvider_rendersFrenchLabels", () => {
    expect(renderToStaticMarkup(<LandingTicker items={["Alpha"]} />)).toContain('aria-label="Fil d&#x27;actualité"');
  });
});
