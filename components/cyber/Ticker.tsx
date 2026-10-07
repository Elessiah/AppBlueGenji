"use client";

import { useState } from "react";
import { useLandingText } from "@/components/i18n/landing-text";
import styles from "./Ticker.module.css";

/** Libellés du bandeau et de son bouton (espace `landing.ticker`). */
export type TickerLabels = Readonly<Record<"label" | "resume" | "pause" | "resumeShort" | "pauseShort", string>>;

interface TickerProps {
  items: string[];
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
 */
export function Ticker({ items, labels }: Readonly<TickerProps>) {
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
                {item}
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
