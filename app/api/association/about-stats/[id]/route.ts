import { itemRoutes } from "@/lib/server/admin-collection-routes";
import { deleteAboutStat, updateAboutStat } from "@/lib/server/about-stats-service";

/** `valueEn` : absent → `undefined` (conservé) ; présent sans texte → `null` (effacé). */
function valueEnOf(body: Record<string, unknown>): string | null | undefined {
  if (!("valueEn" in body)) return undefined;
  return typeof body.valueEn === "string" ? body.valueEn : null;
}

export const { PUT, DELETE } = itemRoutes({
  permission: "showcase",
  notFound: "ABOUT_STAT_NOT_FOUND",
  updateFailed: "ABOUT_STAT_UPDATE_FAILED",
  deleteFailed: "ABOUT_STAT_DELETE_FAILED",
  update: async (id, body) => ({
    stat: await updateAboutStat(id, {
      value: typeof body.value === "string" ? body.value : "",
      // Clé absente : l'anglais enregistré reste ; présente sans texte : effacé.
      valueEn: valueEnOf(body),
      label: typeof body.label === "string" ? body.label : "",
      labelEn: typeof body.labelEn === "string" ? body.labelEn : null,
    }),
  }),
  remove: deleteAboutStat,
});
