import { describe, expect, it, jest } from "@jest/globals";

/**
 * Lot 1 (`docs/features/I18N.md` § Coquille partagée) : la coquille passée par
 * les messages doit rendre **le même HTML français** qu'avant l'extraction. Les
 * instantanés ont été pris sur `main` avant la migration, puis rejoués contre la
 * coquille traduite : un écart d'un octet (espace, apostrophe, ordre) les casse.
 */
jest.mock("next/navigation", () => ({
  usePathname: () => "/equipes/12",
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined, prefetch: () => undefined }),
  useSearchParams: () => new URLSearchParams(),
}));
jest.mock("@/lib/server/auth", () => ({
  getCurrentUser: jest.fn(async () => ({ id: 3, pseudo: "Nova", avatarUrl: null })),
}));
jest.mock("@/lib/server/teams/roster", () => ({
  getUserActiveTeam: jest.fn(async () => ({ teamId: 7, teamName: "Les Ours" })),
}));
jest.mock("@/lib/server/contact-service", () => ({
  getContactInfo: jest.fn(async () => ({ email: "", discordTag: "", discordUrl: "" })),
}));

import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ErrorBoundary from "@/app/error";
import { AccessibilityPanel } from "@/components/accessibility/AccessibilityMenu";
import { SkipLink } from "@/components/accessibility/SkipLink";
import { AccountMenuPanel } from "@/components/account-menu";
import { ArenaNav } from "@/components/arena-nav";
import { PublicFooter } from "@/components/cyber/landing/PublicFooter";
import { PublicHeader } from "@/components/cyber/landing/PublicHeader";
import { PublicNavPanel } from "@/components/cyber/landing/PublicNavMenu";
import { SiteFooterBar } from "@/components/legal/SiteFooterBar";
import { ToastProvider } from "@/components/ui/toast";

const noop = () => undefined;

const CLIENT_FIXTURES: ReadonlyArray<[string, () => ReactElement]> = [
  ["SkipLink", () => <SkipLink />],
  [
    "AccessibilityPanel",
    () => (
      <AccessibilityPanel id="p" titleId="t" settings={["focus"]} onToggle={noop} onReset={noop} onClose={noop} />
    ),
  ],
  [
    "AccountMenuPanel",
    () => (
      <AccountMenuPanel id="c" activeTeam={{ teamId: 7, teamName: "Les Ours" }} leaving={false} onNavigate={noop} onLogout={noop} />
    ),
  ],
  ["PublicNavPanel", () => <PublicNavPanel id="n" pathname="/equipes" onNavigate={noop} />],
  [
    "ArenaNav",
    () => (
      <ToastProvider>
        <ArenaNav
          pseudo="Nova"
          avatarUrl={null}
          activeTeam={{ teamId: 7, teamName: "Les Ours" }}
          openReports={2}
          languageSwitcherLabel="lire cette page en anglais"
        />
      </ToastProvider>
    ),
  ],
  ["SiteFooterBar", () => <SiteFooterBar authenticated />],
  [
    "ErrorBoundary",
    () => <ErrorBoundary error={Object.assign(new Error("boom"), { digest: "d1g3st" })} reset={noop} />,
  ],
];

describe("coquille — français inchangé", () => {
  it.each(CLIENT_FIXTURES)("%s", (_name, fixture) => {
    expect(renderToStaticMarkup(fixture())).toMatchSnapshot();
  });

  it("PublicHeader (connecté)", async () => {
    expect(renderToStaticMarkup(<ToastProvider>{await PublicHeader()}</ToastProvider>)).toMatchSnapshot();
  });

  it("PublicFooter", async () => {
    expect(renderToStaticMarkup(<ToastProvider>{await PublicFooter()}</ToastProvider>)).toMatchSnapshot();
  });
});
