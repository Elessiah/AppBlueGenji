import { reorderRoute } from "@/lib/server/admin-collection-routes";
import { reorderBureauMembers } from "@/lib/server/bureau-service";

export const PUT = reorderRoute({
  permission: "showcase",
  reorder: reorderBureauMembers,
  failed: "BUREAU_REORDER_FAILED",
});
