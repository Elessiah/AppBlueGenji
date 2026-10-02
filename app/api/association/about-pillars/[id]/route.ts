import { itemRoutes } from "@/lib/server/admin-collection-routes";
import { deleteAboutPillar, updateAboutPillar } from "@/lib/server/about-pillars-service";

export const { PUT, DELETE } = itemRoutes({
  permission: "showcase",
  notFound: "ABOUT_PILLAR_NOT_FOUND",
  updateFailed: "ABOUT_PILLAR_UPDATE_FAILED",
  deleteFailed: "ABOUT_PILLAR_DELETE_FAILED",
  update: async (id, body) => ({
    pillar: await updateAboutPillar(id, {
      title: typeof body.title === "string" ? body.title : "",
      text: typeof body.text === "string" ? body.text : "",
    }),
  }),
  remove: deleteAboutPillar,
});
