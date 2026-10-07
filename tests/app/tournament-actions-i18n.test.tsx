/**
 * Lot 8b-1 — les **gestes** de la fiche d'un tournoi sous `/en` : inscription,
 * abandon, score, forfait, signalement, lancement, outils du staff posés sur la
 * page, notifications et confirmations, et la table des refus (`error-map`).
 *
 * Trois gardes :
 * 1. le français ne bouge pas — table des refus égale à la référence relevée
 *    avant le lot, phrases égales aux modules partagés qu'elles remplacent ;
 * 2. rendue sous `/en`, une fenêtre ou un geste ne laisse aucun français ;
 * 3. chaque message des trois espaces donne le même texte que `next-intl`.
 *
 * Rendu serveur, comme `tests/tournois/tournament-dialogs-render.test.tsx` :
 * portail remplacé par son contenu, premier effet joué une fois, hooks de
 * comportement (DOM) neutralisés.
 */
import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";

jest.mock("react-dom", () => {
  const actual = jest.requireActual<typeof import("react-dom")>("react-dom");
  return { ...actual, createPortal: (node: unknown) => node };
});
const effects = { armed: false };
jest.mock("react", () => {
  const actual = jest.requireActual<typeof import("react")>("react");
  return {
    ...actual,
    useEffect: (effect: () => void) => {
      if (!effects.armed) return;
      effects.armed = false;
      effect();
    },
  };
});
jest.mock("@/lib/shared/hooks/useDialogBehavior", () => ({ useDialogBehavior: () => ({ current: null }) }));
jest.mock("next/navigation", () => ({
  usePathname: () => "/en/tournois/1",
  useSearchParams: () => new URLSearchParams(""),
  useParams: () => ({ id: "1" }),
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined, prefetch: () => undefined, back: () => undefined, forward: () => undefined }),
}));

