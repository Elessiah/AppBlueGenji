import type { Metadata } from "next";
import { GetiInfoView } from "@/components/geti/GetiInfoView";
import { GETI_DEFAULT_CATEGORY, type GetiSearchParams } from "@/lib/shared/geti/page";
import { getiCategoryMetadata } from "./metadata";

/**
 * `/geti-info` (et `/en/geti-info`) : la première catégorie, sans renvoi.
 * Son adresse canonique est celle de la catégorie (`/geti-info/lfp`) — une
 * seule adresse pour un même contenu (la page n'est pas indexée).
 */
export function generateMetadata(): Promise<Metadata> {
  return getiCategoryMetadata(GETI_DEFAULT_CATEGORY);
}

// Les annonces changent à tout moment (modification, suppression sur Discord).
export const dynamic = "force-dynamic";

export default async function GetiInfoPage({
  searchParams,
}: Readonly<{ searchParams: Promise<GetiSearchParams> }>) {
  return <GetiInfoView category={GETI_DEFAULT_CATEGORY} searchParams={await searchParams} />;
}
