import type { TournamentCard } from "@/lib/shared/types";
import { registrationStreamNotice } from "@/lib/shared/stream-notice";

/**
 * Texte de la confirmation d'inscription à un tournoi.
 *
 * « Inscrire mon équipe » engageait l'équipe au premier appui, alors qu'aucun
 * joueur ne peut ensuite se désinscrire — seul le staff retire un engagé
 * (`lib/shared/entrant-removal.ts`). Sur téléphone, un appui accidentel en
 * faisant défiler la fiche suffisait. La confirmation récapitule donc ce qu'on
 * engage (le tournoi, son coup d'envoi) et dit que le geste ne se défait pas
 * seul. Elle informe aussi de la retransmission possible des matchs
 * (`lib/shared/stream-notice.ts`) : c'est le moment où le joueur s'engage.
 *
 * Pur : la date arrive déjà mise en forme, sa présentation dépend du fuseau du
 * lecteur (`formatLocalDateTime`, côté interface).
 */
export interface RegistrationConfirmText {
  title: string;
  body: string[];
  confirmLabel: string;
  pendingLabel: string;
}

export function registrationConfirmText(
  card: Pick<TournamentCard, "name" | "participantType">,
  formattedStartAt: string,
): RegistrationConfirmText {
  if (card.participantType === "SOLO") {
    return {
      title: `T'inscrire à « ${card.name} » ?`,
      body: [
        `Coup d'envoi : ${formattedStartAt}.`,
        "Tu ne pourras pas annuler toi-même cette inscription : seul le staff du tournoi peut retirer un engagé.",
        registrationStreamNotice(true),
      ],
      confirmLabel: "M'inscrire",
      pendingLabel: "Inscription…",
    };
  }
  return {
    title: `Inscrire ton équipe à « ${card.name} » ?`,
    body: [
      `Coup d'envoi : ${formattedStartAt}.`,
      "Toute l'équipe sera engagée. Elle ne pourra pas se désinscrire elle-même : seul le staff du tournoi peut retirer un engagé.",
      registrationStreamNotice(false),
    ],
    confirmLabel: "Inscrire mon équipe",
    pendingLabel: "Inscription…",
  };
}
