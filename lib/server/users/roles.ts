import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import { normalizePseudo, parseRoles } from "@/lib/server/serialization";
import { closeUserStreams } from "@/lib/server/session-streams";
import { type PlatformRole, sanitizePlatformRoles } from "@/lib/shared/permissions";
import type { TeamRole } from "@/lib/shared/types";

/**
 * Remplace l'intégralité des rôles de permission d'un utilisateur.
 * Le rôle `ADMIN` est persisté via la colonne `is_admin` ; les autres rôles
 * cumulables (ARBITRE, COMMUNITY_MANAGER, RECRUTEUR) dans `platform_roles_json`.
 * Réservé aux administrateurs (contrôle d'accès effectué côté route API).
 *
 * @returns la liste normalisée des rôles effectivement enregistrés.
 */
export async function setUserRoles(
  targetUserId: number,
  roles: PlatformRole[],
): Promise<PlatformRole[]> {
  const db = await getDatabase();
  const [rows] = await db.execute<(RowDataPacket & { id: number })[]>(
    `SELECT id FROM bg_users WHERE id = ? AND is_deleted = 0 LIMIT 1`,
    [targetUserId],
  );
  if (rows.length === 0) {
    throw new Error("USER_NOT_FOUND");
  }

  const sanitized = sanitizePlatformRoles(roles);
  const isAdmin = sanitized.includes("ADMIN");
  // Ne persister en JSON que les rôles cumulables non-ADMIN (ADMIN ⇔ is_admin).
  const nonAdminRoles = sanitized.filter((role) => role !== "ADMIN");

  // Le `SELECT` ci-dessus donne le **refus lisible** (`USER_NOT_FOUND`), la
  // condition ici tranche la **course** : les deux ne font pas double emploi,
  // c'est le même partage qu'entre le contrôle préalable d'un sigle d'équipe et
  // son index unique. Un `await` sépare la lecture de l'écriture, et une
  // suppression de compte glissée entre les deux laissait un rôle de
  // plateforme posé sur une ligne anonymisée — invisible de `getCurrentUser`,
  // qui filtre déjà les lignes mortes, mais bien listé à l'écran des rôles, qui
  // rend les comptes supprimés.
  const [result] = await db.execute<ResultSetHeader>(
    `UPDATE bg_users SET is_admin = ?, platform_roles_json = ? WHERE id = ? AND is_deleted = 0`,
    [isAdmin ? 1 : 0, JSON.stringify(nonAdminRoles), targetUserId],
  );
  // Et la course se **dit**, elle ne se tait pas : `affectedRows` compte les
  // lignes appariées (mysql2 pose `FOUND_ROWS`), donc zéro ne signifie pas
  // « rien à modifier » mais « la ligne vivante a disparu entre les deux ».
  // Rendre `sanitized` sans regarder affichait les rôles comme enregistrés à
  // l'écran d'administration alors que rien ne l'avait été. C'est le refus que
  // le `SELECT` ci-dessus donne déjà, et le même geste que `updateOwnProfile`
  // et `updateUserAvatar`, qui refusent bruyamment sur la même condition.
  if (result.affectedRows === 0) throw new Error("USER_NOT_FOUND");

  // Un flux SSE de tournoi ne lit les droits qu'à son ouverture : il gardait
  // le palier, l'aperçu du plateau et l'accès aux tournois non publiés d'un
  // rôle retiré tant que l'onglet restait ouvert. Le fermer fait reconnecter
  // le client, et la route recalcule le contexte du lecteur sur les rôles
  // enregistrés — retrait comme ajout (`session-streams.ts`).
  closeUserStreams(targetUserId);

  return sanitized;
}

/**
 * Résout un pseudo vers le compte **vivant** qui le porte.
 *
 * Ses deux appelants nomment un joueur pour l'**attacher à une équipe** —
 * `inviteToTeam` et la reprise d'une équipe fantôme, qui en fait un `OWNER`. Un
 * compte anonymisé garde une ligne et donc un pseudo (d'emprunt) :
 * sans la condition, il restait invitable, et une demande d'adhésion déposée
 * avant la suppression le faisait même **rejoindre** le roster séance tenante —
 * soit rattacher à une équipe vivante un compte dont on vient de promettre
 * qu'il ne servirait plus à rien. Pire côté fantôme : il en devenait
 * propriétaire, sans personne pour ouvrir la session qui l'administre.
 *
 * Le filtre est posé ici et pas chez les appelants parce que c'est **l'unique**
 * traduction « pseudo → compte à rattacher », et que les deux traitent déjà le
 * `null` en `USER_NOT_FOUND` — ce qui est exactement ce qu'un compte supprimé
 * doit être pour eux.
 */
export async function getUserIdByPseudo(pseudo: string): Promise<number | null> {
  const db = await getDatabase();
  const [rows] = await db.execute<(RowDataPacket & { id: number })[]>(
    `SELECT id FROM bg_users WHERE pseudo = ? AND is_deleted = 0 LIMIT 1`,
    [normalizePseudo(pseudo)],
  );

  return rows.length === 0 ? null : Number(rows[0].id);
}

/**
 * Ne garde d'une liste de rôles d'équipe que les valeurs connues, dédupliquées.
 *
 * **Aucun repli** : une entrée vide ou entièrement invalide rend une liste
 * vide, et c'est à l'appelant de dire ce qu'il en fait — `MISSING_ROLE` quand
 * on modifie un membre existant, `DPS` quand on en accueille un nouveau. La
 * fonction repliait jusqu'ici sur `["OWNER"]`, ce que ses appelants
 * annulaient aussitôt en filtrant ce rôle : le repli n'a donc jamais rien
 * accordé, mais il attendait le premier appelant qui oublierait le filtre pour
 * faire d'un corps de requête vide une prise de propriété.
 */
export function sanitizeRoles(roles: TeamRole[]): TeamRole[] {
  return Array.from(new Set(parseRoles(roles)));
}
