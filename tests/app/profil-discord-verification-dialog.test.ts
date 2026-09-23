import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Le dialogue de certification, contrôlé **au niveau de la source** : il se
 * rend dans un portail après l'hydratation, ce que ces tests ne montent pas, et
 * la propriété qui compte est de structure — quel chemin prend un compte déjà
 * relié à Discord.
 *
 * Il passait par la résolution du tag **par le bot**, qui balaie les serveurs
 * qu'il partage avec le joueur. Un compte venu par OAuth Discord, ou par un code
 * demandé avec son identifiant numérique, n'en partage souvent aucun : la
 * recherche les parcourait tous, dépassait le délai, et le profil annonçait
 * « bot non joignable ».
 */
const dialog = readFileSync(
  join(process.cwd(), "app/(secured)/profil/DiscordVerificationDialog.tsx"),
  "utf8",
);

/** La branche rendue quand le compte porte déjà un `discord_id`. */
function linkedBranch(): string {
  const start = dialog.indexOf("{linked ? (");
  const end = dialog.indexOf(") : !awaitingCode ? (");
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return dialog.slice(start, end);
}

describe("certification d'un compte déjà relié à Discord", () => {
  it("repart chez Discord, en rattachement, au lieu d'interroger le bot", () => {
    expect(linkedBranch()).toContain('oauthStartPath("DISCORD", { intent: "LINK" })');
  });

  it("n'envoie aucun tag au bot et n'attend aucun code", () => {
    const branch = linkedBranch();
    expect(branch).not.toContain("onSubmit");
    expect(branch).not.toContain("fetch(");
  });

  it("navigue par un lien : l'aller-retour OAuth quitte la page", () => {
    expect(linkedBranch()).toMatch(/<a href=\{oauthStartPath/);
  });

  it("ne promet plus une certification « immédiate » par le bot", () => {
    expect(dialog).not.toContain("la certification est immédiate");
  });
});
