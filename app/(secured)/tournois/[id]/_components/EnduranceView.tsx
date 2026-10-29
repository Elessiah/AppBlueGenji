"use client";

import { useMemo } from "react";
import type {
  BracketMatch,
  EnduranceMeta,
  EndurancePenaltyRow,
  EnduranceStandingRow,
  TournamentFormat,
} from "@/lib/shared/types";
import { ACCENT } from "../_lib/bracket-sections";
import {
  endurancePlayoffLinks,
  endurancePlayoffRoundCount,
  enduranceRoundSections,
  splitEnduranceMatches,
  splitPlayoffBrackets,
} from "../_lib/endurance-sections";
import { useEntrantParticipantType } from "../_lib/entrant-link";
import { useTournamentViewText } from "@/components/i18n/tournament-page-text";
import { FR_VIEWS_TEXT } from "../_lib/views-text";
import { INTL_LOCALE } from "@/lib/shared/locales";
import { toParticipantType } from "@/lib/shared/participants";
import { useActionsText } from "../_lib/actions-text";
import { enduranceNextRoundInput } from "../_lib/endurance-next-round";
import { previewEnduranceNextRound } from "@/lib/shared/endurance-next-round/preview";
import type { MatchFormat } from "@/lib/shared/match-format";
import { EnduranceNextRoundPanel } from "./EnduranceNextRoundPanel";
import { EntrantName } from "./EntrantName";
import { FORFEIT_BUTTON_STYLE, FORFEIT_CANCEL_BUTTON_STYLE } from "./RoundColumns";
import { ForfeitRowAction, FrozenForfeitLegend, type ForfeitRowActionProps } from "./ForfeitRowAction";
import { EnduranceCard } from "./EnduranceCard";
import { EnduranceRankingViews } from "./EnduranceRankingViews";
import { EnduranceChartPanel } from "./EnduranceChartPanel";
import { PodiumTiersOff } from "@/components/podium-tiers";
import { BracketSections } from "./BracketSections";
import { EnduranceRoundPanels } from "./EnduranceRoundPanels";
import styles from "./EnduranceView.module.css";

interface EnduranceViewProps {
  endurance: EnduranceMeta;
  matches: BracketMatch[];
  /** Le tournoi est-il clos ? (plus aucun abandon possible) */
  isFinished?: boolean;
  /** Engagé du lecteur, mis en avant dans le classement. */
  myTeamId?: number | null;
  /** L'abandon est-il proposé pour cette équipe ? (cf. `_lib/forfeit.ts`) */
  canForfeit?: (teamId: number) => boolean;
  onForfeit?: (teamId: number, teamName: string) => void;
  /**
   * Annulation d'un abandon (administrateur strict), sur une ligne `FORFEIT`
   * de la phase qualificative (`docs/features/FORFEIT_CANCELLATION.md`).
   */
  canCancelForfeit?: boolean;
  onCancelForfeit?: (teamId: number, teamName: string) => void;
  /**
   * La pénalité d'endurance est-elle proposée ? Elle ne dépend que du lecteur
   * (permission `tournaments`) : le statut de l'équipe et l'état des play-offs
   * sont décidés ici, comme pour l'abandon.
   */
  canPenalize?: boolean;
  /**
   * Ouvre la saisie d'une sanction. Ne transporte que l'**identifiant** : le
   * capital du dialogue se relit du flux à chaque rendu, un chiffre passé au
   * clic serait périmé dès le score suivant.
   */
  onPenalize?: (teamId: number) => void;
  onLiftPenalty?: (penalty: EndurancePenaltyRow) => void;
  adminResolvable: (match: BracketMatch) => boolean;
  onOpenAdminModal: (match: BracketMatch) => void;
  format: TournamentFormat;
  /** Phrase affichée quand le plateau ne porte encore aucune rencontre. */
  emptyLabel?: string;
  /**
   * Montrer l'aperçu de la manche suivante
   * (`docs/features/ENDURANCE_NEXT_ROUND_PREVIEW.md`) ? Réservé à l'arbitrage
   * (permission `tournaments`) d'un tournoi en cours — la page en décide.
   */
  showNextRound?: boolean;
  /** Format de la qualification, qui borne ce que les matchs restants peuvent déplacer. */
  qualificationFormat?: MatchFormat | null;
}

