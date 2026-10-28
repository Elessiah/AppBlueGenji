/**
 * Réponse à la fenêtre « Certifier ton tag Discord » proposée à la connexion
 * (`docs/features/DISCORD_CERTIFY_PROMPT.md`).
 *
 * `POST { action: "LATER" }` — « Plus tard », fermeture, ou passage au
 * dialogue de `/profil` : la fenêtre ne revient pas sur **cette session**.
 * `POST { action: "NEVER" }` — « Ne plus voir » : posé sur le compte, et ses
 * sessions aussi. `GET` — la proposition est-elle **encore** due ? Relue par
 * la fenêtre avant de s'ouvrir sur une page chargée plus tôt (choix fait
 * entre-temps sur un autre appareil) ; il **n'écrit rien** (`clearStale:
 * false`). Rien ici ne certifie : la certification reste
 * `POST /api/profile/discord`. Provenance vérifiée par le middleware.
 *
 * Le `POST` porte le compte à qui la fenêtre a été montrée (`userId`) : une
 * session changée depuis (autre compte connecté dans ce navigateur) répond 409
 * `CERTIFY_PROMPT_OTHER_ACCOUNT` sans rien écrire. Une session qui ne doit
 * rien (marque déjà levée) répond sans écrire : rejouée, la réponse ne coûte
 * aucune écriture.
 */
import { currentTokenHash, getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { isUnknownColumnError } from "@/lib/server/mysql-errors";
import { readJsonBody } from "@/lib/server/request-body";
import {
  loadDiscordCertifyPrompt,
  markDiscordCertifyPromptSeen,
  recordDiscordCertifyPromptOff,
} from "@/lib/server/users/discord-certify-prompt";
import { ACCOUNT_DELETED_ERROR } from "@/lib/shared/account-deletion";
import {
  CERTIFY_PROMPT_OTHER_ACCOUNT,
  parseCertifyPromptAction,
  parseCertifyPromptUserId,
} from "@/lib/shared/discord-certify-prompt";

/**
 * `{ prompt }` — le parcours encore offert à cette session, ou `null` (déjà
 * certifié, « Ne plus voir », déjà répondue, session close). Une session sans
 * marque ne coûte aucune requête (`certifyPromptDue`, lu avec la session).
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  if (!user.certifyPromptDue) return ok({ prompt: null });
  try {
    return ok({ prompt: await loadDiscordCertifyPrompt(user.id, await currentTokenHash(), { clearStale: false }) });
  } catch (error) {
    console.error("[discord] GET certify-prompt failed:", error);
    return fail("CERTIFY_PROMPT_FAILED", 500);
  }
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);

  let action;
  let shownTo;
  try {
    const body = (await readJsonBody(req)) as { action?: unknown; userId?: unknown } | null;
    action = parseCertifyPromptAction(body?.action);
    shownTo = parseCertifyPromptUserId(body?.userId);
  } catch {
    action = null;
  }
  // Sans compte (corps malformé, ou client d'avant ce champ) : refusé comme une
  // action illisible — jamais dit « autre compte », qui serait faux.
  if (!action || shownTo == null) return fail("INVALID_ACTION", 400);
  if (shownTo !== user.id) return fail(CERTIFY_PROMPT_OTHER_ACCOUNT, 409);
  // « Plus tard » sur une session qui ne doit rien (déjà répondue, jamais
  // proposée) : rien à écrire. « Ne plus voir », lui, est toujours gardé — un
  // « Plus tard » donné dans un autre onglet a pu lever la marque avant (écriture
  // idempotente : la date du premier choix reste).
  if (action === "LATER" && !user.certifyPromptDue) return ok({ action });

  try {
    if (action === "NEVER") {
      // Le compte et toutes ses sessions, celle-ci comprise, en un appel.
      if (!(await recordDiscordCertifyPromptOff(user.id))) return fail(ACCOUNT_DELETED_ERROR, 409);
    } else {
      await markDiscordCertifyPromptSeen(user.id, await currentTokenHash());
    }
    return ok({ action });
  } catch (error) {
    // Colonne absente : la fenêtre ne s'ouvre pas non plus (`loadDiscordCertifyPrompt`).
    if (isUnknownColumnError(error)) return fail("CERTIFY_PROMPT_UNAVAILABLE", 503);
    console.error("[discord] POST certify-prompt failed:", error);
    return fail("CERTIFY_PROMPT_FAILED", 500);
  }
}
