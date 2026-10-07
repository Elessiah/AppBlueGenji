"use client";

import { useTournamentPageText } from "@/components/i18n/tournament-page-text";
import { useToast } from "@/components/ui/toast";
import { matchFormatDescriptionText, matchFormatText } from "@/lib/shared/tournament-page-text";
import type { TournamentDialogsText } from "@/lib/shared/tournament-actions-text";
import { INTL_LOCALE, type Locale } from "@/lib/shared/locales";
import { FormEvent, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Pill } from "@/components/cyber";
import type { BracketMatch, MatchProposalMaps, MatchScoreReport } from "@/lib/shared/types";
import { useBackdropDismiss } from "@/lib/shared/hooks/useBackdropDismiss";
import { useDialogBehavior } from "@/lib/shared/hooks/useDialogBehavior";
import { forfeitMapCount } from "@/lib/shared/match-format";
import {
  checkMapList,
  mapFieldKey,
  isMapTouched,
  progressiveMapRows,
  refusalFieldOnRows,
  trimTrailingBlankMaps,
  refusalOnTouchedRow,
  type MapListCheck,
  sameMapLists,
  type MatchMapInput,
} from "@/lib/shared/match-maps";
import { useFieldErrors } from "@/lib/shared/hooks/useFieldErrors";
import { isMyTeamTeam1, teamLabel } from "@/lib/shared/match-card-viewer";
import {
  playerReportInitialMaps,
  enteredScoreRelation,
  playerReportView,
  proposalsNeedRefresh,
  toReporterScores,
} from "@/lib/shared/player-score-report";
import { useProposalMaps } from "../_hooks/useProposalMaps";
import { useMatchFormat, useTournamentGame } from "../_lib/match-format-context";
import { useLiveControls } from "../_lib/live-context";
import { useMatchLaunchPhase } from "@/lib/shared/hooks/useMatchLaunchPhase";
import { formatMatchStartAtFull } from "@/lib/shared/match-schedule";
import { useMapError } from "../_lib/error-map";
import { mapViolationText, useDialogsText } from "../_lib/dialogs-text";
import type { MatchLaunchPhase } from "@/lib/shared/match-launch";
import { MapScoreList, mapFieldIds } from "./MapScoreList";
import { MapResultList } from "./MatchMapDetails";
import mapStyles from "./MatchMapDetails.module.css";
import styles from "./ScoreDialog.module.css";

interface PlayerScoreDialogProps {
  tournamentId: number;
  /** Match **résolu à chaque rendu** depuis la liste rafraîchie par le flux. */
  match: BracketMatch;
  /** Engagé du lecteur — son équipe, ou son entrée solo. */
  myTeamId: number;
  /** Le match est lancé : le score peut se saisir (`canPlayersReportScore`). */
  canReportScore: boolean;
  /** Qualité pour déclarer forfait au nom de l'engagé (`OWNER` / `MANAGER`). */
  canForfeit: boolean;
  /**
   * Détail map par map des propositions en attente, lu dans le contexte du
   * lecteur (`TournamentViewerContext.matchProposals`) — l'instantané diffusé
   * ne le porte pas.
   */
  proposals: MatchProposalMaps[];
  onClose: () => void;
  onSubmitted: () => void;
  /** Relit le contexte du lecteur (lecture REST) : une proposition a changé. */
  onRefresh: () => void | Promise<unknown>;
}

/** Empreinte des propositions en attente : ce que le flux peut changer sous la saisie. */
function reportsSignature(match: BracketMatch): string {
  const one = (r: MatchScoreReport | null) =>
    r ? [r.team1Score, r.team2Score, JSON.stringify(r.maps)].join("|") : "∅";
  return `${match.id}|${one(match.team1Report)}|${one(match.team2Report)}`;
}

function scoreText(report: MatchScoreReport): string {
  return `${report.team1Score} – ${report.team2Score}`;
}

