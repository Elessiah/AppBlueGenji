"use client";

import { FormEvent, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useToast } from "@/components/ui/toast";
import { useBackdropDismiss } from "@/lib/shared/hooks/useBackdropDismiss";
import { useDialogBehavior } from "@/lib/shared/hooks/useDialogBehavior";
import { formatLocalDateTime } from "@/lib/shared/dates";
import { participantWording } from "@/lib/shared/participants";
import {
  advanceTarget,
  willCloseWithoutMatches,
  type AdvanceTarget,
} from "@/lib/shared/tournament-launch";
import { computeTournamentProgress, TOURNAMENT_STAGE_META } from "@/lib/shared/tournament-progress";
import type { TournamentCard, TournamentState } from "@/lib/shared/types";
import { mapError } from "../_lib/error-map";

type AdvanceResult = { target: AdvanceTarget; state: TournamentState; entrantCount: number };

interface AdvanceTournamentDialogProps {
  card: TournamentCard;
  onClose: () => void;
  onAdvanced: (result: AdvanceResult) => void;
}

/** Titre et bouton de confirmation, par étape visée. */
const TARGET_COPY: Record<AdvanceTarget, { title: string; confirm: string }> = {
  REGISTRATION: { title: "Ouvrir les inscriptions maintenant", confirm: "Ouvrir les inscriptions" },
  LOCKED: { title: "Clore les inscriptions maintenant", confirm: "Clore les inscriptions" },
  RUNNING: { title: "Lancer le tournoi maintenant", confirm: "Lancer maintenant" },
};

/**
 * Confirmation de « Avancer le tournoi » : l'étape suivante, sur-le-champ.
 *
 * Pas de recopie du nom, contrairement à la suppression : le tournoi n'est pas
 * détruit, il avance — au pire une heure trop tôt. Mais l'action reste sans
 * retour (rien ne rouvre des inscriptions closes), et le dialogue dit donc
 * concrètement ce qui change plutôt qu'un « êtes-vous sûr ? » : le **passage**
 * d'une étape à l'autre, nommé comme sur la frise en bas de la fiche
 * (`tournament-progress.ts`), la date qu'on abandonne, et l'effectif.
 *
 * Le cas du plateau désert est annoncé avant le clic et non découvert après :
 * lancer à moins de deux engagés clôt le tournoi sur-le-champ
 * (`docs/features/UNDERFILLED_TOURNAMENTS.md`), et le bouton le dit alors.
 *
 * Portail sur `document.body` pour la même raison que les autres dialogues de
 * cette page : `.page-shell` enferme son contenu sous la barre de navigation.
 */
