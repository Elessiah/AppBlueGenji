"use client";

import { FormEvent, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useToast } from "@/components/ui/toast";
import { useDialogBehavior } from "@/lib/shared/hooks/useDialogBehavior";
import { formatLocalDateTime } from "@/lib/shared/dates";
import { participantWording } from "@/lib/shared/participants";
import { abridgedStagesForLaunch, willCloseWithoutMatches } from "@/lib/shared/tournament-launch";
import { TOURNAMENT_STAGE_META } from "@/lib/shared/tournament-progress";
import type { TournamentCard } from "@/lib/shared/types";
import { mapError } from "../_lib/error-map";

interface LaunchTournamentDialogProps {
  card: TournamentCard;
  onClose: () => void;
  onLaunched: (result: { state: string; entrantCount: number }) => void;
}

/**
 * Confirmation du lancement anticipé d'un tournoi.
 *
 * Pas de recopie du nom, contrairement à la suppression : le tournoi n'est pas
 * détruit, il commence — au pire une heure trop tôt. Mais l'action reste sans
 * retour (rien ne rouvre des inscriptions closes), et surtout elle **fige
 * l'effectif**. Le dialogue montre donc trois choses concrètes plutôt qu'un
 * « êtes-vous sûr ? » : les **étapes d'avant-course** qui n'auront pas lieu, le
 * nombre d'engagés au départ, et l'heure de début qu'on abandonne.
 *
 * Les étapes viennent du module pur (`abridgedStagesForLaunch`) et portent les
 * libellés de la frise de la page (`tournament-progress.ts`) : ce que le staff
 * voit sauter ici est nommé exactement comme ce qu'il voit sur la barre en bas
 * de la fiche.
 *
 * Le cas du plateau désert est annoncé avant le clic et non découvert après :
 * lancer à moins de deux engagés clôt le tournoi sur-le-champ
 * (`docs/features/UNDERFILLED_TOURNAMENTS.md`), et le bouton le dit alors.
 *
 * Portail sur `document.body` pour la même raison que les autres dialogues de
 * cette page : `.page-shell` enferme son contenu sous la barre de navigation.
 */
export function LaunchTournamentDialog({
  card,
  onClose,
  onLaunched,
}: LaunchTournamentDialogProps) {
  const { showError } = useToast();
  const [busy, setBusy] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const dialogRef = useDialogBehavior({ open: mounted, onClose, locked: busy });

  const wording = participantWording(card.participantType);
  const entrantCount = card.registeredTeams;
  const empty = willCloseWithoutMatches(entrantCount);
  // Calculé à l'ouverture et non à chaque rendu : le dialogue reste monté
  // pendant que le flux SSE redessine la page, et voir la liste des étapes
  // changer sous le curseur pendant qu'on lit la confirmation serait pire que
  // de l'afficher figée le temps d'un clic. Le serveur, lui, rejoue la règle.
  const [abridged] = useState(() => abridgedStagesForLaunch(card));
  const stages = abridged.map((key) => TOURNAMENT_STAGE_META[key].label);
  // Abréger depuis l'étape « masqué » publie le tournoi au passage : c'est une
  // conséquence visible de tous, elle ne doit pas se cacher dans la liste des
  // étapes (voir `lib/shared/tournament-launch.ts`).
  const publishes = abridged.includes("HIDDEN");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;

    setBusy(true);
    try {
      const res = await fetch(`/api/admin/tournaments/${card.id}/launch`, { method: "POST" });
      const payload = (await res.json()) as {
        error?: string;
        launched?: { state: string; entrantCount: number };
      };
      if (!res.ok || !payload.launched) {
        throw new Error(payload.error || "TOURNAMENT_LAUNCH_FAILED");
      }
      onLaunched(payload.launched);
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
        aria-labelledby="launch-tournament-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 480,
          maxHeight: "90vh",
          overflow: "auto",
          background: "var(--cyber-bg-2, #14181f)",
          border: "1px solid var(--line-strong-cy, #2a3340)",
          borderRadius: "var(--r-cy-md, 12px)",
          boxShadow: "0 24px 64px rgba(0,0,0,0.6)",
          padding: 22,
        }}
      >
        <h3 id="launch-tournament-title" style={{ margin: 0, fontSize: 18 }}>
          Lancer le tournoi maintenant
        </h3>

        <p style={{ marginTop: 10, fontSize: 13, color: "var(--text-2, #9aa4b2)", lineHeight: 1.55 }}>
          Le coup d&apos;envoi est avancé à cet instant, au lieu du{" "}
          <strong style={{ color: "var(--ink)" }}>{formatLocalDateTime(card.startAt)}</strong>. Le
          tirage est fait sur les engagés du moment : personne ne pourra plus rejoindre le tournoi.
        </p>

        <dl
          style={{
            margin: "16px 0 0",
            display: "grid",
            gridTemplateColumns: "1fr auto",
            gap: "8px 16px",
            fontSize: 13,
            alignItems: "baseline",
          }}
        >
          {stages.length > 0 && (
            <>
              <dt style={{ color: "var(--text-2, #9aa4b2)" }}>Étapes abrégées</dt>
              <dd style={{ margin: 0, fontWeight: 600, textAlign: "right" }}>
                {stages.join(" › ")}
              </dd>
            </>
          )}
          <dt style={{ color: "var(--text-2, #9aa4b2)" }}>
            {entrantCount > 1 ? wording.manyCapitalized : wording.oneCapitalized} au départ
          </dt>
          <dd className="num" style={{ margin: 0, fontWeight: 600, textAlign: "right" }}>
            {entrantCount}
          </dd>
        </dl>

        {publishes && (
          <p style={{ marginTop: 14, fontSize: 13, lineHeight: 1.55, color: "var(--text-2, #9aa4b2)" }}>
            Ce tournoi n&apos;était pas encore publié : le lancer le rend visible de tous, en même
            temps qu&apos;il le démarre.
          </p>
        )}

        {empty && (
          // Rouge assumé : ce n'est pas un lancement mais une clôture, et
          // l'annoncer après coup serait la découvrir à la place du staff.
          <p
            style={{
              marginTop: 14,
              fontSize: 13,
              lineHeight: 1.55,
              color: "var(--red-live, #ff4d4d)",
            }}
          >
            Moins de deux engagés : le tournoi ne jouera aucun match et sera clos aussitôt
            {entrantCount === 1 ? ", l'unique engagé étant déclaré premier" : ""}.
          </p>
        )}

        <form onSubmit={submit}>
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
              disabled={busy}
              style={{ padding: "8px 20px", fontSize: 13 }}
            >
              {busy ? "Lancement…" : empty ? "Clore le tournoi" : "Lancer maintenant"}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