import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createTranslator } from "next-intl";
import referenceErrors from "../fixtures/tournament-errors-fr-before-lot8b.json";
import frActions from "@/messages/fr/tournamentActions.json";
import frDialogs from "@/messages/fr/tournamentDialogs.json";
import {
  ERROR_MESSAGES,
  FR_ERRORS_TEXT,
  UNKNOWN_ERROR_MESSAGE,
  mapBatchError,
  mapEntrantError,
  mapError,
} from "@/app/(secured)/tournois/[id]/_lib/error-map";
import {
  FR_ACTIONS_TEXT,
  advanceSuccessText,
  launchErrorText,
  refereeSchedulingErrorText,
  rollbackStageText,
} from "@/app/(secured)/tournois/[id]/_lib/actions-text";
import {
  FR_DIALOGS_TEXT,
  adminProposalText,
  mapViolationText,
  scoreBlockerText,
  scoreViolationText,
} from "@/app/(secured)/tournois/[id]/_lib/dialogs-text";
import { matchCardActionList, matchCardActionName } from "@/app/(secured)/tournois/[id]/_lib/match-card-actions";
import { registerBlockedNotice } from "@/app/(secured)/tournois/[id]/_lib/register-entry";
import { registrationConfirmText } from "@/app/(secured)/tournois/[id]/_lib/registration-confirm";
import { adminProposalNotice, scoreBlockerMessage, type ScoreFormBlocker } from "@/app/(secured)/tournois/[id]/_lib/score-form";
import { EntrantProvider } from "@/app/(secured)/tournois/[id]/_lib/entrant-link";
import { AdvanceTournamentDialog } from "@/app/(secured)/tournois/[id]/_components/AdvanceTournamentDialog";
import { AdminScoreDialog } from "@/app/(secured)/tournois/[id]/_components/AdminScoreDialog";
import { DeleteTournamentDialog } from "@/app/(secured)/tournois/[id]/_components/DeleteTournamentDialog";
import { EndurancePenaltyDialog } from "@/app/(secured)/tournois/[id]/_components/EndurancePenaltyDialog";
import { EntrantContactsPanel } from "@/app/(secured)/tournois/[id]/_components/EntrantContactsPanel";
import { GhostRegistrationDialog } from "@/app/(secured)/tournois/[id]/_components/GhostRegistrationDialog";
import { IssueReportDialog } from "@/app/(secured)/tournois/[id]/_components/IssueReportDialog";
import { MatchLiveDialog } from "@/app/(secured)/tournois/[id]/_components/MatchLiveDialog";
import { MatchPlanningPanel } from "@/app/(secured)/tournois/[id]/_components/MatchPlanningPanel";
import { MatchReplayDialog } from "@/app/(secured)/tournois/[id]/_components/MatchReplayDialog";
import { MatchRow } from "@/app/(secured)/tournois/[id]/_components/MatchRow";
import { MatchScheduleDialog } from "@/app/(secured)/tournois/[id]/_components/MatchScheduleDialog";
import { PlayerScoreDialog } from "@/app/(secured)/tournois/[id]/_components/PlayerScoreDialog";
import { RegistrationsPanel } from "@/app/(secured)/tournois/[id]/_components/RegistrationsPanel";
import { RemoveEntrantDialog } from "@/app/(secured)/tournois/[id]/_components/RemoveEntrantDialog";
import { RollbackRoundDialog } from "@/app/(secured)/tournois/[id]/_components/RollbackRoundDialog";
import { TournamentHeader } from "@/app/(secured)/tournois/[id]/_components/TournamentHeader";
import { AppLocaleProvider } from "@/components/i18n/locale-context";
import { TournamentActionsTextProvider } from "@/components/i18n/tournament-actions-text";
import { TournamentPageTextProvider } from "@/components/i18n/tournament-page-text";
import { TournamentsTextProvider } from "@/components/i18n/tournaments-text";
import { ToastProvider } from "@/components/ui/toast";
import { messagesFor } from "@/lib/server/i18n-messages";
import { buildEntrantLogoMap } from "@/lib/shared/entrant-logos";
import { CONCURRENT_UPDATE_RETRY, CONCURRENT_UPDATE_RETRY_MESSAGE } from "@/lib/shared/api-error-code";
import { endurancePenaltyMessage } from "@/lib/shared/endurance-penalty";
import { ENTRANT_REMOVAL_BLOCK_MESSAGES } from "@/lib/shared/entrant-removal";
import { batchCounterLabel, guestBatchSuccessMessage } from "@/lib/shared/ghost-registration";
import { MATCH_LIVE_TRIGGER_LABELS, MATCH_LIVE_TRIGGERS } from "@/lib/shared/live-streams";
import { LOCALES, SITE_TIME_ZONE } from "@/lib/shared/locales";
import { scoreSubmittedMessage } from "@/lib/shared/match-card-viewer";
import { matchScoreViolationMessage, type MatchFormat, type MatchScoreViolation } from "@/lib/shared/match-format";
import { LAUNCH_ERROR_MESSAGES, launchErrorMessage } from "@/lib/shared/match-launch";
import { mapListViolationMessage, type MapListViolation } from "@/lib/shared/match-maps";
import {
  REFEREE_SCHEDULING_ERRORS,
  enablePlanningConsequence,
  playerScoreClosedNotice,
  refereeSchedulingErrorMessage,
  refereeSchedulingToggleLabel,
  refereeSchedulingToggledMessage,
  toPlanCountLabel,
} from "@/lib/shared/match-planning";
import { MATCH_ENTRY_MONTHS, matchEntryMonths } from "@/lib/shared/match-start-entry";
import { formatMessage } from "@/lib/shared/message-format";
import { PARTICIPANT_WORDING } from "@/lib/shared/participants";
import { pendingReportNotice, playerScoreButtonLabel, type PlayerReportView } from "@/lib/shared/player-score-report";
import { SEEDING_SOURCE_LABELS } from "@/lib/shared/seeding";
import { registrationStreamNotice } from "@/lib/shared/stream-notice";
import { tournamentActionsMessages, tournamentActionsText, tournamentErrorsText } from "@/lib/shared/tournament-actions-text";
import { advanceSuccessMessage } from "@/lib/shared/tournament-launch";
import { PHASE_ERROR_MESSAGES } from "@/lib/shared/tournament-phases";
import { tournamentPageMessages } from "@/lib/shared/tournament-page-text";
import { rollbackStageLabel, rollbackStageLabelWithArticle } from "@/lib/shared/tournament-rollback";
import { tournamentsClientMessages } from "@/lib/shared/tournaments-text";
import { bracketMatch } from "../helpers/bracket-match";
import { tournamentCard } from "../helpers/tournament-card";
import { tournamentDetail } from "../helpers/tournament-detail";

const EN = messagesFor("en");
const EN_ERRORS = tournamentErrorsText("en", EN.tournamentErrors);
const EN_ACTIONS = tournamentActionsText("en", EN.tournamentActions);
const noop = () => undefined;

