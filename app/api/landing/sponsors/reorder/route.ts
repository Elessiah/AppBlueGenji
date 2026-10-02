import { reorderRoute } from "@/lib/server/admin-collection-routes";
import { reorderSponsors } from "@/lib/server/sponsors-service";

export const PUT = reorderRoute({
  permission: "showcase",
  reorder: reorderSponsors,
  failed: "SPONSOR_REORDER_FAILED",
});
