/**
 * Lot 9-2, revue performance — aucun texte anglais dans le JavaScript d'une
 * page française : le formulaire de signalement, la page d'un signalement, le
 * réglage des notifications et la modale de recadrage n'emportent plus que
 * leur français (ou rien, chargés à la demande), l'anglais n'arrivant que sous
 * `/en`.
 */
import { describe, expect, it } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import { readSource } from "../helpers/read-source";
import { FR_REPORTS_TEXT, useReportsText } from "@/components/reports/reports-text";
import { ReportsTextProvider } from "@/components/reports/reports-text-provider";
import { FR_PUSH_TEXT, usePushText } from "@/components/notifications/push-text";
import { PushTextProvider } from "@/components/notifications/push-text-provider";
import { FR_PROFILE, lookupCode } from "@/app/(secured)/profil/_lib/profile-text";
import { FR_PROFILE_TEXT } from "@/components/i18n/profile-text";
import { formatQuarantineDate } from "@/lib/shared/logo-quarantine";
import enReports from "@/messages/en/reports.json";
import enPush from "@/messages/en/push.json";

const valueImports = (path: string) =>
  readSource(path)
    .split("\n")
    .filter((line) => line.startsWith("import ") && !line.startsWith("import type "))
    .map((line) => /from\s+"([^"]+)"/.exec(line)?.[1] ?? "");