const globalWithDocument = globalThis as { document?: unknown; window?: unknown; fetch?: unknown };
const saved = { document: globalWithDocument.document, window: globalWithDocument.window, fetch: globalWithDocument.fetch };
beforeAll(() => {
  globalWithDocument.document = { body: {}, referrer: "" };
  globalWithDocument.window = { location: { origin: "http://localhost", pathname: "/en/tournois/1" }, history: { length: 1 } };
  // Les fenêtres qui lisent une liste au montage (équipes fantômes) ne partent pas sur le réseau.
  globalWithDocument.fetch = () => new Promise(() => undefined);
  jest.useFakeTimers({ now: new Date("2026-05-05T10:00:00.000Z") });
});
afterAll(() => {
  globalWithDocument.document = saved.document;
  globalWithDocument.window = saved.window;
  globalWithDocument.fetch = saved.fetch;
  jest.useRealTimers();
});

/** Rendu dans une langue, fournisseurs de la fiche compris (anglais : ceux de `/en`). */
function render(locale: "fr" | "en", ui: ReactElement, participantType: "TEAM" | "SOLO" = "TEAM"): string {
  effects.armed = true;
  return renderWith(locale, ui, participantType);
}

/** Rendu sans effet joué : composants de la page (liens, minuteries), et non fenêtres. */
function renderPage(locale: "fr" | "en", ui: ReactElement): string {
  effects.armed = false;
  return renderWith(locale, ui, "TEAM");
}

function renderWith(locale: "fr" | "en", ui: ReactElement, participantType: "TEAM" | "SOLO"): string {
  const tree = (
    <ToastProvider>
      <EntrantProvider participantType={participantType} soloUserIds={{}} logos={buildEntrantLogoMap([])}>
        {ui}
      </EntrantProvider>
    </ToastProvider>
  );
  if (locale === "fr") return renderToStaticMarkup(tree);
  return renderToStaticMarkup(
    <AppLocaleProvider locale="en">
      <TournamentsTextProvider locale="en" messages={tournamentsClientMessages(EN)}>
        <TournamentPageTextProvider locale="en" messages={tournamentPageMessages(EN)}>
          <TournamentActionsTextProvider locale="en" messages={tournamentActionsMessages(EN)}>
            {tree}
          </TournamentActionsTextProvider>
        </TournamentPageTextProvider>
      </TournamentsTextProvider>
    </AppLocaleProvider>,
  );
}

/** Texte lisible et attributs lus (noms accessibles, infobulles, champs). */
function readable(html: string): string {
  const attributes = [...html.matchAll(/(?:aria-label|title|placeholder|alt|data-label)="([^"]*)"/g)].map((m) => m[1]);
  return `${html.replace(/<[^>]+>/g, " ")} ${attributes.join(" ")}`;
}

// Mots qui trahiraient du français sous `/en` (les noms des fixtures n'en portent pas).
const FRENCH =
  /\b(Annuler|Enregistrer|Fermer|Supprimer|Retirer|Inscrire|Inscription|Abandonner|Forfait|Pénalité|Manche|manche|Valider|Signaler|Envoyer|Planifier|Diffusion|Rediff|Lancer|Équipe|équipe|Joueur|joueur|engagés?|arbitre|Chargement|Réessayer|Aucun|Aucune|tournoi|Tournoi|contre|Mauvaise|Jour|Mois|Heure)\b/;
const ACCENTED = /[À-ÿ]/;

function expectNoFrench(html: string): void {
  const text = readable(html);
  expect(text).not.toMatch(FRENCH);
  expect(text).not.toMatch(ACCENTED);
  expect(html).not.toContain('lang="fr"');
}

/** Toutes les commandes de lancement offertes (`launchStripControls`). */
const LAUNCH_ALL = { showOpen: true, showClaim: true, showRelease: true, showPlan: true, showForce: true, showHost: true, showHostSwap: true };

const BO3: MatchFormat = { type: "BO", value: 3 };
const FT3: MatchFormat = { type: "FT", value: 3 };

// ─── Table des refus ─────────────────────────────────────────────────────────

