import { beforeEach, describe, expect, it, jest } from "@jest/globals";

let mockLocale: "fr" | "en" = "fr";
jest.mock("@/lib/server/request-locale", () => ({ requestLocale: async () => mockLocale }));
jest.mock("@/components/cyber/landing/PublicPageShell", () => ({
  PublicPageShell: ({ children }: { children: unknown }) => children,
}));
jest.mock("@/lib/server/auth", () => ({ getCurrentUser: jest.fn(async () => null) }));
jest.mock("@/lib/server/tournaments-service", () => ({
  getVisibleTournamentCard: jest.fn(),
  getVisibleTournamentSnapshot: jest.fn(),
}));
jest.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.7" }),
}));
jest.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  usePathname: () => "/",
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined, prefetch: () => undefined }),
  useSearchParams: () => new URLSearchParams(),
}));

import { renderToStaticMarkup } from "react-dom/server";
import RuleModePage from "@/app/regles/[slug]/page";
import { AppLocaleProvider } from "@/components/i18n/locale-context";
import { getCurrentUser } from "@/lib/server/auth";
import { clearCache } from "@/lib/server/cache";
import { resetRateLimit } from "@/lib/server/rate-limit";
import { getVisibleTournamentCard, getVisibleTournamentSnapshot } from "@/lib/server/tournaments-service";
import { RULE_MODE_DEFINITIONS } from "@/lib/shared/tournament-rules";
import type { Locale } from "@/lib/shared/locales";
import { authUser } from "../helpers/auth-user";
import { tournamentCard } from "../helpers/tournament-card";
import { tournamentSnapshot } from "../helpers/tournament-detail";

/**
 * Le « ? » des règles depuis la page sans compte mène à
 * `/regles/<mode>?tournoi=<id>` : sans session aussi, les réglages du tournoi
 * publié s'y affichent (réponse publique mutualisée), et le retour ramène à la
 * page sans compte.
 */

const SLUG = RULE_MODE_DEFINITIONS[0].slug;
const card = tournamentCard({ id: 5, name: "Coupe Test_" });

async function renderRules(locale: Locale = "fr", tournoi: string | null = "5"): Promise<string> {
  mockLocale = locale;
  const page = await RuleModePage({
    params: Promise.resolve({ slug: SLUG }),
    searchParams: Promise.resolve(tournoi === null ? {} : { tournoi }),
  });
  return renderToStaticMarkup(<AppLocaleProvider locale={locale}>{page}</AppLocaleProvider>);
}

beforeEach(() => {
  clearCache();
  resetRateLimit();
  jest.mocked(getCurrentUser).mockResolvedValue(null);
  jest.mocked(getVisibleTournamentCard).mockResolvedValue(card);
  jest.mocked(getVisibleTournamentSnapshot).mockReset();
  jest.mocked(getVisibleTournamentSnapshot).mockResolvedValue(tournamentSnapshot({ card }));
});

describe("réglages d'un tournoi sur la page des règles", () => {
  it("sans session : les réglages du tournoi publié, sans aucun droit, et le retour vers la page sans compte", async () => {
    const html = await renderRules();

    expect(html).toContain("Coupe Test_");
    expect(html).toContain('href="/suivre/tournois/5"');
    expect(html).not.toContain('href="/tournois/5"');
    expect(getVisibleTournamentSnapshot).toHaveBeenCalledWith(5);
  });

  it("sans session, en anglais : le retour garde la langue", async () => {
    const html = await renderRules("en");
    expect(html).toContain('href="/en/suivre/tournois/5"');
  });

  it("sans session : servi par la réponse mutualisée, une passe en base pour plusieurs vues", async () => {
    await renderRules();
    await renderRules("en");
    expect(getVisibleTournamentSnapshot).toHaveBeenCalledTimes(1);
  });

  it("sans session, tournoi absent ou pas encore publié : la page générale du mode", async () => {
    jest.mocked(getVisibleTournamentCard).mockResolvedValue(null);
    const html = await renderRules();
    expect(html).not.toContain("Coupe Test_");
    expect(getVisibleTournamentSnapshot).not.toHaveBeenCalled();
  });

  it("base injoignable : la page générale du mode, sans erreur", async () => {
    jest.mocked(getVisibleTournamentSnapshot).mockRejectedValue(new Error("ECONNREFUSED"));
    const html = await renderRules();
    expect(html).not.toContain("Coupe Test_");
  });

  it("avec une session : l'instantané lu avec ses droits, et le retour vers la fiche connectée", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(authUser());
    const html = await renderRules();

    expect(html).toContain("Coupe Test_");
    expect(html).toContain('href="/tournois/5"');
    expect(getVisibleTournamentSnapshot).toHaveBeenCalledWith(5, { canManage: false });
  });

  it("session illisible : lue comme une visite sans compte", async () => {
    jest.mocked(getCurrentUser).mockRejectedValue(new Error("ECONNREFUSED"));
    const html = await renderRules();
    expect(html).toContain('href="/suivre/tournois/5"');
  });

  it("sans `?tournoi=` : rien à lire", async () => {
    const html = await renderRules("fr", null);
    expect(html).not.toContain("Coupe Test_");
    expect(getVisibleTournamentSnapshot).not.toHaveBeenCalled();
  });
});
