import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import { parseRoles, toIso } from "@/lib/server/serialization";
import type { TeamJoinRequest, TeamRole, TeamSentInvitation } from "@/lib/shared/types";
import { getUserIdByPseudo, sanitizeRoles } from "@/lib/server/users-service";
import { arrivalRoles, teamJoinRefusal } from "@/lib/shared/team-join";
import { assertTermsAccepted } from "@/lib/server/terms-acceptance";
import { notifyTeamJoinRequest } from "@/lib/server/team-join-notifications";
import { ghostAdminOverride, userCanManageTeam } from "./access";

/*
 * Entrées dans une équipe : invitations envoyées par la gestion, demandes
 * d'adhésion des joueurs, et leur acceptation.
 */

type InvitationRow = RowDataPacket & {
  id: number;
  team_id: number;
  team_name: string;
  user_id: number;
  pseudo: string;
  kind: "INVITE" | "REQUEST";
  created_at: Date;
};

async function userHasActiveTeam(userId: number): Promise<boolean> {
  const db = await getDatabase();
  const [rows] = await db.execute<(RowDataPacket & { id: number })[]>(
    `SELECT id FROM bg_team_members WHERE user_id = ? AND left_at IS NULL LIMIT 1`,
    [userId],
  );
  return rows.length > 0;
}

/**
 * Fait entrer un joueur dans une équipe en acceptant une invitation ou une
 * demande — **en une seule transaction**.
 *
 * Les trois chemins d'acceptation (le joueur accepte, la gestion accepte, une
 * invitation croise une demande) lisaient `status = 'PENDING'`, relisaient
 * « ce joueur a-t-il une équipe ? », inséraient l'appartenance puis marquaient
 * l'invitation, en quatre instructions sur le pool : deux acceptations
 * simultanées — le joueur clique « Rejoindre » pendant que la gestion accepte sa
 * demande, ou deux équipes l'acceptent au même instant — passaient toutes deux
 * les contrôles, et l'invariant « une seule équipe active » n'est tenu par aucun
 * index.
 *
 * Le verrou est celui de la ligne du **joueur**, en toute première instruction
 * (sous `REPEATABLE READ`, c'est la première lecture ordinaire qui fige
 * l'instantané : placée avant l'attente, elle ferait lire un monde périmé). C'est
 * aussi celui que prennent la suppression de compte et la création d'une entrée
 * solo : une acceptation ne peut donc pas non plus rattacher un compte qu'on est
 * en train d'anonymiser. L'équipe est relue ensuite (une dissolution concurrente
 * rattacherait sinon le joueur à une équipe morte), puis l'invitation est
 * **réservée** par un `UPDATE`
 * conditionné à `PENDING`, relu sur `affectedRows` — une réponse arrivée entre
 * la lecture de l'appelant et ici l'emporte.
 *
 * **Reprise d'une équipe fantôme** : une invitation portant `OWNER` n'est
 * émise que par `claimGhostTeam` (staff `tournaments`) — une invitation de la
 * gestion ne peut jamais le porter. Elle seule fait entrer un joueur dans une
 * fantôme : il y arrive `OWNER`, l'équipe redevient ordinaire (`is_ghost = 0`)
 * et les autres reprises encore en attente sur elle deviennent caduques. Une
 * reprise dont la fantôme a déjà trouvé propriétaire est refusée
 * (`NOT_A_GHOST_TEAM`) plutôt que de faire entrer le joueur dans une équipe
 * réelle qui ne l'a pas invité.
 *
 * @param roles rôles posés à l'arrivée ; vide (demande, invitation d'avant la
 *   colonne) → `DPS`, le défaut d'origine. `OWNER` n'est posé que par une
 *   reprise de fantôme.
 */
