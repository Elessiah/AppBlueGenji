/**
 * Démarrage du serveur Next (`register`, une fois par processus).
 *
 * Seul le runtime Node est concerné : il branche l'envoi des lots du journal
 * Discord sur l'arrêt propre (`docs/features/LOG_BATCHING.md`).
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { installBotLogShutdownFlush } = await import("@/lib/server/bot-log-shutdown");
  installBotLogShutdownFlush();
}
