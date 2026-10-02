import { itemRoutes } from "@/lib/server/admin-collection-routes";
import { deleteBureauMember, updateBureauMember } from "@/lib/server/bureau-service";

export const { PUT, DELETE } = itemRoutes({
  permission: "showcase",
  notFound: "BUREAU_MEMBER_NOT_FOUND",
  updateFailed: "BUREAU_UPDATE_FAILED",
  deleteFailed: "BUREAU_DELETE_FAILED",
  update: async (id, body) => ({
    member: await updateBureauMember(id, {
      name: typeof body.name === "string" ? body.name : "",
      role: typeof body.role === "string" ? body.role : "",
      initials: typeof body.initials === "string" ? body.initials : undefined,
      color: typeof body.color === "string" ? body.color : undefined,
    }),
  }),
  remove: deleteBureauMember,
});
