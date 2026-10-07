/**
 * Lot 8b-2 — création et édition d'un tournoi sous `/en`, sélecteur d'image,
 * fenêtre de lancement globale (espace `launchModal`, chargée à la demande).
 *
 * Trois gardes, comme le lot 8b-1 : le français ne bouge pas (messages égaux
 * aux tables et fonctions d'origine), rendu anglais sans français, équivalence
 * `next-intl` de chaque message des nouveaux espaces.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { readFileSync } from "node:fs";
import path from "node:path";

jest.mock("react-dom", () => {
  const actual = jest.requireActual<typeof import("react-dom")>("react-dom");
  return { ...actual, createPortal: (node: unknown) => node };
});
jest.mock("react", () => {
  const actual = jest.requireActual<typeof import("react")>("react");
  // Rendu serveur : aucun effet (lecture du compte, aperçus d'image).
  return { ...actual, useEffect: () => undefined };
});
let mockLocale: "fr" | "en" = "en";
jest.mock("@/lib/server/request-locale", () => ({ requestLocale: async () => mockLocale }));
jest.mock("next/navigation", () => ({
  usePathname: () => "/en/tournois/creer",
  useSearchParams: () => new URLSearchParams(""),
  useParams: () => ({ id: "12" }),
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined, prefetch: () => undefined, back: () => undefined, forward: () => undefined }),
}));

import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createTranslator } from "next-intl";
import frForm from "@/messages/fr/tournamentForm.json";
import frImage from "@/messages/fr/tournamentImage.json";
import frLaunchModal from "@/messages/fr/launchModal.json";
import frShell from "@/messages/fr/shell.json";
import CreateTournamentPage from "@/app/(secured)/tournois/creer/page";
import CreateLayout, { generateMetadata as createMetadata } from "@/app/(secured)/tournois/creer/layout";
import EditLayout, { generateMetadata as editMetadata } from "@/app/(secured)/tournois/[id]/modifier/layout";
import { TournamentForm, defaultTournamentFormValues } from "@/app/(secured)/tournois/_components/TournamentForm";
import { TournamentImagePicker } from "@/app/(secured)/tournois/_components/TournamentImagePicker";
import { initialImagePickerValue } from "@/app/(secured)/tournois/_lib/image-picker";
import { imageChangeSuccessMessage } from "@/app/(secured)/tournois/_lib/image-picker";
import { matchFormatHint, invalidMatchFormatMessage } from "@/app/(secured)/tournois/_lib/tournament-form-values";
import {
  FR_FORM_TEXT,
  conditionsText,
  formatDescriptionText,
  formatHintText,
  formatNotationText,
  invalidFormatText,
  phaseFormatText,
  phaseIssueText,
  phasePlanText,
  phaseSummaryText,
  useFormText,
} from "@/app/(secured)/tournois/_lib/form-text";
import { FR_IMAGE_TEXT, imageErrorText, imageSuccessText } from "@/app/(secured)/tournois/_lib/image-text";
import { createDefaultPhase, phaseFormatLabel, phaseIssueMessage, phaseSummary } from "@/app/(secured)/tournois/creer/phase-form";
import { FR_ERRORS_TEXT, mapError, useErrorsText } from "@/app/(secured)/tournois/[id]/_lib/error-map";
import {
  FINISHED_EDIT_NOTICE,
  editLockNotice,
  editLockNoticeText,
  editSavedMessage,
  editSavedText,
} from "@/app/(secured)/tournois/[id]/_lib/edit-entry";
import { AppLocaleProvider } from "@/components/i18n/locale-context";
import { TournamentActionsTextProvider } from "@/components/i18n/tournament-actions-text";
import { ToastProvider } from "@/components/ui/toast";
import { messagesFor } from "@/lib/server/i18n-messages";
import { ALL_TOURNAMENT_FIELDS, editableFieldsForWindow } from "@/lib/shared/tournament-edit";
import { isMigratedRoute, LOCALES, SITE_TIME_ZONE } from "@/lib/shared/locales";
import { LAUNCH_ERROR_MESSAGES, launchErrorMessage } from "@/lib/shared/match-launch";
import { matchFormatDescription, matchFormatLabel, type MatchFormat } from "@/lib/shared/match-format";
import {
  ENABLE_PLANNING_WHILE_RUNNING_WARNING,
  REFEREE_SCHEDULING_DESCRIPTION,
  REFEREE_SCHEDULING_ERRORS,
} from "@/lib/shared/match-planning";
import { formatMessage } from "@/lib/shared/message-format";
import { PARTICIPANT_WORDING } from "@/lib/shared/participants";
import { PLAYER_REQUIREMENT_LABELS, registrationFiltersSummary, type PlayerRequirement } from "@/lib/shared/registration-filters";
import { localizedSitemapEntries, publicSitemapRoutes } from "@/lib/shared/sitemap";
import {
  tournamentActionsMessages,
  tournamentEditFormMessages,
  tournamentFormMessages,
} from "@/lib/shared/tournament-actions-text";
import { TOURNAMENT_IMAGE_FIT_LABELS, tournamentImageErrorMessage } from "@/lib/shared/tournament-image";
import { describePhasePlan, findPhaseIssue, resolvePhasePlan, type PhaseConfig } from "@/lib/shared/tournament-phases";
import type { TournamentFormat } from "@/lib/shared/types";

const EN = messagesFor("en");
const noop = () => undefined;
const fr = (source: string, values: Record<string, string | number> = {}) => formatMessage("fr", source, values);

const globalWithDocument = globalThis as { document?: unknown };
const savedDocument = globalWithDocument.document;
beforeAll(() => {
  globalWithDocument.document = { body: {} };
});
afterAll(() => {
  globalWithDocument.document = savedDocument;
});
beforeEach(() => {
  mockLocale = "en";
});

function render(locale: "fr" | "en", ui: ReactElement): string {
  const tree = <ToastProvider>{ui}</ToastProvider>;
  if (locale === "fr") return renderToStaticMarkup(tree);
  return renderToStaticMarkup(
    <AppLocaleProvider locale="en">
      <TournamentActionsTextProvider locale="en" messages={tournamentFormMessages(EN)}>
        {tree}
      </TournamentActionsTextProvider>
    </AppLocaleProvider>,
  );
}

/** L'arbre réel de l'édition : la fiche (refus, gestes, image), puis le formulaire seul. */
function renderEdit(ui: ReactElement): string {
  return renderToStaticMarkup(
    <AppLocaleProvider locale="en">
      <TournamentActionsTextProvider locale="en" messages={tournamentActionsMessages(EN)}>
        <TournamentActionsTextProvider locale="en" messages={tournamentEditFormMessages(EN)}>
          <ToastProvider>{ui}</ToastProvider>
        </TournamentActionsTextProvider>
      </TournamentActionsTextProvider>
    </AppLocaleProvider>,
  );
}

