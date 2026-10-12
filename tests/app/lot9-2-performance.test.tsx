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
import { onceLoader, PRELOAD_RETRY_MS, quietPreload } from "@/lib/shared/lazy-component";
import enReports from "@/messages/en/reports.json";
import enPush from "@/messages/en/push.json";
import FR_SHELL from "@/messages/fr/shell.json";
import EN_SHELL from "@/messages/en/shell.json";

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
    "components/ui/image-crop-dialog-view.tsx",
    "components/i18n/profile-text-providers.tsx",
    "app/(secured)/profil/layout.tsx",
  ])("%s n'importe aucun JSON anglais", (path) => {
    expect(valueImports(path).filter((spec) => spec.startsWith("@/messages/en/"))).toEqual([]);
  });

  it("la fenêtre de lancement ne charge l'anglais du réglage que sous /en", () => {
    const launch = readSource("components/match-launch/MatchLaunchCenter.tsx");
    expect(valueImports("components/match-launch/MatchLaunchCenter.tsx").filter((spec) => spec.startsWith("@/messages/"))).toEqual([]);
    // Le chargeur partagé (`english-loaders.ts`) : déjà reçu par `/profil`, l'anglais ne repart pas.
    expect(dynamicImports("components/match-launch/MatchLaunchCenter.tsx")).toEqual([]);
    expect(valueImports("components/match-launch/MatchLaunchCenter.tsx")).toContain("@/components/i18n/english-loaders");
    expect(launch).toContain('if (locale !== "en" || english) return;');
    expect(launch).toContain('if (locale === "en" && !english) return null;');
    expect(launch).toContain('<LaunchPushPanel locale={text.locale} lead={t("pushLead")} />');
    // Parti dès qu'un match se lance, avant l'ouverture de la fenêtre.
    expect(launch).toContain('if (text.locale === "en" && hasLaunches) englishPush.load().catch(() => undefined);');
    // La documentation de la cadence reste collée à sa fonction.
    expect(launch).toContain("/** Cadence de relève selon la phase la plus pressante de la liste. */\nfunction launchPollInterval(");
  });
});

