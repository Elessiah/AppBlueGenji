import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { ReactElement } from "react";

let mockLocale: "fr" | "en" = "fr";
let mockPathname: string | null = "/tournois/12";
let mockSearch: string | null = null;
jest.mock("@/lib/server/request-locale", () => ({ requestLocale: async () => mockLocale }));
jest.mock("@/lib/server/auth", () => ({ getCurrentUser: jest.fn(async () => null) }));
jest.mock("@/lib/server/tournaments-service", () => ({ getVisibleTournamentCard: jest.fn() }));
jest.mock("next/headers", () => ({
  headers: async () =>
    new Headers({
      ...(mockPathname === null ? {} : { "x-pathname": mockPathname }),
      ...(mockSearch === null ? {} : { "x-search": mockSearch }),
    }),
}));
jest.mock("next/navigation", () => ({
  redirect: jest.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  }),
  notFound: jest.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  usePathname: () => "/tournois/12",
  useSearchParams: () => new URLSearchParams(""),
  useParams: () => ({ id: "12" }),
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined, prefetch: () => undefined, back: () => undefined, forward: () => undefined }),
}));
jest.mock("@/components/arena-shell", () => ({
  ArenaShell: ({ children }: { children: React.ReactNode }) => <div data-shell="arena">{children}</div>,
}));
jest.mock("@/components/legal/SiteFooterBar", () => ({ SiteFooterBar: () => null }));
// En-tête et pied de la vitrine : composants serveur asynchrones, hors de ce test.
jest.mock("@/components/cyber/landing/PublicPageShell", () => ({
  PublicPageShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));

import { renderToStaticMarkup } from "react-dom/server";
import { redirect, notFound } from "next/navigation";
import SecuredLayout from "@/app/(secured)/layout";
import SpectatorLayout, { generateMetadata } from "@/app/suivre/tournois/[id]/layout";
import { getCurrentUser } from "@/lib/server/auth";
import { getVisibleTournamentCard } from "@/lib/server/tournaments-service";
import { PlayerLink, TeamLink } from "@/components/entity-link";
import { SpectatorViewProvider } from "@/components/spectator-view";
import { PodiumTiersProvider } from "@/components/podium-tiers";
import { buildPodiumTiers } from "@/lib/shared/podium-tiers";
import { EntrantLink, EntrantProvider } from "@/app/(secured)/tournois/[id]/_lib/entrant-link";
import { MapResultList } from "@/app/(secured)/tournois/[id]/_components/MatchMapDetails";
import { LiveIndicator } from "@/app/(secured)/tournois/[id]/_components/LiveIndicator";
import { TournamentHeader } from "@/app/(secured)/tournois/[id]/_components/TournamentHeader";
import { TournamentLoading } from "@/app/(secured)/tournois/[id]/_components/TournamentLoading";
import { ToastProvider } from "@/components/ui/toast";
import { buildEntrantLogoMap } from "@/lib/shared/entrant-logos";
import { isMigratedRoute } from "@/lib/shared/locales";
import { SPECTATOR_VIEWER_CONTEXT } from "@/lib/shared/spectator-view";
import frTournament from "@/messages/fr/tournament.json";
import enTournament from "@/messages/en/tournament.json";
import { authUser } from "../helpers/auth-user";
import { tournamentCard } from "../helpers/tournament-card";
import { tournamentSnapshot } from "../helpers/tournament-detail";
import { readSource } from "../helpers/read-source";

/**
 * Page sans compte d'un tournoi (`docs/features/SPECTATOR_VIEW.md`) : les deux
 * redirections entre espaces, l'encart, et ce que la fiche commune tait ou
 * change sous `SpectatorViewProvider`.
 */

function spectator(ui: ReactElement): string {
  return renderToStaticMarkup(
    <ToastProvider>
      <SpectatorViewProvider>{ui}</SpectatorViewProvider>
    </ToastProvider>,
  );
}

function member(ui: ReactElement): string {
  return renderToStaticMarkup(<ToastProvider>{ui}</ToastProvider>);
}

const noop = () => undefined;

beforeEach(() => {
  mockLocale = "fr";
  mockPathname = "/tournois/12";
  mockSearch = null;
  jest.mocked(getCurrentUser).mockResolvedValue(null);
});

afterEach(() => {
  jest.clearAllMocks();
});

describe("espace sécurisé — visiteur sans session", () => {
  it("renvoie la fiche d'un tournoi vers sa page sans compte", async () => {
    await expect(SecuredLayout({ children: <p>protégé</p> })).rejects.toThrow("NEXT_REDIRECT /suivre/tournois/12");
  });

  it("garde la langue de l'adresse", async () => {
    mockLocale = "en";
    await expect(SecuredLayout({ children: <p>protégé</p> })).rejects.toThrow("NEXT_REDIRECT /en/suivre/tournois/12");
  });

  it("fait suivre la requête de l'adresse demandée", async () => {
    mockSearch = "?utm_source=discord";
    await expect(SecuredLayout({ children: <p>protégé</p> })).rejects.toThrow(
      "NEXT_REDIRECT /suivre/tournois/12?utm_source=discord",
    );
  });

  it("ne reprend qu'une requête, jamais un fragment de chemin venu du client", async () => {
    mockSearch = "//evil.test";
    await expect(SecuredLayout({ children: <p>protégé</p> })).rejects.toThrow(/NEXT_REDIRECT \/suivre\/tournois\/12$/);
  });

  it("laisse la carte « Connexion requise » partout ailleurs", async () => {
    for (const path of ["/tournois", "/tournois/creer", "/tournois/12/modifier", "/equipes/12", null]) {
      mockPathname = path;
      const html = renderToStaticMarkup(await SecuredLayout({ children: <p>protégé</p> }));
      expect(html).not.toContain("protégé");
    }
    expect(redirect).not.toHaveBeenCalled();
  });

  it("ne redirige pas un membre connecté : sa fiche a ses actions", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(authUser({ id: 7 }));
    const html = renderToStaticMarkup(await SecuredLayout({ children: <p>fiche</p> }));
    expect(html).toContain("fiche");
    expect(redirect).not.toHaveBeenCalled();
  });

  it("relaie côté client la carte servie par un préchargement, ancre comprise", () => {
    const gate = readSource("app/(secured)/_shared/AuthGate.tsx");
    expect(gate).toContain("tournamentIdFromMemberPath(splitLocalePrefix(pathname).path)");
    expect(gate).toContain("router.replace(`${spectatorTournamentPath(spectatorId)}${search}${hash}`);");
    // Pas de carte « Connexion requise » le temps du relais.
    expect(gate).toContain("if (spectatorId !== null) return null;");
  });
});

