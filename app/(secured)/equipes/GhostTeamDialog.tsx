"use client";

import { FormEvent, useState } from "react";
import { useToast } from "@/components/ui/toast";
import {
  TEAM_TAG_MAX_LENGTH,
  TEAM_TAG_MIN_LENGTH,
  normalizeTeamTag,
  teamTagErrorMessage,
} from "@/lib/shared/team-tag";
import s from "./GhostTeamDialog.module.css";

type GhostTeamDialogProps = {
  onClose: () => void;
  /** Appelé après création réussie, pour rafraîchir la liste. */
  onCreated: () => void;
};

/**
 * Création d'une équipe fantôme (staff `tournaments`). L'équipe n'a aucun
 * joueur : seuls un nom et une description facultative sont demandés. Le logo
 * se règle ensuite depuis la fiche de l'équipe, comme pour une équipe réelle.
 */
export function GhostTeamDialog({ onClose, onCreated }: GhostTeamDialogProps) {
  const { showError, showSuccess } = useToast();
  const [name, setName] = useState("");
  const [tag, setTag] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const response = await fetch("/api/teams", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          description: description.trim() || null,
          tag: tag.trim() || null,
          ghost: true,
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "GHOST_TEAM_CREATE_FAILED");
      showSuccess("Équipe fantôme créée.");
      onCreated();
      onClose();
    } catch (e) {
      const code = (e as Error).message;
      showError(teamTagErrorMessage(code) ?? code);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={s.backdrop} role="dialog" aria-modal="true" aria-labelledby="ghost-team-title">
      <div className={s.panel}>
        <h2 id="ghost-team-title" className={s.title}>
          Nouvelle équipe fantôme
        </h2>
        <p className={s.lede}>
          Une équipe sans joueur rattaché, administrée par le staff. Elle peut être inscrite à un
          tournoi puis attribuée à un joueur réel.
        </p>

        <form onSubmit={submit}>
          <div className="field">
            <label htmlFor="ghost-team-name">Nom de l&apos;équipe</label>
            <input
              id="ghost-team-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              minLength={3}
              maxLength={60}
              required
              autoFocus
            />
          </div>
          <div className="field">
            <label htmlFor="ghost-team-tag">Sigle (facultatif)</label>
            <input
              id="ghost-team-tag"
              value={tag}
              onChange={(e) => setTag(normalizeTeamTag(e.target.value))}
              minLength={TEAM_TAG_MIN_LENGTH}
              maxLength={TEAM_TAG_MAX_LENGTH}
              pattern="[A-Za-z0-9]*"
              placeholder="BG"
              aria-describedby="ghost-team-tag-help"
              style={{ textTransform: "uppercase", letterSpacing: "0.12em", maxWidth: 160 }}
            />
            <p id="ghost-team-tag-help" style={{ fontSize: 11, color: "var(--ink-mute)", margin: "6px 0 0" }}>
              {TEAM_TAG_MIN_LENGTH} à {TEAM_TAG_MAX_LENGTH} lettres ou chiffres, unique sur le site
            </p>
          </div>
          <div className="field">
            <label htmlFor="ghost-team-description">Description (facultatif)</label>
            <textarea
              id="ghost-team-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>

          <div className={s.actions}>
            <button type="button" className="btn ghost" onClick={onClose} disabled={busy}>
              Annuler
            </button>
            <button type="submit" className="btn" disabled={busy}>
              {busy ? "Création…" : "Créer l'équipe"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
