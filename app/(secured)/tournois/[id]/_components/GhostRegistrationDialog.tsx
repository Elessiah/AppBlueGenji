"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { ScrollArea } from "@/components/cyber";
import { useToast } from "@/components/ui/toast";
import {
  batchCapacity,
  batchCounterLabel,
  GHOST_BATCH_MAX,
  guestBatchSuccessMessage,
  matchesTeamSearch,
  registrationErrorTeamId,
} from "@/lib/shared/ghost-registration";
import { useParticipantWording } from "../_lib/entrant-link";
import { mapBatchError } from "../_lib/error-map";
import styles from "./GhostRegistrationDialog.module.css";

type GhostTeamOption = { id: number; name: string; logoUrl: string | null };

interface GhostRegistrationDialogProps {
  tournamentId: number;
  /** Places encore libres, pour borner la sélection avant l'aller-retour. */
  remainingSlots: number;
  onClose: () => void;
  onRegistered: () => void;
}

/**
 * Inscription par le staff (`tournaments`) d'engagés sans compte sur le site :
 * des équipes fantômes, ou des joueurs invités si le tournoi est individuel —
 * c'est la même ligne `bg_teams` dans les deux cas, seul le vocabulaire change.
 *
 * Deux chemins : cocher plusieurs engagés existants et les inscrire **en une
 * seule action**, ou en créer un à la volée — le cas courant quand il faut
 * compléter un bracket juste avant le départ.
 *
 * La liste ne propose que ce qui reste à inscrire : les déjà engagés sont
 * écartés côté serveur (`listGhostTeams(tournamentId)`), pas masqués ici. Elle
 * peut être longue (un jeu de test compte cent quarante équipes de
 * remplissage), d'où la recherche et la zone défilante.
 *
 * Le lot est **tout ou rien** : le serveur défait toute la transaction au
 * premier refus, et nomme l'engagé qui a bloqué.
 */
