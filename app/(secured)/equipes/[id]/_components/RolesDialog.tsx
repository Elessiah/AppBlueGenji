"use client";

import { useState } from "react";
import type { TeamRole } from "@/lib/shared/types";
import { TeamDialog } from "./TeamDialog";
import { RolePicker } from "./RolePicker";
import styles from "../team.module.css";

export interface RolesDialogTarget {
  userId: number;
  pseudo: string;
  isOwner: boolean;
  /** Rôles actuels, `OWNER` retiré : il ne se coche pas. */
  selected: TeamRole[];
  /** La modale édite les rôles de qui l'a ouverte. */
  isViewer: boolean;
}

interface RolesDialogProps {
  target: RolesDialogTarget;
  onClose: () => void;
  /** Rend `true` si l'enregistrement a réussi — la modale ne se ferme qu'alors. */
  onSave: (selected: TeamRole[]) => Promise<boolean>;
}

export function RolesDialog({ target, onClose, onSave }: RolesDialogProps) {
  const [selected, setSelected] = useState(target.selected);
  const [pending, setPending] = useState(false);

  const unchanged =
    selected.length === target.selected.length && selected.every((role) => target.selected.includes(role));
  const empty = selected.length === 0;
  // Se retirer soi-même le rôle de manager, c'est perdre la main sur l'équipe
  // au clic suivant : ça se fait, mais ça se dit avant.
  const dropsOwnManagement =
    target.isViewer &&
    !target.isOwner &&
    target.selected.includes("MANAGER") &&
    !selected.includes("MANAGER");

  const save = async () => {
    if (empty || unchanged || pending) return;
    setPending(true);
    const ok = await onSave(selected);
    // Refus : la modale reste ouverte avec la sélection, pour corriger.
    if (!ok) setPending(false);
  };

  return (
    <TeamDialog
      title={target.isViewer ? "Mes rôles" : `Rôles de ${target.pseudo}`}
      onClose={onClose}
      busy={pending}
      onSubmit={save}
      footer={
        <>
          <button type="button" className="btn ghost" onClick={onClose} disabled={pending}>
            Annuler
          </button>
          <button type="submit" className={`btn ${styles.primaryButton}`} disabled={empty || unchanged || pending}>
            {pending ? "Enregistrement…" : "Enregistrer"}
          </button>
        </>
      }
    >
      {target.isOwner ? (
        <p>
          Le rôle de propriétaire ne se coche pas : il se transfère, depuis les paramètres de
          l&apos;équipe.
        </p>
      ) : null}
      <RolePicker selected={selected} onChange={setSelected} />
      {empty ? (
        <p className={styles.help} role="status">
          Choisis au moins un rôle : un membre sans rôle n&apos;existe pas.
        </p>
      ) : null}
      {dropsOwnManagement ? (
        <p className={styles.help} role="status">
          Sans le rôle de manager, tu ne pourras plus gérer le roster de l&apos;équipe.
        </p>
      ) : null}
    </TeamDialog>
  );
}