/**
 * Phrase du désaccord. À score égal, ce sont les maps qui diffèrent (codes de
 * replay ou scores de map, `MAP_SCORES.md`) : le dire, sans quoi « toi : 2 – 1,
 * eux : 2 – 1 » n'expliquerait rien.
 */
function conflictText(text: TournamentDialogsText, mine: MatchScoreReport, theirs: MatchScoreReport, opponentName: string): string {
  const sameScore = mine.team1Score === theirs.team1Score && mine.team2Score === theirs.team2Score;
  return sameScore
    ? text.t("score.player.conflictMaps", { score: scoreText(mine), opponent: opponentName })
    : text.t("score.player.conflictScores", { mine: scoreText(mine), opponent: opponentName, theirs: scoreText(theirs) });
}

/** Heure d'échéance du délai de confirmation, dans le fuseau du lecteur (24 h). */
function deadlineText(iso: string | null, locale: Locale): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleTimeString(INTL_LOCALE[locale], { hour: "2-digit", minute: "2-digit", ...(locale === "fr" ? {} : { hourCycle: "h23" as const }) });
}

/** Pourquoi le score ne se saisit pas encore (`playerScoreClosedNotice`), dans la langue du texte. */
function closedNoticeText(text: TournamentDialogsText, phase: MatchLaunchPhase, startAtFull: string | null): string {
  if (phase === "TO_PLAN") return text.t("score.player.closed.toPlan");
  if (phase === "SCHEDULED") {
    return startAtFull ? text.t("score.player.closed.scheduledAt", { date: startAtFull }) : text.t("score.player.closed.scheduled");
  }
  return text.t("score.player.closed.lobby");
}

/**
 * Saisie du score d'un match **par un engagé** — le pendant joueur
 * d'`AdminScoreDialog`, avec lequel il partage la mise en page, le stepper et
 * la règle de format (`decideScoreForm`).
 *
 * Ce que l'arbitrage n'a pas, et qui fait tout le cycle : les **propositions**.
 * Un score envoyé ici n'écrit pas le résultat, il le propose ; l'adversaire le
 * confirme d'un clic (la modale s'ouvre sur sa proposition), ou en saisit un
 * autre — ce qui alerte l'arbitrage. Sans réponse, la proposition fait foi à
 * l'échéance du délai. La modale dit donc toujours **où en est le cycle**, ce
 * que l'ancien formulaire en ligne taisait : un score envoyé n'y laissait
 * aucune trace, ni chez qui l'avait envoyé, ni chez qui devait le confirmer.
 *
 * Le **forfait** sur cette manche vit ici aussi, replié : c'est la seule porte
 * joueur vers ce geste. Il s'offre avant même le lancement — l'équipe qui ne
 * pourra pas se présenter le sait avant le coup d'envoi.
 */
/**
 * Les maps saisies confirment-elles la proposition adverse (à score égal) ?
 * Mêmes maps, ou proposition sans détail (antérieure aux maps) : le serveur la
 * compare alors au seul score (`reportsConcord`), et l'envoi garde le contrôle
 * de péremption. Un détail encore en lecture n'est pas une absence de détail :
 * l'envoi reste une proposition ordinaire (pas de faux `PROPOSAL_STALE`).
 */
function confirmsProposalMaps(
  maps: ReadonlyArray<MatchMapInput>,
  theirMaps: ReadonlyArray<MatchMapInput>,
  detailLoading: boolean,
): boolean {
  if (theirMaps.length === 0) return !detailLoading;
  return sameMapLists(maps, theirMaps);
}

/** Une map est renseignée, et le refus ne désigne pas une ligne vierge. */
function refusalWorthShowing(check: MapListCheck, maps: ReadonlyArray<MatchMapInput>): boolean {
  return maps.some(isMapTouched) && refusalOnTouchedRow(check, maps);
}

/**
 * Le détail adverse s'affiche à part en désaccord, et quand le formulaire ne
 * l'a pas repris (proposition arrivée pendant une saisie) — pas dès qu'une
 * retouche l'écarte du pré-remplissage : le bloc ferait sauter le champ saisi.
 */
