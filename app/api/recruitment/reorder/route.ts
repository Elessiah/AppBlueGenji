import { reorderRoute } from "@/lib/server/admin-collection-routes";
import { reorderRecruitmentAds } from "@/lib/server/recruitment-service";

export const PUT = reorderRoute({
  permission: "recruitment",
  reorder: reorderRecruitmentAds,
  failed: "RECRUITMENT_REORDER_FAILED",
  // La saisie est bien formée : c'est l'état des annonces (leurs statuts) qui
  // interdit cet ordre — typiquement un statut changé depuis un autre onglet.
  statusOf: (message) => (message === "RECRUITMENT_ORDER_MIXES_PRIORITIES" ? 409 : 400),
});