async function acceptIntoTeam(
  invitationId: number,
  teamId: number,
  userId: number,
  roles: TeamRole[],
): Promise<void> {
  const claim = isGhostClaimRoles(roles);
  const payload = arrivalRoles(claim, sanitizeRoles(roles));

  const db = await getDatabase();
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const [account] = await connection.execute<(RowDataPacket & { is_deleted: 0 | 1 })[]>(
      `SELECT is_deleted FROM bg_users WHERE id = ? FOR UPDATE`,
      [userId],
    );
    if (account.length === 0 || account[0].is_deleted === 1) throw new Error("PLAYER_ACCOUNT_DELETED");

    // L'équipe est relue **sous verrou partagé**, et avant l'invitation : la
    // dissolution (`softDeleteTeam`) écrit l'équipe puis annule ses
    // invitations ; prendre les deux dans le même ordre qu'elle interdit
    // l'interblocage, et une dissolution commitée pendant l'attente est vue.
    // Une reprise **écrit** l'équipe (`is_ghost = 0`) : elle la verrouille donc
    // d'emblée en exclusif — deux reprises concurrentes qui tiendraient chacune
    // un verrou partagé s'interbloqueraient en voulant l'élever.
    const [teams] = await connection.execute<
      (RowDataPacket & { id: number; deleted_at: Date | null; is_ghost: 0 | 1; solo_user_id: number | null })[]
    >(
      `SELECT id, deleted_at, is_ghost, solo_user_id FROM bg_teams WHERE id = ? ${
        claim ? "FOR UPDATE" : "LOCK IN SHARE MODE"
      }`,
      [teamId],
    );
    const refusal = teamJoinRefusal(teams[0], claim);
    if (refusal) throw new Error(refusal);

    const [claimed] = await connection.execute<ResultSetHeader>(
      `UPDATE bg_team_invitations
       SET status = 'ACCEPTED', responded_at = NOW()
       WHERE id = ? AND status = 'PENDING'`,
      [invitationId],
    );
    if (Number(claimed.affectedRows) === 0) throw new Error("INVITATION_NOT_PENDING");

    const [active] = await connection.execute<(RowDataPacket & { id: number })[]>(
      `SELECT id FROM bg_team_members WHERE user_id = ? AND left_at IS NULL LIMIT 1`,
      [userId],
    );
    if (active.length > 0) throw new Error("USER_ALREADY_IN_TEAM");

    await connection.execute(
      `INSERT INTO bg_team_members (team_id, user_id, roles_json) VALUES (?, ?, ?)`,
      [teamId, userId, JSON.stringify(payload)],
    );
    // Toute autre invitation/demande en attente de ce joueur devient caduque.
    await connection.execute(
      `UPDATE bg_team_invitations
       SET status = 'CANCELLED', responded_at = NOW()
       WHERE user_id = ? AND status = 'PENDING'`,
      [userId],
    );
    if (claim) {
      // La fantôme a désormais un propriétaire : elle redevient une équipe
      // ordinaire, et les reprises proposées à d'autres joueurs n'ont plus
      // d'objet — les laisser en attente, elles finiraient refusées en
      // `NOT_A_GHOST_TEAM` sous les yeux de qui les accepterait.
      await connection.execute(`UPDATE bg_teams SET is_ghost = 0 WHERE id = ?`, [teamId]);
      await connection.execute(
        `UPDATE bg_team_invitations
         SET status = 'CANCELLED', responded_at = NOW()
         WHERE team_id = ? AND status = 'PENDING'`,
        [teamId],
      );
    }

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function findPendingInvitation(
  teamId: number,
  userId: number,
): Promise<{ id: number; kind: "INVITE" | "REQUEST"; roles: TeamRole[] } | null> {
  const db = await getDatabase();
  const [rows] = await db.execute<
    (RowDataPacket & { id: number; kind: "INVITE" | "REQUEST"; roles_json: unknown })[]
  >(
    `SELECT id, kind, roles_json FROM bg_team_invitations
     WHERE team_id = ? AND user_id = ? AND status = 'PENDING'
     ORDER BY created_at DESC LIMIT 1`,
    [teamId, userId],
  );
  return rows.length === 0
    ? null
    : { id: Number(rows[0].id), kind: rows[0].kind, roles: invitationRoles(rows[0].roles_json) };
}

/**
 * Rôles portés par une invitation, tels qu'ils seront posés à l'arrivée du
 * joueur. Une invitation sans rôle (demande d'adhésion, ou invitation émise
 * avant la colonne) rend une liste vide : `acceptIntoTeam` pose alors `DPS`,
 * le défaut d'origine.
 */
function invitationRoles(raw: unknown): TeamRole[] {
  return raw == null ? [] : parseRoles(raw);
}

/**
 * L'invitation est-elle la **reprise d'une équipe fantôme** ? Seule
 * `claimGhostTeam` pose `OWNER` sur une invitation : c'est sa marque.
 */
function isGhostClaimRoles(roles: readonly TeamRole[]): boolean {
  return roles.includes("OWNER");
}

/**
 * Rôles demandés à l'invitation : ceux que la gestion peut distribuer, jamais
 * `OWNER` (il se transfère). Absents, ils valent le défaut d'origine ; présents
 * mais vides, c'est un refus — même règle que `updateTeamMemberRoles`, un membre
 * sans rôle n'existant pas.
 */
function resolveInviteRoles(roles: readonly TeamRole[] | undefined): TeamRole[] {
  if (roles === undefined) return ["DPS"];
  const filtered = sanitizeRoles([...roles]).filter((role) => role !== "OWNER");
  if (filtered.length === 0) throw new Error("MISSING_ROLE");
  return filtered;
}

/**
 * La gestion d'équipe invite un joueur (par pseudo). Remplace l'ajout forcé.
 * Si une demande (REQUEST) du joueur est déjà en attente, l'invitation la valide
 * directement et le joueur rejoint l'équipe.
 */
export async function inviteToTeam(
  requesterId: number,
  teamId: number,
  pseudo: string,
  roles?: readonly TeamRole[],
): Promise<"INVITED" | "JOINED"> {
  if (!(await userCanManageTeam(teamId, requesterId))) throw new Error("FORBIDDEN");
  await assertTermsAccepted(requesterId);
  const inviteRoles = resolveInviteRoles(roles);

  const userId = await getUserIdByPseudo(pseudo);
  if (!userId) throw new Error("USER_NOT_FOUND");
  if (await userHasActiveTeam(userId)) throw new Error("USER_ALREADY_IN_TEAM");

  const existing = await findPendingInvitation(teamId, userId);
  if (existing?.kind === "REQUEST") {
    await acceptIntoTeam(existing.id, teamId, userId, inviteRoles);
    return "JOINED";
  }
  if (existing?.kind === "INVITE") throw new Error("ALREADY_INVITED");

  const db = await getDatabase();
  await db.execute(
    `INSERT INTO bg_team_invitations (team_id, user_id, created_by, kind, roles_json, status)
     VALUES (?, ?, ?, 'INVITE', ?, 'PENDING')`,
    [teamId, userId, requesterId, JSON.stringify(inviteRoles)],
  );
  return "INVITED";
}

/**
 * Un joueur demande à rejoindre une équipe (self-service). Si une invitation
 * (INVITE) lui est déjà adressée, la demande la valide et il rejoint directement.
 */
export async function requestToJoinTeam(userId: number, teamId: number): Promise<"REQUESTED" | "JOINED"> {
  if (await userHasActiveTeam(userId)) throw new Error("USER_ALREADY_IN_TEAM");

  const db = await getDatabase();
  const [teams] = await db.execute<
    (RowDataPacket & {
      id: number;
      deleted_at: Date | null;
      is_ghost: 0 | 1;
      solo_user_id: number | null;
    })[]
  >(
    `SELECT id, deleted_at, is_ghost, solo_user_id FROM bg_teams WHERE id = ? LIMIT 1`,
    [teamId],
  );
  if (teams.length === 0) throw new Error("TEAM_NOT_FOUND");
  if (teams[0].deleted_at !== null) throw new Error("TEAM_DELETED");
  // Ni une fantôme ni une entrée solo ne se rejoignent. Ni l'une ni l'autre n'a
  // de membre, donc personne n'a qualité pour répondre : la demande restait
  // en attente à jamais, et son auteur se voyait ensuite refuser toute autre
  // équipe par `ALREADY_REQUESTED`. Une fantôme se **reprend** sur proposition
  // du staff (`POST /api/teams/[id]/claim`, une invitation portant `OWNER`) :
  // « Rejoindre » sur sa fiche accepte cette proposition, et rien d'autre. Une
  // entrée solo n'est pas une équipe, c'est l'identité d'un joueur en tournoi
  // individuel.
  if (teams[0].solo_user_id !== null) throw new Error("TEAM_NOT_JOINABLE");

  const existing = await findPendingInvitation(teamId, userId);
  if (teams[0].is_ghost === 1) {
    if (existing?.kind === "INVITE" && isGhostClaimRoles(existing.roles)) {
      await acceptIntoTeam(existing.id, teamId, userId, existing.roles);
      return "JOINED";
    }
    throw new Error("TEAM_NOT_JOINABLE");
  }

  if (existing?.kind === "INVITE") {
    await acceptIntoTeam(existing.id, teamId, userId, existing.roles);
    return "JOINED";
  }
  if (existing?.kind === "REQUEST") throw new Error("ALREADY_REQUESTED");

  await db.execute(
    `INSERT INTO bg_team_invitations (team_id, user_id, created_by, kind, status)
     VALUES (?, ?, ?, 'REQUEST', 'PENDING')`,
    [teamId, userId, userId],
  );
  // Le propriétaire et les managers sont prévenus en message privé : sans cela,
  // la demande n'existait que pour qui pensait à ouvrir la fiche. Jamais
  // attendu — la demande est enregistrée, le message n'est qu'un avertissement.
  void notifyTeamJoinRequest(teamId, userId).catch((error) =>
    console.error("[teams] gestion non prévenue d'une demande d'adhésion", error),
  );
  return "REQUESTED";
}

/**
 * Répond à une invitation/demande en attente.
 * - INVITE : seul le joueur invité (user_id) peut répondre.
 * - REQUEST : seule la gestion de l'équipe peut répondre.
 */
export async function respondToInvitation(
  actingUserId: number,
  invitationId: number,
  accept: boolean,
): Promise<void> {
  const db = await getDatabase();
  const [rows] = await db.execute<(RowDataPacket & { team_id: number; user_id: number; kind: "INVITE" | "REQUEST"; status: string; roles_json: unknown })[]>(
    `SELECT team_id, user_id, kind, status, roles_json FROM bg_team_invitations WHERE id = ? LIMIT 1`,
    [invitationId],
  );
  if (rows.length === 0) throw new Error("INVITATION_NOT_FOUND");
  const inv = rows[0];
  if (inv.status !== "PENDING") throw new Error("INVITATION_NOT_PENDING");

  if (inv.kind === "INVITE") {
    if (Number(inv.user_id) !== actingUserId) throw new Error("FORBIDDEN");
  } else {
    if (!(await userCanManageTeam(Number(inv.team_id), actingUserId))) throw new Error("FORBIDDEN");
    // Faire entrer quelqu'un dans l'équipe est un geste de gestion ; refuser
    // une demande ne l'est pas — on ne bloque pas un « non ».
    if (accept) await assertTermsAccepted(actingUserId);
  }

  if (!accept) {
    await db.execute(
      `UPDATE bg_team_invitations SET status = 'DECLINED', responded_at = NOW() WHERE id = ?`,
      [invitationId],
    );
    return;
  }

  if (await userHasActiveTeam(Number(inv.user_id))) throw new Error("USER_ALREADY_IN_TEAM");
  // Une demande (REQUEST) ne porte aucun rôle : `acceptIntoTeam` pose DPS.
  await acceptIntoTeam(invitationId, Number(inv.team_id), Number(inv.user_id), invitationRoles(inv.roles_json));
}

/** Invitations (INVITE) en attente adressées au joueur. */
export async function listUserInvitations(userId: number): Promise<
  {
    id: number;
    teamId: number;
    teamName: string;
    kind: "INVITE" | "REQUEST";
    createdAt: string;
    /** Reprise d'une équipe fantôme : l'accepter en fait le propriétaire. */
    ownership: boolean;
  }[]
> {
  const db = await getDatabase();
  const [rows] = await db.execute<(InvitationRow & { roles_json: unknown })[]>(
    `SELECT i.id, i.team_id, t.name AS team_name, i.user_id, u.pseudo, i.kind, i.roles_json, i.created_at
     FROM bg_team_invitations i
     JOIN bg_teams t ON t.id = i.team_id
     JOIN bg_users u ON u.id = i.user_id
     WHERE i.user_id = ? AND i.kind = 'INVITE' AND i.status = 'PENDING'
     ORDER BY i.created_at DESC`,
    [userId],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    teamId: Number(r.team_id),
    teamName: r.team_name,
    kind: r.kind,
    createdAt: toIso(r.created_at) ?? new Date().toISOString(),
    ownership: isGhostClaimRoles(invitationRoles(r.roles_json)),
  }));
}

