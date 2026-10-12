"use client";

import { useEffect, useState } from "react";
import { onceLoader, quietPreload, type OnceLoader } from "@/lib/shared/lazy-component";
import type { Messages } from "@/lib/shared/i18n-messages";
import type { Locale } from "@/lib/shared/locales";

/**
 * L'anglais des espaces du lot 9-2, **un chargeur par espace**, pour la
 * session (revue de performance) : chaque paquet n'est téléchargé qu'une fois,
 * quel que soit le chemin par lequel il arrive — sérialisé par une mise en page
 * au chargement complet d'une page (`prime`, posé par les fournisseurs), ou
 * chargé à part (`load`, dans son propre morceau) par une page atteinte en
 * navigation, la fenêtre de lancement ou le formulaire de signalement.
 *
 * Module sans texte : les `import()` ne partent qu'à l'appel.
 */
export const englishProfile = onceLoader<Messages["profile"]>(() => import("@/messages/en/profile.json").then((module) => module.default));
export const englishTeamErrors = onceLoader<Messages["teamErrors"]>(() =>
  import("@/messages/en/teamErrors.json").then((module) => module.default),
);
export const englishPush = onceLoader<Messages["push"]>(() => import("@/messages/en/push.json").then((module) => module.default));
export const englishReports = onceLoader<Messages["reports"]>(() => import("@/messages/en/reports.json").then((module) => module.default));

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

function primeProfileEnglish(messages: ProfileEnglishMessages): void {
  englishProfile.prime(messages.profile);
  englishTeamErrors.prime(messages.teamErrors);
  englishPush.prime(messages.push);
}

/** Le chargeur composé de `/profil`, au format d'un `OnceLoader`. */
export const englishProfileMessages: Pick<OnceLoader<ProfileEnglishMessages>, "load" | "loaded" | "prime"> = {
  load: loadProfileEnglish,
  loaded: loadedProfileEnglish,
  prime: primeProfileEnglish,
};

const preloadProfile = quietPreload(loadProfileEnglish);

/**
 * Précharge l'anglais de `/profil` (survol ou focus du lien « My profile ») :
 * il arrive avec la réponse de navigation au lieu de partir après elle.
 */
export function preloadProfileEnglish(locale: Locale): void {
  if (locale !== "en" || loadedProfileEnglish()) return;
  preloadProfile();
}

/**
 * L'anglais d'une page sous `/en` : celui qu'a sérialisé la mise en page
 * (`provided`, au chargement complet), sinon celui déjà reçu dans la session,
 * sinon chargé à part — lancé **dès le rendu** (pas après la première
 * validation), pour courir en même temps que le reste. `null` tant qu'il
 * manque ; `failed` : la page retombe sur le français.
 */
export function useEnglishMessages<T>(
  locale: Locale,
  loader: Pick<OnceLoader<T>, "load" | "loaded" | "prime">,
  provided: T | undefined,
): { english: T | null; failed: boolean } {
  if (locale === "en" && provided) loader.prime(provided);
  const [english, setEnglish] = useState<T | null>(() => (locale === "en" ? loader.loaded() : null));
  const [failed, setFailed] = useState(false);
  const waiting = locale === "en" && !english && !failed;
  // Lancé au rendu : `onceLoader` partage la requête en cours, l'effet n'en attend que l'issue.
  if (waiting) loader.load().catch(() => undefined);

  useEffect(() => {
    if (!waiting) return;
    let live = true;
    loader.load().then(
      (loaded) => {
        if (live) setEnglish(loaded);
      },
      () => {
        if (live) setFailed(true);
      },
    );
    return () => {
      live = false;
    };
  }, [waiting, loader]);

  return { english: locale === "en" ? english : null, failed };
}