describe("page sans compte — mise en page", () => {
  const params = (id: string) => ({ params: Promise.resolve({ id }) });

  it("renvoie un membre connecté vers sa fiche, dans sa langue", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(authUser({ id: 7 }));
    await expect(SpectatorLayout({ children: null, ...params("12") })).rejects.toThrow("NEXT_REDIRECT /tournois/12");
    mockLocale = "en";
    await expect(SpectatorLayout({ children: null, ...params("12") })).rejects.toThrow("NEXT_REDIRECT /en/tournois/12");
  });

  it("fait suivre la requête au membre renvoyé vers sa fiche, et elle seule", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(authUser({ id: 7 }));
    mockSearch = "?utm_source=discord";
    await expect(SpectatorLayout({ children: null, ...params("12") })).rejects.toThrow(
      "NEXT_REDIRECT /tournois/12?utm_source=discord",
    );
    mockSearch = "//evil.test";
    await expect(SpectatorLayout({ children: null, ...params("12") })).rejects.toThrow(/NEXT_REDIRECT \/tournois\/12$/);
  });

  it("sert la page au visiteur sans session, dans le gabarit de la vitrine", async () => {
    const html = renderToStaticMarkup(await SpectatorLayout({ children: <p>plateau</p>, ...params("12") }));
    expect(html).toContain("plateau");
    expect(html).toContain('class="page-shell"');
    expect(html).toContain("<main");
  });

  it("reste servie quand la session est illisible (base injoignable)", async () => {
    jest.mocked(getCurrentUser).mockRejectedValue(new Error("ECONNREFUSED"));
    const html = renderToStaticMarkup(await SpectatorLayout({ children: <p>plateau</p>, ...params("12") }));
    expect(html).toContain("plateau");
  });

  it("répond 404 à un identifiant qui n'en est pas un", async () => {
    await expect(SpectatorLayout({ children: null, ...params("abc") })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalled();
  });

  it("porte l'encart du tournoi, sans droit, à sa propre adresse, hors des moteurs", async () => {
    jest.mocked(getVisibleTournamentCard).mockResolvedValue(tournamentCard({ id: 12, name: "Cup" }));
    const meta = await generateMetadata(params("12"));

    expect(getVisibleTournamentCard).toHaveBeenCalledWith(12, { canManage: false });
    expect((meta.openGraph as { url?: string }).url).toBe("/suivre/tournois/12");
    expect(meta.robots).toEqual({ index: false, follow: false });
  });

  it("ne lit pas la carte pour un membre connecté : il est redirigé vers sa fiche", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(authUser({ id: 7 }));
    const meta = await generateMetadata(params("12"));

    expect(getVisibleTournamentCard).not.toHaveBeenCalled();
    expect(meta.robots).toEqual({ index: false, follow: false });
  });

  it("retombe sur l'encart du site pour un tournoi non publié, toujours hors des moteurs", async () => {
    jest.mocked(getVisibleTournamentCard).mockResolvedValue(null);
    const meta = await generateMetadata(params("12"));
    expect(meta.title).toBe("Tournoi");
    expect(meta.robots).toEqual({ index: false, follow: false });
  });

  it("a sa version anglaise et son image d'aperçu", () => {
    expect(isMigratedRoute("/suivre/tournois/12")).toBe(true);
    const og = readSource("app/suivre/tournois/[id]/opengraph-image.tsx");
    expect(og).toContain('export { default, alt, size, contentType } from "@/app/(secured)/tournois/[id]/opengraph-image";');
    expect(og).toContain("export const revalidate = 300");
  });

  it("ne lit que la route publique, jamais une route de l'espace connecté", () => {
    const poller = readSource("app/suivre/tournois/[id]/_lib/spectator-poller.ts");
    expect(poller).toContain("`/api/spectator/tournaments/${tournamentId}`");
    expect(poller).not.toMatch(/["`]\/api\/tournaments\//);
  });
});

