"use client";

import { memo, useState, type ReactNode } from "react";
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

/**
 * Repère de forme, en plus de la teinte : la couleur n'est jamais seule (WCAG 1.4.1).
 * « ✓ » / « ✕ » et non « ▲ » / « ▼ » : ces derniers disent un mouvement de rang
 * sur `/classement` et dans les vues d'endurance (« ▼Alpha 2 » se lisait « Alpha
 * a perdu 2 places »).
 */
const OUTCOME_MARK: Partial<Record<TickerOutcome, string>> = { win: "✓", loss: "✕" };

/**
 * Un nom habillé selon son issue : classe, `data-outcome` et repère aux mêmes
 * endroits pour un camp de résultat et pour le champion (une seule copie du
 * style du vainqueur).
 */
function OutcomeName({ outcome, children }: Readonly<{ outcome: TickerOutcome; children: ReactNode }>) {
  const mark = OUTCOME_MARK[outcome];
  return (
    <span className={[styles.side, OUTCOME_CLASS[outcome]].filter(Boolean).join(" ")} data-outcome={outcome}>
      {mark ? (
        <i className={styles.mark} aria-hidden="true">
          {mark}
        </i>
      ) : null}
      {children}
    </span>
  );
}

/**
 * `hidden` : la seconde copie de la piste est masquée aux technologies d'assistance —
 * les mots d'issue et notes dits au lecteur d'écran seul n'y sont pas rendus.
 */
function ResultSide({ side, hidden }: Readonly<{ side: TickerResultSide; hidden: boolean }>) {
  return (
    <OutcomeName outcome={side.outcome}>
      <span>{side.name}</span>
      {/* Un forfait se lit aussi à l'écran : sans teinte ni repère, le mot seul le dit. */}
      {side.sr && (side.outcome === "forfeit" || !hidden) ? (
        <span className={side.outcome === "forfeit" ? undefined : "sr-only"}> ({side.sr})</span>
      ) : null}
      {/* Double forfait : aucun score enregistré, pas de « 0 » qui ferait croire à un 0-0. */}
      {side.score === null ? null : (
        <>
          {" "}
          <b className={styles.score}>{side.score}</b>
        </>
      )}
    </OutcomeName>
  );
}

/** Une entrée : phrase brute, ou résultat / champion habillés par camp. */
function TickerEntry({ item, hidden }: Readonly<{ item: TickerItem; hidden: boolean }>) {
  if (typeof item === "string") return <>{item}</>;
  if (item.kind === "champion") {
    if (!item.known) return <>{`${item.lead} ${item.name}`}</>;
    return (
      <>
        {item.lead}{" "}
        <OutcomeName outcome="win">
          <span>{item.name}</span>
        </OutcomeName>
      </>
    );
  }
  const [left, right] = item.sides;
  // Un nul aux scores inégaux (format à égalité permise : 2-1 sans vainqueur) se lirait
  // comme une victoire du camp en tête : la note se voit alors, comme « forfait ».
  const noteShown = item.sr !== null && left.score !== right.score;
  return (
    <>
      {item.lead} <ResultSide side={left} hidden={hidden} /> — <ResultSide side={right} hidden={hidden} />
      {item.sr && (noteShown || !hidden) ? <span className={noteShown ? undefined : "sr-only"}> ({item.sr})</span> : null}
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
 * vainqueur en `--teal-400`, gras, « ✓ » ; perdant dans l'encre de la
 * défaite (`--result-loss-ink`), « ✕ » ; forfait et nul neutres, le forfait dit en clair ; score en gras et plus grand ; l'issue dite
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
                <TickerEntry item={item} hidden={copy === 1} />
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
