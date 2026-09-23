import type { TeamRole } from "@/lib/shared/types";
import { sortTeamRoles, teamRoleFamily, teamRoleLabel } from "@/lib/shared/team-role-display";
import styles from "../team.module.css";

const FAMILY_ICON: Record<ReturnType<typeof teamRoleFamily>, string | null> = {
  owner: "★",
  management: "⚙",
  game: null,
};

/**
 * Rôles d'un membre en pastilles : libellés français, dans l'ordre du plus fort
 * au plus sportif, la famille dite par la couleur **et** par un pictogramme —
 * la couleur seule ne se lit pas partout.
 */
export function RolePills({ roles, label }: { roles: readonly TeamRole[]; label?: string }) {
  const sorted = sortTeamRoles(roles);
  if (sorted.length === 0) return <span className={styles.joinedAt}>—</span>;
  return (
    <ul className={styles.rolePills} aria-label={label ?? "Rôles"}>
      {sorted.map((role) => {
        const family = teamRoleFamily(role);
        const icon = FAMILY_ICON[family];
        return (
          <li key={role} className={styles.rolePill} data-family={family}>
            {icon ? (
              <span className={styles.rolePillIcon} aria-hidden>
                {icon}
              </span>
            ) : null}
            {teamRoleLabel(role)}
          </li>
        );
      })}
    </ul>
  );
}
