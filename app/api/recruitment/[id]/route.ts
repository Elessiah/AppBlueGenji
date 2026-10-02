import { itemRoutes } from "@/lib/server/admin-collection-routes";
import { deleteRecruitmentAd, updateRecruitmentAd } from "@/lib/server/recruitment-service";
import { recruitmentAdInputFromBody } from "@/lib/shared/recruitment";

export const { PUT, DELETE } = itemRoutes({
  permission: "recruitment",
  notFound: "RECRUITMENT_NOT_FOUND",
  updateFailed: "RECRUITMENT_UPDATE_FAILED",
  deleteFailed: "RECRUITMENT_DELETE_FAILED",
  update: async (id, body) => ({ ad: await updateRecruitmentAd(id, recruitmentAdInputFromBody(body)) }),
  remove: deleteRecruitmentAd,
});
