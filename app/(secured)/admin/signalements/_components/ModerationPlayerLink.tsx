"use client";

import { PlayerLink } from "@/components/entity-link";
import styles from "../reports.module.css";

/**
 * Le pseudo d'un compte dans l'écran de modération (signalant, auteur d'une
 * contestation), ouvert dans un nouvel onglet. Passe par `PlayerLink` : un
 * compte supprimé **sans fiche** (D13) y reste un nom, le lien menait à une
 * page introuvable. Outil resté français (D4).
 */
export function ModerationPlayerLink({ userId, pseudo }: Readonly<{ userId: number; pseudo: string }>) {
  return (
    <PlayerLink userId={userId} podiumTier={null} className={styles.inlineLink} newTabLabel="(nouvel onglet)">
      {pseudo}
    </PlayerLink>
  );
}
