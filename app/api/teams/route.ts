import { getCurrentUser } from "@/lib/server/auth";
import {
  chargeRateLimitFor,
  DIRECTORY_READ_RULE,
  enforceRateLimit,
  peekRateLimit,
  TEAM_LIFECYCLE_RULE,
} from "@/lib/server/api-guard";
import { fail, ok } from "@/lib/server/http";
import { listTeams } from "@/lib/server/teams/directory";
import { createTeam } from "@/lib/server/teams/identity";
import { getUserActiveTeam } from "@/lib/server/teams/roster";
import { createGhostTeam } from "@/lib/server/ghost-teams-service";
import { can } from "@/lib/shared/permissions";
import { TERMS_REQUIRED, TERMS_VERSION, TERMS_VERSION_MISMATCH } from "@/lib/shared/terms-of-use";
import { TEAM_TAG_ALREADY_USED, checkTeamTag } from "@/lib/shared/team-tag";
import {
  INVALID_TEAM_FIELDS,
  TEAM_NAME_ALREADY_USED,
  checkTeamName,
  teamFieldsAreText,
} from "@/lib/shared/team-name";
import { readJsonBody } from "@/lib/server/request-body";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);

  const throttled = enforceRateLimit(DIRECTORY_READ_RULE, user.id);
  if (throttled) return throttled;

  // Le lecteur voyage jusqu'à la liste pour le seul masquage d'avatar : il doit
  // voir le sien même s'il l'a masqué au reste du site.
  const teams = await listTeams(user.id);
  const activeTeam = await getUserActiveTeam(user.id);

  // Pilote l'affichage des contrôles d'équipes fantômes côté client.
  return ok({ teams, activeTeam, canManageGhostTeams: can(user, "tournaments") });
}

/**
 * Refus de la case des conditions d'utilisation, ou `null` si elle est valable.
 * La version montrée doit être celle en vigueur : un formulaire chargé avant une
 * nouvelle version (ou un client d'avant ce champ) n'accepte pas un texte qu'il
 * n'a pas présenté — `createTeam` enregistre `TERMS_VERSION`.
 */
function refuseTermsAcceptance(body: { acceptTerms?: boolean; termsVersion?: unknown }) {
  // Sans version (page d'avant ce champ) : le refus que ces pages savent dire.
  if (body.acceptTerms !== true || body.termsVersion === undefined) return fail(TERMS_REQUIRED, 400);
  if (body.termsVersion !== TERMS_VERSION) return fail(TERMS_VERSION_MISMATCH, 409);
  return null;
}

/**
 * Création soumise au plafond des créations et dissolutions d'un compte
 * (`TEAM_LIFECYCLE_RULE`) — le staff `tournaments` n'y est pas soumis. Seule
 * une création réussie est décomptée.
 */
async function createCappedTeam(
  user: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>,
  name: string,
  description: string | null,
  tag: string | null,
) {
  const capped = !can(user, "tournaments");
  const throttled = capped ? peekRateLimit(TEAM_LIFECYCLE_RULE, user.id) : null;
  if (throttled) return throttled;
  const teamId = await createTeam(user.id, name, description, tag);
  if (capped) chargeRateLimitFor(TEAM_LIFECYCLE_RULE, user.id);
  return ok({ teamId }, 201);
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);

  try {
    const body = (await readJsonBody(req)) as {
      name?: string;
      description?: string | null;
      tag?: string | null;
      ghost?: boolean;
      acceptTerms?: boolean;
      /** Version des conditions que le formulaire a montrée. */
      termsVersion?: unknown;
    };
    if (!teamFieldsAreText(body, ["name", "description", "tag"])) return fail(INVALID_TEAM_FIELDS, 400);
    // Mêmes bornes qu'au renommage (`updateTeamMeta`) : une seule règle.
    const nameCheck = checkTeamName(body.name);
    if (!nameCheck.ok) return fail(nameCheck.reason, 400);
    const name = nameCheck.name;

    // Forme du sigle contrôlée ici, avant toute écriture : le refus dit lequel
    // des trois défauts corriger, et le service n'a plus à s'en soucier.
    const tagCheck = checkTeamTag(body.tag);
    if (!tagCheck.ok) return fail(tagCheck.reason, 400);

    // Équipe fantôme : réservée au staff tournois, et sans membre — l'auteur
    // n'en devient donc pas propriétaire et garde son équipe active.
    if (body.ghost === true) {
      if (!can(user, "tournaments")) return fail("FORBIDDEN", 403);
      const ghostTeamId = await createGhostTeam(name, body.description ?? null, tagCheck.tag);
      return ok({ teamId: ghostTeamId, ghost: true }, 201);
    }

    // Créer une équipe, c'est accepter les conditions d'utilisation — la case
    // du formulaire. Refusé avant toute écriture, pas après.
    const termsRefusal = refuseTermsAcceptance(body);
    if (termsRefusal) return termsRefusal;
    return await createCappedTeam(user, name, body.description ?? null, tagCheck.tag);
  } catch (error) {
    const message = (error as Error).message;
    if (message === "USER_ALREADY_IN_TEAM") return fail(message, 409);
    // Avant le repli sur le nom : `bg_teams` porte deux uniques, et une
    // collision de sigle annoncée comme un nom déjà pris enverrait corriger le
    // mauvais champ.
    if (message === TEAM_TAG_ALREADY_USED) return fail(message, 409);
    if (message.includes("Duplicate") || message.includes("duplicate")) return fail(TEAM_NAME_ALREADY_USED, 409);
    return fail(message || "TEAM_CREATE_FAILED", 400);
  }
}
