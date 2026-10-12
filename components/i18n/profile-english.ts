"use client";

import { preloadMissing } from "@/lib/shared/lazy-component";
import type { Messages } from "@/lib/shared/i18n-messages";
import type { Locale } from "@/lib/shared/locales";
import { englishProfile, englishPush, englishTeamErrors } from "./english-loaders-account";

/** L'anglais de `/profil` : ses trois espaces. */
export type ProfileEnglishMessages = Pick<Messages, "profile" | "teamErrors" | "push">;

const preloadProfile = /* @__PURE__ */ preloadMissing([englishProfile, englishTeamErrors, englishPush]);

/**
 * Précharge l'anglais de `/profil` (survol ou focus du lien « My profile ») :
 * il arrive avec la réponse de navigation au lieu de partir après elle.
 */
export function preloadProfileEnglish(locale: Locale): void {
  if (locale === "en") preloadProfile();
}
