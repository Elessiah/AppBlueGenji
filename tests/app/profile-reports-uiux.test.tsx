/**
 * Lot 9-2, revue UI/UX — le formulaire de signalement parle anglais sous
 * `/en` : les textes anglais qui y renvoient nomment ses catégories telles
 * qu'il les affiche, l'heure d'un code suit la langue de la page, la
 * suppression du compte ramène à l'accueil de la même langue, et le bouton du
 * formulaire (chargé au clic) se dit occupé tant que son morceau n'est pas là.
 */
import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import enReports from "@/messages/en/reports.json";
import enLogin from "@/messages/en/login.json";
import frLogin from "@/messages/fr/login.json";
import { ReportProblemButton } from "@/components/reports/ReportProblemButton";

const ROOT = join(__dirname, "..", "..");
const source = (path: string) => readFileSync(join(ROOT, path), "utf8");

/** Textes anglais qui renvoient au formulaire (les annonces passées de `privacy-changes-en.ts` restent telles quelles). */
const ENGLISH_REFERRERS = [
  "app/rgpd/RgpdEn.tsx",
  "app/mentions-legales/MentionsLegalesEn.tsx",
  "app/accessibilite/AccessibilityStatementEn.tsx",
  "lib/shared/legal-text-en.ts",
  "lib/shared/processing-register-en.ts",
  "lib/shared/terms-of-use-en.ts",
  "messages/en/login.json",
];
const FRENCH_CATEGORY_NAMES = ["Droit d'auteur", "Droit d&apos;auteur", "Modération", "Hébergeur", "Autre", "Contestation", "« RGPD »"];

describe("catégories du formulaire citées en anglais", () => {
  it.each(ENGLISH_REFERRERS)("%s ne cite plus l'intitulé français", (path) => {
    const text = source(path);
    for (const name of FRENCH_CATEGORY_NAMES) expect(text).not.toContain(name);
  });

  it("les intitulés cités existent dans le formulaire anglais", () => {
    const labels = Object.values(enReports.categories).map((category) => category.label);
    expect(labels).toEqual(expect.arrayContaining(["Copyright", "Moderation", "Bug", "GDPR", "Host", "Other", "Appeal"]));
    for (const path of ENGLISH_REFERRERS) {
      for (const [, quoted] of source(path).matchAll(/“(\w+)” category/g)) expect(labels).toContain(quoted);
    }
    expect(enReports.privacy.followUp).toContain("“Appeal” category");
  });

  it("l'exposé de suspension : même phrase française, catégorie anglaise sous /en", () => {
    expect(frLogin.suspension.appealText).toContain("catégorie « Autre » (sans connexion)");
    expect(enLogin.suspension.appealText).toContain("category “Other” (no login needed)");
    expect(enLogin.suspension.appealText).not.toContain("<fr>");
  });
});

describe("langue de la page dans les gestes du profil", () => {
  it("l'heure d'expiration d'un code suit la langue de la page, français compris", () => {
    for (const dialog of ["DiscordBotHandleDialog", "DiscordVerificationDialog"]) {
      const text = source(`app/(secured)/profil/${dialog}.tsx`);
      expect(text).toContain("toLocaleTimeString(INTL_LOCALE[text.locale])");
      expect(text).not.toContain("toLocaleTimeString(undefined");
    }
  });

  it("la suppression du compte ramène à l'accueil de la langue de la page", () => {
    const page = source("app/(secured)/profil/page.tsx");
    expect(page).toContain('window.location.href = localeHref("/", text.locale);');
    expect(page).not.toContain('window.location.href = "/";');
  });
});

describe("bouton du formulaire de signalement", () => {
  it("rendu initial : ni occupé ni curseur d'attente", () => {
    const html = renderToStaticMarkup(<ReportProblemButton authenticated={false} label="Report a problem" />);
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).not.toContain("aria-busy");
    expect(html).not.toContain("progress");
  });

  it("précharge au survol et au focus, se dit occupé pendant le chargement", () => {
    const button = source("components/reports/ReportProblemButton.tsx");
    expect(button).toContain("onPointerEnter: preloadDialog");
    expect(button).toContain("onFocus: preloadDialog");
    expect(button).toContain('"aria-busy": pending || undefined');
    // Un seul chargement partagé, retenté après un échec, qui le dit.
    expect(button).toContain("dialogLoad ??= import(");
    expect(button).toContain("dialogLoad = null;");
    expect(button).toContain('const message = t(isChunkLoadError(error) ? "footer.reportReloading" : "footer.reportLoadFailed");');
    expect(button).not.toContain('from "next/dynamic"');
  });
});