/**
 * Ce qui attend une réponse, vue gestion : les demandes (REQUEST) reçues et
 * les invitations (INVITE) envoyées — un seul contrôle de droits, une seule
 * requête.
 *
 * Les invitations envoyées ne se voyaient nulle part : ni pour savoir qui
 * attendre, ni pour en retirer une après une erreur de pseudo — réinviter le
 * même joueur ne rendant que `ALREADY_INVITED`.
 *
 * Sur une **fantôme**, le staff `tournaments` y lit les reprises qu'il a
 * proposées (`claimGhostTeam`) : personne d'autre n'a qualité pour le faire,
 * une fantôme n'ayant aucun membre.
 */
export async function listTeamPendingInvitations(
  teamId: number,
  requesterId: number,
  viewerManagesGhostTeams = false,
): Promise<{ requests: TeamJoinRequest[]; invitations: TeamSentInvitation[] }> {
  if (
    !(await userCanManageTeam(teamId, requesterId)) &&
    !(await ghostAdminOverride(teamId, viewerManagesGhostTeams))
  ) {
    throw new Error("FORBIDDEN");
  }
  const db = await getDatabase();
  const [rows] = await db.execute<
    (RowDataPacket & {
      id: number;
      user_id: number;
      pseudo: string;
      kind: "INVITE" | "REQUEST";
      roles_json: unknown;
      created_at: Date;
    })[]
  >(
    `SELECT i.id, i.user_id, u.pseudo, i.kind, i.roles_json, i.created_at
     FROM bg_team_invitations i
     JOIN bg_users u ON u.id = i.user_id
     WHERE i.team_id = ? AND i.status = 'PENDING'
     ORDER BY i.created_at DESC`,
    [teamId],
  );

  const requests: TeamJoinRequest[] = [];
  const invitations: TeamSentInvitation[] = [];
  for (const r of rows) {
    const base = {
      id: Number(r.id),
      userId: Number(r.user_id),
      pseudo: r.pseudo,
      createdAt: toIso(r.created_at) ?? new Date().toISOString(),
    };
    if (r.kind === "REQUEST") {
      requests.push(base);
    } else {
      const roles = invitationRoles(r.roles_json);
      // Invitation d'avant la colonne : le joueur arrivera en DPS, on le dit.
      invitations.push({ ...base, roles: roles.length === 0 ? (["DPS"] as TeamRole[]) : roles });
    }
  }
  return { requests, invitations };
}