const dynamicImports = (path: string) => [...readSource(path).matchAll(/import\("([^"]+)"\)/g)].map((m) => m[1]);

describe("aucun anglais importé d'office", () => {
  it.each([
    "components/reports/reports-text.ts",
    "components/reports/ReportProblemButton.tsx",
    "components/reports/ReportProblemDialog.tsx",
    "components/reports/TargetPicker.tsx",
    "app/(secured)/signalements/[id]/page.tsx",
    "app/(secured)/signalements/[id]/_components/ConcernedReport.tsx",
    "components/notifications/push-text.ts",
    "components/notifications/PushNotificationsPanel.tsx",
    "components/ui/image-crop-dialog.tsx",
  ])("%s n'importe aucun JSON anglais", (path) => {
    expect(valueImports(path).filter((spec) => spec.startsWith("@/messages/en/"))).toEqual([]);
  });

  it("la fenêtre de lancement, chargée à la demande, garde l'anglais du réglage dans son morceau", () => {
    expect(readSource("components/match-launch/MatchLaunchCenterLazy.tsx")).toContain('import("./MatchLaunchCenter")');
    expect(valueImports("components/match-launch/MatchLaunchCenter.tsx")).toContain("@/messages/en/push.json");
    expect(readSource("components/match-launch/MatchLaunchCenter.tsx")).toContain(
      'messages={text.locale === "en" ? enPush : undefined}',
    );
  });
});

describe("formulaire de signalement : l'anglais chargé au clic, sous /en seulement", () => {
  const button = readSource("components/reports/ReportProblemButton.tsx");

  it("le formulaire et son anglais partent à la demande", () => {
    expect(dynamicImports("components/reports/ReportProblemButton.tsx")).toEqual(["./ReportProblemDialog", "@/messages/en/reports.json"]);
    expect(button).toContain('if (locale !== "en") return loadDialog();');
    expect(button).toContain('return locale === "en" && !loadedEnglish ? null : loadedDialog;');
  });

  it("le formulaire pose lui-même son fournisseur, anglais seulement sous /en", () => {
    expect(button).toContain('englishMessages={locale === "en" ? (loadedEnglish ?? undefined) : undefined}');
    // Le bouton, au pied de chaque page, ne porte pas la mécanique du fournisseur.
    expect(valueImports("components/reports/ReportProblemButton.tsx")).not.toContain("./reports-text-provider");
    expect(readSource("components/reports/ReportProblemDialog.tsx")).toContain(
      '<ReportsTextProvider locale="en" messages={englishMessages}>',
    );
  });

  it("la page d'un signalement : anglais sérialisé sous /en seulement", () => {
    expect(readSource("app/(secured)/signalements/[id]/layout.tsx")).toContain(
      'messages={locale === "en" ? messagesFor(locale).reports : undefined}',
    );
  });
});

function ReportsProbe() {
  return <>{useReportsText().t("concerned.title")}</>;
}
function PushProbe() {
  return <>{usePushText().t("topics.MATCH_START.label")}</>;
}

describe("textes posés par un emplacement, français à défaut", () => {
  it("sans fournisseur : le français", () => {
    expect(renderToStaticMarkup(<ReportsProbe />)).toBe(FR_REPORTS_TEXT.t("concerned.title"));
    expect(renderToStaticMarkup(<PushProbe />)).toBe(FR_PUSH_TEXT.t("topics.MATCH_START.label"));
  });

  it("fournisseur français sans messages : le français", () => {
    const html = renderToStaticMarkup(
      <ReportsTextProvider locale="fr">
        <PushTextProvider locale="fr">
          <ReportsProbe /> / <PushProbe />
        </PushTextProvider>
      </ReportsTextProvider>,
    );
    expect(html).toBe(`${FR_REPORTS_TEXT.t("concerned.title")} / ${FR_PUSH_TEXT.t("topics.MATCH_START.label")}`);
  });

  it("fournisseur anglais : l'anglais", () => {
    const html = renderToStaticMarkup(
      <ReportsTextProvider locale="en" messages={enReports}>
        <PushTextProvider locale="en" messages={enPush}>
          <ReportsProbe /> / <PushProbe />
        </PushTextProvider>
      </ReportsTextProvider>,
    );
    expect(html).toBe(`${enReports.concerned.title} / ${enPush.topics.MATCH_START.label}`);
  });
});

describe("modale de recadrage chargée à la demande", () => {
  const hook = readSource("components/ui/image-crop-dialog.tsx");

  it("le crochet ne charge la modale qu'à l'ouverture", () => {
    expect(dynamicImports("components/ui/image-crop-dialog.tsx")).toEqual(["./image-crop-dialog-view"]);
    expect(hook).toContain('import type { ImageCropDialogProps } from "./image-crop-dialog-view";');
    expect(valueImports("components/ui/image-crop-dialog.tsx")).not.toContain("./image-crop-dialog-view");
    expect(hook).toContain("{ ssr: false }");
    expect(hook).toContain("orReload(");
  });

  it("aucun écran n'importe la modale elle-même", () => {
    for (const path of [
      "app/(secured)/profil/page.tsx",
      "app/(secured)/equipes/creer/CreateTeamForm.tsx",
      "app/(secured)/equipes/[id]/_components/TeamSettings.tsx",
      "app/(secured)/tournois/_components/TournamentImagePicker.tsx",
      "app/benevoles/BenevolesSection.tsx",
      "components/cyber/landing/SponsorsGrid.tsx",
    ]) {
      expect(readSource(path)).not.toContain("image-crop-dialog-view");
    }
  });
});

describe("profil : un seul texte français, codes par la table", () => {
  it("le texte français des fonctions sœurs est celui du fournisseur", () => {
    expect(FR_PROFILE).toBe(FR_PROFILE_TEXT);
  });

  it("un code connu rend sa phrase, un code inconnu ou hérité rend null", () => {
    expect(lookupCode(FR_PROFILE, "errors.write", "PSEUDO_EMPTY")).toBe(FR_PROFILE.t("errors.write.PSEUDO_EMPTY"));
    expect(lookupCode(FR_PROFILE, "connections.errors", "PROVIDER_ALREADY_LINKED")).toBe(
      FR_PROFILE.t("connections.errors.PROVIDER_ALREADY_LINKED"),
    );
    for (const code of ["NOPE", "constructor", "__proto__", "toString", "", null, undefined]) {
      expect(lookupCode(FR_PROFILE, "errors.write", code)).toBeNull();
    }
  });
});

describe("dates en heure de Paris, formateur réutilisé", () => {
  const options = { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Paris" } as const;
  // 31 décembre 23 h 30 UTC : déjà le 1er janvier à Paris.
  const date = new Date(Date.UTC(2026, 11, 31, 23, 30));

  it("même sortie que toLocaleDateString, en français par défaut et dans la langue passée", () => {
    expect(formatQuarantineDate(date)).toBe(date.toLocaleDateString("fr-FR", options));
    expect(formatQuarantineDate(date)).toBe("1 janvier 2027");
    expect(formatQuarantineDate(date, "en-US")).toBe(date.toLocaleDateString("en-US", options));
    // Deuxième appel : le formateur gardé rend la même chose.
    expect(formatQuarantineDate(date, "en-US")).toBe("January 1, 2027");
  });

  it("les dates du formulaire de contestation se forment une fois par langue", () => {
    const dialog = readSource("components/reports/ReportProblemDialog.tsx");
    expect(dialog).toContain("return CONTEST_OPTION_DATE[locale].format(new Date(iso));");
    expect(dialog).not.toContain("date.toLocaleDateString(");
  });
});
