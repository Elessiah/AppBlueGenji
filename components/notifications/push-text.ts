"use client";

import enPush from "@/messages/en/push.json";
import frPush from "@/messages/fr/push.json";
import { useAppLocale } from "@/components/i18n/locale-context";
import type { Locale } from "@/lib/shared/locales";
import type { PushSupport, PushTopic } from "@/lib/shared/push-notifications";
import { scopedText, type Leaves, type ScopedText } from "@/lib/shared/scoped-text";

/**
 * Textes du réglage des notifications push (espace `push`, lot 9-2).
 *
 * Le panneau sert `/profil` et la fenêtre de lancement d'un match (chargée à
 * la demande, sur toutes les pages d'un compte connecté) : ses deux langues
 * voyagent avec lui — quelques centaines d'octets — plutôt que par une mise en
 * page. Les libellés des sujets restent aussi dans `PUSH_TOPICS` (registre,
 * français) ; le français de ce fichier les égale (testé).
 */
export type PushText = ScopedText<Leaves<typeof frPush>>;

export const FR_PUSH_TEXT: PushText = scopedText("fr", frPush);
const EN_PUSH_TEXT: PushText = scopedText("en", enPush);

export function pushText(locale: Locale): PushText {
  return locale === "en" ? EN_PUSH_TEXT : FR_PUSH_TEXT;
}

/** Le texte dans une langue imposée (`"fr"` pour un écran resté français), sinon celle de la page. */
export function usePushText(lang?: string): PushText {
  const locale = useAppLocale();
  return pushText(lang === "fr" ? "fr" : locale);
}

/** `pushErrorMessage` dans la langue du texte : jamais le jeton. */
export function pushErrorText(text: PushText, code: string | null | undefined): string {
  if (!code || code === "fallback" || !Object.hasOwn(frPush.errors, code)) return text.t("errors.fallback");
  return text.t(`errors.${code}` as Leaves<typeof frPush>);
}

export function pushTopicLabel(text: PushText, topic: PushTopic): string {
  return text.t(`topics.${topic}.label`);
}

export function pushTopicDescription(text: PushText, topic: PushTopic): string {
  return text.t(`topics.${topic}.description`);
}

export function pushSupportNotice(text: PushText, support: Exclude<PushSupport, "AVAILABLE">): string {
  return text.t(`support.${support}`);
}
