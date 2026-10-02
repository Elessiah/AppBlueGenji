import { reorderRoute } from "@/lib/server/admin-collection-routes";
import { reorderAboutPillars } from "@/lib/server/about-pillars-service";

export const PUT = reorderRoute({
  permission: "showcase",
  reorder: reorderAboutPillars,
  failed: "ABOUT_PILLAR_REORDER_FAILED",
});