function theirMapsWorthShowing(
  phase: string | undefined,
  theirMaps: ReadonlyArray<MatchMapInput>,
  form: { missedProposal: boolean; confirmsAsIs: boolean },
): boolean {
  if (theirMaps.length === 0) return false;
  if (phase === "CONFLICT") return true;
  return phase === "THEIRS_PENDING" && form.missedProposal && !form.confirmsAsIs;
}

/** Détail adverse en lecture — seulement pour qui peut le lire (`canReportScore`). */
function proposalDetailLoading(
  canRead: boolean,
  match: BracketMatch,
  proposals: ReadonlyArray<MatchProposalMaps>,
): boolean {
  return canRead && proposalsNeedRefresh(match, proposals);
}

/** Phrase d'état quand l'adversaire a proposé un score, selon le détail reçu. */
function theirsPendingStatus(
  text: TournamentDialogsText,
  names: { opponentName: string; myName: string },
  theirs: MatchScoreReport,
  reader: { canReport: boolean; detailLoading: boolean },
): string {
  const values = { opponent: names.opponentName, score: scoreText(theirs), mine: names.myName };
  // Qui ne peut pas reporter ne reçoit jamais le détail (`matchProposals`) :
  // rien à confirmer ni à ressaisir de son côté, et rien à dire du détail.
  if (!reader.canReport) return text.t("score.player.theirs.readOnly", values);
  if ((theirs.maps ?? []).length > 0) return text.t("score.player.theirs.withMaps", values);
  // Détail encore en lecture (proposition arrivée par le flux) : ne pas
  // inviter à ressaisir ce qui va pré-remplir le formulaire.
  if (reader.detailLoading) return text.t("score.player.theirs.loading", values);
  // Sans détail (proposition antérieure aux maps, ou détail introuvable), le
  // formulaire s'ouvre vide : « Confirme-le » laisserait sans geste.
  return text.t("score.player.theirs.withoutMaps", values);
}

