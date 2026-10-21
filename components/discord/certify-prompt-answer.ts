import type { CertifyPrompt, CertifyPromptAction } from "@/lib/shared/discord-certify-prompt";

const PATH = "/api/profile/discord/certify-prompt";

/** Canal des onglets du même navigateur (même session) : une réponse ici ferme la fenêtre ailleurs. */
const CHANNEL_NAME = "bg:certify-prompt";

let channel: BroadcastChannel | null | undefined;

/**
 * Un seul canal par document : un message posté ne revient pas à l'objet qui
 * le poste, l'onglet qui répond ne s'entend donc pas lui-même. `null` sans
 * `BroadcastChannel` (navigateur ancien) : seule la relecture avant ouverture
 * tient alors.
 */
function certifyChannel(): BroadcastChannel | null {
  if (channel === undefined) channel = typeof BroadcastChannel === "function" ? new BroadcastChannel(CHANNEL_NAME) : null;
  return channel;
}

/**
 * Réponse à la proposition de certification (`POST /api/profile/discord/certify-prompt`).
 * Hors du morceau de la fenêtre : son relais (`DiscordCertifyPromptLazy`) clôt
 * aussi la proposition quand le tag est certifié avant qu'elle ne se charge.
 * Écrite, elle est annoncée aux autres onglets (`onCertifyPromptAnsweredElsewhere`).
 */
export async function answerCertifyPrompt(action: CertifyPromptAction): Promise<void> {
  const response = await fetch(PATH, {
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
  try {
    certifyChannel()?.postMessage(action);
  } catch {
    // Canal fermé (document qui part) : la relecture avant ouverture suffit.
  }
}

/** Une réponse donnée dans un autre onglet de ce navigateur. Rend le désabonnement. */
export function onCertifyPromptAnsweredElsewhere(listener: () => void): () => void {
  const current = certifyChannel();
  if (!current) return () => undefined;
  current.addEventListener("message", listener);
  return () => current.removeEventListener("message", listener);
}

/**
 * La proposition est-elle **encore** due (`GET`) ? Relue avant d'ouvrir une
 * fenêtre sur une page chargée plus tôt — « Ne plus voir » ou certification
 * choisis entre-temps sur un autre appareil. Fermée en cas de doute : toute
 * panne rend `null` (la marque de session reste, la proposition revient au
 * chargement suivant).
 */
export async function recheckCertifyPrompt(): Promise<CertifyPrompt | null> {
  try {
    const response = await fetch(PATH, { cache: "no-store" });
    if (!response.ok) return null;
    const payload = (await response.json()) as { prompt?: CertifyPrompt | null };
    return payload.prompt ?? null;
  } catch {
    return null;
  }
}
