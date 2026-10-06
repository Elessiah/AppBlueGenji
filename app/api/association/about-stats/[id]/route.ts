import { itemRoutes } from "@/lib/server/admin-collection-routes";
import { deleteAboutStat, updateAboutStat } from "@/lib/server/about-stats-service";

export const { PUT, DELETE } = itemRoutes({
  permission: "showcase",
  notFound: "ABOUT_STAT_NOT_FOUND",
  updateFailed: "ABOUT_STAT_UPDATE_FAILED",
  deleteFailed: "ABOUT_STAT_DELETE_FAILED",
  update: async (id, body) => ({
    stat: await updateAboutStat(id, {
      value: typeof body.value === "string" ? body.value : "",
      label: typeof body.label === "string" ? body.label : "",
      labelEn: typeof body.labelEn === "string" ? body.labelEn : null,
    }),
  }),
  remove: deleteAboutStat,
});