describe("table des refus (error-map)", () => {
  it("le français est celui d'avant le lot, code par code", () => {
    expect(ERROR_MESSAGES).toEqual(referenceErrors.errors);
    expect(Object.keys(ERROR_MESSAGES)).toHaveLength(referenceErrors.count);
    expect(UNKNOWN_ERROR_MESSAGE).toBe(referenceErrors.unknown);
  });

  it("les phrases venues des modules partagés y sont recopiées à l'identique", () => {
    const shared: Record<string, string> = {
      ...PHASE_ERROR_MESSAGES,
      ...ENTRANT_REMOVAL_BLOCK_MESSAGES,
      [CONCURRENT_UPDATE_RETRY]: CONCURRENT_UPDATE_RETRY_MESSAGE,
      POINTS_NOT_POSITIVE: endurancePenaltyMessage("POINTS_NOT_POSITIVE"),
      POINTS_TOO_HIGH: endurancePenaltyMessage("POINTS_TOO_HIGH"),
      REASON_REQUIRED: endurancePenaltyMessage("REASON_REQUIRED"),
      REASON_TOO_LONG: endurancePenaltyMessage("REASON_TOO_LONG"),
    };
    for (const [code, message] of Object.entries(shared)) expect(`${code}: ${ERROR_MESSAGES[code]}`).toBe(`${code}: ${message}`);
    // Le lancement : toutes ses phrases, sauf celle que la fiche formule à sa manière.
    for (const [code, message] of Object.entries(LAUNCH_ERROR_MESSAGES)) {
      if (code !== "MATCH_ALREADY_COMPLETED") expect(`${code}: ${ERROR_MESSAGES[code]}`).toBe(`${code}: ${message}`);
    }
  });

  it("chaque code a son anglais, distinct du français", () => {
    const en: Record<string, string> = EN.tournamentErrors.codes;
    for (const code of Object.keys(ERROR_MESSAGES)) {
      expect(en[code]).toBeTruthy();
      expect(`${code}: ${en[code]}`).not.toBe(`${code}: ${ERROR_MESSAGES[code]}`);
      expect(`${code}: ${en[code]}`).not.toMatch(ACCENTED);
    }
  });

  it("anglais : code connu, code inconnu, phrase déjà rédigée", () => {
    expect(mapError("TOURNAMENT_FULL", EN_ERRORS)).toBe("This tournament is full.");
    expect(mapError("SOMETHING_NEW", EN_ERRORS)).toBe(EN.tournamentErrors.unknown);
    expect(mapError("constructor", EN_ERRORS)).toBe("constructor");
    expect(mapError("Failed to fetch", EN_ERRORS)).toBe("Failed to fetch");
    expect(mapError("TOURNAMENT_FULL")).toBe("Ce tournoi est complet.");
  });

  it("refus d'un engagé et d'un lot : nom en tête, tout-ou-rien dans les deux langues", () => {
    expect(mapEntrantError("ALREADY_REGISTERED", "Alpha")).toBe("Alpha — Inscription déjà enregistrée pour ce tournoi.");
    expect(mapEntrantError("ALREADY_REGISTERED", "Alpha", EN_ERRORS)).toBe("Alpha — Already registered for this tournament.");
    expect(mapBatchError("TOURNAMENT_FULL", null, 3)).toBe("Ce tournoi est complet. Rien n'a été enregistré.");
    expect(mapBatchError("TOURNAMENT_FULL", null, 3, EN_ERRORS)).toBe("This tournament is full. Nothing was saved.");
    expect(mapBatchError("TOURNAMENT_FULL", "Al {name}", 1, EN_ERRORS)).toBe("Al {name} — This tournament is full.");
  });

  it("refus du lancement : la table, sauf MATCH_ALREADY_COMPLETED, et un repli", () => {
    for (const code of [...Object.keys(LAUNCH_ERROR_MESSAGES), "NOPE", null]) {
      expect(launchErrorText(FR_ACTIONS_TEXT, FR_ERRORS_TEXT, code)).toBe(launchErrorMessage(code));
    }
    expect(launchErrorText(EN_ACTIONS, EN_ERRORS, "NOT_CASTER")).toBe("Casting a match requires the caster role.");
    expect(launchErrorText(EN_ACTIONS, EN_ERRORS, "MATCH_ALREADY_COMPLETED")).toBe("This match is over.");
    expect(launchErrorText(EN_ACTIONS, EN_ERRORS, "NOPE")).toBe(EN.tournamentActions.launch.fallback);
  });
});

// ─── Le français égale les modules qu'il remplace ───────────────────────────

