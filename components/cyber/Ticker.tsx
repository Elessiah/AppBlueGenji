"use client";

import { memo, useState } from "react";
import { useLandingText } from "@/components/i18n/landing-text";
import type { TickerItem, TickerOutcome, TickerResultSide } from "@/lib/shared/ticker-items";
import styles from "./Ticker.module.css";

/** Libellés du bandeau et de son bouton (espace `landing.ticker`). */
export type TickerLabels = Readonly<Record<"label" | "resume" | "pause" | "resumeShort" | "pauseShort", string>>;

/** Classe d'un camp selon son issue : forfait et nul restent neutres. */
const OUTCOME_CLASS: Record<TickerOutcome, string | undefined> = {
  win: styles.winner,
  loss: styles.loser,
  forfeit: undefined,
  none: undefined,
};

/** Repère de forme, en plus de la teinte : la couleur n'est jamais seule (WCAG 1.4.1). */
const OUTCOME_MARK: Partial<Record<TickerOutcome, string>> = { win: "▲", loss: "▼" };

function ResultSide({ side }: Readonly<{ side: TickerResultSide }>) {
  const mark = OUTCOME_MARK[side.outcome];
  return (
    <span className={[styles.side, OUTCOME_CLASS[side.outcome]].filter(Boolean).join(" ")} data-outcome={side.outcome}>
      {mark ? (
        <i className={styles.mark} aria-hidden="true">
          {mark}
        </i>
      ) : null}
      <span className={styles.name}>{side.name}</span>
      {side.sr ? <span className="sr-only"> ({side.sr})</span> : null}{" "}
      <b className={styles.score}>{side.score}</b>
    </span>
  );
}

/** Une entrée : phrase brute, ou résultat / champion habillés par camp. */
function TickerEntry({ item }: Readonly<{ item: TickerItem }>) {
  if (typeof item === "string") return <>{item}</>;
  if (item.kind === "champion") {
    if (!item.known) return <>{`${item.lead} ${item.name}`}</>;
    return (
      <>
        {item.lead}{" "}
        <span className={`${styles.side} ${styles.winner}`} data-outcome="win">
          <i className={styles.mark} aria-hidden="true">
            ▲
          </i>
          <span className={styles.name}>{item.name}</span>
        </span>
      </>
    );
  }
  const [left, right] = item.sides;
  return (
    <>
      {item.lead} <ResultSide side={left} /> — <ResultSide side={right} />
      {item.sr ? <span className="sr-only"> ({item.sr})</span> : null}
    </>
  );
}

interface TickerProps {
  /** Phrases, résultats et champions (`lib/shared/ticker-items.ts`), déjà rédigés. */
  items: readonly TickerItem[];
  /**
   * Libellés venus d'un autre écran que l'accueil (`/tournois`, lot 8a), qui
   * ne pose pas le fournisseur de l'accueil. Sans eux : `useLandingText()`.
   */
  labels?: TickerLabels;
}

/**
 * Bandeau défilant.
 *
 * Un contenu qui bouge plus de cinq secondes doit pouvoir être arrêté
 * (WCAG 2.2.2, RGAA 13.8) : le bandeau se fige au survol de son texte, et porte
 * un bouton **pause** qui le tient arrêté jusqu'au clic suivant — et ne tient
 * que lui : ni le survol du bouton ni son focus ne figent la piste, sans quoi
 * « ▶ » ne relancerait rien tant que le pointeur ou le focus y restent. Il se fige
 * aussi seul avec le régime de charge (`--deco-anim-state`) et le réglage
 * « Réduire les animations ».
 *
 * La piste est **doublée** pour que la boucle ne montre pas de trou : la copie
 * est masquée aux technologies d'assistance, sans quoi chaque élément serait lu
 * deux fois.
 *
 * Un **résultat** habille ses camps (`docs/features/TICKER_RESULTS.md`) :
 * vainqueur en `--teal-400`, gras, « ▲ » ; perdant dans l'encre de la
 * défaite (`--result-loss-ink`), « ▼ » ; forfait et nul neutres ; score en gras et plus grand ; l'issue dite
 * en texte masqué aux lecteurs d'écran.
 */
function TickerView({ items, labels }: Readonly<TickerProps>) {
  const [paused, setPaused] = useState(false);
  const landing = useLandingText();
  const t = (key: `ticker.${keyof TickerLabels}`) => (labels ? labels[key.slice("ticker.".length) as keyof TickerLabels] : landing.t(key));

  return (
    <div className={styles.ticker} role="marquee" aria-label={t("ticker.label")} data-paused={paused ? "true" : undefined}>
      <div className={styles.track}>
        {[0, 1].map((copy) => (
          <div key={copy} className={styles.copy} aria-hidden={copy === 1 ? true : undefined}>
            {items.map((item, i) => (
              <span key={i} /* NOSONAR S6479 — bandeau en lecture seule, entrées sans identifiant et possiblement en double */ className={styles.item}>
                <TickerEntry item={item} />
                <i className={styles.sep} aria-hidden="true">
                  ◆
                </i>
              </span>
            ))}
          </div>
        ))}
      </div>
      <button
        type="button"
        className={styles.pause}
        aria-label={paused ? t("ticker.resume") : t("ticker.pause")}
        title={paused ? t("ticker.resumeShort") : t("ticker.pauseShort")}
        onClick={() => setPaused((value) => !value)}
      >
        <span aria-hidden="true">{paused ? "▶" : "❚❚"}</span>
      </button>
    </div>
  );
}

/**
 * Mémoïsé : un annuaire le rend au-dessus de sa recherche, qui se rend à
 * chaque frappe ; ses libellés y sont gardés (`useMemo`) d'un rendu à l'autre.
 */
export const Ticker = memo(TickerView);
