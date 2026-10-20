"use client";

import { onceLoader } from "@/lib/shared/lazy-component";
import type { Messages } from "@/lib/shared/i18n-messages";
import type { StatsPanelMessages } from "@/lib/shared/stats-text";

/**
 * Les chargeurs d'anglais de l'espace connecté (équipes, joueurs, profil,
 * notifications) — même mécanique que `english-loaders.ts` (un chargeur par
 * espace, pour la session, amorcé par les fournisseurs), à part pour ne pas
 * peser sur le pied de page des écrans publics.
 */
// Dans un module à lui (`english-loader-profile.ts`) : la fenêtre des conditions,
// montée sur chaque page, le précharge sans tirer les autres chargeurs.
export { englishProfile } from "./english-loader-profile";
export const englishTeamErrors = /* @__PURE__ */ onceLoader<Messages["teamErrors"]>(() =>
  import("@/messages/en/teamErrors.json").then((module) => module.default),
);
export const englishPush = /* @__PURE__ */ onceLoader<Messages["push"]>(() => import("@/messages/en/push.json").then((module) => module.default));
export const englishTeams = /* @__PURE__ */ onceLoader<Messages["teams"]>(() => import("@/messages/en/teams.json").then((module) => module.default));
export const englishTeam = /* @__PURE__ */ onceLoader<Messages["team"]>(() => import("@/messages/en/team.json").then((module) => module.default));
export const englishPlayers = /* @__PURE__ */ onceLoader<Messages["players"]>(() => import("@/messages/en/players.json").then((module) => module.default));
/**
 * Le bloc de statistiques : `stats` et les deux tables de `labels` qu'il lit
 * (même forme que `statsPanelMessages`, recomposée ici : `stats-text.ts`
 * porte le français, que ce module n'importe pas).
 */
export const englishStatsPanel = /* @__PURE__ */ onceLoader<StatsPanelMessages>(() =>
  import("./stats-panel-en").then((module) => module.STATS_PANEL_EN),
);

