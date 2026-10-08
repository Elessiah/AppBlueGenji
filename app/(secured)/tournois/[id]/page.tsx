"use client";

import { useParams } from "next/navigation";
import { useTournamentLive } from "./_hooks/useTournamentLive";
import { TournamentSheet } from "./_components/TournamentSheet";

/**
 * Fiche d'un tournoi, espace connecté : la fiche commune (`TournamentSheet`),
 * nourrie par le flux temps réel. Un visiteur sans compte n'arrive jamais ici —
 * l'espace sécurisé le renvoie vers `/suivre/tournois/[id]`
 * (`docs/features/SPECTATOR_VIEW.md`).
 */
export default function TournamentDetailPage() {
  const params = useParams<{ id: string }>();
  const tournamentId = Number(params.id);
  const live = useTournamentLive(tournamentId);
  return <TournamentSheet tournamentId={tournamentId} source={live} />;
}
