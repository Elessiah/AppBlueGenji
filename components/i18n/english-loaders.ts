"use client";

import { onceLoader, type OnceLoader } from "@/lib/shared/lazy-component";
import type { Messages } from "@/lib/shared/i18n-messages";
import type { Locale } from "@/lib/shared/locales";

/**
 * L'anglais des espaces des lots 9 (équipes, joueurs, profil, signalements),
 * **un chargeur par espace**, pour la session (revue de performance du lot
 * 9-2) : chaque paquet n'est téléchargé qu'une fois, quel que soit le chemin
 * par lequel il arrive — sérialisé par une mise en page au chargement complet
 * d'une page (`prime`, posé par les fournisseurs), ou chargé à part (`load`,
 * dans son propre morceau) par une page atteinte en navigation, la fenêtre de
 * lancement ou le formulaire de signalement.
 *
 * Module sans texte, importé au pied de chaque page (formulaire de
 * signalement) : les outils communs et les chargeurs des écrans publics
 * (`reports`, `imageCrop`). Ceux de l'espace connecté vivent dans
 * `english-loaders-account.ts`, le crochet dans `use-english-messages.ts` : un
 * module est embarqué entier, le pied de chaque page ne paie que les siens.
 * Les `import()` ne partent qu'à l'appel.
 */

export const englishReports = /* @__PURE__ */ onceLoader<Messages["reports"]>(() => import("@/messages/en/reports.json").then((module) => module.default));
export const englishImageCrop = /* @__PURE__ */ onceLoader<Messages["imageCrop"]>(() =>
  import("@/messages/en/imageCrop.json").then((module) => module.default),
);
/**
 * Chargeurs et amorces ne vivent que dans le navigateur : sur le serveur, un
 * module est partagé par toutes les requêtes — un dictionnaire gardé là
 * suivrait d'une requête à l'autre, et le rendu serveur ne serait plus celui
 * du client à l'hydratation.
 */
export const inBrowser = (): boolean => typeof window !== "undefined";

/** Amorce `loader` avec l'anglais reçu, dans le navigateur seulement. */
export function primeEnglish<T>(loader: Pick<OnceLoader<T>, "prime">, locale: Locale, messages: T | undefined): void {
  if (inBrowser() && locale === "en" && messages) loader.prime(messages);
}
