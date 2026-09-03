"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { ScrollArea } from "@/components/cyber";
import { useToast } from "@/components/ui/toast";
import {
  guestBatchSuccessMessage,
  matchesTeamSearch,
  registrationErrorTeamId,
} from "@/lib/shared/ghost-registration";
import { useParticipantWording } from "../_lib/entrant-link";
import { mapEntrantError } from "../_lib/error-map";
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
  const [loaded, setLoaded] = useState(false);
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
        setLoaded(true);
        // Plus rien à cocher (aucune fantôme, ou toutes déjà engagées) : la
        // création est le seul chemin utile.
        if (available.length === 0) setMode("new");
      } catch (e) {
        if (!cancelled) showError(mapEntrantError((e as Error).message, null));
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

  const overCapacity = selected.length > remainingSlots;

  // Trois vides bien distincts : on ne sait pas encore, il n'y a plus rien à
  // inscrire, ou la recherche ne trouve rien. « Aucun résultat » sur une liste
  // qui n'a pas fini de charger enverrait créer une équipe déjà en stock.
  const emptyMessage = !loaded
    ? "Chargement…"
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
  const selectVisible = () => {
    setSelected((current) => {
      const next = [...current];
      for (const team of visible) if (!next.includes(team.id)) next.push(team.id);
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
      showError(mapEntrantError((e as Error).message, name));
    } finally {
      setBusy(false);
    }
  };

  const submitDisabled = busy
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
            disabled={teams.length === 0}
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
                {selected.length} / {remainingSlots} place{remainingSlots > 1 ? "s" : ""}
              </span>
            </p>

            <input
              type="search"
              className={styles.search}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
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
                disabled={busy || visible.length === 0}
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
              overCapacity
                ? `Il ne reste que ${remainingSlots} place${remainingSlots > 1 ? "s" : ""} dans ce tournoi.`
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