describe("formulaire de signalement : l'anglais chargé au clic, sous /en seulement", () => {
  const button = readSource("components/reports/ReportProblemButton.tsx");

  const loader = readSource("components/reports/report-form-loader.ts");

  it("le formulaire et son anglais partent à la demande", () => {
    expect(dynamicImports("components/reports/report-form-loader.ts")).toEqual(["./ReportProblemDialog"]);
    expect(loader).toContain('import { englishReports as englishLoader } from "@/components/i18n/english-loaders";');
    expect(dynamicImports("components/reports/ReportProblemButton.tsx")).toEqual([]);
    expect(loader).toContain('if (locale !== "en") return dialogLoader.load();');
    expect(loader).toContain('return locale === "en" && !englishLoader.loaded() ? null : dialogLoader.loaded();');
    // Le formulaire se lit du chargeur à chaque rendu, sans état en double.
    expect(button).toContain("const ReportProblemDialog = open ? loadedReportForm(locale) : null;");
    expect(button).not.toContain("setDialog");
  });

  it("l'anglais déjà servi par une page n'est pas retéléchargé par le pied de page", () => {
    expect(readSource("components/reports/reports-text-provider.tsx")).toContain(
      'if (props.locale === "en" && props.messages) englishReports.prime(props.messages);',
    );
    // Le formulaire importé par la page d'un signalement amorce aussi le chargeur du pied.
    expect(readSource("app/(secured)/signalements/[id]/page.tsx")).toContain("primeReportDialog(ReportProblemDialog);");
    expect(loader).toContain("dialogLoader.prime(dialog);");
  });

  it("le formulaire pose lui-même son fournisseur, anglais seulement sous /en", () => {
    expect(button).toContain('englishMessages={locale === "en" ? (loadedEnglishReports() ?? undefined) : undefined}');
    // Le bouton, au pied de chaque page, ne porte pas la mécanique du fournisseur.
    expect(valueImports("components/reports/ReportProblemButton.tsx")).not.toContain("./reports-text-provider");
    expect(readSource("components/reports/ReportProblemDialog.tsx")).toContain(
      '<ReportsTextProvider locale="en" messages={englishMessages}>',
    );
  });

  it("la page d'un signalement ouvre la contestation sans attente : formulaire importé avec elle", () => {
    const page = "app/(secured)/signalements/[id]/page.tsx";
    expect(valueImports(page)).toContain("@/components/reports/ReportProblemDialog");
    expect(dynamicImports(page)).toEqual([]);
  });

  it("préchargement : rien si tout est là, discret après un échec ; le clic retente", () => {
    expect(loader).toContain("if (loadedReportForm(locale)) return;");
    expect(loader).toContain('const preloadEnglish = quietPreload(() => loadReportForm("en"));');
    expect(button).toContain("loadReportForm(locale)\n      .then(() => {");
  });

  it("la page d'un signalement : anglais sérialisé sous /en, au chargement complet seulement", () => {
    const layout = readSource("app/(secured)/signalements/[id]/layout.tsx");
    expect(layout).toContain('const documentRequest = (await headers()).get(DOCUMENT_REQUEST_HEADER) !== "0";');
    expect(layout).toContain('messages={locale === "en" && documentRequest ? all.reports : undefined}');
    expect(readSource("components/reports/concerned-reports-text.tsx")).toContain(
      "useEnglishMessages(locale, englishReports, messages)",
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
    expect(dynamicImports("components/ui/image-crop-dialog.tsx")).toEqual(["./image-crop-dialog-view", "@/messages/en/imageCrop.json"]);
    expect(hook).toContain('import type { ImageCropDialogProps, ImageCropMessages } from "./image-crop-dialog-view";');
    expect(valueImports("components/ui/image-crop-dialog.tsx")).not.toContain("./image-crop-dialog-view");
  });

  it("un échec de chargement est dit, ne recharge jamais la page et ne reste pas en mémoire", () => {
    // Pas de `next/dynamic` (il garderait un composant vide), pas d'`orReload` (il rechargerait un formulaire en cours).
    expect(hook).not.toContain('from "next/dynamic"');
    expect(valueImports("components/ui/image-crop-dialog.tsx")).not.toContain("next/dynamic");
    expect(hook).not.toContain("orReload }");
    expect(hook).not.toContain("orReload,");
    expect(hook).toContain("await Promise.all([cropDialogLoader.load(), english ? englishCropLoader.load() : null]);");
    expect(hook).toContain('showError(t(isChunkLoadError(error) ? "imageCropLoad.reloading" : "imageCropLoad.failed"));');
    expect(hook).toMatch(/imageCropLoad\.failed"\)\);\s*return null;/);
    expect(hook).toContain("const cropDialog = request && ImageCropDialog ? (");
    // Le préchargement raté se tait un moment (`quietPreload`), rien s'il est déjà là.
    expect(hook).toContain("const preloadCropDialog = quietPreload(() => cropDialogLoader.load());");
    expect(hook).toContain("if (!cropDialogLoader.loaded()) preloadCropDialog();");
    // Sous `/en`, l'anglais de la modale est préchargé avec elle.
    expect(hook).toContain("if (pageIsEnglish() && !englishCropLoader.loaded()) preloadCropEnglish();");
  });

  it("messages d'échec du recadrage dans les deux langues", () => {
    expect(FR_SHELL.imageCropLoad).toEqual({
      failed: "La fenêtre de recadrage n'a pas pu s'ouvrir. Réessaie dans un instant.",
      reloading: "Le site vient d'être mis à jour : recharge la page pour recadrer ton image.",
    });
    expect(EN_SHELL.imageCropLoad).toEqual({
      failed: "The crop window couldn't open. Try again in a moment.",
      reloading: "The site has just been updated: reload the page to crop your image.",
    });
  });

  it("chaque sélecteur de fichier précharge la modale pendant le choix du fichier", () => {
    const pickers: Array<[string, number]> = [
      ["app/(secured)/profil/page.tsx", 1],
      ["app/(secured)/equipes/creer/CreateTeamForm.tsx", 1],
      ["app/(secured)/equipes/[id]/_components/TeamSettings.tsx", 1],
      ["app/(secured)/tournois/_components/TournamentImagePicker.tsx", 1],
      ["app/benevoles/BenevolesSection.tsx", 1],
      ["components/cyber/landing/SponsorsGrid.tsx", 2],
    ];
    for (const [path, inputs] of pickers) {
      const source = readSource(path);
      expect(source.match(/type="file"\n\s*onClick=\{preloadImageCropDialog\}/g)).toHaveLength(inputs);
      // Chaque attribut `type="file"` d'un champ (une ligne à lui), pas ceux des commentaires.
      expect(source.match(/^\s*type="file"$/gm)).toHaveLength(inputs);
    }
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

describe("onceLoader : un chargement partagé, un échec retenté", () => {
  it("un seul appel pour plusieurs demandes, résultat gardé", async () => {
    let calls = 0;
    const loader = onceLoader(async () => {
      calls += 1;
      return "ok";
    });
    expect(loader.loaded()).toBeNull();
    const [a, b] = await Promise.all([loader.load(), loader.load()]);
    expect([a, b]).toEqual(["ok", "ok"]);
    expect(await loader.load()).toBe("ok");
    expect(calls).toBe(1);
    expect(loader.loaded()).toBe("ok");
  });

  it("un échec n'est pas gardé : l'appel suivant retente", async () => {
    let calls = 0;
    const loader = onceLoader(async () => {
      calls += 1;
      if (calls === 1) throw new Error("Loading chunk 12 failed.");
      return 42;
    });
    await expect(loader.load()).rejects.toThrow("Loading chunk 12 failed.");
    expect(loader.loaded()).toBeNull();
    expect(await loader.load()).toBe(42);
    expect(calls).toBe(2);
    expect(loader.loaded()).toBe(42);
  });
});

describe("onceLoader.prime et quietPreload", () => {
  it("prime fournit le résultat sans rien charger, sans écraser un résultat déjà là", async () => {
    let calls = 0;
    const loader = onceLoader(async () => {
      calls += 1;
      return "chargé";
    });
    loader.prime("reçu");
    expect(loader.loaded()).toBe("reçu");
    loader.prime("autre");
    expect(loader.loaded()).toBe("reçu");
    expect(calls).toBe(0);
  });

  it("un préchargement raté se tait PRELOAD_RETRY_MS, puis se relance", async () => {
    let clock = 0;
    let calls = 0;
    let fail = true;
    const preload = quietPreload(async () => {
      calls += 1;
      if (fail) throw new Error("hors ligne");
    }, () => clock);
    const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
    preload();
    await settle();
    expect(calls).toBe(1);
    preload();
    clock = PRELOAD_RETRY_MS - 1;
    preload();
    await settle();
    expect(calls).toBe(1);
    clock = PRELOAD_RETRY_MS;
    fail = false;
    preload();
    await settle();
    expect(calls).toBe(2);
    // Réussi : le geste suivant repart aussitôt (le chargeur, lui, rend son résultat gardé).
    preload();
    await settle();
    expect(calls).toBe(3);
  });
});

describe("modale de recadrage : anglais passé par le crochet", () => {
  it("français sans anglais fourni, ou imposé ; anglais sinon", async () => {
    const { default: enImageCrop } = await import("@/messages/en/imageCrop.json");
    const view = readSource("components/ui/image-crop-dialog-view.tsx");
    expect(view).toContain('if (lang === "fr" || !englishMessages) return FR_CROP_TEXT;');
    expect(enImageCrop).toHaveProperty("confirm");
    expect(readSource("components/ui/image-crop-dialog.tsx")).toContain(
      "englishMessages={english ? (englishCropLoader.loaded() ?? undefined) : undefined}",
    );
  });
});
