import { onceLoader, type OnceLoader } from "@/lib/shared/lazy-component";
import { documentLocale } from "@/lib/shared/document-locale";
import type { Locale } from "@/lib/shared/locales";
import type { TournamentViewMessages } from "@/lib/shared/tournament-page-text";

/**
 * L'anglais des vues chargées à la demande, **un morceau par vue** : la ronde
 * suisse et la survie par coupes (`tournamentViews`), BlueGenji Survie
 * (`tournamentEndurance`), son graphique (`tournamentEnduranceChart`, volet
 * ouvert seulement). Module sans texte — des `import()` qui ne partent qu'à
 * l'appel —, importé par la fiche pour lancer l'anglais d'une vue en même temps
 * que son morceau (`withViewText`), et par les vues pour le lire
 * (`useTournamentViewText`). Le français de chaque vue voyage avec elle
 * (`views-text.ts`, `endurance-text.ts`, `endurance-chart-text.ts`).
 */
export const ENGLISH_VIEWS = /* @__PURE__ */ onceLoader<TournamentViewMessages>(() =>
  import("@/messages/en/tournamentViews.json").then((module) => ({ swiss: module.default.swiss, survival: module.default.survival })),
);

export const ENGLISH_ENDURANCE = /* @__PURE__ */ onceLoader<TournamentViewMessages>(() =>
  import("@/messages/en/tournamentEndurance.json").then((module) => ({ endurance: module.default.endurance }) as TournamentViewMessages),
);

/** Le graphique lit aussi les clés de la vue (`endurance.penaltyBadge*`) : les deux fichiers, fusionnés. */
export const ENGLISH_ENDURANCE_CHART = /* @__PURE__ */ onceLoader<TournamentViewMessages>(() =>
  Promise.all([import("@/messages/en/tournamentEndurance.json"), import("@/messages/en/tournamentEnduranceChart.json")]).then(
    ([view, chart]) => ({ endurance: { ...view.default.endurance, ...chart.default.endurance } }),
  ),
);

/**
 * Enveloppe le chargement d'une vue (`dynamic()`) : sous `/en`, son anglais part
 * **en même temps** que son morceau, et la vue ne se monte qu'une fois les deux
 * là. Un échec de l'anglais rejette comme celui du morceau — `orReload`
 * recharge alors la page. En français, rien de plus : le texte est dans la vue.
 */
export function withViewText<T>(
  load: Promise<T>,
  english: Pick<OnceLoader<TournamentViewMessages>, "load">,
  locale: Locale = documentLocale(),
): Promise<T> {
  if (locale !== "en") return load;
  return Promise.all([load, english.load()]).then(([module]) => module);
}
