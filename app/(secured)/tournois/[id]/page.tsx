"use client";

import { TERMS_ACCEPTANCE_REQUIRED, TERMS_REQUIRED_EVENT } from "@/lib/shared/terms-of-use";
import { useCallback, useMemo, useState, useEffect, useRef } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useParams, useRouter } from "next/navigation";
import type {
  BracketMatch,
  BracketType,
  EndurancePenaltyRow,
  TournamentDetail,
  TournamentFormat,
} from "@/lib/shared/types";
import { participantWording } from "@/lib/shared/participants";
import { remainingSlots } from "@/lib/shared/ghost-registration";
import { advanceSuccessMessage } from "@/lib/shared/tournament-launch";
import { useToast } from "@/components/ui/toast";
import { CyberButton } from "@/components/cyber";
import { useTournamentLive } from "./_hooks/useTournamentLive";
import type { LiveFailure } from "./_lib/live-state";
import { mapError } from "./_lib/error-map";
import { registrationConfirmText } from "./_lib/registration-confirm";
import { formatLocalDateTime } from "@/lib/shared/dates";
import { MatchFormatProvider } from "./_lib/match-format-context";
import { fromBracketMatch } from "@/lib/shared/match-lock";
import { isViewerEntrant } from "@/lib/shared/match-card-viewer";
import { canOpenPlayerScoreDialog } from "@/lib/shared/player-score-report";
import { isPreLaunchState } from "@/lib/shared/seeding";
import {
  planRoundRollback,
  rollbackStageLabelWithArticle,
} from "@/lib/shared/tournament-rollback";
import { canForfeitTeam } from "./_lib/forfeit";
import { RulesHelpFab } from "@/components/rules/RulesHelpFab";
import { PlayerScoreProvider } from "./_lib/player-score-context";
import { LiveProvider } from "./_lib/live-context";
import { canPlayersReportScore } from "@/lib/shared/match-launch";
import { IssueReportProvider } from "./_lib/issue-report-context";
import { RegistrationsPanel } from "./_components/RegistrationsPanel";
import { MatchPlanningPanel } from "./_components/MatchPlanningPanel";
import { tournamentGrantsContactAccess } from "@/lib/shared/discord-identity";
import { BracketSections } from "./_components/BracketSections";
import { PhaseTimeline } from "./_components/PhaseTimeline";
import {
  defaultSelectedPhaseId,
  visibleRulesFormat,
} from "./_lib/phases";
import { EntrantProvider } from "./_lib/entrant-link";
import { buildEntrantLogoMap } from "@/lib/shared/entrant-logos";
import { MatchAnchorProvider } from "./_lib/match-anchor-context";
import { useMatchAnchor } from "./_hooks/useMatchAnchor";
import { TournamentProgress } from "./_components/TournamentProgress";
import { TournamentLoading } from "./_components/TournamentLoading";
import { TournamentHeader } from "./_components/TournamentHeader";
import styles from "./page.module.css";
import { orReload } from "./_lib/lazy-component";

// Découpage du paquet : un spectateur ne voit qu'un format et n'ouvre presque
// jamais un dialogue. Les vues propres à un format et les panneaux du staff
// partent donc dans leur propre fichier, chargé au premier rendu qui les
// affiche ; les dialogues (tous rendus sous condition d'ouverture) au geste qui
// les ouvre. `ssr: false` : la page ne peint aucun de ces blocs avant le
// premier instantané du flux, un rendu serveur n'aurait rien à y mettre.
// `orReload` : un fichier disparu (déploiement survenu depuis l'ouverture)
// recharge la page au lieu de la faire tomber.
const SurvivalView = dynamic(() => orReload(import("./_components/SurvivalView").then((m) => m.SurvivalView)), { ssr: false });
const SurvivalRounds = dynamic(() => orReload(import("./_components/SurvivalView").then((m) => m.SurvivalRounds)), { ssr: false });
const SwissView = dynamic(() => orReload(import("./_components/SwissView").then((m) => m.SwissView)), { ssr: false });
const SwissRounds = dynamic(() => orReload(import("./_components/SwissView").then((m) => m.SwissRounds)), { ssr: false });
const EnduranceView = dynamic(() => orReload(import("./_components/EnduranceView").then((m) => m.EnduranceView)), { ssr: false });
const BracketPreview = dynamic(() => orReload(import("./_components/BracketPreview").then((m) => m.BracketPreview)), { ssr: false });
const PhaseStandingsBlock = dynamic(() => orReload(import("./_components/PhaseStandingsBlock").then((m) => m.PhaseStandingsBlock)), { ssr: false });
const EntrantContactsPanel = dynamic(() => orReload(import("./_components/EntrantContactsPanel").then((m) => m.EntrantContactsPanel)), { ssr: false });
const AdminScoreDialog = dynamic(() => orReload(import("./_components/AdminScoreDialog").then((m) => m.AdminScoreDialog)), { ssr: false });
const PlayerScoreDialog = dynamic(() => orReload(import("./_components/PlayerScoreDialog").then((m) => m.PlayerScoreDialog)), { ssr: false });
const GhostRegistrationDialog = dynamic(() => orReload(import("./_components/GhostRegistrationDialog").then((m) => m.GhostRegistrationDialog)), { ssr: false });
const MatchLiveDialog = dynamic(() => orReload(import("./_components/MatchLiveDialog").then((m) => m.MatchLiveDialog)), { ssr: false });
const MatchScheduleDialog = dynamic(() => orReload(import("./_components/MatchScheduleDialog").then((m) => m.MatchScheduleDialog)), { ssr: false });
const MatchReplayDialog = dynamic(() => orReload(import("./_components/MatchReplayDialog").then((m) => m.MatchReplayDialog)), { ssr: false });
const IssueReportDialog = dynamic(() => orReload(import("./_components/IssueReportDialog").then((m) => m.IssueReportDialog)), { ssr: false });
const DeleteTournamentDialog = dynamic(() => orReload(import("./_components/DeleteTournamentDialog").then((m) => m.DeleteTournamentDialog)), { ssr: false });
const RollbackRoundDialog = dynamic(() => orReload(import("./_components/RollbackRoundDialog").then((m) => m.RollbackRoundDialog)), { ssr: false });
const EndurancePenaltyDialog = dynamic(() => orReload(import("./_components/EndurancePenaltyDialog").then((m) => m.EndurancePenaltyDialog)), { ssr: false });
const AdvanceTournamentDialog = dynamic(() => orReload(import("./_components/AdvanceTournamentDialog").then((m) => m.AdvanceTournamentDialog)), { ssr: false });
const TournamentImageDialog = dynamic(() => orReload(import("./_components/TournamentImageDialog").then((m) => m.TournamentImageDialog)), { ssr: false });
const ConfirmActionDialog = dynamic(() => orReload(import("@/components/ui/confirm-action-dialog").then((m) => m.ConfirmActionDialog)), { ssr: false });