export function PlayerScoreDialog({
  tournamentId,
  match: liveMatch,
  myTeamId,
  canReportScore,
  canForfeit,
  proposals,
  onClose,
  onSubmitted,
  onRefresh,
}: Readonly<PlayerScoreDialogProps>) {
  const pageText = useTournamentPageText();
  const text = useDialogsText();
  const { t } = text;
  const mapError = useMapError();
  // Les propositions complétées de leur détail : la modale s'ouvre sur les maps
  // de l'adversaire (codes et scores), à confirmer d'un clic.
  const match = useProposalMaps(liveMatch, proposals, onRefresh, canReportScore);
  const detailLoading = proposalDetailLoading(canReportScore, liveMatch, proposals);
  const { showError, showSuccess } = useToast();
  const matchFormat = useMatchFormat(match);
  // Phase de lancement, pour dire **pourquoi** le score n'est pas encore
  // saisissable (à planifier, en attente de départ, en lancement).
  const { refereeScheduling } = useLiveControls();
  const launchPhase = useMatchLaunchPhase({ ...match, refereeScheduling });
  const [submitting, setSubmitting] = useState(false);
  const dialogRef = useDialogBehavior({ open: true, onClose, locked: submitting });
  const backdrop = useBackdropDismiss(onClose, submitting);
  const [forfeitOpen, setForfeitOpen] = useState(false);

  const view = playerReportView(match, myTeamId);
  const myTeamIsTeam1 = isMyTeamTeam1(myTeamId, match.team1Id);
  const team1 = teamLabel(match.team1Name, match.team1Placeholder, t("score.team", { side: 1 }));
  const team2 = teamLabel(match.team2Name, match.team2Placeholder, t("score.team", { side: 2 }));
  const [myName, opponentName] = myTeamIsTeam1 ? [team1, team2] : [team2, team1];

  const game = useTournamentGame();
  // Saisie **map par map** (`docs/features/MAP_SCORES.md`) : le score du match
  // se dérive des maps, chacune avec son code de replay.
  // Lignes affichées, une à une au fil du format (`progressiveMapRows`) ; ce qui
  // se valide et part en retire la ligne vierge de fin (`trimTrailingBlankMaps`).
  const [rows, setRows] = useState<MatchMapInput[]>(() =>
    progressiveMapRows(matchFormat, game, playerReportInitialMaps(view), 1),
  );
  const maps = trimTrailingBlankMaps(rows);
  const fieldErrors = useFieldErrors<string>({}, mapFieldIds("player-score", rows.length));
  // Réalignement sur le flux : tant que le lecteur n'a rien touché, une
  // proposition qui arrive (l'adversaire vient d'envoyer la sienne) remplit les
  // champs. Une saisie en cours, elle, n'est jamais écrasée en silence.
  const baseline = useRef(rows);
  const current = useRef(rows);
  current.current = rows;
  // Une proposition arrivée **pendant** une saisie ne la remplace pas : son
  // détail s'affiche alors à part (`theirMapsWorthShowing`).
  const [missedProposal, setMissedProposal] = useState(false);
  const signature = reportsSignature(match);
  useEffect(() => {
    const next = progressiveMapRows(matchFormat, game, playerReportInitialMaps(playerReportView(match, myTeamId)), 1);
    const typing = JSON.stringify(current.current) !== JSON.stringify(baseline.current);
    if (!typing) {
      // Les maps remplacées par la nouvelle proposition : les refus rattachés
      // aux anciennes valeurs ne valent plus.
      fieldErrors.clear();
      setRows(next);
    }
    setMissedProposal(typing && !sameMapLists(current.current, next));
    baseline.current = next;
    // `signature` résume exactement ce qui change la valeur d'ouverture.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  const check = checkMapList(matchFormat, game, maps, { decisive: true });
  // Rien de saisi : la ligne vierge d'ouverture n'est pas une proposition.
  const nothingEntered = !maps.some(isMapTouched);
  const entered =
    nothingEntered
      ? null
      : { team1Score: check.score.team1, team2Score: check.score.team2, maps };
  // Renvoyer à l'identique la proposition déjà envoyée ne change rien : le
  // bouton le dit plutôt que de réécrire la même ligne.
  // Un code de replay corrigé à score égal est bien une nouvelle proposition.
  const relation = enteredScoreRelation(entered, view);
  const unchangedMine = relation.unchangedMine && sameMapLists(maps, view?.mine?.maps ?? []);
  const { confirmsTheirs } = relation;
  // Confirmer **telle quelle** la proposition adverse — mêmes maps, mêmes
  // codes. Toute retouche en fait une contre-proposition (désaccord ordinaire).
  const confirmsAsIs = confirmsTheirs && confirmsProposalMaps(maps, view?.theirs?.maps ?? [], detailLoading);
  // Le bloc tombe dès que le formulaire porte les maps adverses (recopiées).
  const showTheirMaps = theirMapsWorthShowing(view?.phase, view?.theirs?.maps ?? [], { missedProposal, confirmsAsIs });

  const forfeitMaps = forfeitMapCount(matchFormat);
  const deadline = deadlineText(match.scoreDeadlineAt, text.locale);

  // Un refus qui désigne une map est rattaché à son champ, en plus de la
  // notification — avant l'envoi comme après un refus du serveur, qui ne rend
  // qu'un code : la même règle, rejouée ici, retrouve le champ.
  const flagRefusal = (code: string): boolean => {
    const local = checkMapList(matchFormat, game, maps, { decisive: true });
    const target = refusalFieldOnRows(local, rows);
    if (!target || local.error !== code) return false;
    fieldErrors.flag(mapFieldKey(target.index, target.field), mapViolationText(text, local.error, matchFormat, game));
    return true;
  };

  const submitScore = async () => {
    if (submitting || unchangedMine) return;
    if (check.error) {
      flagRefusal(check.error);
      showError(mapViolationText(text, check.error, matchFormat, game));
      return;
    }
    const entered1 = check.score.team1;
    const entered2 = check.score.team2;
    const body = toReporterScores(myTeamIsTeam1, entered1, entered2);
    setSubmitting(true);
    try {
      const response = await fetch(
        `/api/tournaments/${tournamentId}/matches/${match.id}/report`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          // « Confirmer » renvoie le dépôt adverse lu ici : le serveur refuse
          // (`PROPOSAL_STALE`) s'il a changé ou expiré depuis.
          body: JSON.stringify(
            confirmsAsIs && view?.theirs ? { maps, confirm: { reportedAt: view.theirs.reportedAt } } : { maps },
          ),
        },
      );
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "SCORE_SUBMIT_FAILED");
      showSuccess(
        confirmsAsIs
          ? t("score.player.confirmed", { team1, team2, score1: entered1, score2: entered2 })
          : t("score.player.submitted", {
              team1,
              team2,
              score1: myTeamIsTeam1 ? body.myScore : body.opponentScore,
              score2: myTeamIsTeam1 ? body.opponentScore : body.myScore,
            }),
      );
      onSubmitted();
      onClose();
    } catch (error) {
      const code = (error as Error).message;
      flagRefusal(code);
      showError(mapError(code));
      // Proposition changée ou expirée : la modale se recharge sur la nouvelle.
      if (code === "PROPOSAL_STALE") void Promise.resolve(onRefresh()).catch(() => undefined);
    } finally {
      setSubmitting(false);
    }
  };

  const submitForfeit = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const response = await fetch(
        `/api/tournaments/${tournamentId}/matches/${match.id}/forfeit`,
        { method: "POST" },
      );
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "MATCH_FORFEIT_FAILED");
      showSuccess(t("score.player.forfeitRecorded", { opponent: opponentName }));
      onSubmitted();
      onClose();
    } catch (error) {
      showError(mapError((error as Error).message));
    } finally {
      setSubmitting(false);
    }
  };

  const onSubmitForm = (event: FormEvent) => {
    event.preventDefault();
    void submitScore();
  };

  // État du cycle, en une phrase : c'est ce que le formulaire d'avant ne disait
  // jamais, et la raison pour laquelle un score envoyé semblait « sans effet ».
  const status = (() => {
    if (!view) return null;
    switch (view.phase) {
      case "MINE_PENDING":
        return deadline
          ? t("score.player.minePendingDeadline", { score: scoreText(view.mine!), opponent: opponentName, deadline })
          : t("score.player.minePending", { score: scoreText(view.mine!), opponent: opponentName });
      case "THEIRS_PENDING":
        return theirsPendingStatus(text, { opponentName, myName }, view.theirs!, { canReport: canReportScore, detailLoading });
      case "CONFLICT":
        return conflictText(text, view.mine!, view.theirs!, opponentName);
      default:
        return canReportScore
          ? t("score.player.willConfirm", { opponent: opponentName })
          : null;
    }
  })();

  // « Confirmer le score », pas « Confirmer » seul : le forfait déclaré a son
  // propre « Confirmer le forfait de … » dans la même modale.
  const submitLabel = confirmsAsIs ? t("score.player.confirm") : t("score.player.send");
  let blocker: string | null = null;
  if (unchangedMine) blocker = t("score.player.alreadySent", { opponent: opponentName });
  else if (check.error) blocker = mapViolationText(text, check.error, matchFormat, game);
  // Une saisie vide n'est pas un refus : la raison ne s'affiche qu'une fois
  // une map **renseignée** — une ligne vierge qu'on vient d'ajouter n'appelle
  // pas encore de reproche.
  const touched = refusalWorthShowing(check, maps);
  const showBlocker = blocker !== null && (unchangedMine || touched);

  return createPortal(
    <div /* NOSONAR S6819 — voile de modale, sans équivalent natif */ className={styles.backdrop} role="presentation" {...backdrop}>
      <div /* NOSONAR S6819 — modale portée dans body (useDialogBehavior) : `<dialog>` changerait couche, Échap et ::backdrop */
        ref={dialogRef}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="player-score-title"
        tabIndex={-1}
      >
        <form onSubmit={onSubmitForm}>
          <div className={styles.head}>
            <div className={styles.headText}>
              <h3 id="player-score-title" className={styles.title}>
                {t("score.player.title")}
              </h3>
              <p className={styles.opponents}>
                {t("score.opponents", { round: match.roundNumber, team1, team2 })}
              </p>
            </div>
            {matchFormat && <Pill variant="blue">{matchFormatText(pageText, matchFormat)}</Pill>}
          </div>

          {/* `<output>` (région d'état native) : l'adversaire peut répondre pendant que la modale
              est ouverte, et le flux change alors cette phrase. */}
          {status && (
            <output className={`${styles.stored} ${styles.notice}`}>
              {status}
            </output>
          )}

          {/* Désaccord, ou proposition adverse que le formulaire ne reprend pas
              (saisie déjà commencée à son arrivée) : le détail adverse, codes de
              replay compris — sans lui, une faute de frappe ne se retrouverait
              pas, et « Confirme-le » n'aurait rien à montrer. */}
          {showTheirMaps && view?.theirs && (
            <div className={mapStyles.proposals}>
              <p className={mapStyles.proposalTitle}>{t("score.admin.proposalOf", { name: opponentName })}</p>
              <MapResultList
                maps={view.theirs.maps}
                team1Name={team1}
                team2Name={team2}
                label={t("score.admin.proposalMaps", { name: opponentName })}
              />
            </div>
          )}

          {canReportScore ? (
            <>
              <MapScoreList
                idPrefix="player-score"
                maps={rows}
                onChange={setRows}
                minRows={1}
                format={matchFormat}
                game={game}
                team1Name={team1}
                team2Name={team2}
                team1Id={match.team1Id}
                team2Id={match.team2Id}
                disabled={submitting}
                fieldErrors={fieldErrors}
              />
              {matchFormat && (
                <p className={styles.formatHint}>{matchFormatDescriptionText(pageText, matchFormat)}</p>
              )}
            </>
          ) : (
            <p className={styles.formatHint}>
              {closedNoticeText(text, launchPhase, formatMatchStartAtFull(match.startAt, text.locale))}
            </p>
          )}

          {canForfeit ? (
            <div className={styles.forfeitZone}>
              <button
                type="button"
                className={styles.link}
                onClick={() => setForfeitOpen(!forfeitOpen)}
                aria-expanded={forfeitOpen}
                aria-controls="player-score-forfeit"
                disabled={submitting}
              >
                {forfeitOpen ? t("score.player.forfeit.close") : t("score.player.forfeit.open")}
              </button>
              {forfeitOpen && (
                <div id="player-score-forfeit" className={styles.forfeitPanel}>
                  <p id="player-score-forfeit-hint" className={styles.forfeitHint}>
                    {t("score.player.forfeit.hint", { mine: myName, opponent: opponentName, maps: forfeitMaps })}
                  </p>
                  <div className={styles.forfeitRow}>
                    <button
                      type="button"
                      className={styles.forfeit}
                      aria-describedby="player-score-forfeit-hint"
                      onClick={() => void submitForfeit()}
                      disabled={submitting}
                    >
                      {submitting ? "…" : t("score.player.forfeit.confirm", { name: myName })}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <p className={styles.formatHint}>
              {t("score.player.forfeit.notAllowed")}
            </p>
          )}

          {canReportScore && showBlocker && (
            <output className={`${styles.blocker} ${styles.notice}`}>
              {blocker}
            </output>
          )}

          <div className={styles.actions}>
            <button
              type="button"
              className={`${styles.link} ${styles.close}`}
              onClick={onClose}
              disabled={submitting}
            >
              {t("score.close")}
            </button>
            {canReportScore && (
              <button
                type="submit"
                className="btn"
                disabled={nothingEntered || unchangedMine || submitting}
              >
                {submitting ? "…" : submitLabel}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
