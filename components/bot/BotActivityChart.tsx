"use client";

import { useState, useEffect } from "react";
import { BotActivity } from "@/lib/shared/types";
import { botPayloadLabel, botPayloadNumber } from "@/lib/shared/bot-payload";

/**
 * Le nombre de colonnes tracées. La plage la plus large offerte par la page
 * est de 90 jours ; la borne laisse donc la marge d'un point par jour, et ne
 * coupe que des charges qui ne décrivent plus une activité quotidienne.
 */
const MAX_COLUMNS = 120;

type ActivityRange = "7j" | "30j" | "90j";

const RANGES: readonly ActivityRange[] = ["7j", "30j", "90j"];

/** Une charge, et la plage qu'elle **décrit** — pas forcément celle demandée. */
export type ShownActivity = { range: ActivityRange; data: BotActivity | null };

/**
 * Ce que le graphe peut afficher pour la plage `requested`.
 *
 * Entre le clic et la réponse, la charge affichée est encore celle de la plage
 * précédente : la montrer sans rien dire faisait décrire 30 jours au graphe
 * sous une pastille déjà allumée sur « 90j ». `loading` le dit, et une plage
 * précédente **illisible** ne s'annonce pas « indisponible » pour la suivante,
 * qui n'a pas encore répondu.
 */
export function activityView(shown: ShownActivity, requested: ActivityRange) {
  return { data: shown.data, loading: shown.range !== requested };
}

/**
 * Recharge une plage et remet sa réponse à `apply` — **tant qu'elle est encore
 * demandée**. Rend la fonction qui l'annule, posée telle quelle en nettoyage de
 * l'effet.
 *
 * Sans cette garde, cliquer « 90j » puis « 7j » assez vite laissait la réponse
 * la plus lente écraser la plus récente : le graphe, l'axe et la moyenne
 * décrivaient 90 jours sous une pastille qui annonçait « 7j », et rien ne le
 * signalait, les deux réponses étant valides. L'annulation écarte la réponse
 * *et* son échec : une requête abandonnée qui rejette ne doit pas non plus
 * effacer le graphe de la plage qui l'a remplacée.
 *
 * Exportée pour être testée sans DOM : c'est la seule partie du composant qui
 * dépende de l'ordre d'arrivée des réponses.
 */
export function loadActivityRange(
  range: ActivityRange,
  apply: (data: BotActivity | null) => void,
  fetcher: typeof fetch = fetch,
): () => void {
  const controller = new AbortController();
  let current = true;

  (async () => {
    let result: BotActivity | null;
    try {
      const res = await fetcher(`/api/bot/activity?range=${range}`, { signal: controller.signal });
      if (!res.ok) throw new Error("Failed to fetch");
      result = await res.json();
    } catch {
      result = null;
    }
    if (current) apply(result);
  })();

  return () => {
    current = false;
    controller.abort();
  };
}

/**
 * Les trois plages. Leur nom accessible **est** leur texte visible (WCAG
 * 2.5.3) : le groupe dit de quoi elles sont la plage, `aria-pressed` laquelle
 * est affichée.
 */
function RangeChips({ range, onChange }: { range: ActivityRange; onChange: (range: ActivityRange) => void }) {
  return (
    <div className="chart-tools" role="group" aria-label="Plage d'activité affichée">
      {RANGES.map((r) => (
        <button
          key={r}
          type="button"
          className={"chip" + (range === r ? " chip-on" : "")}
          onClick={() => onChange(r)}
          aria-pressed={range === r}
        >
          {r}
        </button>
      ))}
    </div>
  );
}

