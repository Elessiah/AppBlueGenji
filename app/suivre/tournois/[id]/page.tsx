"use client";

import { useParams } from "next/navigation";
import { TournamentSheet } from "@/app/(secured)/tournois/[id]/_components/TournamentSheet";
import { useSpectatorTournament } from "./_hooks/useSpectatorTournament";

/**
 * Fiche d'un tournoi sans compte : la fiche commune (`TournamentSheet`), nourrie
 * par la lecture publique à cadence réglée par le serveur
 * (`docs/features/SPECTATOR_VIEW.md`).
 */
export default function SpectatorTournamentPage() {
  const params = useParams<{ id: string }>();
  const tournamentId = Number(params.id);
  const source = useSpectatorTournament(tournamentId);
  return <TournamentSheet tournamentId={tournamentId} source={source} />;
}