function readable(html: string): string {
  const attributes = [...html.matchAll(/(?:aria-label|aria-roledescription|title|placeholder|alt)="([^"]*)"/g)].map((m) => m[1]);
  return `${html.replace(/<[^>]+>/g, " ")} ${attributes.join(" ")}`;
}

const FRENCH =
  /\b(Annuler|Enregistrer|Créer|Nom|Jeu|Équipes?|Joueurs?|Manches?|Phase finale|Ajouter|Aperçu|Inscriptions?|Début|Fin|Planning|Identité|Conditions|Aucun|Tous|Recadrer|Retirer|Remplacer|Petite finale|Capital|Barème|Rondes?|Mode|Pourcentage|Nombre|Automatique|Libre|tournoi)\b/;
const ACCENTED = /[À-ÿ]/;

function expectNoFrench(html: string): void {
  const text = readable(html);
  expect(text).not.toMatch(FRENCH);
  expect(text).not.toMatch(ACCENTED);
}

const BO5: MatchFormat = { type: "BO", value: 5 };
const FT3_DRAWS: MatchFormat = { type: "FT", value: 3, drawsAllowed: true, maxMaps: 4 };

// ─── Le français égale les textes d'origine ────────────────────────────────

describe("français inchangé — les messages égalent les textes d'origine", () => {
  it("libellés d'effectif, conditions d'inscription, exigences par joueur", () => {
    for (const type of ["TEAM", "SOLO"] as const) expect(frForm.form.maxEntrants[type]).toBe(PARTICIPANT_WORDING[type].maxLabel);
    expect(frForm.form.requirements).toEqual(PLAYER_REQUIREMENT_LABELS);
    const requirements: PlayerRequirement[] = ["NONE", "ANY_PLAYER", "ALL_PLAYERS"];
    for (const discordRequirement of requirements) {
      for (const blizzardRequirement of requirements) {
        for (const minPlayers of [1, 5]) {
          for (const solo of [false, true]) {
            const filters = { discordRequirement, blizzardRequirement, minPlayers };
            expect(conditionsText(FR_FORM_TEXT, filters, solo)).toBe(registrationFiltersSummary(filters, solo));
          }
        }
      }
    }
  });

  it("format de match : notation, description, aide, refus", () => {
    for (const format of [BO5, FT3_DRAWS, { type: "FT", value: 1 } as MatchFormat, null]) {
      expect(formatNotationText(FR_FORM_TEXT, format)).toBe(matchFormatLabel(format));
      expect(formatDescriptionText(FR_FORM_TEXT, format)).toBe(matchFormatDescription(format));
    }
    for (const [type, valid, format] of [["LIBRE", true, null], ["BO", true, BO5], ["BO", false, null], ["FT", false, null]] as const) {
      expect(formatHintText(FR_FORM_TEXT, type, valid, format)).toBe(matchFormatHint(type, valid, format));
      expect(invalidFormatText(FR_FORM_TEXT, type)).toBe(invalidMatchFormatMessage(type));
    }
  });

  it("plan de phases : formats, résumés, aperçu, refus", () => {
    const phases: PhaseConfig[] = [
      { ...createDefaultPhase(1, "SWISS"), qualifierMode: "COUNT", qualifierValue: 8 },
      { ...createDefaultPhase(2, "SINGLE"), qualifierMode: "PERCENT", qualifierValue: 50 },
      createDefaultPhase(3, "DOUBLE"),
    ];
    for (const format of ["SINGLE", "DOUBLE", "SWISS", "SURVIVAL"] as const) expect(phaseFormatText(FR_FORM_TEXT, format)).toBe(phaseFormatLabel(format));
    phases.forEach((phase, index) => expect(phaseSummaryText(FR_FORM_TEXT, phase, index === phases.length - 1)).toBe(phaseSummary(phase, index === phases.length - 1)));
    for (const count of [2, 6, 16, 64]) expect(phasePlanText(FR_FORM_TEXT, resolvePhasePlan(count, phases))).toEqual(describePhasePlan(resolvePhasePlan(count, phases)));
    const broken = [createDefaultPhase(1, "DOUBLE"), createDefaultPhase(2, "SINGLE")];
    const issue = findPhaseIssue(broken);
    expect(issue).not.toBeNull();
    if (issue) expect(phaseIssueText(FR_FORM_TEXT, FR_ERRORS_TEXT, issue)).toBe(phaseIssueMessage(issue));
    expect(phaseIssueText(FR_FORM_TEXT, FR_ERRORS_TEXT, { code: "NOPE", phaseIndex: null, field: null })).toBe(phaseIssueMessage({ code: "NOPE", phaseIndex: null, field: null }));
  });

  it("édition : verrou, enregistrement, planification par l'arbitrage", () => {
    expect(frForm.edit.finished).toBe(FINISHED_EDIT_NOTICE);
    for (const reason of [null, "STARTED", "VISIBLE"] as const) {
      expect(editLockNoticeText(FR_FORM_TEXT, reason, "2026-05-01T10:00:00.000Z")).toBe(editLockNotice(reason, "2026-05-01T10:00:00.000Z"));
    }
    for (const fieldsSent of [false, true]) {
      for (const planning of [null, { changed: false, movedToPlanning: 0 }, { changed: true, movedToPlanning: 0 }, { changed: true, movedToPlanning: 3 }]) {
        for (const enabled of [false, true]) expect(editSavedText(FR_FORM_TEXT, fieldsSent, planning, enabled)).toBe(editSavedMessage(fieldsSent, planning, enabled));
      }
    }
    for (const [code, message] of Object.entries(REFEREE_SCHEDULING_ERRORS)) {
      expect(frForm.edit.planningErrors[code as keyof typeof frForm.edit.planningErrors]).toBe(message);
    }
    expect(frForm.form.referee.description).toBe(REFEREE_SCHEDULING_DESCRIPTION);
    expect(frForm.form.referee.warning).toBe(ENABLE_PLANNING_WHILE_RUNNING_WARNING);
    expect(frForm.edit.fields.maxTeams).toBe("Nombre de places");
    expect(Object.keys(frForm.edit.fields)).toHaveLength(28);
  });

  it("image : modes, refus, réussites", () => {
    expect(frImage.picker.fits).toEqual(TOURNAMENT_IMAGE_FIT_LABELS);
    for (const code of ["FILE_MISSING", "IMAGE_TOO_LARGE", "IMAGE_FORMAT_INVALID", "IMAGE_DIMENSIONS_INVALID", "IMAGE_ANIMATED_NOT_SUPPORTED", "INVALID_IMAGE_FIT", "INVALID_IMAGE_FOCUS", "TOURNAMENT_IMAGE_MISSING", "TOURNAMENT_NOT_FOUND", "FORBIDDEN", "UNAUTHORIZED", "OTHER"]) {
      expect(imageErrorText(FR_IMAGE_TEXT, code)).toBe(tournamentImageErrorMessage(code));
    }
    const settings = { fit: "COVER" as const, focusX: 50, focusY: 50 };
    for (const change of [{ kind: "UPLOAD" as const, settings }, { kind: "UPDATE" as const, settings }, { kind: "DELETE" as const }, { kind: "NONE" as const }]) {
      expect(imageSuccessText(FR_IMAGE_TEXT, change)).toBe(imageChangeSuccessMessage(change));
    }
  });

  it("fenêtre de lancement : refus du lancement et repli", () => {
    const errors: Record<string, string> = frLaunchModal.errors;
    for (const [code, message] of Object.entries(LAUNCH_ERROR_MESSAGES)) expect(`${code}: ${errors[code]}`).toBe(`${code}: ${message}`);
    expect(errors.fallback).toBe(launchErrorMessage(null));
    expect(Object.keys(EN.launchModal.errors)).toEqual(Object.keys(errors));
  });

  it("fenêtre de lancement : hors de la coquille, chargée à la demande", () => {
    // Ses textes ne pèsent plus sur chaque page : ni dans le paquet de la
    // coquille (français), ni dans ce que la mise en page sérialise sous /en.
    expect(frShell).not.toHaveProperty("launchModal");
    expect(EN.shell).not.toHaveProperty("launchModal");
    const layout = readFileSync(path.join(process.cwd(), "app/layout.tsx"), "utf8");
    expect(layout).toContain("<MatchLaunchCenterLazy ");
    expect(layout).not.toMatch(/from "@\/components\/match-launch\/MatchLaunchCenter"/);
    const lazy = readFileSync(path.join(process.cwd(), "components/match-launch/MatchLaunchCenterLazy.tsx"), "utf8");
    expect(lazy).toContain("ssr: false");
    // Un morceau disparu recharge la page (jamais l'écran d'erreur), et ce qui
    // arrive avant lui (choix de confidentialité, ouverture demandée) est retenu.
    expect(lazy).toContain('orReload(import("./MatchLaunchCenter")');
    expect(lazy).toContain("addEventListener(PRIVACY_CHANGES_ANSWERED_EVENT");
    expect(lazy).toContain("addEventListener(MATCH_LAUNCH_OPEN_EVENT");
    expect(lazy).toContain("privacyPending={privacyPending && !privacyAnswered} requestedMatchId={requestedMatchId}");
    const center = readFileSync(path.join(process.cwd(), "components/match-launch/MatchLaunchCenter.tsx"), "utf8");
    expect(center).toContain("useState<number | null>(requestedMatchId)");
  });
});

