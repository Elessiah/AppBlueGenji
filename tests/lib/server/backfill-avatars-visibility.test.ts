import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * `npm run backfill:avatars` copie en lot les photos restées chez leur
 * fournisseur. C'est un **second écrivain** de photo importée, à côté
 * d'`adoptRemoteAvatar` : s'il posait la copie sans la masquer, une URL qu'aucun
 * lecteur ne voyait (`visibleAvatarUrl` rejette une origine étrangère) serait
 * publiée d'office. Le script s'achève par `process.exit`, d'où un contrôle sur
 * sa source plutôt qu'une exécution.
 */
describe("backfill:avatars — la photo rapatriée naît masquée", () => {
  const source = readFileSync(
    path.join(process.cwd(), "lib/server/backfill-avatars.ts"),
    "utf8",
  );

  it("masque l'avatar dans l'écriture qui le pose", () => {
    const writes = source.match(/UPDATE bg_users SET avatar_url = \?[^`]*/g) ?? [];
    expect(writes.length).toBeGreaterThan(0);
    for (const write of writes) expect(write).toContain("visible_avatar = 0");
  });
});