/**
 * Intitulé d'un bloc du plateau (« Play-offs », « Manches qualificatives »).
 *
 * Un `<h3>` et non un `<div>` : le plateau se parcourt au lecteur d'écran par
 * ses titres, et deux blocs de volets côte à côte sans titre de niveau ne se
 * distinguent plus l'un de l'autre. La casse est décidée par la feuille de
 * style, pas écrite dans le texte.
 */
function BoardHeading({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <h3 className={`mono ${styles.boardHeading}`}>{children}</h3>
  );
}

const AMBER = "var(--amber)";

/**
 * Journal des pénalités d'endurance (`docs/features/ENDURANCE_PENALTIES.md`).
 *
 * Visible de **tous**, et pas seulement de l'arbitrage : une sanction qui
 * déplace un classement sans qu'aucun match ne l'explique doit être lisible par
 * l'équipe qui la subit et par celles qu'elle fait remonter. Seul le retrait
 * est réservé à l'arbitrage.
 *
 * Le bloc n'existe pas quand il n'y a rien à lire : un intertitre « Pénalités »
 * suivi du vide laisserait croire à une rubrique en panne.
 */
function PenaltyLog({
  penalties,
  onLift,
}: Readonly<{
  penalties: EndurancePenaltyRow[];
  /** Retrait proposé, `undefined` pour un lecteur sans droit d'arbitrage. */
  onLift?: (penalty: EndurancePenaltyRow) => void;
}>) {
  const text = useTournamentViewText(FR_VIEWS_TEXT);
  const { t } = text;
  // Le retrait d'une sanction est un geste du staff (lot 8b).
  const { t: a } = useActionsText();
  if (penalties.length === 0) return null;

  return (
    <div style={{ marginBottom: 24 }}>
      <div
        id="endurance-penalty-log"
        className="mono"
        style={{ fontSize: 11, color: "var(--ink-quiet)", marginBottom: 8 }}
      >
        {t("endurance.penaltiesTitle")}
      </div>
      {/* La liste porte son intitulé : parcourue au lecteur d'écran, « liste de
          deux éléments » sans nom ne dit pas de quoi elle parle. */}
      <ul className={styles.penaltyList} aria-labelledby="endurance-penalty-log">
        {penalties.map((penalty) => (
          <li
            key={penalty.id}
            className={styles.penaltyItem}
            title={
              penalty.createdAt
                ? new Date(penalty.createdAt).toLocaleString(INTL_LOCALE[text.locale], {
                    dateStyle: "full",
                    timeStyle: "short",
                    ...(text.locale === "fr" ? {} : { hourCycle: "h23" as const }),
                  })
                : undefined
            }
          >
            <span className={styles.penaltyAmount}>−{penalty.points}</span>
            <EntrantName teamId={penalty.teamId} name={penalty.teamName} />
            {/* Vide sur la page sans compte (`spectatorSnapshot`) : pas de case muette. */}
            {penalty.reason && <span className={styles.penaltyReason}>{penalty.reason}</span>}
            <span className={styles.penaltyMeta}>
              {t("endurance.penaltyRound", { round: String(penalty.round) })}
              {/* Une sanction se conteste : elle porte le nom de qui l'a
                  prononcée, ou rien si le compte a depuis été supprimé. */}
              {penalty.authorPseudo ? ` · ${penalty.authorPseudo}` : ""}
            </span>
            {/*
              Le verrou est celui de `match-lock` : une manche jouée depuis
              fige la sanction. On le **dit** au lieu d'offrir un bouton voué au
              refus — même motif que le « 🔒 Score verrouillé » des plateaux.
            */}
            {onLift !== undefined && !penalty.removable && (
              // Forme courte lue avec la sanction ; le motif complet vit derrière
              // le « i » de la légende sous le journal (`FrozenForfeitLegend`) :
              // un `title` ne s'affiche ni au toucher ni au clavier.
              <span className={styles.penaltyMeta}>
                <span aria-hidden="true">🔒</span> {a("penaltyLift.frozen")}
                <span className="sr-only"> {a("penaltyLift.frozenShort")}</span>
              </span>
            )}
            {onLift !== undefined && penalty.removable && (
              <button
                type="button"
                onClick={() => onLift(penalty)}
                className="btn ghost"
                title={a("penaltyLift.buttonTitle", { name: penalty.teamName, points: penalty.points })}
                aria-label={a("penaltyLift.buttonAria", { name: penalty.teamName, points: penalty.points })}
                style={{
                  padding: "2px 8px",
                  fontSize: 11,
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                }}
              >
                {a("penaltyLift.button")}
              </button>
            )}
          </li>
        ))}
      </ul>
      {onLift !== undefined && penalties.some((penalty) => !penalty.removable) && (
        <FrozenForfeitLegend
          id="endurance-penalty-frozen"
          label={a("penaltyLift.frozen")}
          reason={a("penaltyLift.frozenTitle")}
        />
      )}
    </div>
  );
}

