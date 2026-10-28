import type { CertifyPrompt, CertifyPromptAction } from "@/lib/shared/discord-certify-prompt";

const PATH = "/api/profile/discord/certify-prompt";

/** Canal des onglets du même navigateur (même session) : une réponse ici ferme la fenêtre ailleurs. */
const CHANNEL_NAME = "bg:certify-prompt";

/** Cet onglet : il n'agit pas sur sa propre annonce. */
const TAB_ID = Array.from(crypto.getRandomValues(new Uint32Array(2)), (part) => part.toString(36)).join("-");

/** Seul message du canal : une réponse écrite, au nom de ce compte, par cet onglet. */
const ANSWERED_MESSAGE = "answered";
type CertifyPromptMessage = { type: typeof ANSWERED_MESSAGE; userId: number; from: string };

/** Message du canal recevable : de la bonne forme, d'un autre onglet, pour ce compte. */
export function isAnsweredMessageFor(data: unknown, userId: number, tabId: string = TAB_ID): boolean {
  if (!data || typeof data !== "object") return false;
  const message = data as Partial<Record<keyof CertifyPromptMessage, unknown>>;
  return message.type === ANSWERED_MESSAGE && message.userId === userId && typeof message.from === "string" && message.from !== tabId;
}

/**
 * Canal d'écoute, ouvert tant qu'un relais l'écoute et **fermé** au dernier
 * départ (un canal ouvert peut priver la page du cache avant/arrière).
 */
let listening: { channel: BroadcastChannel; listeners: Set<{ userId: number; notify: () => void }> } | null = null;

function hasBroadcastChannel(): boolean {
  return typeof BroadcastChannel === "function";
}

/**
 * Réponse à la proposition de certification (`POST /api/profile/discord/certify-prompt`).
 * Module à part, chargé avec la fenêtre — ou à la demande par son relais
 * (`DiscordCertifyPromptLazy`), qui clôt la proposition quand le tag est
 * certifié avant qu'elle ne se charge.
 * Écrite, elle est annoncée aux autres onglets (`onCertifyPromptAnsweredElsewhere`).
 * `userId` : le compte à qui la fenêtre a été montrée — une session changée
 * depuis (autre compte connecté dans ce navigateur) refuse la réponse
 * (409 `CERTIFY_PROMPT_OTHER_ACCOUNT`), qui ne coupe donc jamais la
 * proposition d'un autre.
 */
export async function answerCertifyPrompt(action: CertifyPromptAction, userId: number): Promise<void> {
  const response = await fetch(PATH, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, userId }),
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
    channel.postMessage({ type: ANSWERED_MESSAGE, userId, from: TAB_ID } satisfies CertifyPromptMessage);
    channel.close();
  } catch {
    // Document qui part : la relecture avant ouverture suffit.
  }
}

/**
 * Une réponse donnée **par ce compte** dans un autre onglet de ce navigateur ;
 * tout autre message (forme inattendue, autre compte) est ignoré. Rend le
 * désabonnement, qui ferme le canal au dernier départ. Sans
 * `BroadcastChannel` (navigateur ancien) : rien, seule la relecture tient.
 */
export function onCertifyPromptAnsweredElsewhere(userId: number, listener: () => void): () => void {
  if (!hasBroadcastChannel()) return () => undefined;
  if (!listening) {
    const channel = new BroadcastChannel(CHANNEL_NAME);
    const listeners = new Set<{ userId: number; notify: () => void }>();
    channel.addEventListener("message", (event: MessageEvent<unknown>) => {
      for (const entry of listeners) if (isAnsweredMessageFor(event.data, entry.userId)) entry.notify();
    });
    listening = { channel, listeners };
  }
  const current = listening;
  const entry = { userId, notify: listener };
  current.listeners.add(entry);
  return () => {
    current.listeners.delete(entry);
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
