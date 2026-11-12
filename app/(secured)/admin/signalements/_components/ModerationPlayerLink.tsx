"use client";

import Link from "next/link";
import { useHasPlayerPage } from "@/components/profileless-players";
import styles from "../reports.module.css";

/**
 * Le pseudo d'un compte dans l'écran de modération (signalant, auteur d'une
 * contestation, cible), ouvert dans un nouvel onglet. Un compte supprimé
 * **sans fiche** (D13, `useHasPlayerPage`) reste un nom : le lien menait à une
 * page introuvable. Outil resté français (D4).
 */
export function ModerationPlayerLink({ userId, pseudo }: Readonly<{ userId: number; pseudo: string }>) {
  const linked = useHasPlayerPage(userId);
  if (!linked) return <span>{pseudo}</span>;
  return (
    <Link href={`/joueurs/${userId}`} target="_blank" rel="noreferrer" className={styles.inlineLink}>
      {pseudo}
    </Link>
  );
}