/**
 * Retire une invitation ou une demande encore en attente.
 *
 * A qualité celui qui l'a émise, au sens de l'acte et non de la ligne : une
 * **invitation** est l'acte de l'équipe (toute sa gestion, quel que soit le
 * membre qui l'a envoyée — `created_by` peut d'ailleurs être `NULL`), une
 * **demande** est l'acte du joueur. Le destinataire, lui, répond par
 * `respondToInvitation`.
 *
 * L'écriture est conditionnée à `status = 'PENDING'` : une réponse arrivée entre
 * la lecture et l'écriture l'emporte, et l'annulation est refusée plutôt que de
 * réécrire une invitation déjà acceptée.
 *
 * Une **reprise de fantôme** est l'acte du staff `tournaments`, qui doit pouvoir
 * la retirer — un pseudo mal choisi, une proposition devenue sans objet : sans
 * cela, elle attendrait indéfiniment et resterait acceptable des semaines plus
 * tard. D'où la dérogation fantôme, la même que pour le reste de
 * l'administration d'une fantôme (`viewerManagesGhostTeams`).
 */
export async function cancelInvitation(
  actingUserId: number,
  invitationId: number,
  viewerManagesGhostTeams = false,
): Promise<void> {
  const db = await getDatabase();
  const [rows] = await db.execute<
    (RowDataPacket & { team_id: number; user_id: number; kind: "INVITE" | "REQUEST"; status: string })[]
  >(
    `SELECT team_id, user_id, kind, status FROM bg_team_invitations WHERE id = ? LIMIT 1`,
    [invitationId],
  );
  if (rows.length === 0) throw new Error("INVITATION_NOT_FOUND");
  const inv = rows[0];
  if (inv.status !== "PENDING") throw new Error("INVITATION_NOT_PENDING");

  if (inv.kind === "INVITE") {
    const teamId = Number(inv.team_id);
    if (
      !(await userCanManageTeam(teamId, actingUserId)) &&
      !(await ghostAdminOverride(teamId, viewerManagesGhostTeams))
    ) {
      throw new Error("FORBIDDEN");
    }
  } else if (Number(inv.user_id) !== actingUserId) {
    throw new Error("FORBIDDEN");
  }

  const [res] = await db.execute<ResultSetHeader>(
    `UPDATE bg_team_invitations
     SET status = 'CANCELLED', responded_at = NOW()
     WHERE id = ? AND status = 'PENDING'`,
    [invitationId],
  );
  if (Number(res.affectedRows) === 0) throw new Error("INVITATION_NOT_PENDING");
}
