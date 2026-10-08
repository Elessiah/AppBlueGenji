"use client";

import { useTournamentPageText } from "@/components/i18n/tournament-page-text";
import styles from "./TournamentLoading.module.css";

/**
 * Attente du premier instantané de la fiche tournoi.
 *
 * Un texte nu disait « Chargement… » dans une page vide ; le squelette reprend
 * la silhouette de ce qui arrive — en-tête, frise, plateau —, si bien que la
 * page ne saute pas quand le flux livre. Les formes sont décoratives
 * (`aria-hidden`) : c'est la phrase, en `role="status"`, que lisent les
 * technologies d'assistance.
 *
 * `retrying` : la première lecture a échoué et la page réessaiera plus tard
 * (page sans compte, `docs/features/SPECTATOR_VIEW.md`) — la phrase le dit,
 * plutôt que de laisser croire à un chargement qui n'avance pas.
 */
export function TournamentLoading({ retrying = false }: Readonly<{ retrying?: boolean }>) {
  const { t } = useTournamentPageText();
  const caption = retrying ? t("live.loadingRetry") : t("loading");
  return (
    <section /* NOSONAR S6819 — région live d'état, pas le résultat d'un formulaire */ className={styles.root} role="status" aria-busy="true">
      <span className="sr-only">{caption}</span>
      <div className={styles.shapes} aria-hidden="true">
        <div className={`${styles.bar} ${styles.back}`} />
        <div className={`${styles.bar} ${styles.title}`} />
        <div className={`${styles.bar} ${styles.line}`} />
        <div className={styles.facts}>
          <div className={styles.fact} />
          <div className={styles.fact} />
          <div className={styles.fact} />
          <div className={styles.fact} />
        </div>
        <div className={`${styles.bar} ${styles.progress}`} />
        <div className={styles.board}>
          <div className={styles.card} />
          <div className={styles.card} />
          <div className={styles.card} />
        </div>
      </div>
      <p className={styles.caption} aria-hidden="true">
        {caption}
      </p>
    </section>
  );
}
