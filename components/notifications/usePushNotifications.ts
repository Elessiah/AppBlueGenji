"use client";

/**
 * L'état des notifications push pour le compte et l'appareil courants — le
 * moteur de `PushNotificationsPanel`, séparé pour qu'un autre écran puisse
 * offrir le même geste sous une autre forme sans le réécrire.
 *
 * Deux états qui ne se confondent pas : **l'appareil** (ce navigateur est-il
 * abonné ?) et **le compte** (quels sujets a-t-il coupés, sur tous ses
 * appareils ?). Le premier se lit dans le navigateur, le second au serveur.
 *
 * Au montage, un abonnement déjà présent dans le navigateur est **renvoyé** au
 * serveur : c'est ce qui rattache un navigateur partagé au compte qui vient de
 * s'y connecter, et ce qui répare un abonnement que le serveur aurait oublié
 * (purgé, base restaurée). L'écriture est un « upsert », sans effet sinon.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { createLatestValueWriter } from "@/lib/shared/latest-value-writer";
import {
  PUSH_SERVICE_WORKER_PATH,
  decodeBase64Url,
  isIosUserAgent,
  isSameServerKey,
  pushSupport,
  type PushSupport,
  type PushTopic,
} from "@/lib/shared/push-notifications";

type ServerState = {
  publicKey: string | null;
  topics: PushTopic[];
  disabledTopics: PushTopic[];
  devices: number;
};

export type PushNotificationsState = {
  /** `null` tant que rien n'est lu. */
  support: PushSupport | null;
  server: ServerState | null;
  /** Ce navigateur est-il abonné (et rattaché à ce compte) ? */
  subscribed: boolean;
  /**
   * L'abonnement du navigateur a-t-il été relu ? Tant que non, `subscribed`
   * vaut `false` par défaut et ne dit rien : un écran qui propose d'activer
   * attend ce drapeau, sans quoi il proposerait un instant d'activer ce qui
   * l'est déjà.
   */
  checked: boolean;
  /** La lecture des réglages a échoué : l'écran propose de réessayer. */
  loadFailed: boolean;
  /** Relit les réglages (et l'abonnement de l'appareil) après un échec. */
  retry: () => void;
  busy: boolean;
  /** `true` si l'appareil est désormais abonné. */
  enable: () => Promise<boolean>;
  /** `true` si l'appareil est désormais désabonné. */
  disable: () => Promise<boolean>;
  setTopicEnabled: (topic: PushTopic, enabled: boolean) => Promise<void>;
};

class PushError extends Error {}

/**
 * Le motif d'un échec d'activation. Seul un refus du navigateur lui-même dit
 * qu'il ne sait pas faire ; une coupure réseau pendant l'envoi de
 * l'abonnement, par exemple, n'est qu'un échec à retenter — l'annoncer
 * « navigateur non compatible » ferait renoncer à un navigateur qui marche.
 */
function enableErrorCode(error: unknown): string {
  if (error instanceof PushError) return error.message;
  const name = error instanceof Error ? error.name : "";
  if (name === "NotSupportedError") return "PUSH_UNSUPPORTED";
  if (name === "NotAllowedError") return "PUSH_PERMISSION_DENIED";
  return "PUSH_FAILED";
}

async function readError(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? "PUSH_FAILED";
}

function detectSupport(): PushSupport {
  const nav = navigator as Navigator & { standalone?: boolean };
  return pushSupport({
    serviceWorker: "serviceWorker" in navigator,
    pushManager: typeof window !== "undefined" && "PushManager" in window,
    notification: typeof Notification !== "undefined",
    permission: typeof Notification !== "undefined" ? Notification.permission : null,
    ios: isIosUserAgent(navigator.userAgent, navigator.maxTouchPoints ?? 0),
    standalone:
      nav.standalone === true ||
      (typeof window.matchMedia === "function" && window.matchMedia("(display-mode: standalone)").matches),
  });
}

