import type { CertifyPrompt, CertifyPromptAction } from "@/lib/shared/discord-certify-prompt";

const PATH = "/api/profile/discord/certify-prompt";

/** Canal des onglets du même navigateur (même session) : une réponse ici ferme la fenêtre ailleurs. */
const CHANNEL_NAME = "bg:certify-prompt";

/** Cet onglet : il n'agit pas sur sa propre annonce. */
const TAB_ID = Array.from(crypto.getRandomValues(new Uint32Array(2)), (part) => part.toString(36)).join("-");

type CertifyPromptMessage = { from: string };

/**
 * Canal d'écoute, ouvert tant qu'un relais l'écoute et **fermé** au dernier
 * départ (un canal ouvert peut priver la page du cache avant/arrière).
 */
let listening: { channel: BroadcastChannel; listeners: Set<() => void> } | null = null;

function hasBroadcastChannel(): boolean {
  return typeof BroadcastChannel === "function";
}

/**
 * Réponse à la proposition de certification (`POST /api/profile/discord/certify-prompt`).
 * Module à part, chargé avec la fenêtre — ou à la demande par son relais
 * (`DiscordCertifyPromptLazy`), qui clôt la proposition quand le tag est
 * certifié avant qu'elle ne se charge.
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
  if (!hasBroadcastChannel()) return;
  try {
    // Canal le temps d'un message : rien ne reste ouvert pour l'onglet qui répond.
    const channel = new BroadcastChannel(CHANNEL_NAME);
    channel.postMessage({ from: TAB_ID } satisfies CertifyPromptMessage);
    channel.close();
  } catch {
    // Document qui part : la relecture avant ouverture suffit.
  }
}

/**
 * Une réponse donnée dans un autre onglet de ce navigateur. Rend le
 * désabonnement, qui ferme le canal au dernier départ. Sans
 * `BroadcastChannel` (navigateur ancien) : rien, seule la relecture tient.
 */
export function onCertifyPromptAnsweredElsewhere(listener: () => void): () => void {
  if (!hasBroadcastChannel()) return () => undefined;
  if (!listening) {
    const channel = new BroadcastChannel(CHANNEL_NAME);
    const listeners = new Set<() => void>();
    channel.addEventListener("message", (event: MessageEvent<CertifyPromptMessage | null>) => {
      if (event.data?.from === TAB_ID) return;
      for (const notify of listeners) notify();
    });
    listening = { channel, listeners };
  }
  const current = listening;
  current.listeners.add(listener);
  return () => {
    current.listeners.delete(listener);
    if (current.listeners.size > 0 || listening !== current) return;
    current.channel.close();
    listening = null;
  };
}

/**
 * Relecture : `{ prompt }` quand le serveur a tranché (`null` : plus due, ou
 * session close — 401), `"UNKNOWN"` sinon (réseau coupé, panne, réponse
 * illisible, requête abandonnée).
 */
export type CertifyPromptRecheck = { prompt: CertifyPrompt | null } | "UNKNOWN";

/**
 * La proposition est-elle **encore** due (`GET`) ? Relue avant d'ouvrir une
 * fenêtre sur une page chargée plus tôt — « Ne plus voir » ou certification
 * choisis entre-temps sur un autre appareil. Avant une ouverture, le relais
 * traite `"UNKNOWN"` comme « plus due » (fermée en cas de doute ; la marque de
 * session reste, la proposition revient au chargement suivant) ; une fenêtre
 * déjà affichée, elle, ne se ferme que sur une réponse tranchée.
 */
export async function recheckCertifyPrompt(signal?: AbortSignal): Promise<CertifyPromptRecheck> {
  try {
    const response = await fetch(PATH, { cache: "no-store", signal });
    if (response.status === 401) return { prompt: null };
    if (!response.ok) return "UNKNOWN";
    const payload = (await response.json()) as { prompt?: CertifyPrompt | null };
    return { prompt: payload.prompt ?? null };
  } catch {
    return "UNKNOWN";
  }
}