/** Confirmation en attente d'un geste irréversible (abandon, retrait de pénalité). */
interface PendingConfirm {
  title: string;
  /** Un paragraphe par entrée. */
  body: string[];
  confirmLabel: string;
  pendingLabel: string;
  /** Ton du bouton de confirmation : `danger` par défaut (geste qui retire). */
  tone?: "danger" | "primary";
  run: () => Promise<boolean>;
}

/** « Arbre » ne veut rien dire dans les formats à classement, qui n'en ont pas. */
const BOARD_TITLES: Record<TournamentFormat, string> = {
  SINGLE: "Arbre du tournoi",
  DOUBLE: "Arbre du tournoi",
  SWISS: "Classement et rondes",
  SURVIVAL: "Classement et rounds",
  MULTI: "Phases du tournoi",
  BG_SURVIE: "Endurance et manches",
};

/** Ce que le plateau deviendra au coup d'envoi, dit avant qu'il n'existe. */
function preLaunchBoardText(formatForBracket: string, format: TournamentFormat, seedingSource: string): string {
  if (formatForBracket === "SURVIVAL") {
    return "Le classement de départ (seeding) et les rounds seront générés au démarrage du tournoi.";
  }
  if (format === "BG_SURVIE") {
    return seedingSource === "MANUAL"
      ? "Le classement de départ est l'ordre fixé par le staff ci-dessous ; les manches d'endurance seront générées au démarrage du tournoi."
      : "Le classement de départ est celui du site, dans l'ordre des inscriptions ci-dessous ; les manches d'endurance seront générées au démarrage du tournoi.";
  }
  if (format === "SWISS") {
    return "Le classement de départ (seeding) et la première ronde seront générés au démarrage du tournoi.";
  }
  return "Le bracket sera généré automatiquement au démarrage du tournoi.";
}

/** Page d'un tournoi inaccessible : session expirée, ou tournoi introuvable. */
function TournamentFatal({ fatal }: Readonly<{ fatal: LiveFailure }>) {
  return (
    <section className={`ds-block ${styles.status}`} role="alert">
      <h1 className={styles.fatalTitle}>
        {fatal === "UNAUTHORIZED" ? "Session expirée" : "Tournoi introuvable"}
      </h1>
      <p className={styles.fatalText}>
        {fatal === "UNAUTHORIZED"
          ? "Ta session a expiré : le suivi en direct est arrêté. Reconnecte-toi pour le reprendre."
          : // Volontairement neutre : ce 404 recouvre le tournoi supprimé et
            // le tournoi pas encore publié, que le serveur refuse sans dire
            // lequel des deux (`docs/features/TOURNAMENT_VISIBILITY_ACCESS.md`).
            "Ce tournoi n'est pas accessible. Il a pu être supprimé, ou n'est pas encore ouvert au public."}
      </p>
      <CyberButton asChild variant="primary">
        <Link href={fatal === "UNAUTHORIZED" ? "/connexion" : "/tournois"}>
          {fatal === "UNAUTHORIZED" ? "Se reconnecter" : "Retour aux tournois"}
        </Link>
      </CyberButton>
    </section>
  );
}

/** Rencontre désignée par un identifiant, relue dans la liste du moment. */
function matchById(matches: readonly BracketMatch[], id: number | null): BracketMatch | null {
  return id === null ? null : matches.find((match) => match.id === id) ?? null;
}

/** Retour en arrière : le plan du moment, son refus, et les rencontres qu'il efface. */
function rollbackView(detail: TournamentDetail, frozen: boolean) {
  const rollbackTargetState =
    detail.card.state === "RUNNING" || detail.card.state === "FINISHED";
  const rollbackPlan =
    detail.isAdmin && !frozen && rollbackTargetState
      ? planRoundRollback(
          detail.matches.map((match) => ({
            ...fromBracketMatch(match),
            bracket: match.bracket,
          })),
        )
      : null;
  const rollbackRefusal = typeof rollbackPlan === "string" ? rollbackPlan : null;
  const rollbackReady =
    rollbackPlan !== null && typeof rollbackPlan !== "string" ? rollbackPlan : null;
  // Les rencontres de la manche, relues à chaque rendu depuis le flux : le
  // dialogue annonce les scores du moment, pas ceux d'une photo prise à
  // l'ouverture.
  const rollbackMatches =
    rollbackReady === null
      ? []
      : detail.matches.filter((match) => rollbackReady.clearedMatchIds.includes(match.id));
  return { rollbackPlan, rollbackRefusal, rollbackReady, rollbackMatches };
}

type TournamentPhaseView = NonNullable<TournamentDetail["phases"]>[number];

/** Phase consultée d'un multi-phases, et ce qu'elle restreint du plateau. */
function selectedPhaseView(detail: TournamentDetail, selectedPhaseId: number | null) {
  const isMulti = detail.card.format === "MULTI";
  const selectedPhase =
    isMulti && selectedPhaseId && detail.phases
      ? detail.phases.find((p) => p.id === selectedPhaseId) || null
      : null;

  const phaseNameSuffix = selectedPhase?.name ? ` — ${selectedPhase.name}` : "";
  const contextLabel =
    isMulti && selectedPhase ? `Phase ${selectedPhase.position}${phaseNameSuffix}` : undefined;

  const filteredMatches = isMulti && selectedPhase
    ? detail.matches.filter((m) => m.phaseId === selectedPhase.id)
    : detail.matches;

  const formatForBracket = isMulti && selectedPhase ? selectedPhase.format : detail.card.format;
  return { isMulti, selectedPhase, contextLabel, filteredMatches, formatForBracket };
}

/** Disposition du plateau selon la phase consultée. */
function phaseBoardLayout(
  detail: TournamentDetail,
  isMulti: boolean,
  selectedPhase: TournamentPhaseView | null,
  formatForBracket: TournamentFormat,
) {
  // Les classements suisse et survie de l'instantané sont ceux du tournoi, ou —
  // en multi-phases — de la seule phase **en cours** (`snapshot.ts`). Ils ne
  // décrivent donc la phase affichée que si c'est elle ; une phase close montre
  // ses manches seules, et son classement de phase dessous.
  const rankingMetaIsSelectedPhase =
    !isMulti || (selectedPhase !== null && selectedPhase.id === detail.currentPhaseId);
  // Clé des vues à manches : changer de phase les remonte, et leur zone de
  // manches se rouvre sur la dernière (`revealKey` ne suffit pas quand deux
  // phases ont autant de manches).
  const phaseViewKey = selectedPhase ? `phase-${selectedPhase.id}` : "tournament";
  const hasThirdPlaceForPhase = isMulti && selectedPhase ? selectedPhase.hasThirdPlaceMatch : detail.card.hasThirdPlaceMatch;

  const singleBracketOrder: BracketType[] = hasThirdPlaceForPhase ? ["UPPER", "THIRD_PLACE"] : ["UPPER"];
  const bracketOrder: BracketType[] =
    formatForBracket === "SINGLE" ? singleBracketOrder : ["UPPER", "LOWER", "GRAND"];
  return { rankingMetaIsSelectedPhase, phaseViewKey, bracketOrder };
}

