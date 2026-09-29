import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Le dialogue de certification, contrôlé **au niveau de la source** : il se
 * rend dans un portail après l'hydratation, ce que ces tests ne montent pas, et
 * la propriété qui compte est de structure — quel chemin prend un compte déjà
 * relié à Discord.
 *
 * La connexion ne certifie plus le tag : elle l'enregistre, nommé par Discord.
 * Un compte relié certifie donc **d'un clic** ce pseudo-là — ni bot (qui ne
 * retrouve pas un compte venu par OAuth), ni code, ni aller-retour OAuth. Seul
 * un compte relié **sans** pseudo nommé par Discord repasse chez Discord.
 */
const dialog = readFileSync(
  join(process.cwd(), "app/(secured)/profil/DiscordVerificationDialog.tsx"),
  "utf8",
);
const page = readFileSync(join(process.cwd(), "app/(secured)/profil/page.tsx"), "utf8");

function slice(from: string, to: string): string {
  const start = dialog.indexOf(from);
  const end = dialog.indexOf(to);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return dialog.slice(start, end);
}

/** Compte relié dont Discord a nommé le pseudo : un clic. */
const oneClickBranch = () => slice("{linked && attested && initialTag ? (", ") : linked ? (");
/** Compte relié sans pseudo nommé par Discord : retour chez Discord. */
const relinkBranch = () => slice(") : linked ? (", ") : !awaitingCode ? (");

describe("certification d'un compte relié dont Discord a nommé le pseudo", () => {
  it("certifie d'un clic, par la route de certification, sans quitter la page", () => {
    const branch = oneClickBranch();
    expect(branch).toContain("onSubmit={requestVerification}");
    expect(branch).not.toContain("oauthStartPath");
    expect(branch).not.toContain("<input");
  });

  it("montre le tag qui sera exposé, et rien d'autre", () => {
    expect(oneClickBranch()).toContain("<strong>{initialTag}</strong>");
  });

  it("la page lui passe le tag **enregistré**, pas celui du champ", () => {
    expect(page).toContain(
      'initialTag={discordState.linked === true ? (discordState.tag ?? "") : discordPseudo}',
    );
    expect(page).toContain("attested={discordState.attested}");
  });
});

describe("certification d'un compte relié sans pseudo nommé par Discord", () => {
  it("repart chez Discord, en rattachement, pour qu'il nomme le pseudo", () => {
    expect(relinkBranch()).toContain('oauthStartPath("DISCORD", { intent: "LINK" })');
    expect(relinkBranch()).toMatch(/<a href=\{oauthStartPath/);
  });

  it("dit qu'il faudra revenir certifier : le retour ne certifie rien", () => {
    expect(relinkBranch()).toMatch(/certifier ici\s+d&apos;un clic/);
  });
});

describe("ce que le dialogue ne promet plus", () => {
  it("dit que la connexion ne donne pas la certification", () => {
    expect(dialog).toMatch(/se connecter par Discord ne la donne pas/);
  });

  it("ne promet plus une certification « immédiate » par le bot", () => {
    expect(dialog).not.toContain("la certification est immédiate");
  });
});
