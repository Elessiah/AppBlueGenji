"use client";

import { useParams } from "next/navigation";
import { TournamentSheet } from "@/app/(secured)/tournois/[id]/_components/TournamentSheet";
import { useSpectatorTournament } from "../../_hooks/useSpectatorTournament";

/**
 * Page d'un match sans compte (`docs/features/MATCH_PAGE.md`) : la fiche du
 * tournoi, nourrie par la lecture publique, rendue sur ce seul match.
 */
export default function SpectatorMatchPage() {
  const params = useParams<{ id: string; matchId: string }>();
  const tournamentId = Number(params.id);
  const source = useSpectatorTournament(tournamentId);
  return <TournamentSheet tournamentId={tournamentId} source={source} matchId={Number(params.matchId)} />;
}
