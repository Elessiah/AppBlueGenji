"use client";

import frPush from "@/messages/fr/push.json";
import { withFrenchFallback } from "@/components/i18n/scoped-text-context";
import type { PushSupport, PushTopic } from "@/lib/shared/push-notifications";
import type { Leaves, ScopedText } from "@/lib/shared/scoped-text";
import { pushTextSlot } from "./push-text-provider";

/**
 * Textes du réglage des notifications push (espace `push`, lot 9-2).
 *
 * Le panneau sert `/profil` et la fenêtre de lancement d'un match (chargée à
 * la demande, sur toutes les pages d'un compte connecté) : son français voyage
 * avec lui ; l'anglais n'arrive que sous `/en`, posé par le fournisseur de
 * `push-text-provider.tsx` (mise en page de `/profil`, fenêtre de lancement) —
 * jamais dans le JavaScript d'une page française. Les libellés des sujets restent aussi dans `PUSH_TOPICS` (registre,
 * français) ; le français de ce fichier les égale (testé).
 */
export type PushText = ScopedText<Leaves<typeof frPush>>;

const context = withFrenchFallback(pushTextSlot, frPush);

export const FR_PUSH_TEXT: PushText = context.fr;

/** Le texte posé par le fournisseur, le français à défaut. */
export function usePushText(): PushText {
  return context.useText();
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
