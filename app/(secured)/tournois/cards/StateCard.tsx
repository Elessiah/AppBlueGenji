"use client";

import type { TournamentCard } from "@/lib/shared/types";
import { RunningCard } from "./RunningCard";
import { RegistrationCard } from "./RegistrationCard";
import { UpcomingCard } from "./UpcomingCard";
import { FinishedCard } from "./FinishedCard";

interface StateCardProps {
  t: TournamentCard;
  priority?: boolean;
}

/**
 * Rend la carte correspondant à l'état du tournoi.
 *
 * Les sections de la page choisissent déjà leur carte, puisqu'elles ne
 * contiennent qu'un seul état. La section « tournois invisibles », elle,
 * regroupe des tournois de n'importe quel état : c'est le seul endroit qui a
 * besoin d'aiguiller.
 */
export function StateCard({ t, priority }: StateCardProps) {
  if (t.state === "RUNNING") return <RunningCard t={t} priority={priority} />;
  if (t.state === "REGISTRATION") return <RegistrationCard t={t} priority={priority} />;
  if (t.state === "FINISHED") return <FinishedCard t={t} priority={priority} />;
  return <UpcomingCard t={t} priority={priority} />;
}
