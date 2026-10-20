"use client";

import { onceLoader } from "@/lib/shared/lazy-component";
import type { Messages } from "@/lib/shared/i18n-messages";

/**
 * Le chargeur de l'espace `profile` anglais, seul dans son module : la fenêtre
 * des conditions d'utilisation (mise en page racine, chaque page) le précharge
 * pour « Supprimer mon compte » sans embarquer les autres chargeurs de
 * l'espace connecté (`english-loaders-account.ts`, qui le réexporte : une
 * seule instance, un seul chargement partagé).
 */
export const englishProfile = /* @__PURE__ */ onceLoader<Messages["profile"]>(() => import("@/messages/en/profile.json").then((module) => module.default));
