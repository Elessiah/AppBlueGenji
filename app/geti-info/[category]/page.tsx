import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { GetiInfoView } from "@/components/geti/GetiInfoView";
import { getiCategoryOfSlug, type GetiSearchParams } from "@/lib/shared/geti/page";
import { getiCategoryMetadata } from "../metadata";

type PageProps = Readonly<{
  params: Promise<{ category: string }>;
  searchParams: Promise<GetiSearchParams>;
}>;

/** `/geti-info/<catégorie>` : une adresse par catégorie (`lfp`, `lft`, `lfsub`, `lfstaff`, `lfs`, `lfcast`). */
export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const category = getiCategoryOfSlug((await params).category);
  return category ? getiCategoryMetadata(category) : {};
}

// Les annonces changent à tout moment (modification, suppression sur Discord).
export const dynamic = "force-dynamic";

export default async function GetiCategoryPage({ params, searchParams }: PageProps) {
  const category = getiCategoryOfSlug((await params).category);
  // Seule l'écriture exacte du sigle a une page : pas de doublon par la casse.
  if (!category || (await params).category !== category) notFound();
  return <GetiInfoView category={category} searchParams={await searchParams} />;
}