describe("fiche commune sous SpectatorViewProvider", () => {
  it("rend les noms d'équipe et de joueur sans lien vers l'espace connecté", () => {
    const html = spectator(
      <>
        <TeamLink teamId={10} aria-label="Équipe Alpha">Alpha</TeamLink>
        <PlayerLink userId={3}>Nova</PlayerLink>
      </>,
    );
    expect(html).not.toContain("<a");
    expect(html).not.toContain("aria-label");
    expect(html).toContain('<span class="entity-name">Alpha</span>');
    expect(html).toContain("Nova");
    // Hors de la page sans compte, rien ne change.
    expect(member(<TeamLink teamId={10}>Alpha</TeamLink>)).toContain('href="/equipes/10"');
  });

  it("vaut aussi pour un engagé de tournoi, solo compris", () => {
    const html = spectator(
      <EntrantProvider participantType="SOLO" soloUserIds={{ 4: 9 }} logos={buildEntrantLogoMap([])}>
        <EntrantLink teamId={4}>Nova</EntrantLink>
      </EntrantProvider>,
    );
    expect(html).not.toContain("<a");
    expect(html).toContain("Nova");
  });

  it("garde la marche du podium d'un joueur engagé en solo : le podium est public", () => {
    // Joueur 9 membre de l'équipe 10, première du classement.
    const tiers = buildPodiumTiers([10, 20, 30], [{ userId: 9, teamId: 10 }]);
    const html = renderToStaticMarkup(
      <PodiumTiersProvider tiers={tiers}>
        <SpectatorViewProvider>
          <EntrantProvider participantType="SOLO" soloUserIds={{ 4: 9 }} logos={buildEntrantLogoMap([])}>
            <EntrantLink teamId={4}>Nova</EntrantLink>
          </EntrantProvider>
        </SpectatorViewProvider>
      </PodiumTiersProvider>,
    );
    expect(html).not.toContain("<a");
    expect(html).toMatch(/class="entity-name [^"]*podium-member/);
  });

  it("ne laisse pas de case vide pour le motif d'une sanction retiré au public", () => {
    const view = readSource("app/(secured)/tournois/[id]/_components/EnduranceView.tsx");
    expect(view).toContain("{penalty.reason && <span className={styles.penaltyReason}>{penalty.reason}</span>}");
  });

  it("oublie la réponse publique d'un tournoi supprimé", () => {
    const deletion = readSource("lib/server/tournaments/deletion.ts");
    expect(deletion).toMatch(/publishUpdatedEvent\(tournamentId\);[\s\S]{0,200}invalidateSpectatorSnapshot\(tournamentId\);/);
  });

  it("tait les codes de replay, réservés aux membres connectés", () => {
    const maps = [
      { mapNumber: 1, replayCode: "ABC123", team1Score: 2, team2Score: 1 },
      { mapNumber: 2, replayCode: "", team1Score: 0, team2Score: 2 },
    ];
    const html = spectator(<MapResultList maps={maps} team1Name="Alpha" team2Name="Bravo" label="Maps" />);
    expect(html).toContain("2 – 1");
    expect(html).not.toContain("ABC123");
    expect(html).not.toContain(frTournament.match.maps.noReplayCode);
    expect(html).not.toContain("<button");
    const memberHtml = member(<MapResultList maps={maps} team1Name="Alpha" team2Name="Bravo" label="Maps" />);
    expect(memberHtml).toContain("ABC123");
    expect(memberHtml).toContain(frTournament.match.maps.noReplayCode);
  });

  it("annonce la cadence accordée par le serveur", () => {
    expect(member(<LiveIndicator isLive tier="STANDARD" cadenceMs={60_000} />)).toContain("toutes les minutes au plus");
    expect(member(<LiveIndicator isLive tier="STANDARD" cadenceMs={30_000} />)).toContain("toutes les 30 secondes au plus");
    expect(member(<LiveIndicator isLive tier="STANDARD" cadenceMs={600_000} />)).toContain("toutes les 10 minutes au plus");
    // Une relecture ratée ne parle pas de flux à rouvrir.
    expect(spectator(<LiveIndicator isLive={false} tier="STANDARD" cadenceMs={30_000} />)).toContain("La dernière mise à jour");
    // Pas de flux à rouvrir : « Hors ligne », jamais « Reconnexion… ».
    expect(spectator(<LiveIndicator isLive={false} tier="STANDARD" cadenceMs={30_000} />)).toContain("Hors ligne");
    expect(spectator(<LiveIndicator isLive={false} tier="STANDARD" cadenceMs={30_000} />)).not.toContain("Reconnexion");
    expect(member(<LiveIndicator isLive={false} tier="STANDARD" />)).toContain("flux temps réel");
    // Sans cadence imposée : celle du palier, comme avant.
    expect(member(<LiveIndicator isLive tier="STANDARD" />)).toContain("toutes les 20 secondes au plus");
  });

  it("dit qu'un tournoi introuvable est revérifié, sans compte seulement", () => {
    const notFound = <LiveIndicator isLive={false} tier="STANDARD" cadenceMs={null} fatal="TOURNAMENT_NOT_FOUND" />;
    expect(spectator(notFound)).toContain("revérifie seule toutes les 11 minutes au plus");
    expect(member(notFound)).toContain("plus rien à suivre");
    const sheet = readSource("app/(secured)/tournois/[id]/_components/TournamentSheet.tsx");
    expect(sheet).toContain("{spectator && !expired ? (");
    expect(sheet).toContain('t("page.fatal.spectatorRecheck", { minutes: SPECTATOR_NOT_FOUND_RECHECK_MINUTES })');
  });

  it("n'offre aucun geste dans l'en-tête, et ramène à l'accueil", () => {
    const detail = {
      ...tournamentSnapshot({ card: tournamentCard({ id: 12, state: "REGISTRATION", maxTeams: 8, registeredTeams: 2 }) }),
      ...SPECTATOR_VIEWER_CONTEXT,
    };
    const browser = globalThis as unknown as { document?: unknown; window?: unknown };
    browser.document = { referrer: "" };
    browser.window = { location: { origin: "http://localhost", pathname: "/suivre/tournois/12" }, history: { length: 1 } };
    let html: string;
    try {
      html = spectator(
        <TournamentHeader
          detail={detail}
          isLive
          tier="STANDARD"
          cadenceMs={120_000}
          fatal={null}
          frozen={false}
          onRegister={noop}
          onReportIssue={noop}
          onGuestRegister={noop}
          onAdvance={noop}
          onLiveSaved={noop}
          onEditImage={noop}
        />,
      );
    } finally {
      delete browser.document;
      delete browser.window;
    }
    expect(html).toContain('href="/"');
    expect(html).not.toContain('href="/tournois"');
    expect(html).toContain(frTournament.header.backHome);
    expect(html).toContain(frTournament.header.spectator);
    expect(html).not.toContain("<button");
    expect(html).not.toContain("/connexion");
    expect(html).toContain("toutes les 2 minutes au plus");
  });

  it("dit que la page réessaiera quand la première lecture a échoué", () => {
    expect(member(<TournamentLoading />)).toContain(frTournament.loading);
    const retrying = member(<TournamentLoading retrying />);
    expect(retrying).toContain("ne peut pas être chargé pour l");
    expect(retrying).not.toContain(frTournament.loading);
  });

  it("a ses textes dans les deux langues", () => {
    for (const messages of [frTournament, enTournament]) {
      expect(messages.header.backHome).toBeTruthy();
      expect(messages.header.spectator).toBeTruthy();
      expect(messages.header.spectatorTitle).toBeTruthy();
      expect(messages.live.retryTitle).toBeTruthy();
      expect(messages.live.cadenceMinute).toBeTruthy();
      expect(messages.live.loadingRetry).toBeTruthy();
      expect(messages.page.fatal.backHome).toBeTruthy();
      expect(messages.page.fatal.spectatorRecheck).toContain("{minutes}");
      expect(messages.live.spectatorNotFoundTitle).toContain("{minutes}");
    }
    // « au plus » : en anglais aussi, une borne haute de l'attente.
    expect(enTournament.page.fatal.spectatorRecheck).toContain("at most every {minutes} minutes");
    expect(enTournament.live.spectatorNotFoundTitle).toContain("at most every {minutes} minutes");
  });
});

