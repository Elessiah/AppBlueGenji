/**
 * Lot 9-2, revue performance — l'anglais d'un espace une seule fois par
 * session : sérialisé au chargement complet (amorce), sinon chargé à part,
 * l'écran de chargement affiché d'ici là. Fichier à part : les chargeurs sont
 * des états de module, l'ordre des cas compte.
 */
import { describe, expect, it, jest } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import { onceLoader } from "@/lib/shared/lazy-component";
import { ProfileTextProviders } from "@/components/i18n/profile-text-providers";
import { useProfileText } from "@/components/i18n/profile-text";
import { usePushText } from "@/components/notifications/push-text";
import { ConcernedReportsText } from "@/components/reports/concerned-reports-text";
import { useReportsText } from "@/components/reports/reports-text";
import { englishProfile, englishPush, englishReports, englishTeamErrors } from "@/components/i18n/english-loaders";
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

const FALLBACK = <span>loading</span>;

describe("onceLoader : un résultat amorcé ne relance rien", () => {
  it("load() rend la valeur fournie, sans appeler le chargement", async () => {
    const start = jest.fn(async () => "chargé");
    const loader = onceLoader(start);
    loader.prime("reçu");
    await expect(loader.load()).resolves.toBe("reçu");
    expect(start).not.toHaveBeenCalled();
  });
});

describe("ProfileTextProviders", () => {
  it("français : ni anglais ni attente", () => {
    const html = renderToStaticMarkup(
      <ProfileTextProviders locale="fr" fallback={FALLBACK}>
        <ProfileProbe />
      </ProfileTextProviders>,
    );
    expect(html).not.toContain("loading");
    expect(html).toContain("Départ de match");
  });

  it("anglais arrivé par navigation, rien reçu : l'écran de chargement, l'anglais lancé dès le rendu", () => {
    expect(englishProfile.loaded()).toBeNull();
    const html = renderToStaticMarkup(
      <ProfileTextProviders locale="en" fallback={FALLBACK}>
        <ProfileProbe />
      </ProfileTextProviders>,
    );
    expect(html).toBe("<span>loading</span>");
  });

  it("anglais sérialisé au chargement complet : rendu tout de suite, et gardé pour la session", () => {
    const html = renderToStaticMarkup(
      <ProfileTextProviders locale="en" messages={{ profile: enProfile, teamErrors: enTeamErrors, push: enPush }} fallback={FALLBACK}>
        <ProfileProbe />
      </ProfileTextProviders>,
    );
    expect(html).toContain(`${enProfile.meta.title} / ${enPush.topics.MATCH_START.label}`);
    // Amorcés : un rafraîchissement (sans dictionnaire) et la fenêtre de lancement s'en servent.
    expect(englishPush.loaded()).toEqual(enPush);
    expect(englishTeamErrors.loaded()).toEqual(enTeamErrors);
    const refreshed = renderToStaticMarkup(
      <ProfileTextProviders locale="en" fallback={FALLBACK}>
        <ProfileProbe />
      </ProfileTextProviders>,
    );
    expect(refreshed).toContain(enProfile.meta.title);
  });
});

describe("ConcernedReportsText", () => {
  it("rien reçu : l'écran de chargement ; reçu : l'anglais, partagé avec le pied de page", () => {
    expect(englishReports.loaded()).toBeNull();
    expect(
      renderToStaticMarkup(
        <ConcernedReportsText locale="en" fallback={FALLBACK}>
          <ReportsProbe />
        </ConcernedReportsText>,
      ),
    ).toBe("<span>loading</span>");
    const html = renderToStaticMarkup(
      <ConcernedReportsText locale="en" messages={enReports} fallback={FALLBACK}>
        <ReportsProbe />
      </ConcernedReportsText>,
    );
    expect(html).toBe(enReports.concerned.title);
    expect(englishReports.loaded()).toEqual(enReports);
  });
});
