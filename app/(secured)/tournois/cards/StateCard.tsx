"use client";

import type { TournamentCard } from "@/lib/shared/types";
import { CARD_IMAGE_SIZES } from "./card-image";
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
 *
 * Volontairement **pas** sous `memo` : `UpcomingCard` juge son visage (« à venir »
 * ou « inscriptions closes ») à l'heure du rendu, et ne le redessinerait pas si
 * ce composant filtrait les rendus du parent. Les cartes dessinées dessous sont,
 * elles, déjà sous `memo`.
 */
export function StateCard({ t, priority }: Readonly<StateCardProps>) {
  // Ces cartes vivent dans la grille à trois colonnes des sections « Mes
  // tournois » et « invisibles », même en cours (pas dans la section « En cours »).
  if (t.state === "RUNNING") return <RunningCard t={t} priority={priority} imageSizes={CARD_IMAGE_SIZES} />;
  if (t.state === "REGISTRATION") return <RegistrationCard t={t} priority={priority} />;
  if (t.state === "FINISHED") return <FinishedCard t={t} priority={priority} />;
  return <UpcomingCard t={t} priority={priority} />;
}
