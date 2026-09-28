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
import { useCallback, useEffect, useState } from "react";
import {
  PUSH_SERVICE_WORKER_PATH,
  decodeBase64Url,
  isIosUserAgent,
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
  busy: boolean;
  /** `true` si l'appareil est désormais abonné. */
  enable: () => Promise<boolean>;
  /** `true` si l'appareil est désormais désabonné. */
  disable: () => Promise<boolean>;
  setTopicEnabled: (topic: PushTopic, enabled: boolean) => Promise<void>;
};

class PushError extends Error {}

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
export function usePushNotifications(onError: (code: string) => void): PushNotificationsState {
  const [support, setSupport] = useState<PushSupport | null>(null);
  const [server, setServer] = useState<ServerState | null>(null);
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);

  const loadServer = useCallback(async (): Promise<ServerState | null> => {
    const response = await fetch("/api/push", { credentials: "same-origin", cache: "no-store" });
    if (!response.ok) return null;
    const state = (await response.json()) as ServerState;
    setServer(state);
    return state;
  }, []);

  useEffect(() => {
    let cancelled = false;
    const detected = detectSupport();
    setSupport(detected);
    void (async () => {
      const state = await loadServer().catch(() => null);
      if (cancelled || detected !== "AVAILABLE" || !state?.publicKey) return;
      try {
        const subscription = await currentSubscription();
        if (!subscription || cancelled) return;
        await postSubscription(subscription);
        if (!cancelled) {
          setSubscribed(true);
          await loadServer();
        }
      } catch {
        // Silencieux : le panneau propose simplement d'activer.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadServer]);

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
      const existing = await registration.pushManager.getSubscription();
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
      onError(error instanceof PushError ? error.message : "PUSH_UNSUPPORTED");
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
      const previous = server.disabledTopics;
      const next = enabled ? previous.filter((t) => t !== topic) : [...previous.filter((t) => t !== topic), topic];
      // Le geste se voit tout de suite ; le serveur le confirme ou le défait.
      setServer({ ...server, disabledTopics: next });
      try {
        const response = await fetch("/api/push/topics", {
          method: "PUT",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ disabledTopics: next }),
        });
        if (!response.ok) throw new PushError(await readError(response));
      } catch (error) {
        setServer((current) => (current ? { ...current, disabledTopics: previous } : current));
        onError(error instanceof PushError ? error.message : "PUSH_FAILED");
      }
    },
    [onError, server],
  );

  return { support, server, subscribed, busy, enable, disable, setTopicEnabled };
}
