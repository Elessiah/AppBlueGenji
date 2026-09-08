"use client";

import { FormEvent, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ScrollArea } from "@/components/cyber";
import { useToast } from "@/components/ui/toast";
import { useDialogBehavior } from "@/lib/shared/hooks/useDialogBehavior";
import { isMatchDrawn } from "@/lib/shared/match-outcome";
import type { BracketMatch } from "@/lib/shared/types";
import { mapError } from "../_lib/error-map";

interface RollbackRoundDialogProps {
  tournamentId: number;
  /**
   * Libellé du stade défait, **article compris** (« la manche 4 », « le tour 2
   * des play-offs », « la manche 3 de la phase 2 ») : le genre change d'un
   * format à l'autre, et les textes sont tournés pour n'accorder avec lui ni
   * article ni participe.
   */
  stageLabel: string;
  /**
   * Clé de ce stade. Renvoyée au serveur, qui refuse le geste si le stade
   * courant a bougé entre l'ouverture et le clic : le dialogue *montre* les
   * rencontres qu'il efface, et c'est là toute la sauvegarde de l'arbitre — il
   * ne doit pas en effacer d'autres.
   */
  stageKey: string;
  /** Rencontres de ce stade, telles qu'elles sont au moment du rendu. */
  matches: BracketMatch[];
  /**
   * Le tournoi est **terminé** : ce retour en arrière le rouvrira.
   *
   * C'est la seule conséquence du geste qui déborde du plateau, et elle mérite
   * d'être annoncée avant le clic : le palmarès publié disparaît, et le tournoi
   * repasse « en cours » jusqu'à ce que le stade rouvert soit rejoué.
   */
  tournamentFinished: boolean;
  onClose: () => void;
  /** Reçoit le libellé que le **serveur** dit avoir effacé, pas celui affiché. */
  onRolledBack: (stageLabel: string) => void;
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
 * Confirmation du retour en arrière : effacer le dernier stade joué.
 *
 * Le dialogue ne se contente pas d'avertir, il **montre ce qui va disparaître** :
 * chaque rencontre du stade y figure avec son score. C'est la seule sauvegarde
 * possible avant le geste — le site ne garde aucune archive d'un résultat
 * effacé, et l'avertissement « pense à noter les scores » sans les scores sous
 * les yeux enverrait l'arbitre les chercher dans un plateau qu'il s'apprête à
 * vider.
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
  stageLabel,
  stageKey,
  matches,
  tournamentFinished,
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
        body: JSON.stringify({ expectedStage: stageKey }),
      });
      const payload = (await res.json()) as {
        error?: string;
        rolledBack?: { label: string };
      };
      if (!res.ok) throw new Error(payload.error || "ROLLBACK_FAILED");
      // Le stade annoncé est celui que le serveur dit avoir effacé : le nôtre
      // pouvait être périmé, et un message qui nomme la mauvaise manche serait
      // pire qu'aucun message.
      onRolledBack(payload.rolledBack?.label ?? stageLabel);
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
          Effacer {stageLabel}
        </h3>

        <p style={{ marginTop: 10, fontSize: 13, color: "var(--text-2, #9aa4b2)", lineHeight: 1.55 }}>
          <strong style={{ color: "var(--ink)" }}>{stageLabel}</strong> perd tout ce qui y a été
          saisi : scores, vainqueurs, forfaits de match et reports en attente. Les rencontres
          restent en place, avec les mêmes équipes, et redeviennent à jouer.
        </p>
        <p style={{ marginTop: 8, fontSize: 13, color: "var(--text-2, #9aa4b2)", lineHeight: 1.55 }}>
          C&apos;est ce qui rouvre la manche précédente à la correction. Le geste se répète : chaque
          fois, le tournoi recule d&apos;une manche. Les abandons et les pénalités déjà déclarés,
          eux, restent en vigueur.
        </p>

        {tournamentFinished && (
          <div
            role="note"
            style={{
              marginTop: 14,
              padding: "10px 12px",
              borderRadius: "var(--r-cy-sm, 8px)",
              border: "1px solid color-mix(in srgb, var(--red-live, #ff4d4d) 45%, transparent)",
              background: "color-mix(in srgb, var(--red-live, #ff4d4d) 8%, transparent)",
              fontSize: 12.5,
              lineHeight: 1.5,
              color: "var(--ink, #e7ecf3)",
            }}
          >
            🏁 <strong>Ce tournoi est terminé : il va être rouvert.</strong> Son classement final
            est effacé et il repasse « en cours ». Une nouvelle championne sera proclamée — et
            réannoncée sur Discord — dès que cette manche aura été rejouée.
          </div>
        )}

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

        {/* Une manche à seize équipes déborde des 220 pixels : la zone passe par
            `ScrollArea`, comme toute zone défilante du projet — c'est ce qui lui
            donne sa barre discrète et, surtout, l'accès au clavier qu'un
            `overflow: auto` posé à la main ne donne pas. La liste garde ses
            propres sémantiques à l'intérieur. */}
        <ScrollArea
          orientation="y"
          ariaLabel="Scores qui vont être effacés"
          style={{ maxHeight: 220, marginTop: 12 }}
        >
          <ul
            style={{
              listStyle: "none",
              margin: 0,
              padding: 0,
              display: "flex",
              flexDirection: "column",
              gap: 6,
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
                <span
                  className="mono"
                  style={{ color: "var(--ink, #e7ecf3)", whiteSpace: "nowrap" }}
                >
                  {scoreLabel(match)}
                </span>
              </li>
            ))}
          </ul>
        </ScrollArea>

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
              {/* Neutre, et pas « cette manche » : le stade peut être un *tour*
                  d'arbre final, et le libellé se serait trompé de genre une fois
                  sur deux. Le titre du dialogue, lui, porte déjà le nom exact. */}
              {busy ? "Effacement…" : "Effacer et reculer"}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
