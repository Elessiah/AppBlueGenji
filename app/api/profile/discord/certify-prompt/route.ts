/**
 * Réponse à la fenêtre « Certifier ton tag Discord » proposée à la connexion
 * (`docs/features/DISCORD_CERTIFY_PROMPT.md`).
 *
 * `POST { action: "LATER" }` — « Plus tard », fermeture, ou passage au
 * dialogue de `/profil` : la fenêtre ne revient pas sur **cette session**.
 * `POST { action: "NEVER" }` — « Ne plus voir » : posé sur le compte, et la
 * session aussi. Rien ici ne certifie : la certification reste
 * `POST /api/profile/discord`. Provenance vérifiée par le middleware.
 */
import { currentTokenHash, getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { isUnknownColumnError } from "@/lib/server/mysql-errors";
import { readJsonBody } from "@/lib/server/request-body";
import {
  markDiscordCertifyPromptSeen,
  recordDiscordCertifyPromptOff,
} from "@/lib/server/users/discord-certify-prompt";
import { ACCOUNT_DELETED_ERROR } from "@/lib/shared/account-deletion";
import { parseCertifyPromptAction } from "@/lib/shared/discord-certify-prompt";

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);

  let action;
  try {
    const body = (await readJsonBody(req)) as { action?: unknown } | null;
    action = parseCertifyPromptAction(body?.action);
  } catch {
    action = null;
  }
  if (!action) return fail("INVALID_ACTION", 400);

  try {
    if (action === "NEVER" && !(await recordDiscordCertifyPromptOff(user.id))) {
      return fail(ACCOUNT_DELETED_ERROR, 409);
    }
    await markDiscordCertifyPromptSeen(user.id, await currentTokenHash());
    return ok({ action });
  } catch (error) {
    // Colonne absente : la fenêtre ne s'ouvre pas non plus (`loadDiscordCertifyPrompt`).
    if (isUnknownColumnError(error)) return fail("CERTIFY_PROMPT_UNAVAILABLE", 503);
    console.error("[discord] POST certify-prompt failed:", error);
    return fail("CERTIFY_PROMPT_FAILED", 500);
  }
}
