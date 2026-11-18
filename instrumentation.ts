/**
 * Démarrage du serveur Next (`register`, une fois par processus).
 *
 * Seul le runtime Node est concerné : il branche l'envoi des lots du journal
 * Discord sur l'arrêt propre (`docs/features/LOG_BATCHING.md`) et lance
 * l'entretien périodique de la mesure d'audience (sels des jours clos, purge
 * du détail : `docs/features/AUDIENCE_MEASUREMENT.md`). Chaque étape échoue
 * seule : aucune n'empêche le site de démarrer, ni l'autre de se lancer.
 */
/** Phase de `next build` (`PHASE_PRODUCTION_BUILD` de `next/constants`), où rien ne touche la base. */
const AUDIENCE_BUILD_PHASE = "phase-production-build";

export async function register(): Promise<void> {
  // Condition écrite en `=== "nodejs"` autour des imports : le paquet edge les
  // élimine (la base, `dotenv`, n'y ont pas cours).
  if (process.env.NEXT_RUNTIME === "nodejs") {
    try {
      const { installBotLogShutdownFlush } = await import("@/lib/server/bot-log-shutdown");
      installBotLogShutdownFlush();
    } catch (error) {
      await logStartupFailure("[bot-logs] Envoi des lots à l'arrêt non branché.", error);
    }
    // Mesure d'agrément : un échec à son chargement ne doit pas empêcher le site de démarrer.
    // Jamais pendant `next build` : un processus de rendu statique qui dure
    // replierait, effacerait et purgerait la base (migrations du nouveau code
    // comprises) avant tout déploiement.
    if (process.env.NEXT_PHASE !== AUDIENCE_BUILD_PHASE) {
      try {
        const { startAudienceMaintenanceClock } = await import("@/lib/server/audience-service");
        startAudienceMaintenanceClock();
      } catch (error) {
        await logStartupFailure("[audience] Horloge d'entretien non lancée.", error);
      }
      try {
        const { startPlanningRetentionClock } = await import("@/lib/server/planning/retention");
        startPlanningRetentionClock();
      } catch (error) {
        await logStartupFailure("[planning] Purge de conservation non lancée.", error);
      }
    }
  }
}

/**
 * Journalise un échec au démarrage selon la règle commune des journaux
 * d'échec (`failureReason` : un code, jamais un texte libre) ; son nom seul si
 * cette règle elle-même ne se charge pas.
 */
async function logStartupFailure(message: string, error: unknown): Promise<void> {
  let reason = error instanceof Error ? error.name : typeof error;
  try {
    const { failureReason } = await import("@/lib/server/failure-reason");
    reason = failureReason(error);
  } catch {
    // Repli déjà posé : le nom de l'erreur.
  }
  console.error(message, reason);
}
