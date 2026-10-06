/**
 * Textes du recrutement (`/recrutement`, `/en/recrutement`, mise en avant sur
 * tout le site), espace de messages `recruitment` — lot 5b
 * (`docs/features/I18N.md` § Association, bénévoles, recrutement).
 *
 * Même mécanique que la connexion (`login-text.ts`) : **pas** de `next-intl`
 * dans le navigateur. Les composants client lisent {@link RECRUITMENT_CLIENT_NAMESPACES}
 * par `useRecruitmentText()` ; le français est inclus dans le paquet (il
 * remplace les chaînes écrites en dur), l'anglais ne voyage que sous `/en`,
 * passé au fournisseur par la page ou la mise en page racine.
 *
 * Les tables françaises partagées (`RECRUITMENT_DOMAIN_LABELS`, lue aussi par
 * l'éditeur du staff) restent en place ; un test vérifie que les messages
 * français les égalent.
 */
import frRecruitment from "@/messages/fr/recruitment.json";
import { DEFAULT_LOCALE, type Locale } from "@/lib/shared/locales";
import { scopedText, type Leaves, type ScopedText } from "@/lib/shared/scoped-text";

export type RecruitmentMessages = typeof frRecruitment;

/** Ce que lisent les composants client : tout sauf les métadonnées et l'en-tête de la page. */
export const RECRUITMENT_CLIENT_NAMESPACES = ["section", "card", "detail", "contact", "domains", "highlight"] as const;
export type RecruitmentClientNamespace = (typeof RECRUITMENT_CLIENT_NAMESPACES)[number];
export type RecruitmentClientMessages = Pick<RecruitmentMessages, RecruitmentClientNamespace>;
export type RecruitmentText = ScopedText<Leaves<RecruitmentClientMessages>>;

export const FR_RECRUITMENT_MESSAGES: RecruitmentMessages = frRecruitment;

export function recruitmentClientMessages(messages: RecruitmentMessages): RecruitmentClientMessages {
  const picked = {} as Record<RecruitmentClientNamespace, unknown>;
  for (const namespace of RECRUITMENT_CLIENT_NAMESPACES) picked[namespace] = messages[namespace];
  return picked as RecruitmentClientMessages;
}

/** Formateur des composants du recrutement ; le français du paquet par défaut. */
export function recruitmentText(
  locale: Locale = DEFAULT_LOCALE,
  messages: RecruitmentClientMessages = FR_RECRUITMENT_MESSAGES,
): RecruitmentText {
  return scopedText(locale, messages);
}

/** Français, construit une fois : rendu par défaut hors fournisseur. */
export const FR_RECRUITMENT_TEXT: RecruitmentText = recruitmentText();