export function AdvanceTournamentDialog({
  card,
  onClose,
  onAdvanced,
}: AdvanceTournamentDialogProps) {
  const { showError } = useToast();
  const [busy, setBusy] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const dialogRef = useDialogBehavior({ open: mounted, onClose, locked: busy });
  const backdrop = useBackdropDismiss(onClose, busy);

  const wording = participantWording(card.participantType);
  const entrantCount = card.registeredTeams;
  // Calculé à l'ouverture et non à chaque rendu : le dialogue reste monté
  // pendant que le flux SSE redessine la page, et voir l'étape annoncée changer
  // sous le curseur pendant qu'on lit la confirmation serait pire que de
  // l'afficher figée le temps d'un clic. Le serveur, lui, rejoue la règle.
  const [plan] = useState(() => ({
    from: computeTournamentProgress(card).current,
    target: advanceTarget(card),
  }));
  // Le bouton d'en-tête n'ouvre ce dialogue que s'il y a une étape suivante ;
  // à défaut (l'heure a tourné entre-temps), on retombe sur le coup d'envoi, que
  // le serveur refusera proprement s'il n'y a vraiment plus rien à avancer.
  const target: AdvanceTarget = plan.target ?? "RUNNING";
  const copy = TARGET_COPY[target];
  const passage = `${TOURNAMENT_STAGE_META[plan.from].label} › ${TOURNAMENT_STAGE_META[target].label}`;
  const empty = target === "RUNNING" && willCloseWithoutMatches(entrantCount);
  // Ouvrir les inscriptions d'un tournoi masqué le publie au passage : c'est
  // une conséquence visible de tous, elle ne doit pas se cacher dans le
  // passage d'étape (voir `lib/shared/tournament-launch.ts`).
  const publishes = plan.from === "HIDDEN";

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;

    setBusy(true);
    try {
      const res = await fetch(`/api/admin/tournaments/${card.id}/advance`, { method: "POST" });
      const payload = (await res.json()) as { error?: string; advanced?: AdvanceResult };
      if (!res.ok || !payload.advanced) {
        throw new Error(payload.error || "TOURNAMENT_ADVANCE_FAILED");
      }
      onAdvanced(payload.advanced);
    } catch (e) {
      showError(mapError((e as Error).message));
      setBusy(false);
    }
  };

  if (!mounted) return null;

  return createPortal(
    <div
      role="presentation"
      {...backdrop}
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
        aria-labelledby="advance-tournament-title"
        // Le résumé est lu à l'ouverture, avant que le focus n'atteigne les
        // boutons : sans lui, la modale s'annonce par son seul titre et laisse
        // deviner ce que « maintenant » remplace.
        aria-describedby="advance-tournament-summary"
        tabIndex={-1}
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
        <h3 id="advance-tournament-title" style={{ margin: 0, fontSize: 18 }}>
          {copy.title}
        </h3>

        <p
          id="advance-tournament-summary"
          style={{ marginTop: 10, fontSize: 13, color: "var(--text-2, #9aa4b2)", lineHeight: 1.55 }}
        >
          {target === "REGISTRATION" && (
            <>
              Les inscriptions ouvrent à cet instant, au lieu du{" "}
              <strong style={{ color: "var(--ink)" }}>
                {formatLocalDateTime(card.registrationOpenAt)}
              </strong>
              . Leur clôture et le coup d&apos;envoi restent prévus aux dates annoncées.
            </>
          )}
          {target === "LOCKED" && (
            <>
              Les inscriptions ferment à cet instant, au lieu du{" "}
              <strong style={{ color: "var(--ink)" }}>
                {formatLocalDateTime(card.registrationCloseAt)}
              </strong>
              : personne ne pourra plus rejoindre le tournoi. Le coup d&apos;envoi reste prévu le{" "}
              <strong style={{ color: "var(--ink)" }}>{formatLocalDateTime(card.startAt)}</strong>.
            </>
          )}
          {target === "RUNNING" && (
            <>
              Le coup d&apos;envoi est avancé à cet instant, au lieu du{" "}
              <strong style={{ color: "var(--ink)" }}>{formatLocalDateTime(card.startAt)}</strong>.
              Le tirage est fait sur les engagés du moment : personne ne pourra plus rejoindre le
              tournoi.
            </>
          )}
        </p>

        <dl
          style={{
            margin: "16px 0 0",
            display: "grid",
            // `auto minmax(0, 1fr)` et non `1fr auto` : la liste des étapes est
            // la valeur la plus longue, et c'est elle qui doit se replier sur
            // une fenêtre étroite plutôt que d'écraser son intitulé.
            gridTemplateColumns: "auto minmax(0, 1fr)",
            gap: "8px 16px",
            fontSize: 13,
            alignItems: "baseline",
          }}
        >
          <dt style={{ color: "var(--text-2, #9aa4b2)" }}>Étape</dt>
          <dd
            style={{
              margin: 0,
              fontWeight: 600,
              textAlign: "right",
              overflowWrap: "anywhere",
            }}
          >
            {passage}
          </dd>
          {/* L'effectif ne compte qu'une fois figé : à la clôture des
              inscriptions et au coup d'envoi. Les ouvrir ne le fige pas. */}
          {target !== "REGISTRATION" && (
            <>
              <dt style={{ color: "var(--text-2, #9aa4b2)" }}>
                {target === "RUNNING"
                  ? `${entrantCount > 1 ? wording.manyCapitalized : wording.oneCapitalized} au départ`
                  : "Effectif final"}
              </dt>
              <dd className="num" style={{ margin: 0, fontWeight: 600, textAlign: "right" }}>
                {entrantCount}
              </dd>
            </>
          )}
        </dl>

        {publishes && (
          <p style={{ marginTop: 14, fontSize: 13, lineHeight: 1.55, color: "var(--text-2, #9aa4b2)" }}>
            Ce tournoi n&apos;était pas encore publié : ouvrir ses inscriptions le rend visible de
            tous.
          </p>
        )}

        {empty && (
          // Rouge assumé : ce n'est pas un lancement mais une clôture, et
          // l'annoncer après coup serait la découvrir à la place du staff.
          <p
            // `role="note"` plutôt qu'une simple couleur : le rouge est la
            // seule chose qui distingue cet avertissement du reste, et il ne
            // dit rien à qui ne le voit pas.
            role="note"
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
              {busy ? "Un instant…" : empty ? "Clore le tournoi" : copy.confirm}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