/**
 * L'abonnement a-t-il été pris avec la clé publique **actuelle** du site ? Un
 * abonnement pris sous une ancienne clé (paire renouvelée) reste présent dans
 * le navigateur, mais chaque envoi y est refusé : il faut le refaire.
 */
function matchesServerKey(subscription: PushSubscription, publicKey: string): boolean {
  return isSameServerKey(subscription.options?.applicationServerKey ?? null, publicKey);
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.getRegistration(PUSH_SERVICE_WORKER_PATH);
  return registration ? registration.pushManager.getSubscription() : null;
}

async function postSubscription(subscription: PushSubscription): Promise<void> {
  const response = await fetch("/api/push/subscriptions", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subscription: subscription.toJSON() }),
  });
  if (!response.ok) throw new PushError(await readError(response));
}

/**
 * @param onError reçoit le **code** d'un refus ; l'appelant le traduit
 *   (`pushErrorMessage`) et l'affiche en notification — jamais dans la page.
 */
export function usePushNotifications(
  onError: (code: string) => void,
  options: {
    /**
     * Renvoyer au serveur l'abonnement déjà présent dans le navigateur (défaut).
     * La forme compacte s'en passe : elle ne fait que proposer, et une écriture
     * à chaque ouverture de la modale de lancement coûterait sans rien apporter.
     */
    syncExisting?: boolean;
  } = {},
): PushNotificationsState {
  const syncExisting = options.syncExisting ?? true;
  const [support, setSupport] = useState<PushSupport | null>(null);
  const [server, setServer] = useState<ServerState | null>(null);
  const [subscribed, setSubscribed] = useState(false);
  const [checked, setChecked] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  // Sujets coupés : la liste **voulue** (dernier geste, tant qu'elle n'est pas
  // écrite) et la dernière **confirmée** par le serveur. Deux cases cochées coup
  // sur coup envoient deux listes entières : elles partent en série
  // (`createLatestValueWriter`), sans quoi la plus ancienne pouvait être écrite
  // en dernier et contredire l'écran.
  const desiredTopics = useRef<PushTopic[] | null>(null);
  const confirmedTopics = useRef<PushTopic[] | null>(null);
  const topicWriter = useRef(
    createLatestValueWriter<PushTopic[]>(async (wanted) => {
      const response = await fetch("/api/push/topics", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ disabledTopics: wanted }),
      });
      if (!response.ok) throw new PushError(await readError(response));
      confirmedTopics.current = wanted;
      if (desiredTopics.current === wanted) desiredTopics.current = null;
    }),
  );

  // Le dernier `onError` reçu, sans en faire une dépendance de l'effet de
  // chargement — un appelant qui ne le mémorise pas relancerait la lecture à
  // chaque rendu.
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const retry = useCallback(() => setAttempt((count) => count + 1), []);

  const loadServer = useCallback(async (): Promise<ServerState | null> => {
    const response = await fetch("/api/push", { credentials: "same-origin", cache: "no-store" });
    if (!response.ok) return null;
    const state = (await response.json()) as ServerState;
    confirmedTopics.current = state.disabledTopics;
    // Une écriture de sujets en cours garde la main sur l'affichage.
    setServer(desiredTopics.current ? { ...state, disabledTopics: desiredTopics.current } : state);
    return state;
  }, []);

  useEffect(() => {
    let cancelled = false;
    const detected = detectSupport();
    setSupport(detected);
    void (async () => {
      const state = await loadServer().catch(() => null);
      if (cancelled) return;
      if (!state) {
        // Sans réglages, le panneau n'a rien à montrer : il le dit et propose
        // de relire, au lieu d'attendre une réponse qui ne viendra pas.
        setLoadFailed(true);
        onErrorRef.current("PUSH_LOAD_FAILED");
        return;
      }
      setLoadFailed(false);
      try {
        if (cancelled || detected !== "AVAILABLE" || !state?.publicKey) return;
        const subscription = await currentSubscription();
        if (!subscription || cancelled) return;
        // Pris sous une ancienne clé : muet pour de bon. Il n'est ni renvoyé ni
        // annoncé actif — « Activer » le refera.
        if (!matchesServerKey(subscription, state.publicKey)) return;
        if (syncExisting) {
          await postSubscription(subscription);
          if (cancelled) return;
          await loadServer();
        }
        if (!cancelled) setSubscribed(true);
      } catch {
        // Silencieux : le panneau propose simplement d'activer.
      } finally {
        if (!cancelled) setChecked(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadServer, syncExisting, attempt]);

  const enable = useCallback(async () => {
    if (!server?.publicKey) {
      onError("PUSH_NOT_CONFIGURED");
      return false;
    }
    setBusy(true);
    try {
      // Première instruction du geste : certains navigateurs n'ouvrent la
      // demande de permission que dans le fil direct d'un clic.
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setSupport(detectSupport());
        throw new PushError("PUSH_PERMISSION_DENIED");
      }
      const registration = await navigator.serviceWorker.register(PUSH_SERVICE_WORKER_PATH, { scope: "/" });
      await navigator.serviceWorker.ready;
      const key = decodeBase64Url(server.publicKey);
      if (!key) throw new PushError("PUSH_NOT_CONFIGURED");
      let existing = await registration.pushManager.getSubscription();
      if (existing && !matchesServerKey(existing, server.publicKey)) {
        await existing.unsubscribe().catch(() => false);
        existing = null;
      }
      const subscription =
        existing ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: key.buffer.slice(key.byteOffset, key.byteOffset + key.byteLength) as ArrayBuffer,
        }));
      await postSubscription(subscription);
      setSubscribed(true);
      await loadServer().catch(() => null);
      return true;
    } catch (error) {
      onError(enableErrorCode(error));
      return false;
    } finally {
      setBusy(false);
    }
  }, [loadServer, onError, server?.publicKey]);

  const disable = useCallback(async () => {
    setBusy(true);
    try {
      const subscription = await currentSubscription();
      if (subscription) {
        const { endpoint } = subscription;
        // Désabonner le navigateur d'abord : si le serveur échoue ensuite,
        // l'abonnement qu'il garde ne recevra plus rien et sera oublié au
        // premier envoi (le service de push répondra « expiré »).
        await subscription.unsubscribe().catch(() => false);
        const response = await fetch("/api/push/subscriptions", {
          method: "DELETE",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint }),
        });
        if (!response.ok) throw new PushError(await readError(response));
      }
      setSubscribed(false);
      await loadServer().catch(() => null);
      return true;
    } catch (error) {
      onError(error instanceof PushError ? error.message : "PUSH_FAILED");
      return false;
    } finally {
      setBusy(false);
    }
  }, [loadServer, onError]);

  const setTopicEnabled = useCallback(
    async (topic: PushTopic, enabled: boolean) => {
      if (!server) return;
      const current = desiredTopics.current ?? server.disabledTopics;
      const next = enabled ? current.filter((t) => t !== topic) : [...current.filter((t) => t !== topic), topic];
      desiredTopics.current = next;
      // Le geste se voit tout de suite ; le serveur le confirme ou le défait.
      setServer((state) => (state ? { ...state, disabledTopics: next } : state));

      try {
        await topicWriter.current.submit(next);
      } catch (error) {
        // Échec : l'écran revient à ce que le serveur a confirmé, et le geste
        // perdu est dit. Un geste plus récent encore en file garde la main.
        if (desiredTopics.current !== next) return;
        desiredTopics.current = null;
        const confirmed = confirmedTopics.current ?? [];
        setServer((state) => (state ? { ...state, disabledTopics: confirmed } : state));
        onError(error instanceof PushError ? error.message : "PUSH_FAILED");
      }
    },
    [onError, server],
  );

  return { support, server, subscribed, checked, loadFailed, retry, busy, enable, disable, setTopicEnabled };
}
