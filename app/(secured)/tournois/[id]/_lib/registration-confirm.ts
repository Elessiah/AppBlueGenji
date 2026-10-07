import type { TournamentCard } from "@/lib/shared/types";
import { toParticipantType } from "@/lib/shared/participants";
import type { TournamentActionsText } from "@/lib/shared/tournament-actions-text";
import { FR_ACTIONS_TEXT } from "./actions-text";

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
  text: TournamentActionsText = FR_ACTIONS_TEXT,
): RegistrationConfirmText {
  const { t } = text;
  const type = toParticipantType(card.participantType);
  return {
    title: t(`register.confirm.${type}.title`, { name: card.name }),
    body: [
      t("register.confirm.kickoff", { date: formattedStartAt }),
      t(`register.confirm.${type}.final`),
      t(`register.streamNotice.${type}`),
    ],
    confirmLabel: t(`wording.${type}.registerCta`),
    pendingLabel: t("register.confirm.pending"),
  };
}
