"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import {
  countdownRemaining,
  isCountdownHeld,
  pauseCountdown,
  resumeCountdown,
  startCountdown,
  type Countdown,
  type CountdownOverride,
} from "@/lib/shared/pausable-countdown";
import styles from "./toast.module.css";

type ToastType = "error" | "success";

interface Toast {
  id: number;
  message: string;
  type: ToastType;
}

interface ToastContextValue {
  showError: (message: string) => void;
  showSuccess: (message: string) => void;
}

/** Durée d'affichage d'une notification, décompte suspendu exclu. */
export const TOAST_DURATION_MS = 5000;

const ToastContext = createContext<ToastContextValue | null>(null);

/**
 * Notifications du site, en bas à gauche.
 *
 * Deux publics, deux chemins. À l'œil, la pile visible : chaque notification
 * porte un bouton **pause** et un bouton **fermer**, et son décompte se
 * suspend aussi au survol et au focus (WCAG 2.2.1) — un message qui part avant
 * d'être lu n'a rien dit. À l'oreille, deux zones d'annonce **permanentes** et
 * invisibles (`role="status"` pour les réussites, `role="alert"` pour les
 * erreurs) : un lecteur d'écran n'annonce de façon fiable que ce qui change
 * *dans* une zone déjà présente, jamais une zone qui vient d'apparaître — d'où
 * des zones montées une fois, que chaque notification remplit d'une ligne.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);

  const add = useCallback((message: string, type: ToastType) => {
    const id = ++nextId.current;
    setToasts((prev) => [...prev, { id, message, type }]);
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showError = useCallback((message: string) => add(message, "error"), [add]);
  const showSuccess = useCallback((message: string) => add(message, "success"), [add]);

  return (
    <ToastContext.Provider value={{ showError, showSuccess }}>
      {children}
      <div className="sr-only" role="status" aria-live="polite">
        {toasts
          .filter((toast) => toast.type === "success")
          .map((toast) => (
            <p key={toast.id}>{toast.message}</p>
          ))}
      </div>
      <div className="sr-only" role="alert" aria-live="assertive">
        {toasts
          .filter((toast) => toast.type === "error")
          .map((toast) => (
            <p key={toast.id}>{toast.message}</p>
          ))}
      </div>
      {toasts.length > 0 && (
        <section className={styles.stack} aria-label="Notifications">
          {toasts.map((toast) => (
            <ToastItem key={toast.id} toast={toast} onDismiss={dismiss} />
          ))}
        </section>
      )}
    </ToastContext.Provider>
  );
}

/**
 * Une notification. Le décompte se suspend au survol et au focus clavier, et
 * le bouton pause pose un choix explicite qui prime sur les deux
 * (`isCountdownHeld`) : « Pause » le tient arrêté jusqu'au clic suivant,
 * « Reprendre » le relance même sous le pointeur qui vient de cliquer. Ce
 * « Reprendre » s'efface au prochain survol ou focus, qui suspendent de
 * nouveau. Le focus ne compte que s'il est visible (clavier) : un clic de
 * souris laisse le focus sur le bouton cliqué, et le décompte ne reprendrait
 * jamais. La barre de progression lit le même état par `data-paused`.
 */
function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: number) => void }) {
  const [override, setOverride] = useState<CountdownOverride>(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const countdown = useRef<Countdown | null>(null);
  const paused = isCountdownHeld(override, hovered, focused);
  const manualPause = override === "PAUSED";
  // Un nouveau survol ou focus rend la main à la règle ordinaire.
  const releaseResume = () => setOverride((value) => (value === "RUNNING" ? null : value));

  useEffect(() => {
    const now = Date.now();
    countdown.current ??= startCountdown(TOAST_DURATION_MS, now);
    if (paused) {
      countdown.current = pauseCountdown(countdown.current, now);
      return;
    }
    countdown.current = resumeCountdown(countdown.current, now);
    const timer = window.setTimeout(() => onDismiss(toast.id), countdownRemaining(countdown.current, now));
    return () => window.clearTimeout(timer);
  }, [paused, onDismiss, toast.id]);

  const kind = toast.type === "error" ? "Erreur" : "Succès";

  return (
    <div
      className={styles.toast}
      data-type={toast.type}
      data-paused={paused ? "true" : undefined}
      onMouseEnter={() => {
        releaseResume();
        setHovered(true);
      }}
      onMouseLeave={() => setHovered(false)}
      onFocus={(event) => {
        if (!event.target.matches(":focus-visible")) return;
        releaseResume();
        setFocused(true);
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
      }}
    >
      <p className={styles.message}>
        <span className="sr-only">{kind} : </span>
        {toast.message}
      </p>
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.action}
          aria-label={manualPause ? "Reprendre le décompte de la notification" : "Mettre en pause la notification"}
          title={manualPause ? "Reprendre" : "Pause"}
          onClick={() => setOverride(manualPause ? "RUNNING" : "PAUSED")}
        >
          <span aria-hidden="true">{manualPause ? "▶" : "❚❚"}</span>
        </button>
        <button
          type="button"
          className={styles.action}
          aria-label="Fermer la notification"
          title="Fermer"
          onClick={() => onDismiss(toast.id)}
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>
      <span
        className={styles.progress}
        aria-hidden="true"
        style={{ animationDuration: `${TOAST_DURATION_MS}ms` }}
      />
    </div>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast doit être utilisé dans ToastProvider");
  return ctx;
}
