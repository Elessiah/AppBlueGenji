"use client";

import { useParams } from "next/navigation";
import { useTournamentLive } from "../../_hooks/useTournamentLive";
import { TournamentSheet } from "../../_components/TournamentSheet";

/**
 * Page d'un match, espace connecté (`docs/features/MATCH_PAGE.md`) : la fiche
 * du tournoi, nourrie par le même flux temps réel, rendue sur ce seul match.
 */
export default function MatchDetailPage() {
  const params = useParams<{ id: string; matchId: string }>();
  const tournamentId = Number(params.id);
  const live = useTournamentLive(tournamentId);
  return <TournamentSheet tournamentId={tournamentId} source={live} matchId={Number(params.matchId)} />;
}
