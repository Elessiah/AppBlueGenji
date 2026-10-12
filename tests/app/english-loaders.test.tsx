/**
 * Lot 9-2, revue performance — l'anglais d'un espace une seule fois par
 * session : servi par la mise en page à toute requête qui ne vient pas d'une
 * page qui le tient déjà, gardé par le navigateur (amorce), chargé à part en
 * secours. Fichier à part : les chargeurs sont des états de module, l'ordre
 * des cas compte.
 */
import { afterAll, describe, expect, it, jest } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import { onceLoader } from "@/lib/shared/lazy-component";
import { ProfileTextProviders } from "@/components/i18n/profile-text-providers";
import { useProfileText } from "@/components/i18n/profile-text";
import { usePushText } from "@/components/notifications/push-text";
import { ConcernedReportsText } from "@/components/reports/concerned-reports-text";
import { useReportsText } from "@/components/reports/reports-text";
import { englishReports, primeEnglish } from "@/components/i18n/english-loaders";
import { englishProfile, englishPush, englishTeamErrors } from "@/components/i18n/english-loaders-account";
import enProfile from "@/messages/en/profile.json";
import enPush from "@/messages/en/push.json";
import enReports from "@/messages/en/reports.json";
import enTeamErrors from "@/messages/en/teamErrors.json";

function ProfileProbe() {
  return (
    <>
      {useProfileText().t("meta.title")} / {usePushText().t("topics.MATCH_START.label")}
    </>
  );
}
function ReportsProbe() {
  return <>{useReportsText().t("concerned.title")}</>;
}

const PROFILE_EN = { profile: enProfile, teamErrors: enTeamErrors, push: enPush };
const globals = globalThis as { window?: unknown };

/** Rendu « navigateur » : les chargeurs ne vivent que là (`inBrowser`). */
function inBrowser<T>(run: () => T): T {
  globals.window = globalThis;
  try {
    return run();
  } finally {
    delete globals.window;
  }
}

afterAll(() => {
  delete globals.window;
});

describe("onceLoader : un résultat amorcé ne relance rien", () => {
  it("load() rend la valeur fournie, sans appeler le chargement", async () => {
    const start = jest.fn(async () => "chargé");
    const loader = onceLoader(start);
    loader.prime("reçu");
    await expect(loader.load()).resolves.toBe("reçu");
    expect(start).not.toHaveBeenCalled();
  });
});

describe("serveur : aucun dictionnaire gardé d'une requête à l'autre", () => {
  it("rendu serveur avec l'anglais : rendu, mais rien d'amorcé", () => {
    const html = renderToStaticMarkup(
      <ProfileTextProviders locale="en" messages={PROFILE_EN}>
        <ProfileProbe />
      </ProfileTextProviders>,
    );
    expect(html).toContain(enProfile.meta.title);
    primeEnglish(englishReports, "en", enReports);
    expect(englishProfile.loaded()).toBeNull();
    expect(englishPush.loaded()).toBeNull();
    expect(englishReports.loaded()).toBeNull();
  });

  it("rendu serveur sans l'anglais : l'écran d'attente, même si une requête précédente l'avait", () => {
    const html = renderToStaticMarkup(
      <ProfileTextProviders locale="en">
        <ProfileProbe />
      </ProfileTextProviders>,
    );
    expect(html).toContain('role="status"');
  });
});

describe("ProfileTextProviders (navigateur)", () => {
  it("français : ni anglais ni attente", () => {
    const html = inBrowser(() =>
      renderToStaticMarkup(
        <ProfileTextProviders locale="fr">
          <ProfileProbe />
        </ProfileTextProviders>,
      ),
    );
    expect(html).not.toContain('role="status"');
    expect(html).toContain("Départ de match");
  });

  it("anglais servi par la mise en page : rendu tout de suite, et gardé pour la session", () => {
    const html = inBrowser(() =>
      renderToStaticMarkup(
        <ProfileTextProviders locale="en" messages={PROFILE_EN}>
          <ProfileProbe />
        </ProfileTextProviders>,
      ),
    );
    expect(html).toContain(`${enProfile.meta.title} / ${enPush.topics.MATCH_START.label}`);
    // Amorcés : le rafraîchissement suivant (sans dictionnaire) et la fenêtre de lancement s'en servent.
    expect(englishPush.loaded()).toBe(enPush);
    expect(englishTeamErrors.loaded()).toBe(enTeamErrors);
    const refreshed = inBrowser(() =>
      renderToStaticMarkup(
        <ProfileTextProviders locale="en">
          <ProfileProbe />
        </ProfileTextProviders>,
      ),
    );
    expect(refreshed).toContain(enProfile.meta.title);
  });
});

describe("ConcernedReportsText (navigateur)", () => {
  it("rien reçu : l'écran d'attente ; reçu : l'anglais, partagé avec le pied de page", () => {
    expect(englishReports.loaded()).toBeNull();
    expect(
      inBrowser(() =>
        renderToStaticMarkup(
          <ConcernedReportsText locale="en">
            <ReportsProbe />
          </ConcernedReportsText>,
        ),
      ),
    ).toContain('role="status"');
    const html = inBrowser(() =>
      renderToStaticMarkup(
        <ConcernedReportsText locale="en" messages={enReports}>
          <ReportsProbe />
        </ConcernedReportsText>,
      ),
    );
    expect(html).toBe(enReports.concerned.title);
    expect(englishReports.loaded()).toBe(enReports);
  });
});