describe("français inchangé — les messages égalent les textes d'origine", () => {
  const fr = (source: string, values: Record<string, string | number> = {}) => formatMessage("fr", source, values);

  it("libellés d'engagés, mention de retransmission, source de l'ordre", () => {
    for (const type of ["TEAM", "SOLO"] as const) {
      const wording = PARTICIPANT_WORDING[type];
      expect(frActions.wording[type]).toEqual({
        registerCta: wording.registerCta,
        guestCta: wording.guestCta,
        forfeitSelfConfirm: wording.forfeitSelfConfirm,
      });
      expect(frActions.register.streamNotice[type]).toBe(registrationStreamNotice(type === "SOLO"));
      const ghost = frDialogs.ghost[type];
      expect([ghost.title, ghost.hint, ghost.selectMany, ghost.noneAvailable, ghost.newName]).toEqual([
        wording.guestTitle,
        wording.guestHint,
        wording.guestSelectManyLabel,
        wording.guestNoneAvailable,
        wording.guestNewNameLabel,
      ]);
      for (const count of [1, 3]) expect(fr(ghost.success, { count })).toBe(guestBatchSuccessMessage(count, wording));
    }
    expect(frActions.registrations.seedingSource).toEqual(SEEDING_SOURCE_LABELS);
  });

  it("boutons de la carte et ligne de proposition", () => {
    const views: Array<PlayerReportView | null> = [null, ...(["THEIRS_PENDING", "MINE_PENDING", "CONFLICT", "NONE"] as const).map((phase) => ({ phase, mine: null, theirs: null }) as PlayerReportView)];
    const labels = Object.values(frActions.cardActions.playerScore);
    for (const view of views) for (const canReport of [true, false]) expect(labels).toContain(playerScoreButtonLabel(view, canReport));
    const report = { team1Score: 2, team2Score: 1, maps: [], reportedAt: "2026-05-05T10:00:00.000Z" };
    const pending = bracketMatch({ team1Name: "Alpha", team2Name: null, team2Report: report, status: "READY" });
    expect(fr(frActions.cardActions.reportPending, { score1: 2, score2: 1, reporter: fr(frActions.cardActions.reportSide, { side: 2 }) })).toBe(pendingReportNotice(pending));
    expect(frActions.cardActions.reportConflict).toBe(pendingReportNotice({ ...pending, team1Report: report }));
    const launch: Parameters<typeof matchCardActionList>[0]["launch"] = { ...LAUNCH_ALL, isCaster: false };
    const input: Parameters<typeof matchCardActionList>[0] = { playerScoreLabel: null, launch, inLobby: true, adminScoreLabel: null, showSchedule: true, hasStartAt: true, showOnAir: true, onAir: false, showLiveConfig: true, liveConfigured: false, showReplay: true, hasReplay: false, canReport: true };
    expect(matchCardActionList(input).map((a) => a.label)).toEqual([
      "Ouvrir le lancement", "Planifier", "Modifier la date", "Forcer le lancement", "Changer l'équipe hôte", "Caster ce match", "Retirer le caster", "Lancer le direct", "Diffuser ce match", "Ajouter la rediff", "Signaler un problème",
    ]);
    expect(matchCardActionName("Planifier", "Alpha vs Bravo")).toBe("Planifier : Alpha vs Bravo");
  });

  it("retour en arrière, avancée anticipée, planification par l'arbitrage", () => {
    for (const plan of [
      { stage: { phaseRank: 0, index: 3 }, roundNumber: 4, playoffRound: false },
      { stage: { phaseRank: 2, index: 1 }, roundNumber: 1001, playoffRound: true },
    ]) {
      expect(rollbackStageText(FR_ACTIONS_TEXT, plan)).toBe(rollbackStageLabel(plan));
      expect(rollbackStageText(FR_ACTIONS_TEXT, plan, true)).toBe(rollbackStageLabelWithArticle(plan));
    }
    for (const [target, state] of [["RUNNING", "RUNNING"], ["RUNNING", "FINISHED"], ["REGISTRATION", "REGISTRATION"], ["LOCKED", "REGISTRATION"]] as const) {
      for (const count of [0, 1, 4]) expect(advanceSuccessText(FR_ACTIONS_TEXT, target, state, count)).toBe(advanceSuccessMessage(target, state, count));
    }
    for (const code of [...Object.keys(REFEREE_SCHEDULING_ERRORS), "OTHER", null]) {
      expect(refereeSchedulingErrorText(FR_ACTIONS_TEXT, code)).toBe(refereeSchedulingErrorMessage(code));
    }
    for (const count of [1, 3]) {
      expect(fr(frActions.planning.toPlanCount, { count })).toBe(toPlanCountLabel(count));
      expect(fr(frActions.planning.enabledMoved, { count })).toBe(refereeSchedulingToggledMessage(true, count));
      expect(fr(frActions.planning.confirm.consequence, { count })).toBe(enablePlanningConsequence(count));
    }
    expect(frActions.planning.enabled).toBe(refereeSchedulingToggledMessage(true, 0));
    expect(frActions.planning.disabled).toBe(refereeSchedulingToggledMessage(false, 0));
    expect([frActions.planning.enable, frActions.planning.disable]).toEqual([refereeSchedulingToggleLabel(false), refereeSchedulingToggleLabel(true)]);
  });

  it("score : violations de format, refus de maps, blocages, proposition, envoi", () => {
    const violations: MatchScoreViolation[] = ["SCORE_EXCEEDS_MATCH_FORMAT", "SCORE_BELOW_MATCH_FORMAT", "DRAW_NOT_ALLOWED"];
    for (const format of [BO3, FT3, { type: "FT", value: 1 } as MatchFormat, null]) {
      for (const violation of violations) expect(scoreViolationText(FR_DIALOGS_TEXT, format, violation)).toBe(matchScoreViolationMessage(format, violation));
      const mapErrors: MapListViolation[] = ["MAP_LIST_EMPTY", "MAP_COUNT_EXCEEDED", "MAP_REPLAY_CODE_REQUIRED", "MAP_REPLAY_CODE_INVALID", "MAP_REPLAY_CODE_DUPLICATE", "MAP_SCORE_INVALID", "MAP_AFTER_DECISION", "MAP_LIST_INCOMPLETE", ...violations];
      for (const error of mapErrors) {
        for (const game of ["OW", "MR", null] as const) expect(mapViolationText(FR_DIALOGS_TEXT, error, format, game)).toBe(mapListViolationMessage(error, format, game));
      }
      const blockers: ScoreFormBlocker[] = ["INCOMPLETE", "EXCEEDS_FORMAT", "BELOW_FORMAT", "DRAW", "ALREADY_DECIDED", "DOUBLE_FORFEIT", "NOT_IN_LAUNCH"];
      for (const blocker of blockers) expect(scoreBlockerText(FR_DIALOGS_TEXT, blocker, format)).toBe(scoreBlockerMessage(blocker, format));
    }
    for (const dirty of [false, true]) {
      const proposal = { team1Score: 2, team2Score: 0, proposedBy: "team2" as const };
      expect(adminProposalText(FR_DIALOGS_TEXT, proposal, "Alpha", "Bravo", dirty)).toBe(adminProposalNotice(proposal, "Alpha", "Bravo", dirty));
    }
    expect(fr(frDialogs.score.player.submitted, { team1: "A", team2: "B", score1: 2, score2: 1 })).toBe(scoreSubmittedMessage(true, 2, 1, "A", "B"));
    expect(frDialogs.score.player.closed.toPlan).toBe(playerScoreClosedNotice("TO_PLAN", null));
    expect(fr(frDialogs.score.player.closed.scheduledAt, { date: "mardi 12 mai" })).toBe(playerScoreClosedNotice("SCHEDULED", "mardi 12 mai"));
    expect(frDialogs.score.player.closed.scheduled).toBe(playerScoreClosedNotice("SCHEDULED", null));
    expect(frDialogs.score.player.closed.lobby).toBe(playerScoreClosedNotice("LOBBY", null));
  });

  it("diffusion, mois de la programmation, compteur des équipes fantômes", () => {
    for (const trigger of MATCH_LIVE_TRIGGERS) expect(frDialogs.live.triggers[trigger]).toBe(MATCH_LIVE_TRIGGER_LABELS[trigger]);
    expect(matchEntryMonths("fr")).toBe(MATCH_ENTRY_MONTHS);
    expect(matchEntryMonths("en")[0]).toBe("January");
    for (const [selected, remaining] of [[0, 1], [2, 5], [3, 40]] as const) {
      const key = remaining <= 32 ? frDialogs.ghost.counterSlots : frDialogs.ghost.counterBatch;
      const capacity = Math.min(remaining, 32);
      expect(fr(key, { selected, capacity })).toBe(batchCounterLabel(selected, remaining));
    }
  });

  it("confirmation d'inscription : rendu d'avant le lot", () => {
    const card = tournamentCard({ name: "Cup" });
    expect(registrationConfirmText(card, "12/05/2026 20:00")).toEqual({
      title: "Inscrire ton équipe à « Cup » ?",
      body: [
        "Coup d'envoi : 12/05/2026 20:00.",
        "Toute l'équipe sera engagée. Elle ne pourra pas se désinscrire elle-même : seul le staff du tournoi peut retirer un engagé.",
        registrationStreamNotice(false),
      ],
      confirmLabel: "Inscrire mon équipe",
      pendingLabel: "Inscription…",
    });
  });
});

