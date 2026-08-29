"use client";

import { FormEvent, useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { formatLocalDateTime } from "@/lib/shared/dates";
import type { BracketMatch, BracketType, TournamentFormat } from "@/lib/shared/types";
import { entrantHref, participantWording } from "@/lib/shared/participants";
import { useToast } from "@/components/ui/toast";
import { Pill, CyberButton } from "@/components/cyber";
import { useTournamentLive } from "./_hooks/useTournamentLive";
import { mapError } from "./_lib/error-map";
import {
  checkMatchScores,
  matchFormatLabel,
  matchScoreViolationMessage,
} from "@/lib/shared/match-format";
import { MatchFormatProvider } from "./_lib/match-format-context";
import { canForfeitTeam } from "./_lib/forfeit";
import { canShowEditButton } from "./_lib/edit-entry";
import { RulesHelpFab } from "@/components/rules/RulesHelpFab";
import { AdminScoreDialog } from "./_components/AdminScoreDialog";
import { LiveIndicator } from "./_components/LiveIndicator";
import { GhostRegistrationDialog } from "./_components/GhostRegistrationDialog";
import { MatchLiveDialog } from "./_components/MatchLiveDialog";
import { TournamentLiveLink } from "./_components/TournamentLiveLink";
import { LiveProvider } from "./_lib/live-context";
import { SeedingEditor } from "./_components/SeedingEditor";
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
import { TournamentProgress } from "./_components/TournamentProgress";

const FORMAT_LABELS: Record<TournamentFormat, string> = {
  SINGLE: "Simple élim.",
  DOUBLE: "Double élim.",
  SWISS: "Ronde suisse",
  SURVIVAL: "Survie",
  MULTI: "Multi-phases",
  BG_SURVIE: "BlueGenji Survie",
};

/** « Arbre » ne veut rien dire dans les formats à classement, qui n'en ont pas. */
const BOARD_TITLES: Record<TournamentFormat, string> = {
  SINGLE: "Arbre du tournoi",
  DOUBLE: "Arbre du tournoi",
  SWISS: "Classement et rondes",
  SURVIVAL: "Classement et rounds",
  MULTI: "Phases du tournoi",
  BG_SURVIE: "Endurance et manches",
};

const STATE_META: Record<string, { label: string; chipClass: string }> = {
  UPCOMING: { label: "Prochainement", chipClass: "teal" },
  REGISTRATION: { label: "Inscriptions", chipClass: "green" },
  RUNNING: { label: "En cours", chipClass: "lime" },
  FINISHED: { label: "Terminé", chipClass: "muted" },
};

export default function TournamentDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const tournamentId = Number(params.id);
  const { showError, showSuccess } = useToast();

  const { tournament: detail, refresh, isLive, tier, fatal } = useTournamentLive(tournamentId);
  const [drafts, setDrafts] = useState<MatchScoreDraft>({});
  const [selectedMatchForAdmin, setSelectedMatchForAdmin] = useState<BracketMatch | null>(null);
  const [ghostRegistrationOpen, setGhostRegistrationOpen] = useState(false);
  // On retient l'**identifiant** du match en cours de configuration, pas l'objet :
  // la page se recharge par SSE, et un objet capturé à l'ouverture deviendrait
  // périmé — le dialogue rejouerait alors une configuration dépassée par-dessus
  // celle d'un autre membre du staff.
  const [matchForLiveId, setMatchForLiveId] = useState<number | null>(null);
  const [selectedPhaseId, setSelectedPhaseId] = useState<number | null>(null);

  // Dernière phase courante observée. On ne resynchronise la sélection que
  // lorsqu'elle change RÉELLEMENT (une phase vient de démarrer) : comparer
  // directement à `selectedPhaseId` ramènerait l'affichage sur la phase en cours
  // à chaque clic, rendant impossible la consultation d'une phase terminée.
  const lastCurrentPhaseId = useRef<number | null>(null);

  useEffect(() => {
    if (!detail?.phases) return;

    const current = detail.currentPhaseId ?? null;

    if (selectedPhaseId === null) {
      setSelectedPhaseId(defaultSelectedPhaseId(detail.phases, current));
    } else if (current !== null && current !== lastCurrentPhaseId.current) {
      setSelectedPhaseId(current);
    }

    lastCurrentPhaseId.current = current;
  }, [detail?.phases, detail?.currentPhaseId, selectedPhaseId]);

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
            : "Ce tournoi n'existe plus. Il a pu être supprimé pendant que tu le consultais."}
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
      : `Déclarer l'abandon de ${teamName} ? ${wording.subject} quittera définitivement le tournoi.`;
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

  const stateMeta = STATE_META[detail.card.state] ?? { label: detail.card.state, chipClass: "muted" };

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
  const matchForLive =
    matchForLiveId === null
      ? null
      : detail.matches.find((match) => match.id === matchForLiveId) ?? null;

  const brackets = bracketOrder
    .map((b) => ({ type: b, matches: filteredMatches.filter((m) => m.bracket === b) }))
    .filter((b) => b.matches.length > 0);

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
      <MatchFormatProvider format={detail.card.matchFormat}>
      <LiveProvider canManage={detail.canManageLive} openConfig={(match) => setMatchForLiveId(match.id)}>
      <RulesHelpFab format={visibleFormat} contextLabel={contextLabel} />
      <section className="fade-in">
        <div className="ds-header green">
          <div className="ds-header-body">
            <button
              onClick={() => router.back()}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                background: "none",
                border: "none",
                color: "rgba(79,224,162,0.7)",
                cursor: "pointer",
                fontSize: 14,
                marginBottom: 12,
                padding: 0,
                fontWeight: 500,
                transition: "color 0.2s",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "rgba(79,224,162,1)")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(79,224,162,0.7)")}
            >
              ← Retour
            </button>
            <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
              <h1 className="ds-title green" style={{ fontSize: "clamp(26px, 3vw, 42px)", marginBottom: 8 }}>
                {detail.card.name}
              </h1>
              {canShowEditButton(detail.card, detail.isAdmin) && (
                <CyberButton asChild variant="ghost" style={{ fontSize: 13, padding: "6px 16px" }}>
                  <Link href={`/tournois/${detail.card.id}/modifier`}>Modifier</Link>
                </CyberButton>
              )}
            </div>
            {detail.card.description && (
              <p style={{ color: "var(--text-1)", margin: "0 0 20px", fontSize: 15, lineHeight: 1.6 }}>
                {detail.card.description}
              </p>
            )}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              {/* Dit que la page se tient à jour seule : sans ce repère, on
                  recharge par précaution même quand tout arrive tout seul. */}
              <LiveIndicator isLive={isLive} tier={tier} fatal={fatal} />
              <Pill variant="blue">{detail.card.game}</Pill>
              <Pill variant={detail.card.state === "RUNNING" ? "live" : "blue"}>
                {stateMeta.label}
              </Pill>
              <Pill variant="blue">
                {detail.card.format === "SINGLE"
                  ? "Simple élim."
                  : detail.card.format === "SURVIVAL"
                    ? "Survie"
                    : detail.card.format === "SWISS"
                      ? "Suisse"
                      : detail.card.format === "MULTI"
                        ? "Multi-phases"
                        : "Double élim."}
              </Pill>
              {detail.card.format === "MULTI" && detail.card.state === "RUNNING" && detail.phases && (
                <Pill variant="blue">
                  Phase {detail.phases.findIndex((p) => p.id === detail.currentPhaseId) + 1}/{detail.phases.length}
                </Pill>
              )}
              <Pill variant="blue">{FORMAT_LABELS[detail.card.format]}</Pill>
              {wording.badge && <Pill variant="blue">{wording.badge}</Pill>}
              {detail.card.matchFormat && (
                <Pill variant="blue">{matchFormatLabel(detail.card.matchFormat)}</Pill>
              )}
              {detail.card.hasThirdPlaceMatch && (
                <Pill variant="blue">Petite finale</Pill>
              )}
              <Pill variant="blue">{detail.card.registeredTeams}/{detail.card.maxTeams}</Pill>
              {detail.isAdmin && !frozen && (
                <Pill variant="blue">⚙ Admin</Pill>
              )}
              {detail.canRegister && !frozen && (
                <CyberButton
                  variant="primary"
                  onClick={registerTeam}
                  style={{ fontSize: 13, padding: "6px 16px" }}
                >
                  {wording.registerCta}
                </CyberButton>
              )}
              {detail.isAdmin && !frozen && detail.card.state === "REGISTRATION" && (
                <CyberButton
                  variant="ghost"
                  onClick={() => setGhostRegistrationOpen(true)}
                  style={{ fontSize: 13, padding: "6px 16px" }}
                >
                  {wording.guestCta}
                </CyberButton>
              )}
            </div>

            {/* Chaîne officielle : antenne permanente du tournoi, distincte de
                l'état « en direct » qui, lui, se joue au niveau des matchs. */}
            <TournamentLiveLink
              tournamentId={tournamentId}
              liveUrl={detail.card.liveUrl}
              canEdit={detail.isAdmin}
              onSaved={() => void refresh()}
            />
          </div>
        </div>

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
                onOpenAdminModal={setSelectedMatchForAdmin}
                canForfeit={canForfeit}
                onForfeit={forfeitTeam}
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
                  onOpenAdminModal={setSelectedMatchForAdmin}
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
              onOpenAdminModal={setSelectedMatchForAdmin}
              canForfeit={canForfeit}
              onForfeit={forfeitTeam}
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
                      onOpenAdminModal={setSelectedMatchForAdmin}
                      format={formatForBracket}
                    />
                  </div>
                ))
              ) : (
                <p style={{ color: "var(--text-2)", margin: 0, fontSize: 14 }}>
                  Aucun match disponible pour l&apos;instant.
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
                Aucun match disponible pour l&apos;instant.
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
                    onOpenAdminModal={setSelectedMatchForAdmin}
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

        {detail.isAdmin && !frozen && (
          <SeedingEditor tournamentId={tournamentId} onReordered={() => void refresh()} />
        )}

        <div className="ds-block">
          <div className="ds-section-title green">
            <h2>Inscriptions</h2>
          </div>
          <div className="table-like">
            <div className="table-row table-header">
              <span>{wording.oneCapitalized}</span>
              <span>Seed</span>
              <span>Inscription</span>
              <span>Classement final</span>
            </div>
            {detail.registrations.map((reg) => (
              <div key={reg.teamId} className="table-row">
                <Link
                  href={entrantHref(reg.teamId, detail.soloUserIds)}
                  style={{ color: "inherit", textDecoration: "none" }}
                >
                  {reg.teamName}
                </Link>
                <span>{reg.seed ?? "-"}</span>
                <span>{formatLocalDateTime(reg.registeredAt)}</span>
                <span>{reg.finalRank ?? "-"}</span>
              </div>
            ))}
          </div>
        </div>

        <TournamentProgress detail={detail} />
      </section>

      <AdminScoreDialog
        match={selectedMatchForAdmin}
        open={!!selectedMatchForAdmin}
        onClose={() => setSelectedMatchForAdmin(null)}
        onSubmitted={() => {
          setSelectedMatchForAdmin(null);
          void refresh();
        }}
      />

      {matchForLive && (
        <MatchLiveDialog
          key={matchForLive.id}
          match={matchForLive}
          onClose={() => setMatchForLiveId(null)}
          onSaved={() => void refresh()}
        />
      )}

      {ghostRegistrationOpen && (
        <GhostRegistrationDialog
          tournamentId={tournamentId}
          onClose={() => setGhostRegistrationOpen(false)}
          onRegistered={() => void refresh()}
        />
      )}
      </LiveProvider>
      </MatchFormatProvider>
    </EntrantProvider>
  );
}
