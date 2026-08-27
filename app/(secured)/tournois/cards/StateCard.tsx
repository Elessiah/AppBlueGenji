"use client";

import type { TournamentCard } from "@/lib/shared/types";
import { RunningCard } from "./RunningCard";
import { RegistrationCard } from "./RegistrationCard";
import { UpcomingCard } from "./UpcomingCard";
import { FinishedCard } from "./FinishedCard";

interface StateCardProps {
  t: TournamentCard;
}

/**
 * Rend la carte correspondant à l'état du tournoi.
 *
 * Les sections de la page choisissent déjà leur carte, puisqu'elles ne
 * contiennent qu'un seul état. La section « non visibles » de l'onglet « Mes
 * tournois », elle, regroupe des tournois de n'importe quel état : c'est le
 * seul endroit qui a besoin d'aiguiller.
 */
export function StateCard({ t }: StateCardProps) {
  if (t.state === "RUNNING") return <RunningCard t={t} />;
  if (t.state === "REGISTRATION") return <RegistrationCard t={t} />;
  if (t.state === "FINISHED") return <FinishedCard t={t} />;
  return <UpcomingCard t={t} />;
}