describe("liens publics vers un tournoi", () => {
  it("la vitrine mène le visiteur sans session droit à la page sans compte", () => {
    const page = readSource("app/page.tsx");
    expect(page).toContain("canEditCopy={isAdmin} spectator={!user} />");
    expect(page).toContain("locale={locale} spectator={!user} />");
    const board = readSource("components/cyber/landing/TournamentBoard.tsx");
    expect(board).toContain("tournamentHref(featured.id, spectator)");
    expect(board).toContain("tournamentHref(card.id, spectator)");
    expect(board).not.toMatch(/href=\{`\/tournois\/\$\{/);
    expect(readSource("components/cyber/landing/Hero.tsx")).toContain("spectator={spectator} />");
    expect(page).toContain("locale={locale} spectator={!user} />");
    expect(readSource("components/cyber/landing/LeaderCal.tsx")).toContain("spectator={spectator} />");
    const calendar = readSource("components/cyber/landing/CalendarCard.tsx");
    expect(calendar).toContain("<LocaleLink className={styles.link} href={tournamentHref(event.tournamentId, spectator)}>");
    expect(readSource("components/cyber/landing/LiveCard.tsx")).toContain(
      "tournamentMatchHref(live.tournament.id, shown?.id ?? null, spectator)",
    );
  });

  it("« Rejoindre » ramène à la fiche connectée depuis la page sans compte, sans bouton de plus", () => {
    const header = readSource("components/cyber/landing/PublicHeader.tsx");
    expect(header).toContain("const joinHref = joinHrefFor(path, search);");
    expect(header).toContain("return { path: requestHeaders.get(PATHNAME_HEADER), search: requestHeaders.get(SEARCH_HEADER) };");
    expect(header).toContain("<JoinLink href={joinHref}>{t(\"join\")}</JoinLink>");
    const join = readSource("components/cyber/landing/JoinLink.tsx");
    expect(join).toContain("withRedirectAnchor(href, globalThis.location.hash)");
    // `pushState` ne déclenche pas `hashchange` : l'ancre est relue avant le geste.
    expect(join).toMatch(/onPointerDown=\{\(event\) => \{\s*update\(\);/);
    expect(join).toMatch(/onFocus=\{\(event\) => \{\s*update\(\);/);
  });
});

describe("textes de la fiche", () => {
  it("les deux espaces posent les mêmes textes, par un seul composant", () => {
    expect(readSource("app/(secured)/tournois/[id]/layout.tsx")).toContain("<TournamentSheetText locale={await requestLocale()}>");
    const spectator = readSource("app/suivre/tournois/[id]/layout.tsx");
    expect(spectator).toContain("<TournamentSheetText locale={locale}>");
    expect(spectator).not.toContain("TournamentPageTextProvider");
    expect(spectator).not.toContain("TournamentActionsTextProvider");
  });
});
