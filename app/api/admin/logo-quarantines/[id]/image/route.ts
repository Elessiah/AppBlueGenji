import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/server/auth";
import { fail } from "@/lib/server/http";
import { quarantinedLogoFile } from "@/lib/server/logo-quarantine";
import { can } from "@/lib/shared/permissions";

/**
 * Aperçu d'un logo en quarantaine, pour la seule modération : juger une
 * contestation demande de voir ce qui est contesté, et le fichier n'est plus
 * servi nulle part ailleurs. Jamais mis en cache — le logo n'est plus public.
 */
export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  if (!can(user, "moderation")) return fail("FORBIDDEN", 403);

  const { id } = await context.params;
  const quarantineId = Number(id);
  if (!Number.isSafeInteger(quarantineId) || quarantineId <= 0) return fail("QUARANTINE_NOT_FOUND", 404);

  const file = await quarantinedLogoFile(quarantineId);
  if (!file) return fail("QUARANTINE_NOT_FOUND", 404);
  try {
    const buffer = await readFile(file);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "content-type": "image/webp",
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return fail("QUARANTINE_NOT_FOUND", 404);
  }
}
