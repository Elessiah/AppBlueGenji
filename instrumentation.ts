/**
 * Démarrage du serveur Next (`register`, une fois par processus).
 *
 * Seul le runtime Node est concerné : il branche l'envoi des lots du journal
 * Discord sur l'arrêt propre (`docs/features/LOG_BATCHING.md`) et lance
 * l'entretien périodique de la mesure d'audience (sels des jours clos, purge
 * du détail : `docs/features/AUDIENCE_MEASUREMENT.md`).
 */
export async function register(): Promise<void> {
  // Condition écrite en `=== "nodejs"` autour des imports : le paquet edge les
  // élimine (la base, `dotenv`, n'y ont pas cours).
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { installBotLogShutdownFlush } = await import("@/lib/server/bot-log-shutdown");
    installBotLogShutdownFlush();
    // Mesure d'agrément : un échec à son chargement ne doit pas empêcher le site de démarrer.
    try {
      const { startAudienceMaintenanceClock } = await import("@/lib/server/audience-service");
      startAudienceMaintenanceClock();
    } catch (error) {
      console.error("[audience] Horloge d'entretien non lancée.", error instanceof Error ? error.name : typeof error);
    }
  }
}
