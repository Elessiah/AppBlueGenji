/**
 * Lot « textes explicatifs » des tournois, équipes et signalements
 * (`docs/features/INFO_HINTS.md`) : le formulaire de tournoi, la fiche
 * `/tournois/[id]`, `/equipes/[id]` et `/signalements/[id]` gardent une ligne
 * visible courte pour l'état ou l'essentiel, et passent le fonctionnement
 * derrière le bouton « i » — que le contrôle cite toujours.
 */
import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";

jest.mock("react-dom", () => {
  const actual = jest.requireActual<typeof import("react-dom")>("react-dom");
  return { ...actual, createPortal: (node: unknown) => node };
});
jest.mock("react", () => {
  const actual = jest.requireActual<typeof import("react")>("react");
  // Rendu serveur : aucun effet (lecture du compte, aperçus d'image).
  return { ...actual, useEffect: () => undefined };
});
jest.mock("next/navigation", () => ({
  usePathname: () => "/en/tournois/creer",
  useSearchParams: () => new URLSearchParams(""),
  useParams: () => ({ id: "12" }),
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined, prefetch: () => undefined, back: () => undefined, forward: () => undefined }),
}));

import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import frForm from "@/messages/fr/tournamentForm.json";
import enForm from "@/messages/en/tournamentForm.json";
import frActions from "@/messages/fr/tournamentActions.json";
import enActions from "@/messages/en/tournamentActions.json";
import frTournament from "@/messages/fr/tournament.json";
import enTournament from "@/messages/en/tournament.json";
import frDialogs from "@/messages/fr/tournamentDialogs.json";
import enDialogs from "@/messages/en/tournamentDialogs.json";
import frImage from "@/messages/fr/tournamentImage.json";
import enImage from "@/messages/en/tournamentImage.json";
import frTeam from "@/messages/fr/team.json";
import enTeam from "@/messages/en/team.json";
import frReports from "@/messages/fr/reports.json";
import enReports from "@/messages/en/reports.json";
import { TournamentForm, defaultTournamentFormValues } from "@/app/(secured)/tournois/_components/TournamentForm";
import { LaunchPhaseField } from "@/app/(secured)/tournois/_components/LaunchPhaseField";
import { formatExplainText, FR_FORM_TEXT } from "@/app/(secured)/tournois/_lib/form-text";
import { registrationsRankingHintKey } from "@/app/(secured)/tournois/[id]/_lib/registrations-list";
import { AppLocaleProvider } from "@/components/i18n/locale-context";
import { TournamentActionsTextProvider } from "@/components/i18n/tournament-actions-text";
import { ToastProvider } from "@/components/ui/toast";
import { messagesFor } from "@/lib/server/i18n-messages";
import { ALL_TOURNAMENT_FIELDS } from "@/lib/shared/tournament-edit";
import { tournamentFormMessages } from "@/lib/shared/tournament-actions-text";
import { REGISTRATION_STREAM_NOTICE_SHORT, registrationStreamNotice } from "@/lib/shared/stream-notice";
import type { TournamentFormat } from "@/lib/shared/types";
import { infoHintButtonCount, withoutInfoHintButtons } from "../helpers/info-hint-markup";
import { readSource } from "../helpers/read-source";

const EN = messagesFor("en");

