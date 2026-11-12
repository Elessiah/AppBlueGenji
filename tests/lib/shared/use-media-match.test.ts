/**
 * Copies bureau / largeur étroite de la barre de navigation (`useMediaMatch`,
 * `responsiveCopies`) : au rendu serveur les deux, triées par le CSS ; monté,
 * la seule de la largeur courante.
 */
import { describe, expect, it, jest } from "@jest/globals";
import { NARROW_LAYOUT_QUERY, mediaQueryList, responsiveCopies, subscribeMediaQuery } from "@/lib/shared/hooks/useMediaMatch";
import { readSource } from "../../helpers/read-source";

describe("responsiveCopies", () => {
  it("largeur inconnue (serveur, hydratation) : les deux copies", () => {
    expect(responsiveCopies(null)).toEqual({ desktop: true, narrow: true });
  });

  it("largeur étroite : la seule copie mobile", () => {
    expect(responsiveCopies(true)).toEqual({ desktop: false, narrow: true });
  });

  it("bureau : la seule copie de bureau", () => {
    expect(responsiveCopies(false)).toEqual({ desktop: true, narrow: false });
  });
});

describe("useMediaMatch", () => {
  const hook = readSource("lib/shared/hooks/useMediaMatch.ts");

  it("rend null côté serveur et suit les changements de la requête", () => {
    expect(hook).toContain("useSyncExternalStore<boolean | null>(subscribe, getSnapshot, () => null)");
    expect(hook).toContain("const getSnapshot = useCallback(() => mediaQueryList(query).matches, [query]);");
    expect(hook).toContain("useCallback((onChange: () => void) => subscribeMediaQuery(query, onChange), [query])");
  });
});

describe("subscribeMediaQuery", () => {
  type Listener = () => void;
  function withMatchMedia(list: Partial<MediaQueryList>, run: () => void): void {
    const previous = (globalThis as { window?: unknown }).window;
    (globalThis as { window?: unknown }).window = { matchMedia: () => list };
    try {
      run();
    } finally {
      (globalThis as { window?: unknown }).window = previous;
    }
  }

  it("subscribeMediaQuery_modernList_usesAddEventListenerAndCleansUp", () => {
    const addEventListener = jest.fn<(type: string, listener: Listener) => void>();
    const removeEventListener = jest.fn<(type: string, listener: Listener) => void>();
    const addListener = jest.fn<(listener: Listener) => void>();
    const onChange = jest.fn<Listener>();
    withMatchMedia({ matches: false, addEventListener, removeEventListener, addListener } as Partial<MediaQueryList>, () => {
      const unsubscribe = subscribeMediaQuery("(max-width: 11px)", onChange);
      expect(addEventListener).toHaveBeenCalledWith("change", onChange);
      unsubscribe();
      expect(removeEventListener).toHaveBeenCalledWith("change", onChange);
      expect(addListener).not.toHaveBeenCalled();
    });
  });

  it("subscribeMediaQuery_legacySafariList_fallsBackToAddListener", () => {
    const addListener = jest.fn<(listener: Listener) => void>();
    const removeListener = jest.fn<(listener: Listener) => void>();
    const onChange = jest.fn<Listener>();
    withMatchMedia({ matches: false, addListener, removeListener } as Partial<MediaQueryList>, () => {
      const unsubscribe = subscribeMediaQuery("(max-width: 12px)", onChange);
      expect(addListener).toHaveBeenCalledWith(onChange);
      unsubscribe();
      expect(removeListener).toHaveBeenCalledWith(onChange);
    });
  });
});

describe("LaunchContactCards : nom de section nettoyé", () => {
  it("sideCard_ariaLabel_usesShownEntrantName", () => {
    const cards = readSource("components/match-launch/LaunchContactCards.tsx");
    expect(cards).toContain('aria-label={shownEntrantName(side.name) ?? "—"}');
    expect(cards).not.toContain("aria-label={side.name}");
  });
});

describe("mediaQueryList", () => {
  it("mediaQueryList_sameQueryTwice_allocatesOneList", () => {
    const list = { matches: true } as unknown as MediaQueryList;
    const matchMedia = jest.fn<(query: string) => MediaQueryList>(() => list);
    const previous = (globalThis as { window?: unknown }).window;
    (globalThis as { window?: unknown }).window = { matchMedia };
    try {
      expect(mediaQueryList("(max-width: 1px)")).toBe(list);
      expect(mediaQueryList("(max-width: 1px)")).toBe(list);
      expect(matchMedia).toHaveBeenCalledTimes(1);
      mediaQueryList("(max-width: 2px)");
      expect(matchMedia).toHaveBeenCalledTimes(2);
    } finally {
      (globalThis as { window?: unknown }).window = previous;
    }
  });
});

describe("SiteNav : une seule copie montée", () => {
  const nav = readSource("components/site-nav.tsx");
  const css = readSource("components/site-nav.module.css");

  it("chaque copie dépend de la largeur courante", () => {
    expect(nav).toContain("responsiveCopies(useMediaMatch(NAV_NARROW_QUERY))");
    expect(nav).toContain("{copies.narrow && <HomeLogo className={s.navLogoMobile} />}");
    expect(nav).toContain("{copies.desktop && <NavLinks className={s.navLeft} pathname={pathname} />}");
    expect(nav).toContain("{copies.desktop && <HomeLogo className={s.navLogo} />}");
    expect(nav).toContain("{copies.narrow && <NavLinks className={s.navLeftMobile} pathname={pathname} />}");
  });

  it("le seuil JS est celui du CSS", () => {
    expect(nav).toContain("NAV_NARROW_QUERY = NARROW_LAYOUT_QUERY;");
    expect(NARROW_LAYOUT_QUERY).toBe("(max-width: 720px)");
    expect(css).toContain("@media (max-width: 720px)");
  });
});

describe("useClientPower — préférence de mouvement", () => {
  const source = readSource("lib/shared/hooks/useClientPower.ts");

  it("useClientPower_reducedMotionListener_goesThroughLegacySafariFallback", () => {
    expect(source).toContain("unsubscribeMotion = subscribeMediaQuery(REDUCED_MOTION_QUERY, onChange);");
    expect(source).toContain("unsubscribeMotion();");
    expect(source).not.toMatch(/motion\?\.addEventListener/);
  });
});