export function BotActivityChart({ initial }: { initial: BotActivity | null }) {
  const [range, setRange] = useState<ActivityRange>("30j");
  const [shown, setShown] = useState<ShownActivity>({ range: "30j", data: initial });

  useEffect(() => {
    if (range === "30j") {
      setShown({ range, data: initial });
      return;
    }
    return loadActivityRange(range, (data) => setShown({ range, data }));
  }, [range, initial]);

  const { data, loading } = activityView(shown, range);

  if (!data) {
    return (
      <section className="panel" aria-busy={loading}>
        <div className="panel-head">
          <span className="title">Activité · relais & scrims</span>
          <RangeChips range={range} onChange={setRange} />
        </div>
        <div style={{ padding: "2rem", textAlign: "center", color: "var(--ink-mute)" }}>
          <p>{loading ? "Chargement…" : "Données indisponibles"}</p>
        </div>
      </section>
    );
  }

  // Plafonné à ce que le graphe peut dire, comme la colonne « tendance » du
  // tableau des serveurs (`MAX_SPARKLINE_POINTS`) et comme `Sparkline`
  // (`MAX_POINTS`). C'est la **seule** série de la page que le client
  // **redemande** (`/api/bot/activity`, qui valide `range` et laisse passer le
  // corps du bot tel quel), donc la seule qu'un navigateur reçoive sans être
  // jamais passée par un rendu serveur. Cinquante mille points y écrivaient
  // trois nœuds DOM chacun — l'onglet se fige. Ne pas lever n'est pas la même
  // chose que rester utilisable.
  //
  // On garde les plus **récentes** : une activité se lit par sa fin, et la
  // plage la plus large proposée (90 jours) tient largement sous la borne.
  const relays = (Array.isArray(data.relays) ? data.relays : []).slice(-MAX_COLUMNS);
  const scrims = (Array.isArray(data.scrims) ? data.scrims : []).slice(-MAX_COLUMNS);
  // Un point ramené à un nombre affichable, **borné des deux côtés** — la même
  // règle que la colonne « tendance » de `BotServersTable`, et pour les mêmes
  // deux raisons : un point non numérique rendait `height: NaN%` et un point
  // négatif `height: -400%`, deux déclarations que le navigateur laisse
  // tomber en silence. La barre disparaît alors sans qu'aucune erreur ne le
  // signale — la panne muette, pas l'exception.
  const point = (v: unknown) => Math.max(0, botPayloadNumber(v) ?? 0);
  // Deux passes plutôt qu'un `[...relays, ...scrims]` : la concaténation
  // recopiait les deux séries entières pour n'en tirer qu'un nombre. Et
  // surtout pas `Math.max(...relays, ...scrims, 1)`, qui les passerait en
  // **arguments d'appel** — un `RangeError` au-delà de ~100 000 points, et
  // `NaN` sur un point non numérique. La graine à 1 reste le garde-fou contre
  // la division par zéro d'une série plate.
  //
  // Le maximum se lit sur la fenêtre **affichée** : gradué sur des points que
  // le plafond vient d'écarter, l'axe décrirait un graphe qu'on ne dessine pas.
  const highest = (serie: unknown[]) => serie.reduce<number>((m, v) => Math.max(m, point(v)), 1);
  const max = Math.max(highest(relays), highest(scrims));
  // `?? []` ne rattrape que `null` : des libellés rangés par index
  // (`{"0": "01/09"}`) passaient tout droit et `labels.map` levait
  // « labels.map is not a function ». `BotActivityChart` étant rendu côté
  // serveur dans `app/bot/page.tsx`, cette exception-là ne fait pas une case
  // vide : elle sert **toute** la page en 500 — bien pire que l'axe sans
  // libellés qu'on rend ici.
  // **Le nombre de colonnes est celui de la plus longue des deux séries**, et
  // non celui des relais. Les barres se tiraient de `relays.map` seul, quand
  // `max`, la légende et l'axe parlent des deux : une charge
  // `{"relays": [], "scrims": [ … ]}` rendait un graphe **vide** sous un axe
  // gradué sur des données jamais dessinées, et une légende qui annonçait des
  // scrims. Seule l'asymétrie inverse était couverte. Une colonne sans point
  // d'un côté y porte un zéro, ce que `point` donne déjà.
  const columns = Math.max(relays.length, scrims.length);
  // Les libellés suivent la même fenêtre que les barres : découpés autrement,
  // l'axe compterait des jours que le graphe ne montre plus.
  const labels = (Array.isArray(data.labels) ? data.labels : []).slice(-MAX_COLUMNS);
  // Même charge non validée : un objet tombait dans `Math.round`, qui rend
  // `NaN`, et la légende annonçait « MOY. NaN / JOUR ». Le `null` est gardé
  // jusqu'à l'affichage : un repli sur zéro annonçait « MOY. 0 / JOUR », une
  // moyenne **mesurée**, sur une charge que la page venait de juger illisible.
  // Le zéro reste réservé à un zéro reçu.
  const avgPerDay = botPayloadNumber(data.avgPerDay);

  return (
    <section className="panel" aria-busy={loading}>
      <div className="panel-head">
        <span className="title">Activité · relais & scrims</span>
        <RangeChips range={range} onChange={setRange} />
      </div>
      <div className={"chart-wrap" + (loading ? " is-loading" : "")}>
        <div className="chart">
          <div className="y-axis">
            <span>0</span>
            <span>{Math.round(max * 0.25)}</span>
            <span>{Math.round(max * 0.5)}</span>
            <span>{Math.round(max * 0.75)}</span>
            <span>{max}</span>
          </div>
          <div className="bars">
            {Array.from({ length: columns }, (_, i) => {
              // Les hauteurs passaient les valeurs **brutes** alors que `max`
              // venait d'être durci : une série `scrims` plus courte que
              // `relays` (ou absente) donnait `scrims[i] === undefined`, donc
              // `height: NaN%` et un `title="undefined scrims"`. Les barres
              // ambre disparaissaient sans une erreur.
              const relay = point(relays[i]);
              const scrim = point(scrims[i]);
              return (
                <div key={i} style={{ flex: 1, display: "flex", alignItems: "flex-end", gap: 1.5, height: "100%" }}>
                  <div className="bar" style={{ height: `${(relay / max) * 100}%`, flex: 1 }} title={`${relay} relais`} />
                  <div
                    className="bar relais"
                    style={{ height: `${(scrim / max) * 100}%`, flex: 0.4 }}
                    title={`${scrim} scrims`}
                  />
                </div>
              );
            })}
          </div>
        </div>
        <div className="x-axis">
          {/* `key={d}` sur le libellé lui-même : deux dates identiques dans la
              série donnaient deux clés identiques, donc un avertissement React
              et une réconciliation qui ne tient plus au changement de plage.
              Et un libellé arrivé en objet tombait en enfant de React, qui
              lève — toute la page en 500. */}
          {labels.map((d, i) => (
            <span key={i}>{botPayloadLabel(d)}</span>
          ))}
        </div>
        <div className="chart-legend">
          <span className="lg">RELAIS INTER-SERVEUR</span>
          <span className="lg amber">SCRIMS PROPOSÉS</span>
          <span style={{ marginLeft: "auto" }}>
            {loading ? "CHARGEMENT…" : `MOY. ${avgPerDay === null ? "—" : Math.round(avgPerDay)} / JOUR`}
          </span>
        </div>
      </div>
    </section>
  );
}
