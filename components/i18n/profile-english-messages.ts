import enProfile from "@/messages/en/profile.json";
import enTeamErrors from "@/messages/en/teamErrors.json";
import enPush from "@/messages/en/push.json";
import type { Messages } from "@/lib/shared/i18n-messages";

/**
 * L'anglais de `/profil` (textes du profil, refus d'équipe, réglage des
 * notifications), en **un** morceau chargé à la demande par
 * `ProfileTextProviders` — jamais importé d'office (revue de performance du
 * lot 9-2).
 */
export type ProfileEnglishMessages = Pick<Messages, "profile" | "teamErrors" | "push">;

export const PROFILE_ENGLISH_MESSAGES: ProfileEnglishMessages = { profile: enProfile, teamErrors: enTeamErrors, push: enPush };