/** Classement d'une phase terminée, quand c'est elle qu'on consulte. */
function finishedPhaseStandingRows(
  detail: TournamentDetail,
  isMulti: boolean,
  selectedPhase: TournamentPhaseView | null,
) {
  return isMulti && selectedPhase?.state === "FINISHED"
    ? detail.phaseStandings?.[selectedPhase.id] ?? null
    : null;
}

interface TournamentDangerZoneProps {
  detail: TournamentDetail;
  rollbackPlan: ReturnType<typeof rollbackView>["rollbackPlan"];
  rollbackReady: ReturnType<typeof rollbackView>["rollbackReady"];
  rollbackRefusal: ReturnType<typeof rollbackView>["rollbackRefusal"];
  rollbackReopenNote: string;
  onRollback: () => void;
  onDelete: () => void;
}

/**
 * Zone de danger : les gestes qu'on ne défait pas, volontairement isolés en bas
 * de page. Chaque bloc garde sa propre garde.
 */
function TournamentDangerZone({
  detail,
  rollbackPlan,
  rollbackReady,
  rollbackRefusal,
  rollbackReopenNote,
  onRollback,
  onDelete,
}: Readonly<TournamentDangerZoneProps>) {
  return (
    <div className={`ds-block ${styles.danger}`}>
      <div className="ds-section-title">
        <h2 className={styles.dangerTitle}>Zone de danger</h2>
      </div>
      {/* Retour en arrière — au-dessus de la suppression : c'est le geste
          qu'un arbitre vient chercher ici, et le seul des deux qui se
          rejoue. Rendu même quand il est refusé, avec son motif : un
          bouton qui disparaît laisse chercher, une phrase explique. */}
      {detail.isAdmin && rollbackPlan !== null && (
        <div className={styles.dangerRow}>
          <p id="rollback-hint" className={styles.dangerText}>
            {rollbackReady
              ? `Effacer ${rollbackStageLabelWithArticle(rollbackReady)} rouvre la manche précédente à la correction. Le geste se répète : de manche en manche, on remonte jusqu'au début du tournoi.${rollbackReopenNote} Pense à noter les scores avant : rien n'est archivé.`
              : mapError(rollbackRefusal ?? "")}
          </p>
          <CyberButton
            variant="ghost"
            onClick={() => {
              if (rollbackReady !== null) onRollback();
            }}
            // `aria-disabled` et non `disabled` : un bouton désactivé n'est
            // pas focalisable, si bien qu'un lecteur d'écran sautait le
            // contrôle **et** le motif du refus qui lui est rattaché.
            // Focalisable, il reste inerte par la garde du clic — et le
            // style du refus vit sur le même attribut.
            aria-disabled={rollbackReady === null}
            // La phrase à gauche dit ce que le geste efface, ou pourquoi il
            // est refusé : elle fait partie du bouton, pas de son décor.
            aria-describedby="rollback-hint"
            className={`${styles.dangerAction} ${styles.rollbackAction}`}
          >
            Revenir en arrière d&apos;une manche
          </CyberButton>
        </div>
      )}

      {detail.canDelete && (
        <div className={styles.dangerRow}>
          <p className={styles.dangerText}>
            Supprimer ce tournoi l&apos;efface du site pour de bon, avec ses matchs, ses
            inscriptions et ses classements. Les équipes et les joueurs, eux, sont conservés.
          </p>
          <CyberButton
            variant="ghost"
            onClick={() => onDelete()}
            className={`${styles.dangerAction} ${styles.deleteAction}`}
          >
            Supprimer le tournoi
          </CyberButton>
        </div>
      )}
    </div>
  );
}

