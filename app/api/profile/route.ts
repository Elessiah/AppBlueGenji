import { clearSession, getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { deleteOwnAccount, getFullProfile, updateOwnProfile } from "@/lib/server/users-service";
import { ACCOUNT_DELETED_ERROR } from "@/lib/shared/account-deletion";
import { BATTLETAG_LOCKED } from "@/lib/shared/battletag-lock";
import { DISCORD_TAG_LOCKED } from "@/lib/shared/discord-tag-lock";
import { isProfileInputError } from "@/lib/shared/profile-input-errors";

/** Les refus de `deleteOwnAccount` qui sortent tels quels : ils ont un sens pour l'écran. */
const ACCOUNT_DELETION_REFUSALS: ReadonlySet<string> = new Set([
  "ACCOUNT_STILL_REFERENCED",
  "USER_NOT_FOUND",
]);

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);

  const profile = await getFullProfile({ id: user.id }, user.id);
  if (!profile) return fail("PROFILE_NOT_FOUND", 404);

  return ok(profile);
}

export async function PATCH(req: Request) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);

  try {
    const body = (await req.json()) as {
      pseudo?: string;
      overwatchBattletag?: string | null;
      marvelRivalsTag?: string | null;
      discordPseudo?: string | null;
      isAdult?: boolean | null;
      // Le pseudo n'est pas masquable : il identifie le joueur partout où il
      // joue (brackets, rosters, feuilles de match).
      visibility?: {
        avatar?: boolean;
        overwatch?: boolean;
        marvel?: boolean;
        major?: boolean;
        discord?: boolean;
      };
      openToRecruitment?: boolean;
    };

    await updateOwnProfile(user.id, body);
    const profile = await getFullProfile({ id: user.id }, user.id);
    return ok(profile);
  } catch (error) {
    const message = (error as Error).message;
    if (message === "PSEUDO_ALREADY_USED") return fail(message, 409);
    // Le compte a été supprimé pendant que la sauvegarde attendait son verrou :
    // même refus que sur l'avatar, et même code — c'est un conflit d'état, pas
    // une saisie fautive.
    if (message === ACCOUNT_DELETED_ERROR) return fail(message, 409);
    // La saisie est bonne, c'est l'état du compte qui l'interdit : un compte
    // Discord rattaché possède son tag (`lib/shared/discord-tag-lock.ts`).
    if (message === DISCORD_TAG_LOCKED) return fail(message, 409);
    // Même nature : un compte Blizzard rattaché possède son BattleTag
    // (`lib/shared/battletag-lock.ts`).
    if (message === BATTLETAG_LOCKED) return fail(message, 409);
    if (isProfileInputError(message)) return fail(message, 400);
    // Tout le reste est une panne, pas un refus : un corps illisible (le
    // `SyntaxError` de `req.json()`), une erreur MySQL, un `TypeError`. Leur
    // message est **interne** — il nomme une colonne, une fonction, un jeton —
    // et partait tel quel dans le corps de la réponse. Il reste au journal du
    // serveur ; le client reçoit le code générique, que l'écran traduit.
    console.error("[profile] PATCH failed:", error);
    return fail("PROFILE_UPDATE_FAILED", 400);
  }
}

export async function DELETE() {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);

  try {
    // Le plan voyage jusqu'à l'écran : « effacé » et « anonymisé » ne sont pas
    // la même promesse, et le motif de la conservation encore moins — c'est le
    // serveur qui vient de trancher les deux.
    const plan = await deleteOwnAccount(user.id);
    await clearSession();
    return ok({ deleted: true, ...plan });
  } catch (error) {
    // Deux refus nommés — la course sur une clé étrangère (le second essai
    // anonymisera) et un compte déjà introuvable. Tout le reste est une panne
    // dont le message est interne (MySQL nomme base, table et contrainte) : il
    // reste au journal, le client reçoit le code générique.
    const message = (error as Error).message;
    if (ACCOUNT_DELETION_REFUSALS.has(message)) return fail(message, 400);
    console.error("[profile] DELETE failed:", error);
    return fail("ACCOUNT_DELETE_FAILED", 400);
  }
}
