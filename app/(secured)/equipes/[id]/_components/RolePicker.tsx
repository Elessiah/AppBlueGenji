"use client";

import { useId } from "react";
import type { TeamRole } from "@/lib/shared/types";
import { Coche } from "@/components/Coche";
import {
  ASSIGNABLE_GAME_ROLES,
  ASSIGNABLE_MANAGEMENT_ROLES,
  teamRoleLabel,
} from "@/lib/shared/team-role-display";
import styles from "../team.module.css";

interface RolePickerProps {
  selected: readonly TeamRole[];
  onChange: (roles: TeamRole[]) => void;
}

/**
 * Choix des rôles d'un membre, en deux groupes.
 *
 * `MANAGER` se cochait comme `TANK`, au milieu des rôles de jeu, alors qu'il
 * donne la main sur l'équipe : il est séparé, et son effet est écrit sous lui.
 * `OWNER` n'y figure jamais — il se transfère, il ne se coche pas.
 */
export function RolePicker({ selected, onChange }: RolePickerProps) {
  // Deux sélecteurs peuvent coexister (formulaire d'invitation et modale des
  // rôles) : un identifiant écrit en dur serait dupliqué dans la page.
  const helpId = useId();
  const toggle = (role: TeamRole) => {
    onChange(selected.includes(role) ? selected.filter((r) => r !== role) : [...selected, role]);
  };

  return (
    <div className={styles.rolePicker}>
      <fieldset className={styles.roleGroup}>
        <legend className={styles.roleGroupLegend}>Rôles de jeu</legend>
        <div className={styles.roleGroupOptions}>
          {ASSIGNABLE_GAME_ROLES.map((role) => (
            <Coche
              key={role}
              label={teamRoleLabel(role)}
              checked={selected.includes(role)}
              theme="equipe"
              onChange={() => toggle(role)}
            />
          ))}
        </div>
      </fieldset>
      <fieldset className={styles.roleGroup}>
        <legend className={styles.roleGroupLegend}>Gestion de l&apos;équipe</legend>
        <div className={styles.roleGroupOptions}>
          {ASSIGNABLE_MANAGEMENT_ROLES.map((role) => (
            <Coche
              key={role}
              label={teamRoleLabel(role)}
              checked={selected.includes(role)}
              theme="equipe"
              onChange={() => toggle(role)}
              aria-describedby={helpId}
            />
          ))}
        </div>
        <p id={helpId} className={styles.help}>
          Un manager invite et exclut des membres, distribue les rôles, change le logo et inscrit
          l&apos;équipe aux tournois. Le nom, le sigle, la description et la dissolution restent au
          propriétaire.
        </p>
      </fieldset>
    </div>
  );
}