export function GhostRegistrationDialog({
  tournamentId,
  remainingSlots,
  onClose,
  onRegistered,
}: GhostRegistrationDialogProps) {
  const { showError, showSuccess } = useToast();
  const wording = useParticipantWording();
  const [teams, setTeams] = useState<GhostTeamOption[]>([]);
  // Trois états, pas deux : la liste n'est pas « vide » tant qu'on ne sait pas,
  // et une liste qu'on n'a pas pu lire n'est pas une liste épuisée.
  const [load, setLoad] = useState<"pending" | "loaded" | "failed">("pending");
  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [selected, setSelected] = useState<number[]>([]);
  const [query, setQuery] = useState("");
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/admin/tournaments/${tournamentId}/ghost-registrations`, {
          cache: "no-store",
        });
        const payload = (await res.json()) as { teams?: GhostTeamOption[]; error?: string };
        if (!res.ok) throw new Error(payload.error || "GHOST_TEAMS_LOAD_FAILED");
        if (cancelled) return;
        const available = payload.teams ?? [];
        setTeams(available);
        setLoad("loaded");
        // Plus rien à cocher (aucune fantôme, ou toutes déjà engagées) : la
        // création est le seul chemin utile.
        if (available.length === 0) setMode("new");
      } catch (e) {
        if (cancelled) return;
        // Sans cette branche, l'échec laissait « Chargement… » à l'écran pour la
        // vie du dialogue, l'onglet « Existantes » désactivé et aucun repli : il
        // fallait fermer et rouvrir pour retenter.
        setLoad("failed");
        // On bascule sur la création — le seul chemin encore praticable —, mais
        // l'onglet « Existantes » reste ouvert : c'est là que se lit *pourquoi*
        // la liste est vide.
        setMode("new");
        showError(mapBatchError((e as Error).message, null, 1));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tournamentId, showError]);

  const visible = useMemo(
    () => teams.filter((team) => matchesTeamSearch(team.name, query)),
    [teams, query],
  );

  const nameById = useMemo(
    () => new Map(teams.map((team) => [team.id, team.name])),
    [teams],
  );

  const capacity = batchCapacity(remainingSlots);
  const overCapacity = selected.length > capacity;

  // Trois vides bien distincts : on ne sait pas encore, il n'y a plus rien à
  // inscrire, ou la recherche ne trouve rien. « Aucun résultat » sur une liste
  // qui n'a pas fini de charger enverrait créer une équipe déjà en stock.
  const emptyMessage =
    load === "pending"
      ? "Chargement…"
      : load === "failed"
        ? "Liste indisponible. Ferme et rouvre la fenêtre pour réessayer."
        : teams.length === 0
          ? wording.guestNoneLeft
          : "Aucun résultat pour cette recherche.";

  const toggle = (teamId: number) => {
    setSelected((current) =>
      current.includes(teamId)
        ? current.filter((id) => id !== teamId)
        : [...current, teamId],
    );
  };

  // « Tout sélectionner » porte sur ce que la recherche laisse voir : cocher en
  // masse des lignes hors écran serait un piège, la sélection ne se relisant que
  // par son compteur.
  //
  // Il s'arrête à ce qu'un lot peut porter : cocher cent quarante équipes de
  // remplissage devant quatorze places désactivait « Inscrire » sans autre issue
  // que de décocher cent vingt-six cases à la main.
  const selectVisible = () => {
    setSelected((current) => {
      const next = [...current];
      for (const team of visible) {
        if (next.length >= capacity) break;
        if (!next.includes(team.id)) next.push(team.id);
      }
      return next;
    });
  };

  const registerBatch = async (teamIds: number[]) => {
    const res = await fetch(`/api/admin/tournaments/${tournamentId}/ghost-registrations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ teamIds }),
    });
    const payload = (await res.json()) as { error?: string; teamId?: number };
    if (!res.ok) {
      throw Object.assign(new Error(payload.error || "GHOST_REGISTRATION_FAILED"), {
        teamId: payload.teamId,
      });
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    // Retenu avant le premier `await` : c'est la taille du lot *envoyé* qui dit
    // si le refus doit préciser que rien n'a été enregistré.
    const batchSize = mode === "new" ? 1 : selected.length;
    try {
      let teamIds = selected;

      if (mode === "new") {
        const res = await fetch("/api/teams", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: newName.trim(), ghost: true }),
        });
        const payload = (await res.json()) as { teamId?: number; error?: string };
        if (!res.ok || !payload.teamId) throw new Error(payload.error || "GHOST_TEAM_CREATE_FAILED");
        teamIds = [payload.teamId];
      }

      if (teamIds.length === 0) throw new Error("EMPTY_TEAM_SELECTION");

      await registerBatch(teamIds);
      showSuccess(guestBatchSuccessMessage(teamIds.length, wording));
      onRegistered();
      onClose();
    } catch (e) {
      // Le refus qui désigne un engagé le nomme : sur un lot de trente, « déjà
      // inscrite » sans nom n'apprend rien.
      const teamId = registrationErrorTeamId(e);
      const name = teamId === undefined ? null : nameById.get(teamId) ?? null;
      showError(mapBatchError((e as Error).message, name, batchSize));
    } finally {
      setBusy(false);
    }
  };

  // Le plafond vaut aussi pour la création : sans lui, `POST /api/teams` créait
  // l'équipe fantôme *puis* l'inscription échouait en 409 — une ligne orpheline
  // dans `bg_teams`, reproposée à tous les autres tournois, et une de plus à
  // chaque nouvelle tentative.
  const noSlot = capacity < 1;
  const submitDisabled = busy
    || noSlot
    || (mode === "existing"
      ? selected.length === 0 || overCapacity
      : newName.trim().length < 3);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="ghost-registration-title"
      onClick={() => {
        if (!busy) onClose();
      }}
      className={styles.overlay}
    >
      <form onClick={(e) => e.stopPropagation()} onSubmit={submit} className={styles.panel}>
        <h3 id="ghost-registration-title" className={styles.title}>
          {wording.guestTitle}
        </h3>
        <p className={styles.hint}>{wording.guestHint}</p>

        <div className={styles.modes}>
          <button
            type="button"
            className={`${mode === "existing" ? "btn" : "btn ghost"} ${styles.modeButton}`}
            onClick={() => setMode("existing")}
            aria-pressed={mode === "existing"}
          >
            Existantes
          </button>
          <button
            type="button"
            className={`${mode === "new" ? "btn" : "btn ghost"} ${styles.modeButton}`}
            onClick={() => setMode("new")}
            aria-pressed={mode === "new"}
          >
            Nouvelle
          </button>
        </div>

        {mode === "existing" ? (
          <div>
            <p className={styles.listLabel} id="ghost-team-list-label">
              <span>{wording.guestSelectManyLabel}</span>
              {/* Le seul retour d'un clic sur une case est ce compteur : il doit
                  aussi s'entendre. */}
              <span
                aria-live="polite"
                className={`${styles.count} ${
                  overCapacity ? styles.countOver : selected.length > 0 ? styles.countActive : ""
                }`}
              >
                {batchCounterLabel(selected.length, remainingSlots)}
              </span>
            </p>

            <input
              type="search"
              className={styles.search}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              // Un champ de saisie dans un formulaire soumet à la touche Entrée.
              // Ici, filtrer puis appuyer sur Entrée inscrivait le lot coché et
              // fermait la fenêtre : une écriture irréversible sans le clic qui
              // la confirme. Le filtre s'applique déjà à la frappe, Entrée n'a
              // donc rien à y déclencher.
              onKeyDown={(e) => {
                if (e.key === "Enter") e.preventDefault();
              }}
              placeholder="Rechercher…"
              aria-label="Filtrer la liste par nom"
              autoFocus
            />

            <ScrollArea
              orientation="y"
              className={styles.list}
              ariaLabel={wording.guestSelectManyLabel}
            >
              {visible.length === 0 ? (
                <p className={styles.empty}>{emptyMessage}</p>
              ) : (
                visible.map((team) => {
                  const checked = selected.includes(team.id);
                  return (
                    <label
                      key={team.id}
                      className={`${styles.option} ${checked ? styles.optionChecked : ""}`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggle(team.id)}
                        disabled={busy}
                      />
                      <span className={styles.optionName}>{team.name}</span>
                    </label>
                  );
                })
              )}
            </ScrollArea>

            <div className={styles.bulk}>
              <button
                type="button"
                className={styles.linkButton}
                onClick={selectVisible}
                disabled={busy || visible.length === 0 || selected.length >= capacity}
              >
                Tout sélectionner
              </button>
              <button
                type="button"
                className={styles.linkButton}
                onClick={() => setSelected([])}
                disabled={busy || selected.length === 0}
              >
                Tout désélectionner
              </button>
            </div>
          </div>
        ) : (
          <div className="field">
            <label htmlFor="ghost-team-new-name">{wording.guestNewNameLabel}</label>
            <input
              id="ghost-team-new-name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              minLength={3}
              maxLength={60}
              required
              autoFocus
            />
          </div>
        )}

        <div className={styles.actions}>
          <button
            type="button"
            className={`btn ghost ${styles.actionButton}`}
            onClick={onClose}
            disabled={busy}
          >
            Annuler
          </button>
          <button
            type="submit"
            className={`btn ${styles.actionButton}`}
            disabled={submitDisabled}
            // Le bouton grisé doit dire pourquoi : le compteur passe à l'ambre,
            // encore faut-il faire le lien.
            title={
              noSlot
                ? "Ce tournoi est complet : il n'y a plus de place à prendre."
                : overCapacity
                ? remainingSlots <= GHOST_BATCH_MAX
                  ? `Il ne reste que ${remainingSlots} place${remainingSlots > 1 ? "s" : ""} dans ce tournoi.`
                  : `${GHOST_BATCH_MAX} engagés au maximum par inscription : recommencez pour les suivants.`
                : undefined
            }
          >
            {busy
              ? "Inscription…"
              : mode === "existing" && selected.length > 1
                ? `Inscrire (${selected.length})`
                : "Inscrire"}
          </button>
        </div>
      </form>
    </div>
  );
}