// ─── Route, métadonnées ──────────────────────────────────────────────────────

describe("route et référencement", () => {
  it("création et édition ouvertes sous /en, hors sitemap (staff, noindex)", () => {
    expect(isMigratedRoute("/tournois/creer")).toBe(true);
    expect(isMigratedRoute("/tournois/12/modifier")).toBe(true);
    const paths = localizedSitemapEntries(publicSitemapRoutes()).map((entry) => entry.path);
    expect(paths.some((path) => path.includes("/tournois/creer") || path.includes("/modifier"))).toBe(false);
  });

  it("titre, canonique et hreflang dans la langue de l'adresse", async () => {
    const create = await createMetadata();
    expect(JSON.stringify(create.title)).toContain("Create a tournament");
    expect(create.alternates?.canonical).toBe("/en/tournois/creer");
    expect(create.alternates?.languages).toEqual({ fr: "/tournois/creer", en: "/en/tournois/creer", "x-default": "/tournois/creer" });
    const edit = await editMetadata({ params: Promise.resolve({ id: "12" }) });
    expect(JSON.stringify(edit.title)).toContain("Edit the tournament");
    expect(edit.alternates?.canonical).toBe("/en/tournois/12/modifier");
    expect(edit.openGraph).toBeNull();
    mockLocale = "fr";
    expect(JSON.stringify((await createMetadata()).title)).toContain("Créer un tournoi");
    expect(JSON.stringify((await editMetadata({ params: Promise.resolve({ id: "12" }) })).title)).toContain("Modifier le tournoi");
  });

  it("les mises en page ne sérialisent l'anglais que sous /en", async () => {
    const en = await CreateLayout({ children: null });
    expect((en.props as { messages?: Record<string, unknown> }).messages).toHaveProperty("form");
    // L'édition hérite des refus, des gestes et de l'image de la fiche : elle
    // n'envoie que le formulaire (pas deux fois ~30 Ko d'anglais).
    const editEn = await EditLayout({ children: null });
    expect(Object.keys((editEn.props as { messages?: Record<string, unknown> }).messages ?? {})).toEqual(["form"]);
    mockLocale = "fr";
    expect(((await CreateLayout({ children: null })).props as { messages?: unknown }).messages).toBeUndefined();
    expect(((await EditLayout({ children: null })).props as { messages?: unknown }).messages).toBeUndefined();
  });

  it("le bouton « Créer » de la liste ne dit plus la page française (hrefLang)", () => {
    const source = readFileSync(path.join(process.cwd(), "app/(secured)/tournois/TournamentsList.tsx"), "utf8");
    const link = /<LocaleLink href="\/tournois\/creer"[^>]*>/.exec(source);
    expect(link?.[0]).toBe('<LocaleLink href="/tournois/creer">');
  });

  it("les fenêtres restées françaises (recadrage, notifications) le disent jusque dans leur titre et leurs notifications", () => {
    const picker = readFileSync(path.join(process.cwd(), "app/(secured)/tournois/_components/TournamentImagePicker.tsx"), "utf8");
    expect(picker).toContain('const CROP_TITLE = FR_IMAGE_TEXT.t("picker.cropTitle");');
    expect(picker).not.toContain(', t("picker.cropTitle")');
    const launch = readFileSync(path.join(process.cwd(), "components/match-launch/MatchLaunchCenter.tsx"), "utf8");
    expect(launch).toContain('toastLang={text.locale === "fr" ? undefined : "fr"}');
    const panel = readFileSync(path.join(process.cwd(), "components/notifications/PushNotificationsPanel.tsx"), "utf8");
    expect(panel.match(/toastOptions\)/g)).toHaveLength(2);
    expect(panel).toContain("toastLang ? { lang: toastLang } : undefined");
  });

  it("l'édition lit les refus du fournisseur de la fiche, le formulaire du sien", () => {
    function Probe() {
      const errors = useErrorsText();
      const { t } = useFormText();
      return <p>{`${errors.locale}|${mapError("TOURNAMENT_NOT_FOUND", errors)}|${t("meta.editTitle")}`}</p>;
    }
    const html = renderEdit(<Probe />);
    expect(html).toContain(`en|${mapError("TOURNAMENT_NOT_FOUND", { locale: "en", messages: EN.tournamentErrors })}|${EN.tournamentForm.meta.editTitle}`);
  });

  it("le sélecteur d'image porte ses deux langues : la langue seule suffit", () => {
    const picker = <TournamentImagePicker existing={null} value={initialImagePickerValue(null)} onChange={noop} />;
    const html = renderToStaticMarkup(
      <AppLocaleProvider locale="en">
        <TournamentActionsTextProvider locale="en">
          <ToastProvider>{picker}</ToastProvider>
        </TournamentActionsTextProvider>
      </AppLocaleProvider>,
    );
    expectNoFrench(html);
    expect(html).toBe(render("en", picker));
  });
});

