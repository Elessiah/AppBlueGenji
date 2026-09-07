"use client";

import { FormEvent } from "react";
import { ScrollArea } from "@/components/cyber";
import type {
  BracketMatch,
  EnduranceMeta,
  EndurancePenaltyRow,
  TournamentFormat,
} from "@/lib/shared/types";
import {
  enduranceCellLabel,
  enduranceCellPenalty,
  enduranceCellTitle,
  enduranceCellTone,
  enduranceHistoryColumns,
  type EnduranceCellTone,
} from "../_lib/endurance-history";
import { ACCENT } from "../_lib/bracket-sections";
import {
  endurancePlayoffLinks,
  endurancePlayoffRoundCount,
  enduranceRoundSections,
  splitEnduranceMatches,
  splitPlayoffBrackets,
} from "../_lib/endurance-sections";
import { EntrantLink, useParticipantWording } from "../_lib/entrant-link";
import { BracketSections } from "./BracketSections";
import type { MatchScoreDraft } from "./BracketTree";
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
  canReport: (match: BracketMatch) => boolean;
  adminResolvable: (match: BracketMatch) => boolean;
  drafts: MatchScoreDraft;
  onScoreChange: (matchId: number, field: "myScore" | "opponentScore", value: string) => void;
  onSubmit: (match: BracketMatch, e: FormEvent) => Promise<void>;
  onOpenAdminModal: (match: BracketMatch) => void;
  format: TournamentFormat;
  /** Phrase affichée quand le plateau ne porte encore aucune rencontre. */
  emptyLabel?: string;
}

/**
 * Intitulé d'un bloc du plateau (« Play-offs », « Manches qualificatives »).
 *
 * Un `<h3>` et non un `<div>` : le plateau se parcourt au lecteur d'écran par
 * ses titres, et deux blocs de volets côte à côte sans titre de niveau ne se
 * distinguent plus l'un de l'autre. La casse est décidée par la feuille de
 * style, pas écrite dans le texte.
 */
function BoardHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className={`mono ${styles.boardHeading}`}>{children}</h3>
  );
}

const AMBER = "rgba(255,157,46,0.9)";

/**
 * Classe de gabarit du classement (cf. `EnduranceView.module.css`) : cinq
 * colonnes, six quand au moins une ligne porte un bouton d'abandon. Le gabarit
 * est une classe et non un style en ligne, sans quoi il l'emporterait sur le
 * repli mobile de `.table-row`.
 */
function rowClass(withActions: boolean, wide: boolean): string {
  if (!withActions) return `table-row ${styles.row}`;
  return `table-row ${wide ? styles.rowWithWideActions : styles.rowWithActions}`;
}

/**
 * « Éliminée » et « Hors course » ne disent pas la même chose et ne peuvent pas
 * partager un libellé : la première a vidé son capital, la seconde en garde
 * mais ne peut plus rejoindre les play-offs dans les manches restantes — sa
 * ligne montre encore des points, et « Éliminée » à côté ne se lirait pas.
 */
const STATUS_LABELS: Record<EnduranceMeta["standings"][number]["status"], string> = {
  ACTIVE: "En lice",
  ELIMINATED: "Éliminée",
  OUT_OF_CONTENTION: "Hors course",
  FORFEIT: "Forfait",
};

/**
 * Une ligne sortie s'estompe, mais pas toutes au même degré : « Hors course »
 * porte encore un capital à lire, là où une éliminée ou une partie n'affiche
 * qu'un zéro. Les effacer pareil rendrait la moins lisible des trois celle qui
 * a justement un chiffre à montrer.
 */
const ROW_OPACITY: Record<EnduranceMeta["standings"][number]["status"], number> = {
  ACTIVE: 1,
  OUT_OF_CONTENTION: 0.8,
  ELIMINATED: 0.55,
  FORFEIT: 0.55,
};