describe("revue UI/UX, deuxième passe", () => {
  it("compteur de caractères manquants accordé au singulier", async () => {
    const { reportsText } = await import("@/components/reports/reports-text");
    expect(reportsText("fr").t("dialog.tooShort", { count: 1 })).toBe("Encore 1 caractère au moins.");
    expect(reportsText("fr").t("dialog.tooShort", { count: 4 })).toBe("Encore 4 caractères au moins.");
    expect(reportsText("en").t("dialog.tooShort", { count: 1 })).toBe("At least 1 more character.");
    expect(reportsText("en").t("dialog.tooShort", { count: 4 })).toBe("At least 4 more characters.");
  });

  it("lien d'invitation Discord : nouvel onglet annoncé aux lecteurs d'écran", () => {
    for (const dialog of ["DiscordBotHandleDialog", "DiscordVerificationDialog"]) {
      const text = source(`app/(secured)/profil/${dialog}.tsx`);
      expect(text).toMatch(/target="_blank"[\s\S]{0,600}<span className="sr-only">\{` \$\{t\("verify\.newTab"\)\}`\}<\/span>/);
    }
  });

  it("dates d'une image : heure de Paris, langue de la page, une seule fonction", async () => {
    const { formatQuarantineDate } = await import("@/lib/shared/logo-quarantine");
    // 23 h 30 UTC le 31 décembre = 1er janvier à Paris, quel que soit le fuseau du lecteur.
    const date = new Date("2026-12-31T23:30:00Z");
    expect(formatQuarantineDate(date)).toBe("1 janvier 2027");
    expect(formatQuarantineDate(date, "en-US")).toBe("January 1, 2027");
    const view = source("app/(secured)/signalements/[id]/_components/ConcernedReport.tsx");
    expect(view).not.toContain("formatPurgeDate");
    // Toutes les dates de la page, réception et contestations comprises, en heure de Paris.
    expect(view).not.toMatch(/\bformatDate\(/);
    expect(view).toContain("formatParisDay(report.createdAt, locale)");
  });

  it("identifiant d'un fournisseur : le registre décide, chaque libellé est traduit", async () => {
    const { OAUTH_PROVIDER_HANDLE_LABELS } = await import("@/lib/shared/oauth-providers");
    const enProfile = (await import("@/messages/en/profile.json")).default;
    const frProfile = (await import("@/messages/fr/profile.json")).default;
    const withHandle = Object.entries(OAUTH_PROVIDER_HANDLE_LABELS)
      .filter(([, label]) => label !== null)
      .map(([provider]) => provider)
      .sort((a, b) => a.localeCompare(b));
    expect(Object.keys(enProfile.connections.handleLabels).sort((a, b) => a.localeCompare(b))).toEqual(withHandle);
    expect(Object.keys(frProfile.connections.handleLabels).sort((a, b) => a.localeCompare(b))).toEqual(withHandle);
    expect(source("app/(secured)/profil/ConnectedAppsSection.tsx")).not.toContain('provider !== "GOOGLE"');
  });

  it("ligne du bot : chaque cas traduit depuis son code, sans redécider", async () => {
    const { discordBotRowText, FR_PROFILE } = await import("@/app/(secured)/profil/_lib/profile-text");
    const { scopedText } = await import("@/lib/shared/scoped-text");
    const enProfile = (await import("@/messages/en/profile.json")).default;
    const en = scopedText("en", enProfile);
    const codes = ["HANDLE", "LINKED_BY_CODE", "LINKED_BY_BUTTON", "LINKED_ELSEWHERE", "NOT_LINKED"] as const;
    const notes = codes.map((noteCode) => discordBotRowText(en, { noteCode, handle: "gamer", refusalCode: null }).note);
    expect(new Set(notes).size).toBe(codes.length);
    expect(notes[0]).toContain("gamer");
    expect(discordBotRowText(FR_PROFILE, { noteCode: "HANDLE", handle: "gamer", refusalCode: "LAST_CONNECTION" }).refusal).toBe(
      FR_PROFILE.t("connections.bot.lastConnection"),
    );
    expect(source("app/(secured)/profil/_lib/profile-text.ts")).not.toContain("checkConnectionUnlink");
  });
});

describe("revue UI/UX, troisième passe", () => {
  it("bouton du formulaire : chargement visible et annoncé, morceau disparu dit comme tel", () => {
    const html = renderToStaticMarkup(<ReportProblemButton authenticated={false} label="Report a problem" />);
    // Région d'état présente dès le rendu, vide tant que rien ne charge.
    expect(html).toContain('<output class="sr-only"></output>');
    expect(html).not.toContain("Ouverture du formulaire");
    const button = source("components/reports/ReportProblemButton.tsx");
    expect(button).toContain('const visibleLabel = pending ? t("footer.reportLoading") : label;');
    expect(button).toContain('setStatus(t("footer.reportLoading"));');
    // L'échec s'annonce aussi dans la région d'état (hors toast, il resterait muet).
    expect(button).toMatch(/if \(toast\) \{\s*setStatus\(""\);\s*toast\.showError\(message\);\s*\} else \{\s*setStatus\(message\);/);
    // Après un clic, jamais de rechargement d'office (une saisie en cours serait perdue).
    expect(button).not.toContain("reloadAfterChunkError");
    // Préchargé au survol : le clic ouvre sans passer par l'attente.
    expect(button).toContain("const ready = ReportProblemDialog ?? loadedDialog;");
    // Arrivé après un changement de page : ouvert quand même (suite du clic, page affichée retenue).
    expect(button).not.toContain("currentPath");
  });

  it("textes du chargement dans les deux langues", async () => {
    const fr = (await import("@/messages/fr/shell.json")).default.footer;
    const en = (await import("@/messages/en/shell.json")).default.footer;
    expect(fr.reportLoading).toBe("Ouverture du formulaire…");
    expect(en.reportLoading).toBe("Opening the form…");
    expect(en.reportReloading).toBe("The site has just been updated: reload the page to open the form.");
    expect(en.reportLoadFailed).toContain("Try again");
  });

  it("accusé d'envoi : jamais « n° undefined »", () => {
    const dialog = source("components/reports/ReportProblemDialog.tsx");
    expect(dialog).toContain('const sent = typeof body.id === "number" ? t("dialog.sent", { id: String(body.id) }) : t("dialog.sentNoId");');
    expect(enReports.dialog.sentNoId).toBe("Thanks, your report has been sent to the association.");
  });

  it("déconnexion du profil : échec dit, double clic sans effet", () => {
    // Un seul geste pour le menu du compte et le bouton du profil.
    const button = source("components/logout-button.tsx");
    expect(button).toContain("const { leaving, logout } = useLogout();");
    expect(button).not.toContain('fetch("/api/auth/logout"');
    expect(button).not.toContain("account-menu");
    expect(source("components/account-menu.tsx")).toContain("useLogout(() => setOpen(false))");
    const menu = source("components/use-logout.ts");
    // `leaving` ne retombe qu'après un échec, qui se dit.
    expect(menu).toMatch(/if \(!\(await requestLogout\(\)\)\) \{\s*setLeaving\(false\);\s*showError\(t\("account\.logoutFailed"\)\);/);
    // Le bouton du profil garde le focus pendant la requête.
    expect(button).toContain("aria-disabled={leaving || undefined}");
    expect(button).not.toMatch(/\sdisabled=\{leaving\}/);
    expect(menu).toContain("if (leaving) return;");
  });
});

describe("revue UI/UX, quatrième passe", () => {
  it("boutons Discord du profil : le nom accessible anglais contient le texte visible (WCAG 2.5.3)", async () => {
    for (const locale of ["fr", "en"] as const) {
      const { discord } = (await import(`@/messages/${locale}/profile.json`)).default as {
        discord: Record<string, string>;
      };
      for (const key of ["certify", "recertify", "register", "remove", "retry"]) {
        expect(discord[`${key}Label`]).toContain(discord[key]);
      }
    }
  });

  it("cibles d'un signalement : TeamLink / PlayerLink, pas de chemin écrit à la main", () => {
    const view = source("app/(secured)/signalements/[id]/_components/ConcernedReport.tsx");
    expect(view).toContain('<PlayerLink userId={target.id}>{target.label}</PlayerLink>');
    expect(view).toContain('<TeamLink teamId={target.id}>{target.label}</TeamLink>');
  });

  it("date d'un signalement à contester : français inchangé, mois nommé en anglais", () => {
    const dialog = source("components/reports/ReportProblemDialog.tsx");
    expect(dialog).toContain("date: contestOptionDate(option.createdAt, text.locale),");
    expect(dialog).toContain('? date.toLocaleDateString(INTL_LOCALE.fr, { timeZone: "Europe/Paris" })');
    expect(dialog).toContain('{ day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Paris" }');
  });
});

describe("revue UI/UX, cinquième passe", () => {
  const NAMESPACES = ["profile", "reports", "imageCrop", "push"] as const;
  function leaves(tree: unknown, prefix = ""): Array<[string, string]> {
    if (typeof tree === "string") return [[prefix, tree]];
    return Object.entries(tree as Record<string, unknown>).flatMap(([key, value]) => leaves(value, prefix ? `${prefix}.${key}` : key));
  }

  it.each(NAMESPACES)("%s : aucun message ne dépend d'une espace en tête ou en queue", async (ns) => {
    for (const locale of ["fr", "en"] as const) {
      const messages = (await import(`@/messages/${locale}/${ns}.json`)).default as unknown;
      for (const [key, value] of leaves(messages)) expect([key, value]).toEqual([key, value.trim()]);
    }
  });

  it("refus de saisie du profil : chacun a sa phrase, dans les deux langues", async () => {
    const { PROFILE_INPUT_ERRORS } = await import("@/lib/shared/profile-input-errors");
    for (const locale of ["fr", "en"] as const) {
      const { errors } = (await import(`@/messages/${locale}/profile.json`)).default as { errors: { write: Record<string, string> } };
      for (const code of PROFILE_INPUT_ERRORS) expect(Object.keys(errors.write)).toContain(code);
    }
    expect(source("app/(secured)/profil/profile-errors.ts")).toContain(
      "type InputErrorsCovered = [ProfileInputError] extends [WriteErrorCode] ? true : never;",
    );
  });

  it("anglais : la catégorie se nomme « Appeal », le nom suit (le verbe reste « contest »)", () => {
    expect(enReports.categories.CONTEST.label).toBe("Appeal");
    expect(enReports.concerned.myContests).toBe("Your appeals");
    expect(enReports.concerned.addContest).toBe("Add an appeal");
    expect(enReports.concerned.contest).toBe("Appeal this report");
    expect(enReports.dialog.contestOf).toBe("You're appealing report no. {id}.");
    expect(JSON.stringify(enReports)).not.toMatch(/the contest succeeds|your contest|contest deadline/i);
  });

  it("profil : plus de libellé « Déconnexion » en double (la coquille le porte)", async () => {
    for (const locale of ["fr", "en"] as const) {
      const { account } = (await import(`@/messages/${locale}/profile.json`)).default as { account: Record<string, string> };
      expect(account).not.toHaveProperty("logout");
    }
  });
});

describe("revue UI/UX, septième passe", () => {
  it("bouton occupé : plus d'aria-label figé, le texte visible fait le nom (WCAG 2.5.3)", () => {
    const apps = source("app/(secured)/profil/ConnectedAppsSection.tsx");
    expect(apps).toContain('aria-label={busyAriaLabel(busy === connection.provider, t("connections.unlinkLabel", { label }))}');
    expect(apps).toContain('aria-label={busyAriaLabel(disconnecting, t("connections.bot.disconnectLabel"))}');
    const page = source("app/(secured)/profil/page.tsx");
    expect(page).toContain('aria-label={busyAriaLabel(discordStateBusy, t("discord.retryLabel"))}');
    expect(page).toContain('aria-label={busyAriaLabel(discordTagBusy, t("discord.removeLabel"))}');
  });

  it("busyAriaLabel : le libellé au repos, aucun une fois occupé", async () => {
    const { busyAriaLabel } = await import("@/lib/shared/busy-aria-label");
    expect(busyAriaLabel(false, "Remove my tag (Discord)")).toBe("Remove my tag (Discord)");
    expect(busyAriaLabel(true, "Remove my tag (Discord)")).toBeUndefined();
  });

  it("date à contester : heure de Paris, comme la page du signalement", () => {
    const dialog = source("components/reports/ReportProblemDialog.tsx");
    expect(dialog.match(/timeZone: "Europe\/Paris"/g)).toHaveLength(2);
  });

  it("suite donnée à une notification : la phrase anglaise du formulaire égale celle des pages juridiques", async () => {
    const { NOTIFIER_FOLLOW_UP_EN } = await import("@/lib/shared/legal-text-en");
    expect(enReports.privacy.followUp).toBe(NOTIFIER_FOLLOW_UP_EN);
  });

  it("logo d'une équipe masqué ou supprimé : le nom passe par TeamLink, dans les deux langues", async () => {
    const frReports = (await import("@/messages/fr/reports.json")).default;
    for (const messages of [frReports, enReports]) {
      for (const key of ["logoHidden", "logoRemoved", "logoRemovedImmediately"] as const) {
        expect(messages.concerned[key]).toContain("<team>{name}</team>");
      }
    }
    const view = source("app/(secured)/signalements/[id]/_components/ConcernedReport.tsx");
    expect(view).toContain("team: (chunks: React.ReactNode[]) => <TeamLink teamId={teamId}>{chunks}</TeamLink>");
    expect(view.match(/teamTags\(quarantine\.targetId\)/g)).toHaveLength(2);
  });
});

describe("revue UI/UX, huitième passe", () => {
  it("avis hors site : une phrase, lien compris, dans chaque langue", async () => {
    const frReports = (await import("@/messages/fr/reports.json")).default;
    expect(frReports.offSite.notice).toMatch(/<portal>[^<]+<\/portal>\.$/);
    expect(enReports.offSite.notice).toMatch(/<portal>[^<]+<\/portal>\.$/);
    const dialog = source("components/reports/ReportProblemDialog.tsx");
    expect(dialog).toContain('text.rich("offSite.notice", {}, {');
    expect(dialog).not.toContain('{t("offSite.notice")}');
  });

  it("anglais : ponctuation anglaise, libellés du formulaire cités", async () => {
    expect(enReports.concerned.lead).not.toContain("—,");
    const rgpd = source("app/rgpd/RgpdEn.tsx");
    expect(rgpd).toContain("“Copyright”, “Moderation”, “Bug”, “GDPR”, “Host” or “Other”");
    expect(rgpd).not.toContain("other —,");
    const enProfile = (await import("@/messages/en/profile.json")).default;
    expect(JSON.stringify(enProfile)).not.toContain("Of age");
    expect(enProfile.identity.adult).toBe("Age status");
  });
});

describe("revue UI/UX, neuvième passe", () => {
  it("gras des alertes de logo : ses morceaux passent par richNodes (lien d'équipe imbriqué, avec clé)", () => {
    const view = source("app/(secured)/signalements/[id]/_components/ConcernedReport.tsx");
    expect(view).toContain("const strong = { strong: (chunks: React.ReactNode[]) => <strong>{richNodes(chunks)}</strong> };");
  });

  it("exposition de la certification : les clés du dialogue suivent les messages", async () => {
    const { EXPOSURE_KEYS } = await import("@/app/(secured)/profil/DiscordVerificationDialog");
    for (const locale of ["fr", "en"] as const) {
      const { verify } = (await import(`@/messages/${locale}/profile.json`)).default as { verify: { exposure: Record<string, string> } };
      expect(Object.keys(verify.exposure)).toEqual([...EXPOSURE_KEYS]);
    }
  });

  it("badge certifié : un seul jeu de libellés", async () => {
    const { verifiedBadgeLabels, FR_PROFILE } = await import("@/app/(secured)/profil/_lib/profile-text");
    expect(verifiedBadgeLabels(FR_PROFILE)).toEqual({ alt: FR_PROFILE.t("discord.verifiedAlt"), title: FR_PROFILE.t("discord.verifiedTitle") });
    expect(source("app/(secured)/profil/page.tsx")).toContain("<VerifiedBadge labels={verifiedBadgeLabels(text)} />");
    expect(source("app/(secured)/profil/DiscordVerificationDialog.tsx")).toContain("labels={verifiedBadgeLabels(text)}");
  });
});