// ─── Rendu anglais ───────────────────────────────────────────────────────────

describe("rendu anglais — aucun français dans les formulaires", () => {
  const formats: TournamentFormat[] = ["SINGLE", "DOUBLE", "SWISS", "SURVIVAL", "BG_SURVIE", "MULTI"];

  it.each(formats)("création — %s", (format) => {
    const values = { ...defaultTournamentFormValues(), format, matchFormat: FT3_DRAWS, registrationMinPlayers: 5 };
    const ui = () => (
      <TournamentForm mode="create" initialValues={values} editableFields={new Set(ALL_TOURNAMENT_FIELDS)} submitLabel="Create the tournament" onSubmit={async () => undefined} />
    );
    const html = render("en", ui());
    expectNoFrench(html);
    expect(html).toContain("Registration requirements");
    expect(render("fr", ui())).toContain("Conditions d&#x27;inscription");
  });

  it("création en individuel, jeu Marvel Rivals", () => {
    const values = { ...defaultTournamentFormValues(), participantType: "SOLO" as const, game: "MR" as const };
    const html = render("en", <TournamentForm mode="create" initialValues={values} editableFields={new Set(ALL_TOURNAMENT_FIELDS)} submitLabel="Create" onSubmit={async () => undefined} />);
    expectNoFrench(html);
    expect(html).toContain("Maximum number of players");
    expect(html).toContain("Not relevant for a Marvel Rivals tournament");
  });

  it("édition restreinte (tournoi visible) et planification en cours", () => {
    const html = renderEdit(
      <TournamentForm
        mode="edit"
        initialValues={{ ...defaultTournamentFormValues(), format: "MULTI" }}
        editableFields={editableFieldsForWindow("RESTRICTED")}
        submitLabel="Save changes"
        explanationId="lock"
        tournamentState="RUNNING"
        onSubmit={async () => undefined}
      />,
    );
    expectNoFrench(html);
    expect(html).toContain("Plan preview");
  });

  it("page de création", () => {
    const html = render("en", <CreateTournamentPage />);
    expectNoFrench(html);
    expect(html).toContain("Create <span class=\"text-gradient\">a tournament</span>");
    expect(html).toContain('href="/en/tournois"');
  });

  it("sélecteur d'image, vide puis avec une illustration", () => {
    const empty = render("en", <TournamentImagePicker existing={null} value={initialImagePickerValue(null)} onChange={noop} />);
    expectNoFrench(empty);
    expect(empty).toContain("Add an illustration or a logo");
    const image = { url: "/uploads/t.webp", fit: "COVER" as const, focusX: 40, focusY: 60 };
    const filled = render("en", <TournamentImagePicker existing={image} value={initialImagePickerValue(image)} onChange={noop} />);
    expectNoFrench(filled);
    expect(filled).toContain("Focal point: 40% from the left, 60% from the top");
  });
});

