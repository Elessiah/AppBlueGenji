import type { CertifyPromptAction } from "@/lib/shared/discord-certify-prompt";

/**
 * Réponse à la proposition de certification (`POST /api/profile/discord/certify-prompt`).
 * Hors du morceau de la fenêtre : son relais (`DiscordCertifyPromptLazy`) clôt
 * aussi la proposition quand le tag est certifié avant qu'elle ne se charge.
 */
export async function answerCertifyPrompt(action: CertifyPromptAction): Promise<void> {
  const response = await fetch("/api/profile/discord/certify-prompt", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action }),
    // « Plus tard » puis un lien qui charge un nouveau document (changement de
    // langue, passage par Discord) : sans `keepalive`, ce départ l'annulerait.
    keepalive: true,
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error ?? `HTTP ${response.status}`);
  }
}
