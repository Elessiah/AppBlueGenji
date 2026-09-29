"use client";

import { useEffect } from "react";
import { PUSH_SERVICE_WORKER_PATH } from "@/lib/shared/push-notifications";

/**
 * Pose le service worker du site (`public/push-sw.js`) pour **tout** visiteur,
 * et non plus seulement pour qui s'abonne aux notifications : c'est lui qui
 * rend la page hors ligne quand une navigation échoue faute de réseau — sans
 * lui, l'app installée, qui n'a pas de barre d'adresse, restait bloquée sur la
 * page d'erreur du navigateur.
 *
 * Le même chemin et la même portée que l'abonnement push
 * (`usePushNotifications`) : les deux appels désignent **un seul**
 * enregistrement, que le navigateur ne duplique pas. Différé au premier temps
 * mort pour ne rien disputer au chargement de la page ; tout échec est ignoré
 * — le site marche sans.
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!("serviceWorker" in navigator) || !window.isSecureContext) return;
    const register = () => {
      navigator.serviceWorker.register(PUSH_SERVICE_WORKER_PATH, { scope: "/" }).catch(() => undefined);
    };
    if (typeof window.requestIdleCallback === "function") {
      const handle = window.requestIdleCallback(register, { timeout: 5000 });
      return () => window.cancelIdleCallback(handle);
    }
    const timer = window.setTimeout(register, 2000);
    return () => window.clearTimeout(timer);
  }, []);
  return null;
}