const globalWithDocument = globalThis as { document?: unknown };
const savedDocument = globalWithDocument.document;
beforeAll(() => {
  globalWithDocument.document = { body: {} };
});
afterAll(() => {
  globalWithDocument.document = savedDocument;
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

const form = (over: Partial<ReturnType<typeof defaultTournamentFormValues>> = {}) => (
  <TournamentForm
    mode="create"
    initialValues={{ ...defaultTournamentFormValues(), ...over }}
    editableFields={new Set(ALL_TOURNAMENT_FIELDS)}
    submitLabel="Create"
    onSubmit={async () => undefined}
  />
);

/** Ce qui reste affiché en permanence, dans chaque langue. */
function visibleLines(
  messages: { form: typeof frForm; actions: typeof frActions; tournament: typeof frTournament; dialogs: typeof frDialogs; image: typeof frImage; team: typeof frTeam; reports: typeof frReports },
): Record<string, string> {
  const { form: f, actions: a, tournament, dialogs, image, team, reports } = messages;
  return {
    "form.launchPhase.scope": f.form.launchPhase.scope,
    "form.launchPhase.locked": f.form.launchPhase.locked,
    "form.referee.create": f.form.referee.create,
    "form.referee.edit": f.form.referee.edit,
    "form.maxMapsHint": f.form.maxMapsHint,
    "form.blizzardMarvel": f.form.blizzardMarvel,
    "phases.modeHint": f.phases.modeHint,
    "settings.drawsUnavailable": f.settings.drawsUnavailable,
    "picker.hint": image.picker.hint,
    "picker.fits.COVER.hint": image.picker.fits.COVER.hint,
    "picker.fits.CONTAIN.hint": image.picker.fits.CONTAIN.hint,
    "picker.logoHint": image.picker.logoHint,
    "register.streamNoticeShort": a.register.streamNoticeShort,
    "danger.rollbackHint": a.danger.rollbackHint,
    "danger.deleteHint": a.danger.deleteHint,
    "registrations.seedingHint": a.registrations.seedingHint,
    "registrations.seedingHintWaiting.TEAM": a.registrations.seedingHintWaiting.TEAM,
    "nextRound.stageUncertain": a.nextRound.stageUncertain,
    "nextRound.footnoteShort": a.nextRound.footnoteShort,
    "planning.descriptionOff": tournament.planning.descriptionOff,
    "contacts.intro": dialogs.contacts.intro.replace(/<\/?strong>/g, ""),
    "settings.dangerGhostHelp": team.settings.dangerGhostHelp,
    "roles.managerHelp": team.roles.managerHelp,
    "concerned.lead": reports.concerned.lead,
  };
}

describe("lignes visibles : courtes, en français comme en anglais", () => {
  it.each([
    ["fr", visibleLines({ form: frForm, actions: frActions, tournament: frTournament, dialogs: frDialogs, image: frImage, team: frTeam, reports: frReports })],
    ["en", visibleLines({ form: enForm, actions: enActions, tournament: enTournament, dialogs: enDialogs, image: enImage, team: enTeam, reports: enReports })],
  ])("%s : aucune ligne permanente au-delà de 140 caractères", (_locale: string, lines: Record<string, string>) => {
    for (const [key, line] of Object.entries(lines)) {
      expect(`${key}: ${line.length}`).toBe(`${key}: ${Math.min(line.length, 140)}`);
    }
  });

  it("la retransmission : une ligne visible avec le droit d'opposition, écrite une fois", () => {
    expect(frActions.register.streamNoticeShort).toBe(REGISTRATION_STREAM_NOTICE_SHORT);
    expect(REGISTRATION_STREAM_NOTICE_SHORT).toMatch(/diffusés en direct et enregistrés/);
    expect(REGISTRATION_STREAM_NOTICE_SHORT).toMatch(/opposer/);
    expect(enActions.register.streamNoticeShort).toMatch(/streamed live and recorded/);
    expect(enActions.register.streamNoticeShort).toMatch(/object/);
    // La mention entière, derrière le « i », reste celle du module.
    for (const type of ["TEAM", "SOLO"] as const) {
      expect(frActions.register.streamNotice[type]).toBe(registrationStreamNotice(type === "SOLO"));
    }
  });

  it("le tutoiement du site : plus de « Utilisez » ni de « votre ordre »", () => {
    expect(frActions.registrations.seedingHint).not.toMatch(/Utilisez/);
    expect(frActions.registrations.followsRanking).not.toMatch(/réordonnez|votre/);
  });
});

describe("formulaire de tournoi : le fonctionnement derrière le « i »", () => {
  it("phase de lancement : la case cite son « i » et sa ligne d'état", () => {
    const html = render("fr", <LaunchPhaseField checked={false} locked={false} aria={{ "aria-describedby": "launch-phase-more launch-phase-hint" }} error={null} onChange={() => undefined} />);
    expect(html).toContain('aria-describedby="launch-phase-more launch-phase-hint"');
    expect(html).toMatch(/<div id="launch-phase-more" class="panel" hidden="">/);
    expect(html).toContain("Modifiable jusqu&#x27;au début du tournoi, puis figée.");
    // Un bouton ne se pose pas dans un `<label>`.
    expect(html).not.toMatch(/<label[^>]*>(?:(?!<\/label>)[\s\S])*<button/);
  });

  it("le formulaire relie la case au « i » et à sa ligne", () => {
    const source = readSource("app/(secured)/tournois/_components/TournamentForm.tsx");
    expect(source).toContain('aria={fieldAttrs("launchPhase", LAUNCH_PHASE_MORE_ID, LAUNCH_PHASE_HINT_ID)}');
  });

  it("inscriptions : intro, Discord et Battle.net derrière le « i », cités par leur liste", () => {
    for (const locale of ["fr", "en"] as const) {
      const html = render(locale, form());
      expect(html).toMatch(/<div id="registration-intro" class="panel" hidden="">/);
      expect(html).toMatch(/<select id="registration-discord"[^>]*aria-describedby="registration-discord-hint"/);
      expect(html).toMatch(/<div id="registration-discord-hint" class="panel" hidden="">/);
      expect(html).toMatch(/<select id="registration-blizzard"[^>]*aria-describedby="registration-blizzard-hint"/);
      expect(html).toMatch(/<div id="registration-blizzard-hint" class="panel" hidden="">/);
    }
    // Le conseil propre à Marvel Rivals reste visible, et cité.
    const marvel = render("en", form({ game: "MR" }));
    expect(marvel).toMatch(/aria-describedby="registration-blizzard-hint registration-blizzard-marvel"/);
    expect(marvel).toContain('<p id="registration-blizzard-marvel"');
  });

  const explainedFormats: Array<[TournamentFormat]> = [["SURVIVAL"], ["SWISS"]];
  it.each(explainedFormats)("format %s : son fonctionnement derrière le « i » du libellé « Format »", (format: TournamentFormat) => {
    const html = render("en", form({ format }));
    expect(html).toMatch(/<select id="tournament-format" aria-describedby="tournament-format-explain"/);
    expect(html).toMatch(/<div id="tournament-format-explain" class="panel" hidden="">/);
    expect(html).toContain('aria-label="More info: Bracket format"');
  });

  it("élimination simple : aucun « i » sur le format, dont le nom suffit", () => {
    const html = render("fr", form({ format: "SINGLE" }));
    expect(html).not.toContain("tournament-format-explain");
  });

  it("BG Survie : effectif, manches, égalités et format des play-offs derrière le « i »", () => {
    const html = render("fr", form({ format: "BG_SURVIE" }));
    for (const id of ["endurance-playoff-hint", "endurance-max-rounds-hint", "endurance-early-exit-hint", "endurance-draws-hint", "endurance-playoff-format-hint"]) {
      expect(html).toContain(`aria-controls="${id}"`);
      expect(html).toMatch(new RegExp(`aria-describedby="[^"]*\\b${id}\\b`));
    }
  });

  it("BG Survie en saisie libre : la raison des égalités indisponibles reste visible, sans « i »", () => {
    const html = render("fr", form({ format: "BG_SURVIE", matchFormat: null }));
    expect(html).not.toContain('aria-controls="endurance-draws-hint"');
    expect(html).toContain('<p id="endurance-draws-hint"');
    expect(html).toContain("Indisponible en saisie de score libre");
  });

  it("formatExplainText : Survie et ronde suisse seulement", () => {
    expect(formatExplainText(FR_FORM_TEXT, "SURVIVAL", 5)).toBe(frForm.settings.survivalExplain);
    expect(formatExplainText(FR_FORM_TEXT, "SWISS", 5)).toContain("les 5 rondes");
    for (const format of ["SINGLE", "DOUBLE", "BG_SURVIE", "MULTI"] as const) {
      expect(formatExplainText(FR_FORM_TEXT, format, 5)).toBeNull();
    }
  });

  it("le formulaire entier n'a plus de paragraphe d'explication permanent", () => {
    const html = render("fr", form({ format: "SWISS" }));
    expect(infoHintButtonCount(html)).toBeGreaterThanOrEqual(6);
    // Le fonctionnement de la ronde suisse n'est plus qu'au « i ».
    expect(withoutInfoHintButtons(html).match(/Aucune élimination/g)).toHaveLength(1);
  });
});

describe("fiche du tournoi, équipe, signalement : câblage du « i »", () => {
  it("en-tête : mention de retransmission en couches, spectateur et conditions sans `title`", () => {
    const header = readSource("app/(secured)/tournois/[id]/_components/TournamentHeader.tsx");
    expect(header).toContain('<p>{a("register.streamNoticeShort")}</p>');
    expect(header).toContain('<InfoHint id="register-stream-notice" subject={a("register.streamNoticeSubject")}>');
    expect(header).toContain('<InfoHint id="tournament-spectator-hint" subject={t("header.spectator")}>');
    expect(header).toContain("<InfoHint id={`tournament-meta-${item.key}-hint`} subject={item.label}>");
    expect(header).not.toContain('title={t("header.spectatorTitle")}');
    expect(header).not.toContain("title={item.hint}");
  });

  it("inscriptions, planification, aperçu de la manche suivante", () => {
    expect(readSource("app/(secured)/tournois/[id]/_components/RegistrationsPanel.tsx")).toContain('<InfoHint id="registrations-seeding-more"');
    expect(readSource("app/(secured)/tournois/[id]/_components/MatchPlanningPanel.tsx")).toContain('<InfoHint id="match-planning-more" subject={text.t("planning.titleOn")}>');
    const next = readSource("app/(secured)/tournois/[id]/_components/EnduranceNextRoundPanel.tsx");
    expect(next).toContain("<InfoHint id={`${panelId}-sides-${index}`}");
    expect(next).toContain("<InfoHint id={`${panelId}-footnote`}");
    expect(next).not.toContain("title={sidesHint}");
  });

  it("équipe : l'aide de l'invitation derrière le « i », toujours citée par le champ", () => {
    const members = readSource("app/(secured)/equipes/[id]/_components/MembersSection.tsx");
    expect(members).toContain('<InfoHint id="team-invite-help" subject={t("members.pseudo")}>');
    expect(members).toContain('aria={fieldErrors.aria("pseudo", "team-invite-help")}');
  });

  it("signalement : le droit de contester visible, les exemples derrière le « i »", () => {
    const report = readSource("app/(secured)/signalements/[id]/_components/ConcernedReport.tsx");
    expect(report).toContain('<InfoHint id="concerned-lead-more" subject={t("concerned.contest")}>');
    expect(frReports.concerned.lead).toMatch(/conteste-le/i);
    expect(enReports.concerned.lead).toMatch(/appeal it/i);
  });
});

describe("registrationsRankingHintKey", () => {
  it("nomme l'explication de l'ordre qui suit le classement du site", () => {
    expect(registrationsRankingHintKey(true, false, 3)).toBe("registrations.followsRanking");
    expect(registrationsRankingHintKey(false, true, 3)).toBe("registrations.followsFrozenDraw");
  });

  it("rien à expliquer sur une liste vide ou un ordre qui ne suit pas le classement", () => {
    expect(registrationsRankingHintKey(true, false, 0)).toBeNull();
    expect(registrationsRankingHintKey(false, true, 0)).toBeNull();
    expect(registrationsRankingHintKey(false, false, 4)).toBeNull();
  });
});