/** Habillage d'une case, selon le poids décidé par `_lib/endurance-history`. */
const CELL_CLASS: Record<EnduranceCellTone, string> = {
  POINTS: "num",
  ZERO: `num ${styles.historyZero}`,
  FORFEIT: styles.historyForfeit,
  OUT: styles.historyOut,
};

/**
 * Tableau du capital d'endurance **manche par manche**, comme la feuille de
 * calcul qui tient le règlement : une ligne par équipe, une colonne par manche.
 *
 * C'est le seul endroit où un forfait de tournoi se lit d'un coup d'œil : la
 * colonne « Statut » du classement dit qu'une équipe est partie, elle ne dit pas
 * **à partir de quand** — ici, ses manches restantes portent « FF » en rouge au
 * lieu d'un capital, et le tableau se lit comme le document d'arbitrage.
 *
 * Défilement horizontal plutôt que repli mobile : un tableau de capitaux empilé
 * en colonne ne se compare plus.
 */
function EnduranceHistory({
  endurance,
  myTeamId,
}: {
  endurance: EnduranceMeta;
  myTeamId: number | null;
}) {
  if (endurance.rounds.length === 0) return null;

  const columns = enduranceHistoryColumns(endurance.rounds.length);

  return (
    <div style={{ marginBottom: 24 }}>
      <div className="mono" style={{ fontSize: 11, color: "var(--text-2)", marginBottom: 8 }}>
        ENDURANCE MANCHE PAR MANCHE
      </div>
      <ScrollArea fade ariaLabel="Capital d'endurance manche par manche">
        <div className={styles.historyTable}>
          <div
            className={`${styles.historyRow} ${styles.historyHead}`}
            style={{ "--history-cols": columns } as React.CSSProperties}
          >
            <span className={styles.historyTeam}>Équipe</span>
            {endurance.rounds.map((round) => (
              <span key={round} className={styles.historyCell} title={`Manche ${round}`}>
                M{round}
              </span>
            ))}
          </div>
          {endurance.standings.map((standing) => (
            <div
              key={standing.teamId}
              className={[
                styles.historyRow,
                standing.status === "FORFEIT" ? styles.historyRowForfeit : null,
                myTeamId !== null && standing.teamId === myTeamId ? styles.historyRowMine : null,
              ]
                .filter(Boolean)
                .join(" ")}
              style={{ "--history-cols": columns } as React.CSSProperties}
            >
              {/* Même affordance que le classement au-dessus : un nom d'engagé
                  mène toujours à sa fiche, d'une vue à l'autre. */}
              <EntrantLink teamId={standing.teamId} className={styles.historyTeam}>
                {standing.teamName}
              </EntrantLink>
              {standing.rounds.map((cell) => (
                <span
                  key={cell.round}
                  className={[
                    styles.historyCell,
                    CELL_CLASS[enduranceCellTone(cell)],
                    // La marque de pénalité s'**ajoute** au ton de la case : une
                    // sanction qui vide le capital doit rester lisible comme un
                    // zéro, tout en disant d'où vient ce zéro.
                    enduranceCellPenalty(cell) > 0 ? styles.historyPenalty : null,
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  title={enduranceCellTitle(standing.teamName, cell)}
                >
                  {enduranceCellLabel(cell)}
                </span>
              ))}
            </div>
          ))}
        </div>
      </ScrollArea>
      {/* Une case rouge n'est lisible qu'accompagnée de ce qu'elle veut dire :
          la légende n'apparaît que s'il y a effectivement un forfait à lire. */}
      {endurance.standings.some((standing) => standing.status === "FORFEIT") && (
        <p className="mono" style={{ fontSize: 10, color: "var(--text-2)", margin: "8px 0 0" }}>
          FF = FORFAIT SUR TOUT LE RESTE DU TOURNOI
        </p>
      )}
      {/* Un soulignement ambre ne se devine pas davantage qu'une case rouge :
          la légende n'apparaît, elle aussi, que s'il y a quelque chose à lire.
          Le test porte sur les **cases**, pas sur la liste des sanctions : une
          pénalité qui n'a rien pu retirer (équipe déjà sortie) n'en marque
          aucune, et la légende annoncerait alors un trait introuvable. */}
      {endurance.standings.some((standing) =>
        standing.rounds.some((cell) => enduranceCellPenalty(cell) > 0),
      ) && (
        <p className="mono" style={{ fontSize: 10, color: "var(--text-2)", margin: "8px 0 0" }}>
          SOULIGNÉ EN AMBRE = PÉNALITÉ D&apos;ARBITRAGE SUR CETTE MANCHE
        </p>
      )}
    </div>
  );
}


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
}: {
  penalties: EndurancePenaltyRow[];
  /** Retrait proposé, `undefined` pour un lecteur sans droit d'arbitrage. */
  onLift?: (penalty: EndurancePenaltyRow) => void;
}) {
  if (penalties.length === 0) return null;

  return (
    <div style={{ marginBottom: 24 }}>
      <div
        id="endurance-penalty-log"
        className="mono"
        style={{ fontSize: 11, color: "var(--text-2)", marginBottom: 8 }}
      >
        PÉNALITÉS D&apos;ARBITRAGE
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
                ? new Date(penalty.createdAt).toLocaleString("fr-FR", {
                    dateStyle: "full",
                    timeStyle: "short",
                  })
                : undefined
            }
          >
            <span className={styles.penaltyAmount}>−{penalty.points}</span>
            <EntrantLink teamId={penalty.teamId}>{penalty.teamName}</EntrantLink>
            <span className={styles.penaltyReason}>{penalty.reason}</span>
            <span className={styles.penaltyMeta}>
              M{penalty.round}
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
              <span
                className={styles.penaltyMeta}
                title="Une manche a été jouée depuis : rendre ces points remettrait en lice une équipe qui ne l'a pas disputée."
              >
                🔒 Figée
              </span>
            )}
            {onLift !== undefined && penalty.removable && (
              <button
                type="button"
                onClick={() => onLift(penalty)}
                className="btn ghost"
                title={`Retirer cette pénalité : ${penalty.teamName} récupère ${penalty.points} point(s)`}
                aria-label={`Retirer la pénalité de ${penalty.points} point(s) infligée à ${penalty.teamName}`}
                style={{
                  padding: "2px 8px",
                  fontSize: 10,
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                }}
              >
                Retirer
              </button>
            )}
          </li>
        ))}
      </ul>
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
  canPenalize = false,
  onPenalize,
  onLiftPenalty,
  canReport,
  adminResolvable,
  drafts,
  onScoreChange,
  onSubmit,
  onOpenAdminModal,
  format,
  emptyLabel = "Aucun match pour l'instant.",
}: EnduranceViewProps) {
  const wording = useParticipantWording();
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

  const activeCount = endurance.standings.filter((s) => s.status === "ACTIVE").length;

  // Sous plafond, la manche courante ne se lit qu'accompagnée de son total :
  // « manche 4 » ne dit pas s'il en reste six ou une seule, et c'est justement
  // ce qui décide qui est encore en course.
  const roundLabel =
    endurance.maxRounds === null
      ? String(endurance.currentRound)
      : `${endurance.currentRound}/${endurance.maxRounds}`;

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

  const showActions = endurance.standings.some(
    (s) => canForfeitRow(s.teamId, s.status) || canPenalizeRow(s.status),
  );
  const showPenaltyAction = endurance.standings.some((s) => canPenalizeRow(s.status));
  const rowClassName = rowClass(showActions, showPenaltyAction);

  // « Hors course » ne se devine pas : la ligne affiche encore un capital, et
  // rien n'explique pourquoi elle n'est plus en lice. La légende n'apparaît
  // qu'en présence d'une telle ligne, comme celle du forfait plus bas.
  const showOutLegend = endurance.standings.some((s) => s.status === "OUT_OF_CONTENTION");

  return (
    <>
      {/*
        Le barème se compte map par map : « par victoire » laissait lire un
        point par match gagné, alors qu'un 3-0 en déplace trois — et c'est ce
        même compte qui chiffre un forfait.
      */}
      <p className="mono" style={{ fontSize: 11, color: "var(--text-2)", margin: "0 0 16px" }}>
        ENDURANCE {endurance.startPoints} PTS · +{endurance.winDelta} PAR MAP GAGNÉE · −
        {endurance.lossDelta} PAR MAP PERDUE · FORFAIT COMPTÉ {endurance.forfeitMaps}-0 ·{" "}
        {endurance.playoffsStarted
          ? `PLAY-OFFS À ${endurance.playoffSize}`
          : `MANCHE ${roundLabel} · ${activeCount} ${wording.manyCapitalized.toUpperCase()} EN LICE → ${endurance.playoffSize}`}
      </p>

      <div className="table-like" style={{ marginBottom: showOutLegend ? 8 : 24 }}>
        <div className={`${rowClassName} table-header`}>
          <span>#</span>
          <span>{wording.oneCapitalized}</span>
          <span>Endurance</span>
          <span>V / D</span>
          <span>Statut</span>
          {showActions && <span className="sr-only">Actions</span>}
        </div>
        {endurance.standings.map((standing) => {
          const isMine = myTeamId !== null && standing.teamId === myTeamId;
          const forfeitable = canForfeitRow(standing.teamId, standing.status);

          return (
            <div
              key={standing.teamId}
              className={rowClassName}
              style={{
                opacity: ROW_OPACITY[standing.status],
                background: isMine ? "rgba(89,212,255,0.06)" : undefined,
              }}
            >
              <span className="num">{standing.rank}</span>
              <EntrantLink
                teamId={standing.teamId}
                style={{ fontWeight: isMine ? 700 : undefined }}
              >
                {standing.teamName}
              </EntrantLink>
              <span className="num">
                {standing.points}
                {/*
                  Le cumul des pénalités se lit à côté du capital, pas à sa
                  place : c'est le capital qui décide du classement, la sanction
                  explique seulement pourquoi il n'est pas celui qu'on attendait.
                */}
                {standing.penaltyPoints > 0 && (
                  <span
                    className={styles.penaltyBadge}
                    title={`${standing.penaltyPoints} point(s) retiré(s) par pénalité d'arbitrage`}
                  >
                    {/*
                      « −3 » seul se lit « moins trois » sans dire de quoi : le
                      `title` d'un `<span>` n'étant pas annoncé de façon fiable,
                      la phrase est écrite pour de bon, et masquée à l'œil.
                    */}
                    <span aria-hidden="true">−{standing.penaltyPoints}</span>
                    <span className="sr-only">
                      {` (${standing.penaltyPoints} point(s) retiré(s) par pénalité)`}
                    </span>
                  </span>
                )}
              </span>
              <span>
                {standing.wins} / {standing.losses}
              </span>
              <span>
                {STATUS_LABELS[standing.status]}
                {standing.eliminatedRound ? ` (M${standing.eliminatedRound})` : ""}
              </span>
              {showActions && (
                <span className={styles.rowActions}>
                  {canPenalizeRow(standing.status) && onPenalize !== undefined && (
                    <button
                      type="button"
                      onClick={() => onPenalize(standing.teamId)}
                      className="btn"
                      title={`Retirer des points d'endurance à ${standing.teamName}`}
                      aria-label={`Infliger une pénalité d'endurance à ${standing.teamName}`}
                      style={{
                        padding: "3px 8px",
                        fontSize: 10,
                        textTransform: "uppercase",
                        letterSpacing: "0.04em",
                        background: "rgba(255,157,46,0.12)",
                        borderColor: "rgba(255,157,46,0.4)",
                        color: AMBER,
                      }}
                    >
                      Pénalité
                    </button>
                  )}
                  {forfeitable && onForfeit !== undefined && (
                    <button
                      type="button"
                      onClick={() => onForfeit(standing.teamId, standing.teamName)}
                      className="btn"
                      title={
                        isMine
                          ? `Abandonner : ${wording.subject} quittera définitivement le tournoi`
                          : `Déclarer ${standing.teamName} forfait pour tout le reste du tournoi`
                      }
                      aria-label={
                        isMine
                          ? "Abandonner le tournoi"
                          : `Déclarer ${standing.teamName} forfait pour tout le reste du tournoi`
                      }
                      style={{
                        padding: "3px 8px",
                        fontSize: 10,
                        textTransform: "uppercase",
                        letterSpacing: "0.04em",
                        background: "rgba(255,157,46,0.12)",
                        borderColor: "rgba(255,157,46,0.4)",
                        color: AMBER,
                      }}
                    >
                      {/*
                        Deux gestes différents sous un même bouton : le lecteur
                        qui quitte le tournoi « abandonne », l'arbitrage, lui,
                        « déclare forfait » une équipe — pour tout le reste du
                        tournoi, et non sur la seule manche en cours (ce
                        forfait-là se pose sur le match).
                      */}
                      {isMine ? "Abandonner" : "Forfait"}
                    </button>
                  )}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {showOutLegend && (
        <p className="mono" style={{ fontSize: 10, color: "var(--text-2)", margin: "0 0 24px" }}>
          HORS COURSE = CAPITAL RESTANT, MAIS PLUS AUCUNE CHANCE D&apos;ATTEINDRE LES PLAY-OFFS
          {endurance.maxRounds === null ? "" : ` DANS LES ${endurance.maxRounds} MANCHES PRÉVUES`}
        </p>
      )}

      {/*
        Le journal des sanctions vient **avant** le tableau manche par manche :
        c'est lui qui explique les soulignements ambre qu'on y trouvera, et une
        légende qui suit ce qu'elle légende se lit deux fois.
      */}
      <PenaltyLog
        penalties={endurance.penalties}
        onLift={
          canPenalize && !endurance.playoffsStarted && !isFinished ? onLiftPenalty : undefined
        }
      />

      <EnduranceHistory endurance={endurance} myTeamId={myTeamId} />

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
          <BoardHeading>Play-offs</BoardHeading>
          <BracketSections
            bracketType="UPPER"
            bracketLabel="Play-offs"
            showBracketLabel={false}
            matches={decisive}
            allTournamentMatches={matches}
            myTeamId={myTeamId}
            canReport={canReport}
            adminResolvable={adminResolvable}
            drafts={drafts}
            onScoreChange={onScoreChange}
            onSubmit={onSubmit}
            onOpenAdminModal={onOpenAdminModal}
            format={format}
            resolveNextMatchId={resolvePlayoffNext}
            plannedRounds={playoffRounds}
          />
          {thirdPlace.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <BracketSections
                bracketType="THIRD_PLACE"
                bracketLabel="Petite finale"
                showBracketLabel={false}
                matches={thirdPlace}
                allTournamentMatches={matches}
                myTeamId={myTeamId}
                canReport={canReport}
                adminResolvable={adminResolvable}
                drafts={drafts}
                onScoreChange={onScoreChange}
                onSubmit={onSubmit}
                onOpenAdminModal={onOpenAdminModal}
                format={format}
              />
            </div>
          )}
        </div>
      )}

      {roundSections.length > 0 ? (
        <>
          {decisive.length > 0 && <BoardHeading>Manches qualificatives</BoardHeading>}
          <EnduranceRoundPanels
            sections={roundSections}
            accent={ACCENT.UPPER}
            myTeamId={myTeamId}
            playoffsStarted={endurance.playoffsStarted}
            allTournamentMatches={matches}
            canReport={canReport}
            adminResolvable={adminResolvable}
            drafts={drafts}
            onScoreChange={onScoreChange}
            onSubmit={onSubmit}
            onOpenAdminModal={onOpenAdminModal}
            format={format}
          />
        </>
      ) : (
        decisive.length === 0 && (
          <p style={{ color: "var(--text-2)", margin: 0, fontSize: 14 }}>{emptyLabel}</p>
        )
      )}
    </>
  );
}