// ─── Équivalence avec next-intl ──────────────────────────────────────────────

describe("formulaires — équivalence avec next-intl, message par message", () => {
  type Leaf = { key: string; source: string };
  const leaves = (tree: unknown, prefix = ""): Leaf[] =>
    typeof tree === "string"
      ? [{ key: prefix, source: tree }]
      : Object.entries(tree as Record<string, unknown>).flatMap(([key, value]) => leaves(value, prefix ? `${prefix}.${key}` : key));
  const sample = (source: string, count: number): Record<string, string | number> => {
    const values: Record<string, string | number> = {};
    for (const [, name, type] of source.matchAll(/\{\s*([A-Za-z_]\w*)\s*(?:,\s*(\w+))?/g)) values[name] = type === "plural" ? count : `‹${name}›`;
    return values;
  };

  it.each(LOCALES.flatMap((locale) => (["tournamentImage", "tournamentForm", "launchModal"] as const).map((ns) => [locale, ns] as const)))("%s — %s", (locale, namespace) => {
    const messages = leaves(messagesFor(locale)[namespace]);
    expect(messages.length).toBeGreaterThan(30);
    for (const { key, source } of messages) {
      const reference = createTranslator({ locale, messages: { m: source }, timeZone: SITE_TIME_ZONE });
      for (const count of [0, 1, 2]) {
        const values = sample(source, count);
        const tags = { strong: (c: string) => c, em: (c: string) => c, hl: (c: string) => c };
        expect(`${key}: ${formatMessage(locale, source, values)}`).toBe(`${key}: ${reference.markup("m", { ...values, ...tags })}`);
      }
    }
  });
});

// Repère : les phrases ICU de `fr` restent celles qu'écrivait le code (pluriel `> 1`).
it("pluriels français : 0 et 1 au singulier, comme `> 1`", () => {
  expect(fr(frForm.phases.plan.teams, { count: 1 })).toBe("1 équipe");
  expect(fr(frForm.phases.plan.teams, { count: 0 })).toBe("0 équipe");
  expect(fr(frForm.phases.plan.teams, { count: 2 })).toBe("2 équipes");
});
