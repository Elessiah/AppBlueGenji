"use client";

/**
 * « Sessions ouvertes » — sous les applications connectées, sur `/profil`.
 *
 * Une session volée restait valide trente jours sans que la victime ait de
 * quoi la fermer : seules la déconnexion de l'appareil courant et la
 * suppression du compte effaçaient des sessions. Ce panneau dit combien
 * d'autres sessions ouvrent encore le compte, et les ferme toutes d'un geste,
 * sauf celle qui le fait.
 *
 * Il vit avec les portes d'entrée parce qu'il en est la suite : retirer une
 * porte ferme aussi les autres sessions (le parent incrémente `version` pour
 * que le compte soit relu), et c'est ici qu'on refait le geste s'il a échoué.
 */
import { useCallback, useEffect, useState } from "react";
import { useToast } from "@/components/ui/toast";
import { connectionErrorMessage, otherSessionsSummary, sessionsRevokedMessage } from "./connection-errors";
import s from "./profil.module.css";

async function readError(res: Response): Promise<string> {
  const payload = (await res.json().catch(() => null)) as { error?: string } | null;
  return payload?.error ?? "";
}

export function OtherSessionsPanel({ version }: { version: number }): React.ReactElement {
  const { showError, showSuccess } = useToast();
  const [count, setCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch("/api/profile/sessions", { signal, cache: "no-store" });
      if (!res.ok) throw new Error(await readError(res));
      const payload = (await res.json()) as { otherSessions: number };
      if (!signal?.aborted) setCount(payload.otherSessions);
    } catch {
      // Silencieux : la ligne dit « pas encore compté », et le bouton reste
      // offert — fermer ne dépend pas d'avoir compté.
      if (!signal?.aborted) setCount(null);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load, version]);

  const revoke = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/profile/sessions", { method: "DELETE" });
      if (!res.ok) throw new Error(await readError(res));
      const payload = (await res.json()) as { revoked: number };
      showSuccess(sessionsRevokedMessage(payload.revoked));
      setCount(0);
    } catch (e) {
      showError(connectionErrorMessage((e as Error).message || "SESSIONS_REVOKE_FAILED"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={s.sessionsRow}>
      <p id="other-sessions-summary" className={`${s.hint} ${s.sessionsSummary}`} aria-live="polite">
        {otherSessionsSummary(count)}
      </p>
      <button
        type="button"
        className="btn ghost"
        onClick={revoke}
        disabled={busy || count === 0}
        aria-describedby="other-sessions-summary"
        style={{ padding: "4px 12px", fontSize: 12 }}
      >
        {busy ? "Fermeture…" : "Déconnecter mes autres sessions"}
      </button>
    </div>
  );
}
