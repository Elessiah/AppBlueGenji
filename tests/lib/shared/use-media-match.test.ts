/**
 * Copies bureau / largeur étroite de la barre de navigation (`useMediaMatch`,
 * `responsiveCopies`) : au rendu serveur les deux, triées par le CSS ; monté,
 * la seule de la largeur courante.
 */
import { describe, expect, it } from "@jest/globals";
import { responsiveCopies } from "@/lib/shared/hooks/useMediaMatch";
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
    expect(hook).toContain("() => window.matchMedia(query).matches, () => null");
    expect(hook).toContain('list.addEventListener("change", onChange);');
    expect(hook).toContain('list.removeEventListener("change", onChange);');
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
    expect(nav).toContain('NAV_NARROW_QUERY = "(max-width: 720px)"');
    expect(css).toContain("@media (max-width: 720px)");
  });
});
