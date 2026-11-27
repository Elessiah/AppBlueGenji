import { describe, expect, it, jest } from "@jest/globals";

jest.mock("@/components/ui/toast", () => ({
  useToast: () => ({ showError: jest.fn(), showSuccess: jest.fn(), showInfo: jest.fn() }),
}));
jest.mock("@/components/i18n/locale-navigation", () => ({
  useLocaleRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
}));

import { renderToStaticMarkup } from "react-dom/server";
import { GetiCopyTag } from "@/components/geti/GetiCopyTag";
import { GetiFilters } from "@/components/geti/GetiFilters";
import { GetiPostText } from "@/components/geti/GetiPostText";
import { AppLocaleProvider } from "@/components/i18n/locale-context";
import { emptyGetiPageQuery, GETI_CATEGORY_FILTERS } from "@/lib/shared/geti/page";
import { getiDataText } from "@/lib/shared/geti/page-text";
import enMessages from "@/messages/en/geti.json";
import frMessages from "@/messages/fr/geti.json";
import { readSource } from "../helpers/read-source";

const COPY_TEXT = {
  copy: "Copy",
  copyLabel: "Copy {tag}",
  copied: "Copied {tag}",
  copyFailed: "Failed",
  tagLabel: "Discord username",
  tagPrefix: "Discord username:",
};

/** Options d'une liste d'heures, repérée par la fin de son identifiant (`…-hourFrom`). */
function hourOptions(markup: string, key: "hourFrom" | "hourTo"): string[] {
  const start = markup.indexOf(`-${key}"`);
  const end = markup.indexOf("</select>", start);
  return [...markup.slice(start, end).matchAll(/<option value="(\d+)">([^<]+)<\/option>/g)].map(
    (match) => `${match[1]}=${match[2]}`,
  );
}

function renderFilters(locale: "fr" | "en"): string {
  const messages = locale === "fr" ? frMessages : enMessages;
  return renderToStaticMarkup(
    <AppLocaleProvider locale={locale}>
      <GetiFilters
        category="lfp"
        query={emptyGetiPageQuery()}
        fields={GETI_CATEGORY_FILTERS.lfp}
        ageOptions={[1, 3]}
        retentionDays={7}
        text={messages.filters}
        data={getiDataText(messages)}
      />
    </AppLocaleProvider>,
  );
}

describe("GetiPostText", () => {
  it("un texte long est rendu replié avec son bouton (avant mesure)", () => {
    const markup = renderToStaticMarkup(<GetiPostText body="texte" long text={{ more: "Lire la suite", less: "Replier" }} />);

    expect(markup).toContain("Lire la suite");
    expect(markup).toContain('aria-expanded="false"');
  });

  it("un texte court n'a pas de bouton", () => {
    const markup = renderToStaticMarkup(<GetiPostText body="texte" long={false} text={{ more: "Lire la suite", less: "Replier" }} />);

    expect(markup).not.toContain("Lire la suite");
  });

  it("le bouton ne reste que si le texte replié dépasse réellement", () => {
    const source = readSource("components/geti/GetiPostText.tsx");

    expect(source).toContain("element.scrollHeight > element.clientHeight + 1");
    expect(source).toContain("const collapsible = long && (open || overflowing);");
  });
});

describe("GetiCopyTag", () => {
  it("le préfixe lu avant le pseudo vient des messages, sans ponctuation écrite en dur", () => {
    const markup = renderToStaticMarkup(
      <AppLocaleProvider locale="en">
        <GetiCopyTag tag="kiri" text={COPY_TEXT} />
      </AppLocaleProvider>,
    );

    expect(markup).toContain('<span class="sr-only">Discord username: </span>kiri');
  });

  it("le préfixe existe en français et en anglais", () => {
    expect(frMessages.post.tagPrefix).toBe("Pseudo Discord :");
    expect(enMessages.post.tagPrefix).toBe("Discord username:");
  });
});

describe("GetiFilters — heures", () => {
  it("le début propose 0h à 23h", () => {
    const options = hourOptions(renderFilters("fr"), "hourFrom");

    expect(options[0]).toBe("0=0h");
    expect(options.at(-1)).toBe("23=23h");
    expect(options).toHaveLength(24);
  });

  it("la fin propose 1h à 24h : la fin de journée ne s'écrit plus « 0h »", () => {
    const options = hourOptions(renderFilters("fr"), "hourTo");

    expect(options[0]).toBe("1=1h");
    expect(options.at(-1)).toBe("24=24h");
    expect(options).toHaveLength(24);
  });

  it("en anglais, les heures s'écrivent 00:00 à 24:00", () => {
    const markup = renderFilters("en");

    expect(markup).toContain('<option value="0">00:00</option>');
    expect(markup).toContain('<option value="24">24:00</option>');
    expect(markup).not.toMatch(/<option value="\d+">\d+h<\/option>/);
  });

  it("le rendu d'un changement plus ancien ne défait pas le dernier geste ; un retour arrière lève l'attente", () => {
    const source = readSource("components/geti/GetiFilters.tsx");

    expect(source).toContain("getiFilterSync(pendingSearch.current, serverSearch)");
    expect(source).toContain('window.addEventListener("popstate", release)');
  });
});

describe("GetiInfoView", () => {
  it("data-nosnippet est posé sur une enveloppe div, pas sur la liste", () => {
    const source = readSource("components/geti/GetiInfoView.tsx");

    expect(source).toContain('<div data-nosnippet="" data-testid="geti-nosnippet">');
    expect(source).not.toMatch(/<ul[^>]*data-nosnippet/);
  });

  it("une page au-delà de la dernière a son message et son lien, en français et en anglais", () => {
    expect(frMessages.results.beyond).not.toBe("");
    expect(enMessages.results.beyond).not.toBe("");
    expect(frMessages.results.beyondLink).toContain("{page}");
    expect(enMessages.results.beyondLink).toContain("{page}");
  });
});
