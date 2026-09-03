"use client";

import { FormEvent, useCallback, useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import type { BracketMatch, BracketType, TournamentFormat } from "@/lib/shared/types";
import { participantWording } from "@/lib/shared/participants";
import { remainingSlots } from "@/lib/shared/ghost-registration";
import { useToast } from "@/components/ui/toast";
import { CyberButton } from "@/components/cyber";
import { useTournamentLive } from "./_hooks/useTournamentLive";
import { mapError } from "./_lib/error-map";
import { checkMatchScores, matchScoreViolationMessage } from "@/lib/shared/match-format";
import { MatchFormatProvider } from "./_lib/match-format-context";
import { canForfeitTeam } from "./_lib/forfeit";
import { RulesHelpFab } from "@/components/rules/RulesHelpFab";
import { AdminScoreDialog } from "./_components/AdminScoreDialog";
import { GhostRegistrationDialog } from "./_components/GhostRegistrationDialog";
import { MatchLiveDialog } from "./_components/MatchLiveDialog";
import { MatchScheduleDialog } from "./_components/MatchScheduleDialog";
import { LiveProvider } from "./_lib/live-context";
import { IssueReportProvider } from "./_lib/issue-report-context";
import { IssueReportDialog } from "./_components/IssueReportDialog";
import { RegistrationsPanel } from "./_components/RegistrationsPanel";
import { BracketPreview } from "./_components/BracketPreview";
import { MatchScoreDraft } from "./_components/BracketTree";
import { BracketSections } from "./_components/BracketSections";
import { SurvivalView } from "./_components/SurvivalView";
import { PhaseTimeline } from "./_components/PhaseTimeline";
import { PhaseStandingsTable } from "./_components/PhaseStandingsTable";
import {
  defaultSelectedPhaseId,
  visibleRulesFormat,
} from "./_lib/phases";
import { SwissView } from "./_components/SwissView";
import { EnduranceView } from "./_components/EnduranceView";
import { MatchRow } from "./_components/MatchRow";
import { EntrantProvider } from "./_lib/entrant-link";
import { MatchAnchorProvider } from "./_lib/match-anchor-context";
import { useMatchAnchor } from "./_hooks/useMatchAnchor";
import { TournamentProgress } from "./_components/TournamentProgress";
import { DeleteTournamentDialog } from "./_components/DeleteTournamentDialog";
import { LaunchTournamentDialog } from "./_components/LaunchTournamentDialog";
import { TournamentHeader } from "./_components/TournamentHeader";

/** « Arbre » ne veut rien dire dans les formats à classement, qui n'en ont pas. */
const BOARD_TITLES: Record<TournamentFormat, string> = {
  SINGLE: "Arbre du tournoi",
  DOUBLE: "Arbre du tournoi",
  SWISS: "Classement et rondes",
  SURVIVAL: "Classement et rounds",
  MULTI: "Phases du tournoi",
  BG_SURVIE: "Endurance et manches",
};

export default function TournamentDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const tournamentId = Number(params.id);
  const { showError, showSuccess } = useToast();

  const { tournament: detail, refresh, isLive, tier, fatal } = useTournamentLive(tournamentId);
  const [drafts, setDrafts] = useState<MatchScoreDraft>({});
  // Même raison que les deux dialogues ci-dessous : on retient l'identifiant, pas
  // l'objet. Un match capturé à l'ouverture ne bougeait plus, si bien que le
  // dialogue continuait d'afficher « 0 – 0 » sur un match que le flux venait de
  // rapporter à 2-1 — et l'enregistrer écrasait la saisie de l'autre arbitre.
  const [selectedMatchForAdminId, setSelectedMatchForAdminId] = useState<number | null>(null);
  const [ghostRegistrationOpen, setGhostRegistrationOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [launchDialogOpen, setLaunchDialogOpen] = useState(false);
  // On retient l'**identifiant** du match en cours de configuration, pas l'objet :
  // la page se recharge par SSE, et un objet capturé à l'ouverture deviendrait
  // périmé — le dialogue rejouerait alors une configuration dépassée par-dessus
  // celle d'un autre membre du staff.
  const [matchForLiveId, setMatchForLiveId] = useState<number | null>(null);
  // Même raison que ci-dessus : on retient l'identifiant, pas l'objet.
  const [matchForScheduleId, setMatchForScheduleId] = useState<number | null>(null);
  // Stables pour la vie de la page : les `setState` de React le sont déjà. Sans
  // cela, deux flèches neuves à chaque rendu changeraient la valeur du contexte
  // de diffusion à chaque instantané SSE, et redessineraient les 127 bandeaux
  // d'un plateau à 128 équipes pour un score qui n'en concerne qu'un.
  const openAdminScore = useCallback((match: BracketMatch) => setSelectedMatchForAdminId(match.id), []);
  const openMatchLive = useCallback((match: BracketMatch) => setMatchForLiveId(match.id), []);
  const openMatchSchedule = useCallback(
    (match: BracketMatch) => setMatchForScheduleId(match.id),
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
  useEffect(() => setLaunchDialogOpen(false), [tournamentId]);
  useEffect(() => setIssueTarget(undefined), [tournamentId]);

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

  // Échec définitif avant même d'avoir reçu quoi que ce soit : sans ce cas, la
  // page resterait sur « Chargement… » pour toujours — le seul état où il ne
  // reste que le F5, et où il ne sert à rien.
  if (fatal && !detail) {
    return (
      <section className="ds-block" style={{ color: "var(--text-2)" }} role="alert">
        <h1 className="ds-title green" style={{ fontSize: 24, marginBottom: 12 }}>
          {fatal === "UNAUTHORIZED" ? "Session expirée" : "Tournoi introuvable"}
        </h1>
        <p style={{ margin: "0 0 20px", lineHeight: 1.6 }}>
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

  if (!detail) {
    // Le premier affichage attend l'ouverture du flux, qui apporte le plateau
    // et le contexte du lecteur d'un seul coup. `aria-busy` annonce l'attente
    // aux lecteurs d'écran plutôt que de leur laisser une page muette.
    return (
      <section
        className="ds-block"
        style={{ color: "var(--text-2)" }}
        role="status"
        aria-busy="true"
      >
        Chargement du tournoi…
      </section>
    );
  }

  /**
   * Le suivi est arrêté : ce qui est affiché ne bouge plus. On retire donc les
   * actions plutôt que de les laisser échouer une par une — une équipe qui
   * saisit son score en fin de manche n'a aucun moyen de deviner que son
   * plateau date de plusieurs minutes.
   */
  const frozen = fatal !== null;

  // Vocabulaire de l'affichage : un tournoi individuel parle de joueurs, pas
  // d'équipes (`lib/shared/participants.ts`).
  const wording = participantWording(detail.card.participantType);

  const handleScoreChange = (matchId: number, field: "myScore" | "opponentScore", value: string) => {
    setDrafts((prev) => ({
      ...prev,
      [matchId]: { ...prev[matchId], [field]: value },
    }));
  };

  const canReport = (match: BracketMatch): boolean => {
    if (frozen) return false;
    if (!detail?.myTeamId) return false;
    if (match.winnerTeamId !== null) return false;
    if (match.team1Id === null || match.team2Id === null) return false;
    return (
      detail.canCreateReportsForTeamIds.includes(detail.myTeamId) &&
      (detail.myTeamId === match.team1Id || detail.myTeamId === match.team2Id)
    );
  };

  const canAdminResolve = (match: BracketMatch): boolean => {
    if (frozen) return false;
    if (!detail?.isAdmin) return false;
    if (match.team1Id === null || match.team2Id === null) return false;
    return true;
  };

  const submitScore = async (match: BracketMatch, event: FormEvent) => {
    event.preventDefault();
    const draft = drafts[match.id] || { myScore: "", opponentScore: "" };

    // Contrôle local contre le format du tournoi : évite un aller-retour pour
    // un score que le serveur refusera de toute façon, et permet un message
    // chiffré (« le vainqueur doit atteindre 3 manches »).
    const violation = checkMatchScores(
      detail.card.matchFormat,
      Number(draft.myScore),
      Number(draft.opponentScore),
      { decisive: true },
    );
    if (violation) {
      showError(matchScoreViolationMessage(detail.card.matchFormat, violation));
      return;
    }

    try {
      const response = await fetch(`/api/tournaments/${tournamentId}/matches/${match.id}/report`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          myScore: Number(draft.myScore),
          opponentScore: Number(draft.opponentScore),
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "SCORE_SUBMIT_FAILED");
      showSuccess(`Score transmis pour le match #${match.id}.`);
      // Retour immédiat pour qui agit : le flux, lui, sert tout le monde à la
      // cadence de son palier.
      void refresh();
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[match.id];
        return next;
      });
    } catch (e) {
      showError(mapError((e as Error).message));
    }
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
      },
      teamId,
    );

  const forfeitTeam = async (teamId: number, teamName: string) => {
    const isMine = detail?.myTeamId === teamId;
    const confirmation = isMine
      ? wording.forfeitSelfConfirm
      : `Déclarer ${teamName} forfait pour tout le reste du tournoi ? ${wording.subject} quittera définitivement le tournoi. Pour un forfait sur une seule manche, passez par le score du match.`;
    if (!window.confirm(confirmation)) return;
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
    } catch (e) {
      showError(mapError((e as Error).message));
    }
  };

  const registerTeam = async () => {
    try {
      const response = await fetch(`/api/tournaments/${tournamentId}/register`, {
        method: "POST",
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "REGISTRATION_FAILED");
      showSuccess("Inscription validée.");
      void refresh();
    } catch (e) {
      showError(mapError((e as Error).message));
    }
  };

  const isMulti = detail.card.format === "MULTI";
  const selectedPhase =
    isMulti && selectedPhaseId && detail.phases
      ? detail.phases.find((p) => p.id === selectedPhaseId) || null
      : null;

  const visibleFormat = visibleRulesFormat(detail.card, selectedPhase);
  const contextLabel =
    isMulti && selectedPhase
      ? `Phase ${selectedPhase.position}${
          selectedPhase.name ? ` — ${selectedPhase.name}` : ""
        }`
      : undefined;

  const filteredMatches = isMulti && selectedPhase
    ? detail.matches.filter((m) => m.phaseId === selectedPhase.id)
    : detail.matches;

  const formatForBracket = isMulti && selectedPhase ? selectedPhase.format : detail.card.format;
  const hasThirdPlaceForPhase = isMulti && selectedPhase ? selectedPhase.hasThirdPlaceMatch : detail.card.hasThirdPlaceMatch;

  const bracketOrder: BracketType[] =
    formatForBracket === "SINGLE"
      ? hasThirdPlaceForPhase ? ["UPPER", "THIRD_PLACE"] : ["UPPER"]
      : ["UPPER", "LOWER", "GRAND"];
  const bracketLabels: Record<BracketType, string> = {
    UPPER: "Tableau principal",
    LOWER: "Tableau perdants",
    GRAND: "Grande Finale",
    THIRD_PLACE: "Petite Finale",
  };
  // Résolu à chaque rendu depuis la liste fraîche : le dialogue de diffusion
  // travaille toujours sur l'état courant du match, et se ferme de lui-même si
  // le match disparaît (plateau régénéré).
  const matchForAdminScore =
    selectedMatchForAdminId === null
      ? null
      : detail.matches.find((match) => match.id === selectedMatchForAdminId) ?? null;
  const matchForLive =
    matchForLiveId === null
      ? null
      : detail.matches.find((match) => match.id === matchForLiveId) ?? null;
  const matchForSchedule =
    matchForScheduleId === null
      ? null
      : detail.matches.find((match) => match.id === matchForScheduleId) ?? null;

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
  // d'avance, et pour un tournoi déjà lancé. Deux endroits l'affichent — pendant
  // les inscriptions et sur un tournoi encore sans match — d'où ce fragment
  // unique plutôt que deux copies à faire évoluer de front.
  const previewBlock = detail.preview ? (
    <div style={{ marginTop: 18 }}>
      <BracketPreview preview={detail.preview} canReorder={detail.isAdmin} />
    </div>
  ) : null;

  return (
    <EntrantProvider
      participantType={detail.card.participantType}
      soloUserIds={detail.soloUserIds}
    >
      <MatchAnchorProvider
        targetMatchId={targetMatchId}
        highlightedMatchId={highlightedMatchId}
      >
      <MatchFormatProvider format={detail.card.matchFormat}>
      <LiveProvider
        canManage={detail.canManageLive}
        canSchedule={detail.isAdmin}
        openConfig={openMatchLive}
        openSchedule={openMatchSchedule}
      >
      {/* Le bouton **par match** suit la règle de `frozen` : le plateau affiché
          ne bouge plus, et signaler « ce match » depuis une manche périmée
          désignerait la mauvaise. Celui de l'en-tête reste, lui, disponible —
          c'est justement quand le site décroche qu'il faut pouvoir joindre un
          arbitre. */}
      <IssueReportProvider
        canReport={detail.myTeamId !== null && !frozen}
        openReport={openIssueReport}
      >
      <RulesHelpFab format={visibleFormat} contextLabel={contextLabel} />
      <section className="fade-in">
        <TournamentHeader
          detail={detail}
          isLive={isLive}
          tier={tier}
          fatal={fatal}
          frozen={frozen}
          onBack={() => router.back()}
          onRegister={registerTeam}
          onReportIssue={() => openIssueReport(null)}
          onGuestRegister={() => setGhostRegistrationOpen(true)}
          onLaunchNow={() => setLaunchDialogOpen(true)}
          onLiveSaved={() => void refresh()}
        />

        <div className="ds-block" style={{ marginBottom: 20 }}>
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

          {detail.card.state === "REGISTRATION" ? (
            <>
              <p style={{ color: "var(--text-2)", margin: 0, fontSize: 14 }}>
                {formatForBracket === "SURVIVAL"
                  ? "Le classement de départ (seeding) et les rounds seront générés au démarrage du tournoi."
                  : detail.card.format === "BG_SURVIE"
                    ? "Le classement de départ est celui du seeding ci-dessous ; les manches d'endurance seront générées au démarrage du tournoi."
                  : detail.card.format === "SWISS"
                    ? "Le classement de départ (seeding) et la première ronde seront générés au démarrage du tournoi."
                    : "Le bracket sera généré automatiquement au démarrage du tournoi."}
              </p>
              {previewBlock}
            </>
          ) : formatForBracket === "SURVIVAL" && detail.survival ? (
            <>
              <SurvivalView
                survival={detail.survival}
                matches={filteredMatches}
                allTournamentMatches={detail.matches}
                myTeamId={detail.myTeamId}
                isFinished={detail.card.state === "FINISHED"}
                canReport={canReport}
                adminResolvable={canAdminResolve}
                drafts={drafts}
                onScoreChange={handleScoreChange}
                onSubmit={submitScore}
                onOpenAdminModal={openAdminScore}
                canForfeit={canForfeit}
                onForfeit={forfeitTeam}
                emptyLabel={noMatchesLabel}
              />
              {isMulti && selectedPhase?.state === "FINISHED" && detail.phaseStandings && detail.phaseStandings[selectedPhase.id] && (
                <div style={{ marginTop: 24 }}>
                  <div
                    style={{
                      fontSize: 11,
                      textTransform: "uppercase",
                      letterSpacing: "0.08em",
                      color: "var(--text-2)",
                      fontWeight: 600,
                      marginBottom: 10,
                    }}
                  >
                    Qualifiées
                  </div>
                  <PhaseStandingsTable standings={detail.phaseStandings[selectedPhase.id]} />
                </div>
              )}
            </>
          ) : detail.card.format === "BG_SURVIE" && detail.endurance ? (
            <EnduranceView
              endurance={detail.endurance}
              matches={detail.matches}
              isFinished={detail.card.state === "FINISHED"}
              myTeamId={detail.myTeamId}
              canForfeit={canForfeit}
              onForfeit={forfeitTeam}
              renderMatch={(match) => (
                <MatchRow
                  key={match.id}
                  match={match}
                  reportable={canReport(match)}
                  adminResolvable={canAdminResolve(match)}
                  onScoreChange={handleScoreChange}
                  myScore={drafts[match.id]?.myScore || ""}
                  opponentScore={drafts[match.id]?.opponentScore || ""}
                  onSubmit={submitScore}
                  onOpenAdminModal={openAdminScore}
                  allMatches={detail.matches}
                  roundNumber={match.roundNumber}
                  format="SURVIVAL"
                />
              )}
            />
          ) : detail.card.format === "SWISS" && detail.swiss ? (
            <SwissView
              swiss={detail.swiss}
              matches={detail.matches}
              allTournamentMatches={detail.matches}
              myTeamId={detail.myTeamId}
              isFinished={detail.card.state === "FINISHED"}
              canReport={canReport}
              adminResolvable={canAdminResolve}
              drafts={drafts}
              onScoreChange={handleScoreChange}
              onSubmit={submitScore}
              onOpenAdminModal={openAdminScore}
              canForfeit={canForfeit}
              onForfeit={forfeitTeam}
              emptyLabel={noMatchesLabel}
            />
          ) : formatForBracket === "SWISS" ? (
            <>
              {brackets.length > 0 ? (
                brackets.map(({ type, matches }) => (
                  <div key={type} style={{ marginBottom: type !== brackets[brackets.length - 1].type ? 32 : 0, minHeight: 0, overflow: "visible" }}>
                    <BracketSections
                      bracketType={type}
                      bracketLabel={bracketLabels[type]}
                      showBracketLabel={brackets.length > 1}
                      matches={matches}
                      allTournamentMatches={detail.matches}
                      myTeamId={detail.myTeamId}
                      canReport={canReport}
                      adminResolvable={canAdminResolve}
                      drafts={drafts}
                      onScoreChange={handleScoreChange}
                      onSubmit={submitScore}
                      onOpenAdminModal={openAdminScore}
                      format={formatForBracket}
                    />
                  </div>
                ))
              ) : (
                <p style={{ color: "var(--text-2)", margin: 0, fontSize: 14 }}>
                  {noMatchesLabel}
                </p>
              )}
              {isMulti && selectedPhase?.state === "FINISHED" && detail.phaseStandings && detail.phaseStandings[selectedPhase.id] && (
                <div style={{ marginTop: 24 }}>
                  <div
                    style={{
                      fontSize: 11,
                      textTransform: "uppercase",
                      letterSpacing: "0.08em",
                      color: "var(--text-2)",
                      fontWeight: 600,
                      marginBottom: 10,
                    }}
                  >
                    Classement
                  </div>
                  <PhaseStandingsTable standings={detail.phaseStandings[selectedPhase.id]} />
                </div>
              )}
            </>
          ) : !filteredMatches.length ? (
            <>
              <p style={{ color: "var(--text-2)", margin: 0, fontSize: 14 }}>
                {noMatchesLabel}
              </p>
              {previewBlock}
            </>
          ) : (
            <>
              {brackets.map(({ type, matches }) => (
                <div key={type} style={{ marginBottom: type !== brackets[brackets.length - 1].type ? 32 : 0, minHeight: 0, overflow: "visible" }}>
                  <BracketSections
                    bracketType={type}
                    bracketLabel={bracketLabels[type]}
                    showBracketLabel={brackets.length > 1}
                    matches={matches}
                    allTournamentMatches={detail.matches}
                    myTeamId={detail.myTeamId}
                    canReport={canReport}
                    adminResolvable={canAdminResolve}
                    drafts={drafts}
                    onScoreChange={handleScoreChange}
                    onSubmit={submitScore}
                    onOpenAdminModal={openAdminScore}
                    format={formatForBracket}
                  />
                </div>
              ))}
              {isMulti && selectedPhase?.state === "FINISHED" && detail.phaseStandings && detail.phaseStandings[selectedPhase.id] && (
                <div style={{ marginTop: 24 }}>
                  <div
                    style={{
                      fontSize: 11,
                      textTransform: "uppercase",
                      letterSpacing: "0.08em",
                      color: "var(--text-2)",
                      fontWeight: 600,
                      marginBottom: 10,
                    }}
                  >
                    Qualifiées
                  </div>
                  <PhaseStandingsTable standings={detail.phaseStandings[selectedPhase.id]} />
                </div>
              )}
            </>
          )}
        </div>

        <RegistrationsPanel
          detail={detail}
          canReorder={!frozen}
          onReordered={() => void refresh()}
        />

        <TournamentProgress detail={detail} />

        {/* Zone de danger : réservée aux administrateurs stricts (`canDelete`),
            et volontairement isolée en bas de page, loin des actions courantes.
            Retirée comme les autres actions quand le suivi est arrêté. */}
        {detail.canDelete && !frozen && (
          <div
            className="ds-block"
            style={{
              marginTop: 24,
              border: "1px solid color-mix(in srgb, var(--red-live, #ff4d4d) 45%, transparent)",
              borderRadius: "var(--r-cy-md, 12px)",
              padding: 18,
            }}
          >
            <div className="ds-section-title">
              <h2 style={{ color: "var(--red-live, #ff4d4d)" }}>Zone de danger</h2>
            </div>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 16,
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <p style={{ margin: 0, fontSize: 13, color: "var(--text-2, #9aa4b2)", maxWidth: 560, lineHeight: 1.55 }}>
                Supprimer ce tournoi l&apos;efface du site pour de bon, avec ses matchs, ses
                inscriptions et ses classements. Les équipes et les joueurs, eux, sont conservés.
              </p>
              <CyberButton
                variant="ghost"
                onClick={() => setDeleteDialogOpen(true)}
                style={{
                  fontSize: 13,
                  padding: "8px 18px",
                  borderColor: "var(--red-live, #ff4d4d)",
                  color: "var(--red-live, #ff4d4d)",
                }}
              >
                Supprimer le tournoi
              </CyberButton>
            </div>
          </div>
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
          onClose={() => setMatchForScheduleId(null)}
          onSaved={() => void refresh()}
        />
      )}

      {launchDialogOpen && detail.isAdmin && !frozen && (
        <LaunchTournamentDialog
          card={detail.card}
          onClose={() => setLaunchDialogOpen(false)}
          onLaunched={({ state, entrantCount }) => {
            setLaunchDialogOpen(false);
            // Deux issues, deux messages : le moteur clôt sur-le-champ un
            // plateau de moins de deux engagés, et annoncer « tournoi lancé »
            // devant une fiche déjà terminée serait un démenti immédiat.
            showSuccess(
              state === "FINISHED"
                ? "Tournoi clos : il n'y avait pas assez d'engagés pour jouer un match."
                : `Tournoi lancé avec ${entrantCount} engagés.`,
            );
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
      </IssueReportProvider>
      </LiveProvider>
      </MatchFormatProvider>
      </MatchAnchorProvider>
    </EntrantProvider>
  );
}
