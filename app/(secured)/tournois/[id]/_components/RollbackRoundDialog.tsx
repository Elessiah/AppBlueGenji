"use client";

import { FormEvent, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useToast } from "@/components/ui/toast";
import { useDialogBehavior } from "@/lib/shared/hooks/useDialogBehavior";
import { isMatchDrawn } from "@/lib/shared/match-outcome";
import type { BracketMatch } from "@/lib/shared/types";
import { mapError } from "../_lib/error-map";

interface RollbackRoundDialogProps {
  tournamentId: number;
  /**
   * Libellé de la manche défaite, **article compris** (« la manche 4 », « le
   * tour 2 des play-offs ») : le genre change d'un format à l'autre, et les
   * textes sont tournés pour n'accorder avec lui ni article ni participe.
   */
  roundLabel: string;
  /**
   * Numéro de cette manche, tel qu'il est stocké. Renvoyé au serveur, qui refuse
   * le geste si la manche courante a bougé entre l'ouverture et le clic : le
   * dialogue *montre* les rencontres qu'il efface, et c'est là toute la
   * sauvegarde de l'arbitre — il ne doit pas en effacer d'autres.
   */
  roundNumber: number;
  /** Rencontres de cette manche, telles qu'elles sont au moment du rendu. */
  matches: BracketMatch[];
  onClose: () => void;
  /** Reçoit ce que le **serveur** dit avoir effacé, pas ce qui était affiché. */
  onRolledBack: (roundNumber: number) => void;
}

/** Score affiché d'une rencontre, ou son absence, en une chaîne relisible. */
function scoreLabel(match: BracketMatch): string {
  if (match.team1Score === null && match.team2Score === null) return "aucun score saisi";
  const score = `${match.team1Score ?? "—"} – ${match.team2Score ?? "—"}`;
  if (match.forfeitTeamId !== null) return `${score} (forfait)`;
  if (isMatchDrawn(match)) return `${score} (nul)`;
  return score;
}

/**
 * Confirmation du retour en arrière : effacer la manche courante.
 *
 * Le dialogue ne se contente pas d'avertir, il **montre ce qui va disparaître** :
 * chaque rencontre de la manche y figure avec son score. C'est la seule
 * sauvegarde possible avant le geste — le site ne garde aucune archive d'un
 * résultat effacé, et l'avertissement « pense à noter les scores » sans les
 * scores sous les yeux enverrait l'arbitre les chercher dans un plateau qu'il
 * s'apprête à vider.
 *
 * Le bouton ne s'arme qu'une fois la case cochée, pour la même raison que la
 * recopie du nom sur la suppression : l'action est irréversible, elle ne doit
 * pas partir d'un clic distrait.
 *
 * Portail sur `document.body` (voir `DeleteTournamentDialog`) : la page vit dans
 * `.page-shell`, qui enferme ses enfants sous la barre de navigation.
 */
