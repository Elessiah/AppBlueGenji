"use client";

import { quietPreload, type OnceLoader } from "@/lib/shared/lazy-component";
import type { Messages } from "@/lib/shared/i18n-messages";
import type { Locale } from "@/lib/shared/locales";
import { englishProfile, englishPush, englishTeamErrors } from "./english-loaders-account";

/** L'anglais de `/profil` : ses trois espaces. */
export type ProfileEnglishMessages = Pick<Messages, "profile" | "teamErrors" | "push">;

/** Les trois espaces de `/profil`, s'ils sont tous là. */
function loadedProfileEnglish(): ProfileEnglishMessages | null {
  const profile = englishProfile.loaded();
  const teamErrors = englishTeamErrors.loaded();
  const push = englishPush.loaded();
  return profile && teamErrors && push ? { profile, teamErrors, push } : null;
}

/** Les trois espaces en parallèle — ceux déjà reçus ne repartent pas. */
function loadProfileEnglish(): Promise<ProfileEnglishMessages> {
  return Promise.all([englishProfile.load(), englishTeamErrors.load(), englishPush.load()]).then(([profile, teamErrors, push]) => ({
    profile,
    teamErrors,
    push,
  }));
}

/** Le chargeur composé de `/profil`, au format d'un `OnceLoader` (l'amorce passe par les fournisseurs). */
export const englishProfileMessages: Pick<OnceLoader<ProfileEnglishMessages>, "load" | "loaded"> = {
  load: loadProfileEnglish,
  loaded: loadedProfileEnglish,
};

const preloadProfile = /* @__PURE__ */ quietPreload(loadProfileEnglish);

/**
 * Précharge l'anglais de `/profil` (survol ou focus du lien « My profile ») :
 * il arrive avec la réponse de navigation au lieu de partir après elle.
 */
export function preloadProfileEnglish(locale: Locale): void {
  if (locale !== "en" || loadedProfileEnglish()) return;
  preloadProfile();
}