/**
 * Vue du mode « BlueGenji Survie » : capital d'endurance de chaque équipe, puis
 * les matchs de la manche courante — ou de l'arbre final une fois les play-offs
 * lancés.
 */
export function EnduranceView({
  endurance,
  matches,
  isFinished = false,
  myTeamId = null,
  canForfeit,
  onForfeit,
  canCancelForfeit = false,
  onCancelForfeit,
  canPenalize = false,
  onPenalize,
  onLiftPenalty,
  adminResolvable,
  onOpenAdminModal,
  format,
  emptyLabel,
  showNextRound = false,
  qualificationFormat = null,
}: Readonly<EnduranceViewProps>) {
  const text = useTournamentViewText(FR_VIEWS_TEXT);
  const { t } = text;
  // Abandon et sanctions : gestes du lot 8b et du staff.
  const { t: a } = useActionsText();
  const participantType = useEntrantParticipantType();
  const emptyText = emptyLabel ?? t("page.noMatchesShort");

  // Calculé ici, sur l'instantané que le flux pousse à chaque score : l'aperçu
  // suit le plateau sans requête de plus. Rien n'est calculé pour qui ne le
  // voit pas.
  const nextRound = useMemo(
    () =>
      showNextRound
        ? previewEnduranceNextRound(enduranceNextRoundInput(endurance, matches, qualificationFormat))
        : null,
    [showNextRound, endurance, matches, qualificationFormat],
  );
  const teamNames = useMemo(
    () => new Map(endurance.standings.map((standing) => [standing.teamId, standing.teamName])),
    [endurance.standings],
  );
  const { qualification, playoffs } = splitEnduranceMatches(matches);
  const roundSections = enduranceRoundSections(qualification);

  // L'arbre final vit dans les mêmes manches que la petite finale, qui ne mène
  // nulle part : les deux se dessinent séparément, comme dans les tableaux à
  // élimination du site.
  const { decisive, thirdPlace } = splitPlayoffBrackets(playoffs);
  const playoffLinks = endurancePlayoffLinks(decisive);
  const resolvePlayoffNext = (match: BracketMatch) => playoffLinks.get(match.id) ?? null;
  // Les tours de l'arbre naissent un à un : sans ce compte, les quarts de finale
  // s'appelleraient « Finale » tant qu'ils seraient le seul tour posé.
  const playoffRounds = endurancePlayoffRoundCount(decisive);

  // Abandon : proposé sur les équipes encore en lice, à leurs représentants
  // comme à l'arbitrage (cf. `canForfeit` côté page).
  //
  // **Pas pendant les play-offs.** `forfeitEnduranceTeam` ne sait clore qu'un
  // match de la manche qualificative courante (`endurance_current_round`) ;
  // l'arbre final vit à partir de `PLAYOFF_ROUND_OFFSET`, hors de sa portée. Un
  // abandon y laisserait l'équipe déclarée forfait au classement mais toujours
  // engagée dans un match ouvert — que rien ne viendrait jamais clore. Un
  // forfait de play-off se tranche sur le match lui-même, par l'arbitrage, qui
  // fait alors avancer l'arbre. Même refus côté serveur.
  const canForfeitRow = (teamId: number, status: string): boolean =>
    !isFinished &&
    !endurance.playoffsStarted &&
    status === "ACTIVE" &&
    canForfeit !== undefined &&
    onForfeit !== undefined &&
    canForfeit(teamId);

  // La pénalité suit exactement la même fenêtre que l'abandon : la phase
  // qualificative d'un tournoi en cours. Passé le coup d'envoi des play-offs, le
  // capital ne décide plus rien — une sanction y serait sans effet tout en
  // figurant au tableau comme si elle en avait un. Même refus côté serveur.
  const canPenalizeRow = (status: string): boolean =>
    !isFinished &&
    !endurance.playoffsStarted &&
    status === "ACTIVE" &&
    canPenalize &&
    onPenalize !== undefined;

  // Annuler un abandon : même fenêtre. Une fois l'arbre final posé, l'équipe
  // ne pourrait plus y entrer — le serveur refuse aussi.
  const canCancelRow = (status: string): boolean =>
    !isFinished &&
    !endurance.playoffsStarted &&
    status === "FORFEIT" &&
    canCancelForfeit &&
    onCancelForfeit !== undefined;

  const showActions = endurance.standings.some(
    (s) => canForfeitRow(s.teamId, s.status) || canPenalizeRow(s.status) || canCancelRow(s.status),
  );
  const showPenaltyAction = endurance.standings.some((s) => canPenalizeRow(s.status));
  // « Hors course » ne se devine pas : la ligne affiche encore un capital, et
  // rien n'explique pourquoi elle n'est plus en lice. La légende n'apparaît
  // qu'en présence d'une telle ligne.
  const showOutLegend = endurance.standings.some((s) => s.status === "OUT_OF_CONTENTION");

  const cancellableIds = new Set(endurance.cancellableForfeitTeamIds);
  const forfeitAction = (
    standing: EnduranceStandingRow,
    isMine: boolean,
    forfeitable: boolean,
  ): ForfeitRowActionProps | null => {
    if (forfeitable && onForfeit !== undefined) {
      return {
        kind: "button",
        teamId: standing.teamId,
        label: isMine ? a("forfeit.button.label") : a("forfeit.endurance.other"),
        title: isMine
          ? a(`forfeit.endurance.selfTitle.${toParticipantType(participantType)}`)
          : a("forfeit.endurance.otherTitle", { name: standing.teamName }),
        ariaLabel: isMine
          ? a("forfeit.endurance.selfAria")
          : a("forfeit.endurance.otherTitle", { name: standing.teamName }),
        style: FORFEIT_BUTTON_STYLE,
        onClick: () => onForfeit(standing.teamId, standing.teamName),
      };
    }
    if (!canCancelRow(standing.status) || onCancelForfeit === undefined) return null;
    if (!cancellableIds.has(standing.teamId)) {
      return { kind: "locked", teamId: standing.teamId, label: a("forfeitCancel.frozen"), note: a("forfeitCancel.frozenShort") };
    }
    return {
      kind: "button",
      teamId: standing.teamId,
      label: a("forfeitCancel.button"),
      title: a("forfeitCancel.buttonTitle", { name: standing.teamName }),
      ariaLabel: a("forfeitCancel.buttonAria", { name: standing.teamName }),
      style: FORFEIT_CANCEL_BUTTON_STYLE,
      onClick: () => onCancelForfeit(standing.teamId, standing.teamName),
    };
  };

  // Ligne figée : pas d'abandon à proposer, et l'annulation refusée (une manche
  // a été jouée depuis). Même condition que le geste « verrou » de `forfeitAction`.
  const isFrozenRow = (standing: EnduranceStandingRow) =>
    !(canForfeitRow(standing.teamId, standing.status) && onForfeit !== undefined) &&
    canCancelRow(standing.status) &&
    onCancelForfeit !== undefined &&
    !cancellableIds.has(standing.teamId);

  // Gestes d'une ligne, avec leurs gardes : `EnduranceRankingViews` ne les
  // montre que dans la vue « Général ».
  const renderActions = (standing: EnduranceStandingRow) => {
    const isMine = myTeamId !== null && standing.teamId === myTeamId;
    const forfeitRow = forfeitAction(standing, isMine, canForfeitRow(standing.teamId, standing.status));
    return (
      <>
        {canPenalizeRow(standing.status) && onPenalize !== undefined && (
          <button
            type="button"
            onClick={() => onPenalize(standing.teamId)}
            className="btn tap-target"
            title={a("penalty.buttonTitle", { name: standing.teamName })}
            aria-label={a("penalty.buttonAria", { name: standing.teamName })}
            style={{
              padding: "3px 8px",
              fontSize: 11,
              textTransform: "uppercase",
              letterSpacing: "0.04em",
              background: "rgba(var(--amber-rgb), 0.12)",
              borderColor: "rgba(var(--amber-rgb), 0.4)",
              color: AMBER,
            }}
          >
            {a("penalty.button")}
          </button>
        )}
        {/*
          Un seul geste d'abandon par ligne, rendu par un même `<button>`
          (`ForfeitRowAction`). Deux gestes différents sous ce bouton : le
          lecteur qui quitte le tournoi « abandonne », l'arbitrage, lui,
          « déclare forfait » une équipe — pour tout le reste du tournoi, et
          non sur la seule manche en cours (ce forfait-là se pose sur le match).
        */}
        {forfeitRow && <ForfeitRowAction {...forfeitRow} />}
      </>
    );
  };

  return (
    <>
      <EnduranceCard endurance={endurance} matches={matches} isFinished={isFinished} />

      <EnduranceRankingViews
        endurance={endurance}
        matches={matches}
        myTeamId={myTeamId}
        renderActions={renderActions}
        showActions={showActions}
        wideActions={showPenaltyAction}
        outLegend={
          showOutLegend ? (
            <p className="mono" style={{ fontSize: 11, color: "var(--ink-quiet)", margin: "8px 0 0" }}>
              {t("endurance.outLegend")}
              {endurance.maxRounds === null ? "" : t("endurance.outLegendRounds", { count: endurance.maxRounds })}
            </p>
          ) : null
        }
        actionsLegend={
          endurance.standings.some(isFrozenRow) ? (
            <FrozenForfeitLegend
              id="endurance-forfeit-frozen"
              label={a("forfeitCancel.frozen")}
              reason={a("forfeitCancel.frozenTitle")}
            />
          ) : null
        }
      />

      {/*
        Le journal des sanctions suit le classement : c'est lui qui explique les
        badges ambre « −N » qu'on vient d'y lire.
      */}
      <PenaltyLog
        penalties={endurance.penalties}
        onLift={
          canPenalize && !endurance.playoffsStarted && !isFinished ? onLiftPenalty : undefined
        }
      />

      {/*
        Accordéon « Évolution de l'endurance », replié à chaque chargement : le
        graphique n'est chargé qu'au premier dépliage.
      */}
      <EnduranceChartPanel endurance={endurance} matches={matches} />

      {/*
        L'aperçu ouvre la suite des volets (aperçu → manche en cours → manches
        closes, de la plus récente à la plus ancienne) : c'est en regardant la
        manche en cours que l'arbitrage prépare la suivante, et le volet se
        replie pour qui n'en a pas l'usage. Play-offs lancés, il annonce le tour
        suivant de l'arbre et précède donc l'arbre lui-même. Outil d'arbitrage :
        noms sobres, sans marche du podium.
      */}
      {nextRound && (
        <PodiumTiersOff>
          <EnduranceNextRoundPanel
            preview={nextRound}
            maxRounds={endurance.maxRounds}
            teamNames={teamNames}
          />
        </PodiumTiersOff>
      )}

      {/*
        Les play-offs passent devant les manches qualificatives dès qu'ils sont
        lancés : c'est là que se joue le tournoi. Les manches restent en dessous
        plutôt que d'être escamotées — l'ancienne vue les remplaçait purement, et
        le parcours d'une équipe devenait alors illisible.

        L'arbre est celui de l'élimination simple, `BracketSections` : mêmes
        volets, mêmes stades nommés, mêmes traits d'un tour à l'autre. Les liens
        n'existant pas en base pour ce mode, ils sont rejoués depuis la règle
        d'appariement du moteur (cf. `_lib/endurance-sections.ts`).
      */}
      {decisive.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <BoardHeading>{t("endurance.playoffs")}</BoardHeading>
          <BracketSections
            bracketType="UPPER"
            bracketLabel={t("endurance.playoffs")}
            showBracketLabel={false}
            matches={decisive}
            allTournamentMatches={matches}
            myTeamId={myTeamId}
            adminResolvable={adminResolvable}
            onOpenAdminModal={onOpenAdminModal}
            format={format}
            resolveNextMatchId={resolvePlayoffNext}
            plannedRounds={playoffRounds}
          />
          {thirdPlace.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <BracketSections
                bracketType="THIRD_PLACE"
                bracketLabel={t("endurance.thirdPlace")}
                showBracketLabel={false}
                matches={thirdPlace}
                allTournamentMatches={matches}
                myTeamId={myTeamId}
                adminResolvable={adminResolvable}
                onOpenAdminModal={onOpenAdminModal}
                format={format}
              />
            </div>
          )}
        </div>
      )}

      {roundSections.length > 0 ? (
        <>
          {decisive.length > 0 && <BoardHeading>{t("endurance.qualifying")}</BoardHeading>}
          <EnduranceRoundPanels
            sections={roundSections}
            accent={ACCENT.UPPER}
            myTeamId={myTeamId}
            allTournamentMatches={matches}
            adminResolvable={adminResolvable}
            onOpenAdminModal={onOpenAdminModal}
            format={format}
          />
        </>
      ) : (
        decisive.length === 0 && (
          <p style={{ color: "var(--ink-quiet)", margin: 0, fontSize: 14 }}>{emptyText}</p>
        )
      )}
    </>
  );
}
