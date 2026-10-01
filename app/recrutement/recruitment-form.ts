import type {
  RecruitmentAd,
  RecruitmentContactChannel,
  RecruitmentDomain,
  RecruitmentPriority,
} from "@/lib/shared/recruitment";

/** Champs du formulaire de gestion d'une annonce (`RecruitmentSection`). */
export interface RecruitmentFormState {
  title: string;
  teamName: string;
  domain: RecruitmentDomain;
  roles: string;
  body: string;
  contactUrl: string;
  contactDiscord: string;
  contactPreferred: RecruitmentContactChannel;
  priority: RecruitmentPriority;
  active: boolean;
}

export const EMPTY_RECRUITMENT_FORM: RecruitmentFormState = {
  title: "",
  teamName: "",
  domain: "AUTRE",
  roles: "",
  body: "",
  contactUrl: "",
  contactDiscord: "",
  contactPreferred: "AUTO",
  priority: "OPTIONAL",
  active: true,
};

/** Formulaire prérempli depuis une annonce existante : un champ absent devient vide. */
export function recruitmentFormFromAd(ad: RecruitmentAd): RecruitmentFormState {
  return {
    title: ad.title,
    teamName: ad.teamName ?? "",
    domain: ad.domain,
    roles: ad.roles ?? "",
    body: ad.body ?? "",
    contactUrl: ad.contactUrl ?? "",
    contactDiscord: ad.contactDiscord ?? "",
    contactPreferred: ad.contactPreferred,
    priority: ad.priority,
    active: ad.active,
  };
}

/** Couple (pseudo, identifiant Discord) connu à l'ouverture du formulaire. */
export interface DiscordContactSnapshot {
  pseudo: string;
  id: string | null;
}

/**
 * Corps envoyé à `POST /api/recruitment` et `PUT /api/recruitment/[id]`.
 * Champs texte rognés, vide → `null`. L'identifiant Discord (lien profond)
 * n'est renvoyé que si le pseudo est resté celui pour lequel il a été
 * dérivé : sinon il associerait l'identifiant d'un recruteur à un pseudo tiers.
 */
export function recruitmentRequestBody(form: RecruitmentFormState, snapshot: DiscordContactSnapshot) {
  const discord = form.contactDiscord.trim();
  return {
    title: form.title.trim(),
    teamName: form.teamName.trim() || null,
    domain: form.domain,
    roles: form.roles.trim() || null,
    body: form.body.trim() || null,
    contactUrl: form.contactUrl.trim() || null,
    contactDiscord: discord || null,
    contactDiscordId: discord && discord === snapshot.pseudo ? snapshot.id : null,
    contactPreferred: form.contactPreferred,
    priority: form.priority,
    active: form.active,
  };
}