export default function TournamentDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const tournamentId = Number(params.id);
  const { showError, showSuccess } = useToast();

  const { tournament: detail, refresh, isLive, tier, fatal } = useTournamentLive(tournamentId);
  // Même raison que les deux dialogues ci-dessous : on retient l'identifiant, pas
  // l'objet. Un match capturé à l'ouverture ne bougeait plus, si bien que le
  // dialogue continuait d'afficher « 0 – 0 » sur un match que le flux venait de
  // rapporter à 2-1 — et l'enregistrer écrasait la saisie de l'autre arbitre.
  const [selectedMatchForAdminId, setSelectedMatchForAdminId] = useState<number | null>(null);
  const [ghostRegistrationOpen, setGhostRegistrationOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [rollbackDialogOpen, setRollbackDialogOpen] = useState(false);
  const [advanceDialogOpen, setAdvanceDialogOpen] = useState(false);
  const [imageDialogOpen, setImageDialogOpen] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);
  // On retient l'**identifiant** du match en cours de configuration, pas l'objet :
  // la page se recharge par SSE, et un objet capturé à l'ouverture deviendrait
  // périmé — le dialogue rejouerait alors une configuration dépassée par-dessus
  // celle d'un autre membre du staff.
  const [matchForLiveId, setMatchForLiveId] = useState<number | null>(null);
  // Même raison que ci-dessus : on retient l'identifiant, pas l'objet.
  const [matchForScheduleId, setMatchForScheduleId] = useState<number | null>(null);
  // Même raison encore : identifiant, pas objet.
  const [matchForReplayId, setMatchForReplayId] = useState<number | null>(null);
  // Stables pour la vie de la page : les `setState` de React le sont déjà. Sans
  // cela, deux flèches neuves à chaque rendu changeraient la valeur du contexte
  // de diffusion à chaque instantané SSE, et redessineraient les 127 bandeaux
  // d'un plateau à 128 équipes pour un score qui n'en concerne qu'un.
  const openAdminScore = useCallback((match: BracketMatch) => setSelectedMatchForAdminId(match.id), []);
  // Modale de score d'un engagé : identifiant, pas objet, comme l'arbitrage —
  // la proposition adverse arrive par le flux pendant qu'elle est ouverte.
  const [playerScoreMatchId, setPlayerScoreMatchId] = useState<number | null>(null);
  const openPlayerScore = useCallback((match: BracketMatch) => setPlayerScoreMatchId(match.id), []);
  const openMatchLive = useCallback((match: BracketMatch) => setMatchForLiveId(match.id), []);
  const openMatchSchedule = useCallback(
    (match: BracketMatch) => setMatchForScheduleId(match.id),
    [],
  );
  const openMatchReplay = useCallback(
    (match: BracketMatch) => setMatchForReplayId(match.id),
    [],
  );
  // Signalement de problème : `undefined` = fermé, `null` = ouvert sur tout le
  // tournoi, un match = ouvert sur cette manche. Trois états, un seul `useState`
  // — un booléen doublé d'un match laisserait exister « fermé mais sur ce match ».
  const [issueTarget, setIssueTarget] = useState<BracketMatch | null | undefined>(undefined);
  // Stable pour la même raison que `openMatchLive` : le contexte descend dans
  // chaque `MatchRow` du plateau.
  const openIssueReport = useCallback(
    (match: BracketMatch | null) => setIssueTarget(match),
    [],
  );
  const [selectedPhaseId, setSelectedPhaseId] = useState<number | null>(null);
  // Pénalité d'endurance en cours de saisie : `null` = dialogue fermé. On retient
  // l'**identifiant** de l'engagé visé, jamais sa ligne de classement — même
  // raison que les trois dialogues ci-dessus : le flux réécrit le classement, et
  // un capital capturé au clic ferait annoncer au dialogue un « capital
  // restant » périmé, voire tairait l'élimination qu'une sanction provoque.
  const [penaltyTeamId, setPenaltyTeamId] = useState<number | null>(null);

  // Lien profond `#match-[id]` : la fiche s'ouvre défilée sur le match désigné
  // (carte « en cours » de l'accueil, lien partagé). Le hook révèle au besoin la
  // phase qui le contient, attend qu'il arrive par le flux, puis le surligne.
  const { targetMatchId, highlightedMatchId } = useMatchAnchor({
    tournamentId,
    matches: detail?.matches,
    selectedPhaseId,
    onSelectPhase: setSelectedPhaseId,
  });

  // L'App Router réutilise ce composant d'un paramètre à l'autre : passer de
  // `/tournois/1` à `/tournois/2` ne le remonte pas (`useTournamentLive` remet
  // son état à zéro pour la même raison). Une modale destructrice ne doit pas
  // survivre au changement de cible.
  useEffect(() => setDeleteDialogOpen(false), [tournamentId]);
  // Même précaution : lancer le tournoi qu'on croyait regarder serait pire
  // encore qu'un dialogue de suppression laissé ouvert sur la mauvaise cible.
  useEffect(() => setAdvanceDialogOpen(false), [tournamentId]);
  // L'image enregistrée depuis ce dialogue irait sinon habiller un autre tournoi.
  useEffect(() => setImageDialogOpen(false), [tournamentId]);
  useEffect(() => setIssueTarget(undefined), [tournamentId]);
  useEffect(() => setPlayerScoreMatchId(null), [tournamentId]);
  // Même précaution : une sanction ne doit pas se retrouver adressée à l'engagé
  // d'un autre tournoi parce que la page a changé de cible sous le dialogue.
  useEffect(() => setPenaltyTeamId(null), [tournamentId]);

  // Dernière phase courante observée. On ne resynchronise la sélection que
  // lorsqu'elle change RÉELLEMENT (une phase vient de démarrer) : comparer
  // directement à `selectedPhaseId` ramènerait l'affichage sur la phase en cours
  // à chaque clic, rendant impossible la consultation d'une phase terminée.
  //
  // `undefined` = **rien observé encore**, et ce troisième état n'est pas du
  // luxe : parti de `null`, le premier instantané ressemblait à un changement de
  // phase (`null` → la phase en cours) et emportait la sélection avec lui. Le
  // défaut ci-dessous le masquait tant qu'il était seul à écrire ; il ne l'est
  // plus depuis qu'une ancre `#match-[id]` peut avoir déjà choisi une phase.
  const lastCurrentPhaseId = useRef<number | null | undefined>(undefined);

  // Même précaution que les trois dialogues ci-dessus, et pour la même raison :
  // la page n'est pas remontée d'un tournoi à l'autre. Une phase appartient à
  // **son** tournoi — garder son identifiant laisserait `selectedPhase`
  // introuvable, donc `filteredMatches` non filtré, et la fiche empilerait
  // toutes les phases. Les deux repères partent ensemble : remettre le seul
  // `lastCurrentPhaseId` ferait croire à un démarrage de phase au premier
  // instantané du nouveau tournoi, ce qui écraserait la phase qu'une ancre
  // `#match-[id]` vient de choisir.
  useEffect(() => {
    setSelectedPhaseId(null);
    lastCurrentPhaseId.current = undefined;
  }, [tournamentId]);

  useEffect(() => {
    const phases = detail?.phases;
    if (!phases) return;

    const current = detail?.currentPhaseId ?? null;
    const phaseJustStarted =
      lastCurrentPhaseId.current !== undefined &&
      current !== null &&
      current !== lastCurrentPhaseId.current;
    lastCurrentPhaseId.current = current;

    // Mise à jour **fonctionnelle**, et ce n'est pas un détail de style : cet
    // effet n'est pas seul à écrire la phase sélectionnée. `useMatchAnchor`
    // l'écrit aussi, pour révéler la phase d'un match visé par une ancre, et il
    // est déclaré plus haut — ses effets passent donc avant celui-ci **dans le
    // même commit**, où `selectedPhaseId` vaut encore ce qu'il valait au rendu.
    // Lu directement, il valait `null` : ce défaut écrasait aussitôt la phase
    // que l'ancre venait de choisir, et le match restait introuvable. Le
    // paramètre `previous`, lui, porte la valeur écrite juste avant.
    setSelectedPhaseId((previous) => {
      if (previous === null) return defaultSelectedPhaseId(phases, current);
      if (phaseJustStarted) return current;
      return previous;
    });
  }, [detail?.phases, detail?.currentPhaseId]);

  // Logos des engagés pour toutes les vues du plateau (cartes de match, arbre,
  // classements) : construits une fois depuis les inscrites, qui sont les seules
  // à porter le logo — voir `lib/shared/entrant-logos.ts`. Mémorisés sur la
  // liste reçue, pour ne pas redessiner chaque carte à chaque rendu de la page.
  const entrantLogos = useMemo(
    () => buildEntrantLogoMap(detail?.registrations ?? []),
    [detail?.registrations],
  );

  // Le match est lancé et le lecteur y est engagé : la modale offre la saisie
  // du score (`lib/shared/match-launch.ts`, même règle que le serveur).
  //
  // Mémorisées, et donc déclarées avant les retours anticipés : elles
  // descendent dans chaque `MatchRow` par `PlayerScoreProvider`, et deux
  // flèches neuves à chaque rendu changeraient la valeur du contexte à chaque
  // instantané — toutes les cartes, pourtant mémorisées, se redessineraient.
  // Leurs dépendances tiennent au lecteur, pas au plateau : l'horloge n'y joue
  // aucun rôle (`canPlayersReportScore` ne rend `LAUNCHED` que sur une
  // écriture, que le flux apporte avec un nouvel objet de match).
  const viewerMyTeamId = detail?.myTeamId ?? null;
  const viewerReportTeamIds = detail?.canCreateReportsForTeamIds;
  const viewerCanActForEntrant = detail?.canRegisterEntrant ?? false;
  /**
   * Le suivi est arrêté : ce qui est affiché ne bouge plus. On retire donc les
   * actions plutôt que de les laisser échouer une par une — une équipe qui
   * saisit son score en fin de manche n'a aucun moyen de deviner que son
   * plateau date de plusieurs minutes.
   */
  const frozen = fatal !== null;
  const canReportScore = useCallback(
    (match: BracketMatch): boolean =>
      !frozen &&
      viewerMyTeamId !== null &&
      (viewerReportTeamIds?.includes(viewerMyTeamId) ?? false) &&
      canPlayersReportScore(match, Date.now()),
    [frozen, viewerMyTeamId, viewerReportTeamIds],
  );
  const canOpenPlayerScore = useCallback(
    (match: BracketMatch): boolean =>
      canOpenPlayerScoreDialog({
        match,
        myTeamId: viewerMyTeamId,
        canReportScore: canReportScore(match),
        canActForEntrant: viewerCanActForEntrant,
        frozen,
      }),
    [canReportScore, viewerMyTeamId, viewerCanActForEntrant, frozen],
  );

  // Échec définitif avant même d'avoir reçu quoi que ce soit : sans ce cas, la
  // page resterait sur « Chargement… » pour toujours — le seul état où il ne
  // reste que le F5, et où il ne sert à rien.
  if (fatal && !detail) {
    return <TournamentFatal fatal={fatal} />;
  }

  if (!detail) {
    // Le premier affichage attend l'ouverture du flux, qui apporte le plateau
    // et le contexte du lecteur d'un seul coup — ou, passé un délai sans rien,
    // la lecture REST de secours (`FIRST_SNAPSHOT_TIMEOUT_MS`).
    return <TournamentLoading />;
  }

  /**
   * Retour en arrière : le stade que le geste effacerait, ou le motif du refus.
   *
   * Décidé côté client par le module que le serveur applique lui-même
   * (`lib/shared/tournament-rollback.ts`) : le bouton ne s'arme donc jamais sur
   * un stade que la route refuserait, et le motif affiché est exactement celui
   * qu'elle rendrait. Deux lectures de la même règle, une seule implémentation.
   *
   * Un tournoi **terminé** y a droit comme un tournoi en cours : c'est même le
   * cas qui manquait le plus, l'erreur de finale étant la seule que `match-lock`
   * ne laisse plus corriger. Le geste le rouvrira, et le dialogue le dit.
   */
  const { rollbackPlan, rollbackRefusal, rollbackReady, rollbackMatches } = rollbackView(detail, frozen);

  // Vocabulaire de l'affichage : un tournoi individuel parle de joueurs, pas
  // d'équipes (`lib/shared/participants.ts`).
  const wording = participantWording(detail.card.participantType);

  const canAdminResolve = (match: BracketMatch): boolean => {
    if (frozen) return false;
    if (!detail?.isAdmin) return false;
    if (match.team1Id === null || match.team2Id === null) return false;
    return true;
  };

  // En multi-phases, l'abandon suit le format de la phase **en cours** — et non
  // celui du tournoi (« MULTI », qui n'a pas de notion d'abandon), ni celui
  // d'une phase terminée qu'on serait simplement en train de consulter.
  const forfeitFormat =
    detail.card.format === "MULTI"
      ? detail.phases?.find((p) => p.id === detail.currentPhaseId)?.format ?? detail.card.format
      : detail.card.format;

  const canForfeit = (teamId: number): boolean =>
    !frozen &&
    canForfeitTeam(
      {
        format: forfeitFormat,
        state: detail.card.state,
        isAdmin: detail.isAdmin,
        myTeamId: detail.myTeamId,
        canCreateReportsForTeamIds: detail.canCreateReportsForTeamIds,
        canActForEntrant: detail.canRegisterEntrant,
      },
      teamId,
    );

  // Abandon et retrait d'une pénalité : deux gestes qui ne se défont pas, donc
  // une confirmation — une modale et non `window.confirm`, comme leurs voisins
  // de la page (`ConfirmActionDialog`). Le geste lui-même ne part qu'au clic de
  // confirmation, et rend `true` s'il a abouti pour que la modale se ferme.
  const performForfeit = async (teamId: number, teamName: string, isMine: boolean) => {
    try {
      const response = await fetch(`/api/tournaments/${tournamentId}/forfeit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ teamId }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "FORFEIT_FAILED");
      showSuccess(isMine ? "Forfait enregistré." : `Forfait de ${teamName} enregistré.`);
      void refresh();
      return true;
    } catch (e) {
      showError(mapError((e as Error).message));
      return false;
    }
  };

  const forfeitTeam = (teamId: number, teamName: string) => {
    const isMine = detail?.myTeamId === teamId;
    setPendingConfirm(
      isMine
        ? {
            title: "Abandonner le tournoi ?",
            body: [wording.forfeitSelfConfirm],
            confirmLabel: "Abandonner",
            pendingLabel: "Abandon…",
            run: () => performForfeit(teamId, teamName, true),
          }
        : {
            title: `Déclarer ${teamName} forfait ?`,
            body: [
              `${wording.subject} quittera définitivement le tournoi : le forfait vaut pour tout ce qui reste à jouer.`,
              "Pour un forfait sur une seule manche, passez par le score du match.",
            ],
            confirmLabel: "Déclarer forfait",
            pendingLabel: "Enregistrement…",
            run: () => performForfeit(teamId, teamName, false),
          },
    );
  };

  const performLiftPenalty = async (penalty: EndurancePenaltyRow) => {
    try {
      const response = await fetch(
        `/api/tournaments/${tournamentId}/penalties/${penalty.id}`,
        { method: "DELETE" },
      );
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "PENALTY_LIFT_FAILED");
      showSuccess(`Pénalité retirée : ${penalty.teamName} récupère ${penalty.points} point(s).`);
      void refresh();
      return true;
    } catch (e) {
      showError(mapError((e as Error).message));
      return false;
    }
  };

  const liftPenalty = (penalty: EndurancePenaltyRow) => {
    setPendingConfirm({
      title: `Retirer la pénalité de ${penalty.teamName} ?`,
      body: [
        `${penalty.points} point(s) seront rendus au capital d'endurance, et tout ce que la sanction avait entraîné sera rétabli.`,
      ],
      confirmLabel: "Retirer la pénalité",
      pendingLabel: "Retrait…",
      run: () => performLiftPenalty(penalty),
    });
  };

  // Ligne visée par le dialogue de pénalité, relue à chaque rendu depuis
  // l'instantané : c'est ce qui garde le « capital restant » du dialogue aligné
  // sur ce que le flux vient d'apporter.
  const penaltyStanding =
    penaltyTeamId === null
      ? null
      : detail.endurance?.standings.find((s) => s.teamId === penaltyTeamId) ?? null;

  // Inscription : confirmée d'abord (`_lib/registration-confirm.ts`), et le
  // bouton de la modale reste désactivé pendant l'envoi — un double appui ne
  // part donc qu'une fois.
  const performRegister = async () => {
    try {
      const response = await fetch(`/api/tournaments/${tournamentId}/register`, {
        method: "POST",
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        // Refus faute des conditions d'utilisation : la modale d'acceptation
        // (mise en page racine) s'ouvre, le toast dit pourquoi. La confirmation
        // se ferme alors (`true`) : deux modales empilées se disputeraient le focus.
        if (payload.error === TERMS_ACCEPTANCE_REQUIRED) {
          showError(mapError(payload.error));
          // Après la fermeture de la confirmation, qui rend le focus en partant.
          window.setTimeout(() => window.dispatchEvent(new Event(TERMS_REQUIRED_EVENT)), 0);
          return true;
        }
        throw new Error(payload.error || "REGISTRATION_FAILED");
      }
      showSuccess("Inscription validée.");
      void refresh();
      return true;
    } catch (e) {
      showError(mapError((e as Error).message));
      return false;
    }
  };

  const registerTeam = () => {
    const text = registrationConfirmText(detail.card, formatLocalDateTime(detail.card.startAt));
    setPendingConfirm({ ...text, tone: "primary", run: performRegister });
  };

  const { isMulti, selectedPhase, contextLabel, filteredMatches, formatForBracket } = selectedPhaseView(
    detail,
    selectedPhaseId,
  );
  const visibleFormat = visibleRulesFormat(detail.card, selectedPhase);
  const { rankingMetaIsSelectedPhase, phaseViewKey, bracketOrder } = phaseBoardLayout(
    detail,
    isMulti,
    selectedPhase,
    formatForBracket,
  );
  const bracketLabels: Record<BracketType, string> = {
    UPPER: "Tableau principal",
    LOWER: "Tableau perdants",
    GRAND: "Grande Finale",
    THIRD_PLACE: "Petite Finale",
  };
  // Résolu à chaque rendu depuis la liste fraîche : le dialogue de diffusion
  // travaille toujours sur l'état courant du match, et se ferme de lui-même si
  // le match disparaît (plateau régénéré).
  const matchForAdminScore = matchById(detail.matches, selectedMatchForAdminId);
  // Relu comme l'arbitrage, et refermé de lui-même dès que le match n'appelle
  // plus de geste du lecteur : l'adversaire vient de confirmer, l'arbitrage de
  // trancher — la modale ne reste pas ouverte sur un résultat acquis.
  const playerScoreCandidate = matchById(detail.matches, playerScoreMatchId);
  const matchForPlayerScore =
    playerScoreCandidate && canOpenPlayerScore(playerScoreCandidate) ? playerScoreCandidate : null;
  const matchForLive = matchById(detail.matches, matchForLiveId);
  const matchForSchedule = matchById(detail.matches, matchForScheduleId);
  const matchForReplay = matchById(detail.matches, matchForReplayId);

  const brackets = bracketOrder
    .map((b) => ({ type: b, matches: filteredMatches.filter((m) => m.bracket === b) }))
    .filter((b) => b.matches.length > 0);

  // Un tournoi clos sans le moindre match n'attend plus rien : il est parti sans
  // adversaires (moins de deux engagées au coup d'envoi, voir
  // docs/features/UNDERFILLED_TOURNAMENTS.md). Lui laisser le « pour l'instant »
  // d'un plateau encore à naître ferait espérer une suite qui ne viendra pas.
  const noMatchesLabel =
    detail.card.state === "FINISHED" && detail.matches.length === 0
      ? `Tournoi clos sans être joué : moins de deux ${wording.manyEngaged} au coup d'envoi.`
      : "Aucun match disponible pour l'instant.";

  // Aperçu du plateau avant lancement, réservé au staff et au cast : le serveur
  // le laisse à `null` pour les autres, à qui le tirage ne doit rien révéler
  // d'avance, et pour un tournoi déjà lancé. Il s'affiche sur tout l'avant-course
  // (`isPreLaunchState`), inscriptions closes comprises.
  const previewBlock = detail.preview ? (
    <div className={styles.preview}>
      <BracketPreview preview={detail.preview} canReorder={detail.isAdmin} />
    </div>
  ) : null;

  // Classement d'une phase terminée, affiché sous son plateau quand on la
  // consulte — le même bloc pour les trois vues qui en ont un.
  const selectedPhaseStandings = finishedPhaseStandingRows(detail, isMulti, selectedPhase);
  const finishedPhaseStandings = selectedPhaseStandings ? (
    <PhaseStandingsBlock standings={selectedPhaseStandings} />
  ) : null;

  const rollbackReopenNote =
    detail.card.state === "FINISHED" ? " Le tournoi étant terminé, il sera rouvert et son classement final effacé." : "";

  // Plateau affiché : aperçu avant le coup d'envoi, vue du format, puis arbre.
  const renderBoard = () => {
    if (isPreLaunchState(detail.card.state)) {
      return (
        <>
          <p className={styles.empty}>
            {preLaunchBoardText(formatForBracket, detail.card.format, detail.seedingSource)}
          </p>
          {previewBlock}
        </>
      );
    }
    if (formatForBracket === "SURVIVAL" && detail.survival && rankingMetaIsSelectedPhase) {
      return (
        <>
          <SurvivalView
            // Une vue par phase : la rangée de manches se rouvre sur la
            // dernière de la phase choisie, même à nombre de manches égal.
            key={phaseViewKey}
            survival={detail.survival}
            matches={filteredMatches}
            allTournamentMatches={detail.matches}
            myTeamId={detail.myTeamId}
            isFinished={detail.card.state === "FINISHED"}
            adminResolvable={canAdminResolve}
            onOpenAdminModal={openAdminScore}
            canForfeit={canForfeit}
            onForfeit={forfeitTeam}
            emptyLabel={noMatchesLabel}
          />
          {/* Pas de `finishedPhaseStandings` ici, comme pour la vue suisse :
              la phase en cours ne se clôt qu'avec le tournoi, et la vue
              porte déjà son classement — il s'afficherait deux fois. */}
        </>
      );
    }
    if (formatForBracket === "SURVIVAL" && isMulti) {
      return (
        // Phase survie close d'un multi-phases : ses manches, et son
        // classement de phase dessous — jamais le classement de la phase en
        // cours, ni un arbre à élimination. Le barrage n'est connu que de la
        // phase en cours : les manches s'affichent sans marques de coupe.
        <>
          <SurvivalRounds
            key={phaseViewKey}
            matches={filteredMatches}
            allTournamentMatches={detail.matches}
            cutSchedule={null}
            adminResolvable={canAdminResolve}
            onOpenAdminModal={openAdminScore}
            emptyLabel={noMatchesLabel}
          />
          {finishedPhaseStandings}
        </>
      );
    }
    if (detail.card.format === "BG_SURVIE" && detail.endurance) {
      return (
        <EnduranceView
          endurance={detail.endurance}
          matches={detail.matches}
          isFinished={detail.card.state === "FINISHED"}
          myTeamId={detail.myTeamId}
          canForfeit={canForfeit}
          onForfeit={forfeitTeam}
          // La sanction est un geste d'**arbitrage** : elle ne suit pas
          // `canForfeit`, qu'un capitaine porte aussi pour son propre
          // engagé. On ne se pénalise pas soi-même.
          canPenalize={!frozen && detail.isAdmin}
          onPenalize={(teamId) => setPenaltyTeamId(teamId)}
          onLiftPenalty={liftPenalty}
          adminResolvable={canAdminResolve}
          onOpenAdminModal={openAdminScore}
          emptyLabel={noMatchesLabel}
          // Le format du tournoi, pas « SURVIVAL » en dur : les deux modes
          // tombent aujourd'hui dans la même branche de `dependentMatches`,
          // mais un verrou de score se lirait faux le jour où ils
          // divergeraient.
          format={detail.card.format}
          // Aperçu de la manche suivante : un outil d'arbitrage, pour un
          // tournoi qui se joue. `isAdmin` vaut la permission
          // `tournaments` (administrateurs et arbitres).
          showNextRound={detail.isAdmin && detail.card.state === "RUNNING" && !frozen}
          qualificationFormat={detail.card.matchFormat}
        />
      );
    }
    if (formatForBracket === "SWISS" && detail.swiss && rankingMetaIsSelectedPhase) {
      return (
        // Tournoi suisse, ou phase suisse **en cours** d'un multi-phases :
        // le serveur ne charge le classement suisse que de celle-ci.
        <>
          <SwissView
            key={phaseViewKey}
            swiss={detail.swiss}
            matches={filteredMatches}
            allTournamentMatches={detail.matches}
            myTeamId={detail.myTeamId}
            isFinished={detail.card.state === "FINISHED"}
            adminResolvable={canAdminResolve}
            onOpenAdminModal={openAdminScore}
            canForfeit={canForfeit}
            onForfeit={forfeitTeam}
            emptyLabel={noMatchesLabel}
          />
          {/* Pas de `finishedPhaseStandings` ici : la phase en cours ne
              se clôt qu'avec le tournoi (dernière phase), et la vue porte
              déjà son classement — il s'afficherait deux fois. */}
        </>
      );
    }
    if (formatForBracket === "SWISS") {
      return (
        // Phase suisse close d'un multi-phases : ses rondes, et son
        // classement de phase dessous. Jamais un arbre à élimination, qui
        // nommait ses rondes « Quart de finale 1…12 ».
        <>
          <SwissRounds
            key={phaseViewKey}
            matches={filteredMatches}
            allTournamentMatches={detail.matches}
            totalRounds={null}
            adminResolvable={canAdminResolve}
            onOpenAdminModal={openAdminScore}
            emptyLabel={noMatchesLabel}
          />
          {finishedPhaseStandings}
        </>
      );
    }
    if (!filteredMatches.length) {
      return (
        <p className={styles.empty}>
          {noMatchesLabel}
        </p>
      );
    }
    return (
      <>
        {brackets.map(({ type, matches }) => (
          <div key={type} className={styles.bracket}>
            <BracketSections
              bracketType={type}
              bracketLabel={bracketLabels[type]}
              showBracketLabel={brackets.length > 1}
              matches={matches}
              allTournamentMatches={detail.matches}
              myTeamId={detail.myTeamId}
              adminResolvable={canAdminResolve}
              onOpenAdminModal={openAdminScore}
              format={formatForBracket}
            />
          </div>
        ))}
        {finishedPhaseStandings}
      </>
    );
  };

  return (
    <EntrantProvider
      participantType={detail.card.participantType}
      soloUserIds={detail.soloUserIds}
      logos={entrantLogos}
    >
      <MatchAnchorProvider
        targetMatchId={targetMatchId}
        highlightedMatchId={highlightedMatchId}
      >
      <MatchFormatProvider
        format={detail.card.matchFormat}
        playoffFormat={detail.card.endurancePlayoffFormat}
        tournamentFormat={detail.card.format}
      >
      <LiveProvider
        canManage={detail.canManageLive}
        canSchedule={detail.isAdmin}
        refereeScheduling={detail.card.refereeScheduling}
        openConfig={openMatchLive}
        openSchedule={openMatchSchedule}
        viewerUserId={detail.viewerUserId}
        myTeamId={detail.myTeamId}
        castBlock={detail.castBlock}
        openReplay={openMatchReplay}
      >
      {/* Le bouton **par match** suit la règle de `frozen` : le plateau affiché
          ne bouge plus, et signaler « ce match » depuis une manche périmée
          désignerait la mauvaise. Celui de l'en-tête reste, lui, disponible —
          c'est justement quand le site décroche qu'il faut pouvoir joindre un
          arbitre. */}
      <IssueReportProvider
        canReport={isViewerEntrant(detail.myTeamId, detail.registrations) && !frozen}
        openReport={openIssueReport}
      >
      <PlayerScoreProvider
        canOpen={canOpenPlayerScore}
        canReportScore={canReportScore}
        open={openPlayerScore}
      >
      <RulesHelpFab format={visibleFormat} contextLabel={contextLabel} tournamentId={detail.card.id} />
      <section className="fade-in">
        <TournamentHeader
          detail={detail}
          isLive={isLive}
          tier={tier}
          fatal={fatal}
          frozen={frozen}
          onRegister={registerTeam}
          onReportIssue={() => openIssueReport(null)}
          onGuestRegister={() => setGhostRegistrationOpen(true)}
          onAdvance={() => setAdvanceDialogOpen(true)}
          onLiveSaved={() => void refresh()}
          onEditImage={() => setImageDialogOpen(true)}
        />

        {/* La frise complète l'en-tête : elle situe le tournoi sur son cycle de
            vie, ce qu'on cherche en arrivant — pas sous les inscrites et les
            contacts, où elle attendait en bas de page. */}
        <TournamentProgress detail={detail} />

        {/* Sous la frise et avant le plateau : c'est là que l'arbitrage lit
            ce qui attend une date, et qu'un engagé apprend pourquoi son match
            est « À planifier ». */}
        <MatchPlanningPanel detail={detail} onPlan={openMatchSchedule} frozen={frozen} />

        <div className={`ds-block ${styles.board}`}>
          {isMulti && detail.phases && (
            <PhaseTimeline
              phases={detail.phases}
              selectedPhaseId={selectedPhaseId}
              currentPhaseId={detail.currentPhaseId}
              onSelect={setSelectedPhaseId}
            />
          )}

          <div className="ds-section-title green">
            <h2>{BOARD_TITLES[detail.card.format]}</h2>
          </div>

          {/* Tout l'avant-course, et pas seulement les inscriptions : un tournoi
              aux inscriptions closes (`UPCOMING`) n'a pas davantage de plateau,
              et c'est précisément le moment où le staff relit le tirage. Les
              formats à classement chargent leurs métadonnées dès la création
              (vides), si bien qu'une condition sur `REGISTRATION` seul faisait
              tomber la clôture dans leur vue — sans match ni aperçu. */}
          {renderBoard()}
        </div>

        <RegistrationsPanel
          detail={detail}
          canAct={!frozen}
          onChanged={() => void refresh()}
        />

        {/* Contacts Discord : sous la liste des engagés, dont il prolonge la
            lecture — on vient d'y voir qui joue, on y lit ensuite comment les
            joindre. Réservé au staff `tournaments` (`detail.isAdmin` porte cette
            permission, cf. `TournamentViewerContext`), la route le revérifiant
            de son côté. Affiché même quand le suivi du tournoi est en échec :
            c'est une lecture, elle n'écrit rien, et un incident est précisément
            le moment où joindre les engagés devient urgent.

            Il disparaît en revanche sur un tournoi **clos**
            (`tournamentGrantsContactAccess`) : le besoin de joindre un engagé
            naît du tournoi et s'éteint avec lui, et la route refuse de toute
            façon — un panneau qui ne rendrait qu'un toast n'a rien à faire là. */}
        {detail.isAdmin && tournamentGrantsContactAccess(detail.card.state) && (
          <EntrantContactsPanel tournamentId={detail.card.id} />
        )}

        {/* Zone de danger : les gestes qu'on ne défait pas, volontairement isolés
            en bas de page, loin des actions courantes. Retirés comme les autres
            quand le suivi est arrêté.

            Deux publics, et non un seul : le retour en arrière est un acte
            d'arbitrage (staff `tournaments`), la suppression définitive reste
            réservée aux administrateurs stricts (`canDelete`). La section
            s'ouvre donc au premier, chaque bloc gardant sa propre garde. */}
        {(detail.isAdmin || detail.canDelete) && !frozen && (
          <TournamentDangerZone
            detail={detail}
            rollbackPlan={rollbackPlan}
            rollbackReady={rollbackReady}
            rollbackRefusal={rollbackRefusal}
            rollbackReopenNote={rollbackReopenNote}
            onRollback={() => setRollbackDialogOpen(true)}
            onDelete={() => setDeleteDialogOpen(true)}
          />
        )}
      </section>

      {matchForAdminScore && (
        <AdminScoreDialog
          key={matchForAdminScore.id}
          match={matchForAdminScore}
          onClose={() => setSelectedMatchForAdminId(null)}
          onSubmitted={() => {
            setSelectedMatchForAdminId(null);
            void refresh();
          }}
        />
      )}

      {matchForPlayerScore && detail.myTeamId !== null && (
        <PlayerScoreDialog
          key={matchForPlayerScore.id}
          tournamentId={tournamentId}
          match={matchForPlayerScore}
          myTeamId={detail.myTeamId}
          canReportScore={canReportScore(matchForPlayerScore)}
          canForfeit={detail.canRegisterEntrant}
          onClose={() => setPlayerScoreMatchId(null)}
          onSubmitted={() => void refresh()}
        />
      )}

      {matchForLive && (
        <MatchLiveDialog
          key={matchForLive.id}
          match={matchForLive}
          onClose={() => setMatchForLiveId(null)}
          onSaved={() => void refresh()}
        />
      )}

      {matchForSchedule && (
        <MatchScheduleDialog
          key={matchForSchedule.id}
          match={matchForSchedule}
          tournamentStartAt={detail.card.startAt}
          tournamentFinished={detail.card.state === "FINISHED"}
          refereeScheduling={detail.card.refereeScheduling}
          onClose={() => setMatchForScheduleId(null)}
          onSaved={() => void refresh()}
        />
      )}

      {matchForReplay && detail.canManageLive && (
        <MatchReplayDialog
          key={matchForReplay.id}
          match={matchForReplay}
          onClose={() => setMatchForReplayId(null)}
          onSaved={() => void refresh()}
        />
      )}

      {imageDialogOpen && detail.isAdmin && !frozen && (
        <TournamentImageDialog
          tournamentId={detail.card.id}
          image={detail.card.image}
          onClose={() => setImageDialogOpen(false)}
          onSaved={() => void refresh()}
        />
      )}

      {advanceDialogOpen && detail.isAdmin && !frozen && (
        <AdvanceTournamentDialog
          card={detail.card}
          onClose={() => setAdvanceDialogOpen(false)}
          onAdvanced={({ target, state, entrantCount }) => {
            setAdvanceDialogOpen(false);
            showSuccess(advanceSuccessMessage(target, state, entrantCount));
            void refresh();
          }}
        />
      )}

      {/* Le suivi arrêté retire les actions : une confirmation restée ouverte
          partirait sur un état que la page ne montre plus. */}
      {pendingConfirm !== null && !frozen && (
        <ConfirmActionDialog
          title={pendingConfirm.title}
          confirmLabel={pendingConfirm.confirmLabel}
          pendingLabel={pendingConfirm.pendingLabel}
          tone={pendingConfirm.tone}
          onClose={() => setPendingConfirm(null)}
          onConfirm={pendingConfirm.run}
        >
          {pendingConfirm.body.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </ConfirmActionDialog>
      )}

      {rollbackDialogOpen && rollbackReady !== null && (
        <RollbackRoundDialog
          tournamentId={tournamentId}
          stageLabel={rollbackStageLabelWithArticle(rollbackReady)}
          stageKey={rollbackReady.stageKey}
          matches={rollbackMatches}
          tournamentFinished={detail.card.state === "FINISHED"}
          onClose={() => setRollbackDialogOpen(false)}
          onRolledBack={(label) => {
            setRollbackDialogOpen(false);
            showSuccess(`Résultats effacés : ${label}.`);
            // Le flux pousse déjà la nouvelle version ; on relit tout de même,
            // pour que celui qui vient d'agir voie le plateau à la seconde
            // plutôt qu'à la fenêtre de son palier de fraîcheur.
            void refresh();
          }}
        />
      )}

      {deleteDialogOpen && detail.canDelete && !frozen && (
        <DeleteTournamentDialog
          tournamentId={tournamentId}
          tournamentName={detail.card.name}
          onClose={() => setDeleteDialogOpen(false)}
          onDeleted={(name) => {
            // On quitte sans attendre le flux : la salle finira par fermer les
            // connexions, mais celui qui vient de supprimer n'a rien à faire sur
            // la fiche d'un tournoi qui n'existe plus.
            showSuccess(`Tournoi « ${name} » supprimé définitivement.`);
            router.replace("/tournois");
          }}
        />
      )}

      {/*
        La cible est un **identifiant**, sa ligne se relit à chaque rendu depuis
        le flux : le dialogue annonce donc le capital du moment, et l'élimination
        quand la sanction y mène. Une ligne disparue (l'engagé vient de sortir)
        referme le dialogue plutôt que d'ouvrir sur des chiffres inventés.
      */}
      {penaltyStanding !== null && detail.isAdmin && !frozen && detail.endurance && (
        <EndurancePenaltyDialog
          tournamentId={tournamentId}
          teamId={penaltyStanding.teamId}
          teamName={penaltyStanding.teamName}
          currentPoints={penaltyStanding.points}
          round={detail.endurance.currentRound}
          onClose={() => setPenaltyTeamId(null)}
          onApplied={() => void refresh()}
        />
      )}

      {issueTarget !== undefined && (
        <IssueReportDialog
          tournamentId={tournamentId}
          match={issueTarget}
          onClose={() => setIssueTarget(undefined)}
        />
      )}

      {ghostRegistrationOpen && (
        <GhostRegistrationDialog
          tournamentId={tournamentId}
          remainingSlots={remainingSlots(detail.card.maxTeams, detail.card.registeredTeams)}
          onClose={() => setGhostRegistrationOpen(false)}
          onRegistered={() => void refresh()}
        />
      )}
      </PlayerScoreProvider>
      </IssueReportProvider>
      </LiveProvider>
      </MatchFormatProvider>
      </MatchAnchorProvider>
    </EntrantProvider>
  );
}
