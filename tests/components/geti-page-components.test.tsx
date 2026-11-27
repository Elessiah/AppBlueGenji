import { describe, expect, it, jest } from "@jest/globals";

jest.mock("@/components/ui/toast", () => ({
  useToast: () => ({ showError: jest.fn(), showSuccess: jest.fn(), showInfo: jest.fn() }),
}));
jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh: jest.fn() }) }));
jest.mock("@/components/i18n/locale-navigation", () => ({
  useLocaleRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
}));

import { renderToStaticMarkup } from "react-dom/server";
import { GetiCopyTag } from "@/components/geti/GetiCopyTag";
import { GetiFilters } from "@/components/geti/GetiFilters";
import { GetiLayout } from "@/components/geti/GetiLayout";
import { GetiRetry } from "@/components/geti/GetiRetry";
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
        total={12}
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

  it("l'attente porte l'adresse normalisée, se lève à chaque rendu et sur un lien suivi", () => {
    const source = readSource("components/geti/GetiFilters.tsx");

    expect(source).toContain("pendingSearch.current = getiNormalizedSearch(category, first)");
    expect(source).not.toContain("lastServerSearch");
    expect(source).toContain('document.addEventListener("click", releaseOnLink, true)');
    expect(source).toContain('closest("a[href]")');
  });

  it("un lien ne lève l'attente que s'il remplace cette page", () => {
    const source = readSource("components/geti/GetiFilters.tsx");

    expect(source).toContain("getiLinkNavigatesTab(");
    expect(source).toContain('link.hasAttribute("download")');
  });

  it("l'attente se lève quand toutes les navigations de filtre sont rendues", () => {
    const source = readSource("components/geti/GetiFilters.tsx");

    expect(source).toContain("const [navigating, startNavigation] = useTransition();");
    expect(source).toContain("if (!navigating) pendingSearch.current = null;");
    expect(source).toContain("startNavigation(() => router.replace(");
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

  it("au-delà de la dernière page, liste vide comprise, la pagination n'est pas rendue", () => {
    const source = readSource("components/geti/GetiInfoView.tsx");

    expect(source).toMatch(/\{query\.page > pages \? null : \(\s*<GetiPagination/);
  });
});

describe("GetiLayout, GetiRetry et finitions UI (cycle ui 1)", () => {
  it("la grille n'est ni occupée ni en attente au rendu initial", () => {
    const markup = renderToStaticMarkup(<GetiLayout>contenu</GetiLayout>);

    expect(markup).toContain('aria-busy="false"');
    expect(markup).not.toContain("data-pending");
    expect(markup).not.toContain("data-single");
  });

  it("sans liste, la grille passe en colonne unique", () => {
    expect(renderToStaticMarkup(<GetiLayout single>x</GetiLayout>)).toContain('data-single="true"');
  });

  it("le bouton Réessayer porte son libellé", () => {
    expect(renderToStaticMarkup(<GetiRetry label="Réessayer" error="Indisponible" />)).toContain("Réessayer");
  });

  it("GetiRetry_mount_announcesTheFailureAsAToastNotInline", () => {
    const source = readSource("components/geti/GetiRetry.tsx");
    const markup = renderToStaticMarkup(<GetiRetry label="Réessayer" error="Indisponible" />);

    expect(source).toMatch(/useEffect\(\(\) => \{\s*showError\(error\);/);
    expect(markup).not.toContain("Indisponible");
  });

  it("GetiRetry_retryStillUnavailable_announcesTheFailureAgain", () => {
    const source = readSource("components/geti/GetiRetry.tsx");

    expect(source).toContain("useTransition()");
    expect(source).toMatch(/if \(retrying \|\| !retried\.current\) return;\s*retried\.current = false;\s*showError\(error\);/);
    expect(source).toContain("startRetry(() => router.refresh())");
  });

  it("GetiInfoView_listUnavailable_logsACodeOnlyAndShowsANeutralLine", () => {
    const source = readSource("components/geti/GetiInfoView.tsx");

    expect(source).toContain("logGetiListFailure(error);");
    expect(source).toContain("{m.results.none}");
    expect(source).toContain("error={m.results.unavailable}");
  });

  it("les messages du repli neutre et du texte masqué existent en français et en anglais", () => {
    expect([frMessages.results.none, enMessages.results.none]).toEqual(["Annonces non chargées.", "Posts not loaded."]);
    expect([frMessages.post.spoiler, enMessages.post.spoiler]).toEqual(["[masqué]", "[hidden]"]);
  });

  it("l'attente d'un filtre ne passe pas par une opacité (contraste 4,5:1)", () => {
    const css = readSource("components/geti/geti.module.css");

    expect(css).not.toMatch(/data-pending="true"\] \.results \{[^}]*opacity/);
  });

  it("le panneau rend le bouton « Voir les annonces » avec le total, et une zone de statut", () => {
    const fr = renderFilters("fr");
    const en = renderFilters("en");

    expect(fr).toContain("Voir les 12 annonces");
    expect(en).toContain("Show all 12 posts");
    expect(fr).toContain("<output");
  });

  it("la réinitialisation déplace le focus avant que son bouton disparaisse", () => {
    const source = readSource("components/geti/GetiFilters.tsx");

    expect(source).toContain("const resetAll = () => {");
    expect(source).toContain("focusStableTarget(toggleRef.current, titleRef.current);");
    expect(source).not.toContain("onClick={() => apply({ ...emptyGetiPageQuery() })}");
  });

  it("le repli de copie rend le focus au bouton et évite le zoom iOS", () => {
    const source = readSource("components/geti/GetiCopyTag.tsx");

    expect(source).toContain("previous?.focus({ preventScroll: true });");
    expect(source).toContain('area.style.fontSize = "16px"');
  });

  it("la date exacte est un texte visible, pas une infobulle", () => {
    const source = readSource("components/geti/GetiPostCard.tsx");

    expect(source).not.toContain("title={getiText(locale, text.postedAt");
    expect(source).toContain("getiText(locale, text.postedAt, { date: postedAbsolute })");
  });

  it("le surlignage des étiquettes l'emporte sur la teinte globale", () => {
    expect(readSource("components/geti/geti.module.css")).toContain(".chips .chipMatch {");
  });

  it("les nouvelles clés existent en français et en anglais", () => {
    for (const messages of [frMessages, enMessages]) {
      expect(messages.filters.updating).not.toBe("");
      expect(messages.filters.apply).toContain("{count");
      expect(messages.results.retry).not.toBe("");
    }
  });
});

describe("coût de la page (perf 1)", () => {
  it("filtres : la navigation est différée, la réinitialisation est immédiate", () => {
    const source = readSource("components/geti/GetiFilters.tsx");
    expect(source).toContain("GETI_FILTER_DEBOUNCE_MS");
    expect(source).toContain("setTimeout(go, GETI_FILTER_DEBOUNCE_MS)");
    expect(source).toContain("apply({ ...emptyGetiPageQuery() }, true)");
    expect(source).toContain("useEffect(() => cancelNavigation, [])");
  });

  it("la page lit la liste mutualisée et construit ses libellés une fois", () => {
    const source = readSource("components/geti/GetiInfoView.tsx");
    expect(source).toContain("listGetiPostsShared(");
    expect(source.match(/getiDataText\(m\)/g)).toHaveLength(1);
  });

  it("la carte officielle de la fenêtre Publier n'est plus portée par le serveur", () => {
    const publish = readSource("components/geti/GetiPublishButton.tsx");
    const card = readSource("components/geti/GetiOfficialCard.tsx");
    expect(publish).toContain("official: OfficialText");
    expect(publish).not.toContain("card: ReactNode");
    expect(card).not.toContain("lib/server");
  });

  it("le texte long ne mesure pas de façon synchrone quand l'observateur existe", () => {
    const source = readSource("components/geti/GetiPostText.tsx");
    expect(source.indexOf("measure();")).toBeGreaterThan(source.indexOf('typeof ResizeObserver === "undefined"'));
  });
});
