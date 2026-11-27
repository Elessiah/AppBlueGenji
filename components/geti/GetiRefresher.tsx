"use client";

import { useRouter } from "next/navigation";
import { useAutoRefresh } from "@/lib/shared/hooks/useAutoRefresh";
import { useClientPower } from "@/lib/shared/hooks/useClientPower";
import { getiRefreshIntervalMs } from "@/lib/shared/geti/page";

/**
 * Tient la liste à jour sans flux : une annonce modifiée ou supprimée sur
 * Discord l'est sur le site, la page ouverte doit le voir. Le retour sur
 * l'onglet relit (étranglé), doublé d'une relecture de fond rare — coupée quand
 * la page doit se faire discrète (`CLIENT_POWER_MODES.md`) ; un onglet caché
 * ne demande jamais rien (`useAutoRefresh`).
 */
export function GetiRefresher() {
  const router = useRouter();
  const power = useClientPower();
  useAutoRefresh(() => router.refresh(), { intervalMs: getiRefreshIntervalMs(power.mode), pageShow: true });
  return null;
}