// ─── Rendu anglais ───────────────────────────────────────────────────────────

const OPEN = { registrationOpenAt: "2026-05-02T10:00:00.000Z", registrationCloseAt: "2026-05-10T10:00:00.000Z", startAt: "2026-05-12T10:00:00.000Z" };
const versus = bracketMatch({ id: 7, roundNumber: 2, team1Id: 10, team1Name: "Alpha", team2Id: 11, team2Name: "Bravo", status: "READY" });

describe("rendu anglais — aucun français dans les gestes", () => {
  it("en-tête : inscription, mention de retransmission, outils du staff", () => {
    const detail = tournamentDetail({
      card: tournamentCard({ ...OPEN, name: "Spring Cup", state: "REGISTRATION", startVisibilityAt: "2026-05-01T10:00:00.000Z" }),
      canRegister: true,
      isAdmin: true,
      myTeamId: 10,
      registrations: [{ teamId: 10, teamName: "Alpha", registeredAt: "2026-05-03T18:30:00.000Z", finalRank: null, seed: 1, logoUrl: null }],
    });
    const html = renderPage(
      "en",
      <TournamentHeader detail={detail} isLive tier="PRIORITY" fatal={null} frozen={false} onRegister={noop} onReportIssue={noop} onGuestRegister={noop} onAdvance={noop} onLiveSaved={noop} onEditImage={noop} />,
    );
    // L'édition reste française (lot 8b-2) : son lien l'annonce.
    expectNoFrench(html.replace(/<a[^>]*hrefLang="fr"[^>]*>[^<]*<\/a>/, ""));
    expect(html).toContain("Register my team");
    expect(html).toContain("Learn more");
    expect(html).toContain("+ Ghost team");
    expect(html).toContain("Advance the tournament");
    expect(html).toContain("Report a problem");
  });

  it("refus d'inscription expliqué dans la langue de la page", () => {
    const detail = tournamentDetail({ card: tournamentCard({ ...OPEN, state: "REGISTRATION" }), canRegister: false, canRegisterEntrant: false, myTeamId: 10, registrations: [] });
    expect(registerBlockedNotice(detail, EN_ERRORS, EN_ACTIONS)).toBe(
      "Only your team's owner and managers can register it for a tournament.",
    );
    expect(registerBlockedNotice({ ...detail, registrationBlock: "TEAM_TOO_FEW_PLAYERS" }, EN_ERRORS)).toBe(EN.tournamentErrors.codes.TEAM_TOO_FEW_PLAYERS);
  });

  it("inscrites (staff) et planification : ordre, retraits, décompte", () => {
    const detail = tournamentDetail({
      card: tournamentCard({ ...OPEN, state: "RUNNING", refereeScheduling: true }),
      registrations: [
        { teamId: 10, teamName: "Alpha", registeredAt: "2026-05-03T18:30:00.000Z", finalRank: null, seed: 1, logoUrl: null },
        { teamId: 11, teamName: "Bravo", registeredAt: "2026-05-03T19:30:00.000Z", finalRank: null, seed: 2, logoUrl: null },
      ],
      matches: [versus],
      isAdmin: true,
    });
    const registrations = renderPage("en", <RegistrationsPanel detail={detail} canAct onChanged={noop} />);
    expectNoFrench(registrations);
    expect(renderPage("fr", <RegistrationsPanel detail={detail} canAct onChanged={noop} />)).toContain("Le tournoi a commencé");
    const planning = renderPage("en", <MatchPlanningPanel detail={detail} onPlan={noop} frozen={false} />);
    expectNoFrench(planning);
    expect(planning).toContain("1 match to schedule");
  });

  it("carte de match : actions de l'arbitrage, proposition, verrou", () => {
    const proposed = { ...versus, team1Report: { team1Score: 2, team2Score: 1, maps: [], reportedAt: "2026-05-05T09:00:00.000Z" } };
    const html = renderPage("en", <MatchRow match={proposed} adminResolvable onOpenAdminModal={noop} scoreLocked={false} roundNumber={2} />);
    expectNoFrench(html);
    expect(html).toContain("2 – 1 proposed by Alpha · awaiting confirmation");
    const locked = renderPage("en", <MatchRow match={versus} adminResolvable onOpenAdminModal={noop} scoreLocked roundNumber={2} />);
    expectNoFrench(locked);
    expect(locked).toContain("Score locked");
  });

  it.each<[string, () => ReactElement]>([
    ["avancée anticipée", () => <AdvanceTournamentDialog card={tournamentCard({ ...OPEN, registeredTeams: 4 })} onClose={noop} onAdvanced={noop} />],
    ["suppression", () => <DeleteTournamentDialog tournamentId={1} tournamentName="Spring Cup" onClose={noop} onDeleted={noop} />],
    ["retour en arrière", () => <RollbackRoundDialog tournamentId={1} stageLabel="round 2" stageKey="0:1" matches={[versus]} tournamentFinished onClose={noop} onRolledBack={noop} />],
    ["signalement", () => <IssueReportDialog tournamentId={1} match={versus} onClose={noop} />],
    ["pénalité", () => <EndurancePenaltyDialog tournamentId={1} teamId={10} teamName="Alpha" currentPoints={5} round={2} onClose={noop} onApplied={noop} />],
    ["diffusion", () => <MatchLiveDialog match={versus} onClose={noop} onSaved={noop} />],
    ["rediff", () => <MatchReplayDialog match={{ ...versus, status: "COMPLETED", team1Score: 2, team2Score: 0, winnerTeamId: 10 }} onClose={noop} onSaved={noop} />],
    ["programmation", () => <MatchScheduleDialog match={versus} tournamentStartAt={OPEN.startAt} tournamentFinished={false} refereeScheduling onClose={noop} onSaved={noop} />],
    ["équipes fantômes", () => <GhostRegistrationDialog tournamentId={1} remainingSlots={4} onClose={noop} onRegistered={noop} />],
    ["retrait d'un engagé", () => <RemoveEntrantDialog card={tournamentCard(OPEN)} teamId={10} entrantName="Alpha" onClose={noop} onRemoved={noop} />],
    ["score (arbitrage)", () => <AdminScoreDialog match={versus} onClose={noop} onSubmitted={noop} />],
    ["score (engagé)", () => <PlayerScoreDialog tournamentId={1} match={versus} myTeamId={10} canReportScore canForfeit proposals={[]} onClose={noop} onSubmitted={noop} onRefresh={noop} />],
    ["contacts", () => <EntrantContactsPanel tournamentId={1} />],
  ])("fenêtre — %s", (_name, ui) => {
    const html = render("en", ui());
    expectNoFrench(html);
    // Le français, lui, est toujours là.
    expect(render("fr", ui())).not.toBe(html);
  });

  it("équipes fantômes d'un tournoi individuel : joueurs invités", () => {
    const html = render("en", <GhostRegistrationDialog tournamentId={1} remainingSlots={4} onClose={noop} onRegistered={noop} />, "SOLO");
    expect(html).toContain("Register a guest player");
  });
});

// ─── Équivalence avec next-intl ──────────────────────────────────────────────

describe("gestes — équivalence avec next-intl, message par message", () => {
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

  it.each(LOCALES.flatMap((locale) => (["tournamentErrors", "tournamentActions", "tournamentDialogs"] as const).map((ns) => [locale, ns] as const)))(
    "%s — %s",
    (locale, namespace) => {
      const messages = leaves(messagesFor(locale)[namespace]);
      expect(messages.length).toBeGreaterThan(50);
      for (const { key, source } of messages) {
        const reference = createTranslator({ locale, messages: { m: source }, timeZone: SITE_TIME_ZONE });
        for (const count of [0, 1, 2]) {
          const values = sample(source, count);
          const expected = reference.markup("m", { ...values, strong: (chunks: string) => `<strong>${chunks}</strong>` });
          const actual = formatMessage(locale, source.replace(/<\/?strong>/g, (tag) => tag), values);
          const plain = expected.replace(/<\/?strong>/g, "");
          expect(`${key}: ${actual}`).toBe(`${key}: ${plain}`);
        }
      }
    },
  );
});
