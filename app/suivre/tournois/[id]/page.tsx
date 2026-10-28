"use client";

import { useParams } from "next/navigation";
import { TournamentSheet } from "@/app/(secured)/tournois/[id]/_components/TournamentSheet";
import { parseTournamentId } from "@/lib/shared/spectator-view";
import { useSpectatorTournament } from "./_hooks/useSpectatorTournament";

/**
 * Fiche d'un tournoi sans compte : la fiche commune (`TournamentSheet`), nourrie
 * par la lecture publique à cadence réglée par le serveur
 * (`docs/features/SPECTATOR_VIEW.md`).
 */
export default function SpectatorTournamentPage() {
  const params = useParams<{ id: string }>();
  // La règle de la mise en page, qui a déjà refusé un identifiant illisible
  // (`notFound`) : elle ne vit qu'à un endroit (`parseTournamentId`).
  const tournamentId = parseTournamentId(params.id) ?? 0;
  const source = useSpectatorTournament(tournamentId);
  return <TournamentSheet tournamentId={tournamentId} source={source} />;
}