export function RollbackRoundDialog({
  tournamentId,
  roundLabel,
  roundNumber,
  matches,
  onClose,
  onRolledBack,
}: RollbackRoundDialogProps) {
  const { showError } = useToast();
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const dialogRef = useDialogBehavior({ open: mounted, onClose, locked: busy });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!acknowledged || busy) return;

    setBusy(true);
    try {
      const res = await fetch(`/api/admin/tournaments/${tournamentId}/rollback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedRound: roundNumber }),
      });
      const payload = (await res.json()) as {
        error?: string;
        rolledBack?: { roundNumber: number };
      };
      if (!res.ok) throw new Error(payload.error || "ROLLBACK_FAILED");
      // La manche annoncée est celle que le serveur dit avoir effacée : la
      // nôtre pouvait être périmée, et un message qui nomme la mauvaise manche
      // serait pire qu'aucun message.
      onRolledBack(payload.rolledBack?.roundNumber ?? roundNumber);
    } catch (e) {
      showError(mapError((e as Error).message));
      setBusy(false);
    }
  };

  if (!mounted) return null;

  return createPortal(
    <div
      role="presentation"
      onClick={() => {
        if (!busy) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 90,
        background: "rgba(6, 8, 12, 0.72)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="rollback-round-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 520,
          maxHeight: "90vh",
          overflow: "auto",
          background: "var(--cyber-bg-2, #14181f)",
          border: "1px solid var(--red-live, #ff4d4d)",
          borderRadius: "var(--r-cy-md, 12px)",
          boxShadow: "0 24px 64px rgba(0,0,0,0.6)",
          padding: 22,
        }}
      >
        <h3
          id="rollback-round-title"
          style={{ margin: 0, fontSize: 18, color: "var(--red-live, #ff4d4d)" }}
        >
          Effacer {roundLabel}
        </h3>

        <p style={{ marginTop: 10, fontSize: 13, color: "var(--text-2, #9aa4b2)", lineHeight: 1.55 }}>
          <strong style={{ color: "var(--ink)" }}>{roundLabel}</strong> perd tout ce qui y a été
          saisi : scores, vainqueurs, forfaits de match et reports en attente. Les rencontres
          restent en place, avec les mêmes équipes, et redeviennent à jouer.
        </p>
        <p style={{ marginTop: 8, fontSize: 13, color: "var(--text-2, #9aa4b2)", lineHeight: 1.55 }}>
          C&apos;est ce qui rouvre la manche précédente à la correction. Les abandons et les
          pénalités déjà déclarés, eux, restent en vigueur.
        </p>

        <div
          role="note"
          style={{
            marginTop: 14,
            padding: "10px 12px",
            borderRadius: "var(--r-cy-sm, 8px)",
            border: "1px solid color-mix(in srgb, var(--amber, #ffb020) 45%, transparent)",
            background: "color-mix(in srgb, var(--amber, #ffb020) 8%, transparent)",
            fontSize: 12.5,
            lineHeight: 1.5,
            color: "var(--ink, #e7ecf3)",
          }}
        >
          ⚠️ <strong>Note les scores ci-dessous avant de continuer.</strong> Rien n&apos;est
          archivé : une fois la manche effacée, il faudra les ressaisir à la main pour revenir à
          l&apos;état actuel.
        </div>

        <ul
          aria-label="Scores qui vont être effacés"
          style={{
            listStyle: "none",
            margin: "12px 0 0",
            padding: 0,
            display: "flex",
            flexDirection: "column",
            gap: 6,
            maxHeight: 220,
            overflow: "auto",
          }}
        >
          {matches.map((match) => (
            <li
              key={match.id}
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 12,
                fontSize: 12.5,
                padding: "6px 10px",
                borderRadius: "var(--r-cy-sm, 8px)",
                background: "var(--cyber-bg-3, #1b2029)",
              }}
            >
              <span style={{ color: "var(--text-2, #9aa4b2)" }}>
                {match.team1Name ?? match.team1Placeholder ?? "À venir"} vs{" "}
                {match.team2Name ?? match.team2Placeholder ?? "À venir"}
              </span>
              <span className="mono" style={{ color: "var(--ink, #e7ecf3)", whiteSpace: "nowrap" }}>
                {scoreLabel(match)}
              </span>
            </li>
          ))}
        </ul>

        <form onSubmit={submit}>
          <label
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 8,
              marginTop: 16,
              fontSize: 13,
              lineHeight: 1.5,
              color: "var(--text-2, #9aa4b2)",
              cursor: busy ? "default" : "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
              disabled={busy}
              style={{ marginTop: 2 }}
            />
            J&apos;ai noté les scores ci-dessus.
          </label>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20 }}>
            <button
              type="button"
              className="btn ghost"
              onClick={onClose}
              disabled={busy}
              style={{ padding: "8px 18px", fontSize: 13 }}
            >
              Annuler
            </button>
            <button
              type="submit"
              className="btn"
              disabled={!acknowledged || busy}
              style={{
                padding: "8px 20px",
                fontSize: 13,
                borderColor: "var(--red-live, #ff4d4d)",
                color: acknowledged && !busy ? "var(--red-live, #ff4d4d)" : undefined,
              }}
            >
              {busy ? "Effacement…" : "Effacer cette manche"}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
