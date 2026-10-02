import { reorderRoute } from "@/lib/server/admin-collection-routes";
import { reorderAboutStats } from "@/lib/server/about-stats-service";

export const PUT = reorderRoute({
  permission: "showcase",
  reorder: reorderAboutStats,
  failed: "ABOUT_STAT_REORDER_FAILED",
});
