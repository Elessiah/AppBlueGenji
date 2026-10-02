"use client";

import { FormEvent, useState } from "react";
import { useToast } from "@/components/ui/toast";
import { computeTournamentState } from "@/lib/shared/tournament-state";
import type { TournamentCard } from "@/lib/shared/types";
import { mapError } from "../_lib/error-map";
import { TournamentDialogShell } from "./TournamentDialogShell";

interface RemoveEntrantDialogProps {
  card: TournamentCard;
  teamId: number;
  entrantName: string;
  onClose: () => void;
  onRemoved: () => void;
}

/**
 * Confirmation du retrait d'un engagé, avant le coup d'envoi.
 *
 * Pas de recopie du nom, contrairement à la suppression d'un tournoi : aucun
 * historique n'est détruit ici, il n'y en a pas encore. Mais le bouton voisine
 * des flèches de réordonnancement, à trente-deux pixels d'un geste anodin : une
 * confirmation nommant l'engagé est ce qui distingue les deux.
 *
 * Elle dit les deux choses qu'on ne devine pas. La première : l'inscription est
 * **effacée** — l'engagé n'apparaîtra nulle part comme ayant participé, à la
 * différence d'un abandon.
 *
 * La seconde dépend de l'étape, et c'est pourquoi elle est calculée et non
 * écrite une fois pour toutes. Tant que les **inscriptions sont ouvertes**, le
 * geste se défait : la place est rendue et quelqu'un peut la reprendre — souvent
 * la raison même du retrait, sur un plateau complet dont on attend un
 * désistement. **Une fois closes**, il ne se défait plus : `registerTeam` exige
 * l'état `REGISTRATION`, donc ni l'engagé ni le staff ne peuvent revenir en
 * arrière sans rouvrir les inscriptions par l'édition du tournoi. C'est
 * exactement le moment où l'on retire un désistement de dernière minute, et ce
 * n'est pas au clic de l'apprendre.
 *
 * L'étape se lit sur les **dates** (`computeTournamentState`), comme partout
 * ailleurs côté client : l'état stocké retombe à `UPCOMING` dans cet entre-deux,
 * et le serveur, lui, accepte toujours le retrait.
 *
 * Coquille (portail, voile, titre, boutons) : `TournamentDialogShell`.
 */
export function RemoveEntrantDialog({
  card,
  teamId,
  entrantName,
  onClose,
  onRemoved,
}: Readonly<RemoveEntrantDialogProps>) {
  const { showError, showSuccess } = useToast();
  const [busy, setBusy] = useState(false);

  // Figé à l'ouverture, comme la liste des étapes de `LaunchTournamentDialog` :
  // le dialogue reste monté pendant que le flux SSE redessine la page, et voir
  // la phrase changer sous le curseur serait pire que de la lire figée le temps
  // d'un clic.
  const [registrationOpen] = useState(() => computeTournamentState(card) === "REGISTRATION");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;

    setBusy(true);
    try {
      const res = await fetch(`/api/admin/tournaments/${card.id}/registrations/${teamId}`, {
        method: "DELETE",
      });
      const payload = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(payload.error || "ENTRANT_REMOVAL_FAILED");
      // Tournure neutre : le genre de « équipe » et de « joueur » diverge.
      showSuccess(`${entrantName} ne figure plus parmi les engagés.`);
      onRemoved();
    } catch (e) {
      showError(mapError((e as Error).message));
      setBusy(false);
    }
  };

  return (
    <TournamentDialogShell
      titleId="remove-entrant-title"
      summaryId="remove-entrant-summary"
      maxWidth={440}
      title={<>Retirer {entrantName} du tournoi</>}
      busy={busy}
      onClose={onClose}
      onSubmit={submit}
      submitLabel={busy ? "Retrait…" : "Retirer"}
    >
      <p
        id="remove-entrant-summary"
        style={{ marginTop: 10, fontSize: 13, color: "var(--text-2, #9aa4b2)", lineHeight: 1.55 }}
      >
        L&apos;inscription est <strong style={{ color: "var(--ink)" }}>effacée</strong> : rien
        n&apos;indiquera que cet engagé a pris part au tournoi, à la différence d&apos;un abandon.
        La place est rendue au plateau.
      </p>

      {registrationOpen ? (
        <p
          style={{ marginTop: 12, fontSize: 13, color: "var(--text-2, #9aa4b2)", lineHeight: 1.55 }}
        >
          Les inscriptions sont ouvertes : la place libérée peut être reprise, et cet engagé
          réinscrit.
        </p>
      ) : (
        <p
          // `role="note"` plutôt qu'une simple couleur : l'ambre est la seule
          // chose qui distingue cet avertissement du paragraphe au-dessus, et
          // il ne dit rien à qui ne le voit pas.
          role="note"
          style={{
            marginTop: 12,
            fontSize: 13,
            lineHeight: 1.55,
            color: "var(--amber, #ffb347)",
          }}
        >
          Les inscriptions sont closes : plus personne ne peut prendre cette place, et cet engagé
          ne pourra pas être réinscrit sans rouvrir les inscriptions.
        </p>
      )}
    </TournamentDialogShell>
  );
}
