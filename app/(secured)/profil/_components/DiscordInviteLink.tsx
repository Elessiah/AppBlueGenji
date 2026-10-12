"use client";

import type { ReactNode } from "react";
import { DISCORD_INVITE_URL } from "@/lib/shared/discord";
import { useProfileText } from "@/components/i18n/profile-text";

/**
 * Le lien « rejoins le serveur BlueGenji » des deux dialogues Discord du
 * profil (certification, rattachement par code) : un seul rendu, nouvel
 * onglet annoncé aux lecteurs d'écran (`verify.newTab`).
 */
export function DiscordInviteLink({ children }: Readonly<{ children: ReactNode }>) {
  const { t } = useProfileText();
  return (
    <a
      href={DISCORD_INVITE_URL}
      target="_blank"
      rel="noopener noreferrer"
      style={{ color: "var(--blue-300)", textDecoration: "underline" }}
    >
      {children}
      {/* NOSONAR S6772 — l'espace est dans le texte réservé aux lecteurs d'écran */}
      <span className="sr-only">{` ${t("verify.newTab")}`}</span>
    </a>
  );
}
