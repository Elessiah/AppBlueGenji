import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { createTeam, getUserActiveTeam, listTeams } from "@/lib/server/teams-service";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);

  const teams = await listTeams();
  const activeTeam = await getUserActiveTeam(user.id);

  return ok({ teams, activeTeam });
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);

  try {
    const body = (await req.json()) as { name?: string; logoUrl?: string | null };
    const name = (body.name ?? "").trim();

    if (name.length < 3 || name.length > 60) {
      return fail("INVALID_TEAM_NAME", 400);
    }

    const teamId = await createTeam(user.id, name, body.logoUrl ?? null);
    return ok({ teamId }, 201);
  } catch (error) {
    const message = (error as Error).message;
    if (message === "USER_ALREADY_IN_TEAM") return fail(message, 409);
    if (message.includes("Duplicate") || message.includes("duplicate")) return fail("TEAM_NAME_ALREADY_USED", 409);
    return fail(message || "TEAM_CREATE_FAILED", 400);
  }
}
