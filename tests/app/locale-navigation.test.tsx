import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/shared/i18n-routes", () => ({
  MIGRATED_ROUTES: ["/", "/regles", "/equipes/[id]", "/joueurs/[id]"],
}));

let mockPathname = "/regles";
const mockRouter = {
  push: jest.fn(),
  replace: jest.fn(),
  prefetch: jest.fn(),
  back: jest.fn(),
  forward: jest.fn(),
  refresh: jest.fn(),
};
jest.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
  useRouter: () => mockRouter,
}));
// `next/link` marqué, pour distinguer une navigation client d'un `<a>` nu.
jest.mock("next/link", () => {
  const { forwardRef, createElement } = jest.requireActual<typeof import("react")>("react");
  return {
    __esModule: true,
    default: forwardRef<HTMLAnchorElement, Record<string, unknown>>(function MockLink(props, ref) {
      const { prefetch: _prefetch, replace: _replace, scroll: _scroll, ...rest } = props;
      return createElement("a", { ...rest, ref, "data-next-link": "" });
    }),
  };
});

import { renderToStaticMarkup } from "react-dom/server";
import { LocaleLink, useLocaleHref, useLocalePathname, useLocaleRouter, type LocaleRouter } from "@/components/i18n/locale-navigation";
import { PlayerLink, TeamLink } from "@/components/entity-link";
import { EntrantLink, EntrantProvider } from "@/app/(secured)/tournois/[id]/_lib/entrant-link";
import { withIntl } from "../helpers/intl";
import type { Locale } from "@/lib/shared/locales";

const render = (ui: React.ReactElement, locale: Locale = "fr") => renderToStaticMarkup(withIntl(ui, { locale }));

describe("LocaleLink — lien dans la langue de la page", () => {
  it("préfixe une route traduite sur une page anglaise, en navigation client", () => {
    const html = render(<LocaleLink href="/regles">Règles</LocaleLink>, "en");
    expect(html).toBe('<a href="/en/regles" data-next-link="">Règles</a>');
  });

  it("garde l'adresse nue sur une page française", () => {
    expect(render(<LocaleLink href="/regles">Règles</LocaleLink>)).toBe('<a href="/regles" data-next-link="">Règles</a>');
  });

  it("charge le document entier quand le lien change de langue", () => {
    const html = render(<LocaleLink href="/classement">Classement</LocaleLink>, "en");
    expect(html).toBe('<a href="/classement">Classement</a>');
  });

  it("vaut français hors de tout fournisseur", () => {
    expect(renderToStaticMarkup(<LocaleLink href="/regles">Règles</LocaleLink>)).toContain('href="/regles"');
  });
});

describe("liens d'entité — chemin construit une fois, langue de la page", () => {
  it("TeamLink et PlayerLink mènent à la fiche dans la langue de la page", () => {
    expect(render(<TeamLink teamId={7}>Nova</TeamLink>, "en")).toContain('href="/en/equipes/7"');
    expect(render(<PlayerLink userId={3}>Kai</PlayerLink>, "en")).toContain('href="/en/joueurs/3"');
    expect(render(<TeamLink teamId={7}>Nova</TeamLink>)).toContain('href="/equipes/7"');
  });

  it("EntrantLink résout l'entrée solo vers le joueur, préfixe compris", () => {
    const html = render(
      <EntrantProvider participantType="SOLO" soloUserIds={{ 9: 42 }} logos={{}}>
        <EntrantLink teamId={9}>Solo</EntrantLink>
      </EntrantProvider>,
      "en",
    );
    expect(html).toContain('href="/en/joueurs/42"');
  });
});

describe("useLocaleRouter / useLocaleHref / useLocalePathname", () => {
  const assign = jest.fn();
  const replace = jest.fn();
  const originalLocation = globalThis.location;

  beforeEach(() => {
    Object.defineProperty(globalThis, "location", { value: { assign, replace }, configurable: true });
  });
  afterEach(() => {
    Object.defineProperty(globalThis, "location", { value: originalLocation, configurable: true });
    jest.clearAllMocks();
    mockPathname = "/regles";
  });

  function capture(locale: Locale) {
    const seen: { router?: LocaleRouter; href?: (h: string) => string; path?: ReturnType<typeof useLocalePathname> } = {};
    function Probe() {
      seen.router = useLocaleRouter();
      seen.href = useLocaleHref();
      seen.path = useLocalePathname();
      return null;
    }
    render(<Probe />, locale);
    return seen;
  }

  it("pousse l'adresse anglaise d'une route traduite par le routeur", () => {
    const { router } = capture("en");
    router?.push("/regles", { scroll: false });
    expect(mockRouter.push).toHaveBeenCalledWith("/en/regles", { scroll: false });
    router?.replace("/equipes/4");
    expect(mockRouter.replace).toHaveBeenCalledWith("/en/equipes/4", undefined);
    router?.prefetch("/regles");
    expect(mockRouter.prefetch).toHaveBeenCalledWith("/en/regles");
  });

  it("change de document, sans routeur, pour une route d'une autre langue", () => {
    const { router } = capture("en");
    router?.push("/classement");
    router?.replace("/classement?x=1");
    router?.prefetch("/classement");
    expect(assign).toHaveBeenCalledWith("/classement");
    expect(replace).toHaveBeenCalledWith("/classement?x=1");
    expect(mockRouter.push).not.toHaveBeenCalled();
    expect(mockRouter.prefetch).not.toHaveBeenCalled();
  });

  it("relaie back, forward et refresh", () => {
    const { router } = capture("fr");
    router?.back();
    router?.forward();
    router?.refresh();
    expect(mockRouter.back).toHaveBeenCalled();
    expect(mockRouter.forward).toHaveBeenCalled();
    expect(mockRouter.refresh).toHaveBeenCalled();
  });

  it("construit une adresse et lit le chemin sans préfixe", () => {
    mockPathname = "/en/regles";
    const { href, path } = capture("en");
    expect(href?.("/regles")).toBe("/en/regles");
    expect(path).toEqual({ locale: "en", path: "/regles" });
  });
});
