import { describe, expect, it } from "@jest/globals";
import { envFileOrder, missingNodeEnvNotice, PRODUCTION_ENV_FILES } from "@/lib/shared/env-files";

describe("envFileOrder", () => {
  it("nomme d'abord le fichier de production, que `dotenv/config` ne lisait pas", () => {
    // Le défaut d'origine, constaté sur le serveur : la configuration vit dans
    // `.env.production`, `.env` n'existe pas, et le script mourait sur
    // « Missing required environment variable DB_HOST ».
    expect(envFileOrder("production")).toContain(".env.production");
  });

  it("garde `.env` en dernier recours, jamais en premier", () => {
    // dotenv n'écrase pas une variable déjà posée : le premier fichier qui
    // nomme une clé la fixe. `.env` en tête rendrait `.env.production` muet.
    const order = envFileOrder("production");
    expect(order[order.length - 1]).toBe(".env");
    expect(order.indexOf(".env.production")).toBeLessThan(order.indexOf(".env"));
  });

  it("classe le local au-dessus du partagé, pour le même environnement", () => {
    const order = envFileOrder("development");
    expect(order.indexOf(".env.development.local")).toBeLessThan(
      order.indexOf(".env.development"),
    );
    expect(order.indexOf(".env.local")).toBeLessThan(order.indexOf(".env"));
  });

  it("écarte les fichiers locaux en test, comme le fait Next", () => {
    // Un fichier local est la configuration d'une machine : une suite de tests
    // qui lirait celle du développeur ne rendrait pas le même résultat chez
    // deux personnes.
    const order = envFileOrder("test");
    expect(order.some((file) => file.endsWith(".local"))).toBe(false);
    expect(order).toEqual([".env.test", ".env"]);
  });

  it("suit l'environnement qu'on lui donne, sans liste fermée", () => {
    // `staging` n'est pas une valeur que Next connaît, mais rien ici n'a à en
    // décider — le nom du fichier se dérive.
    expect(envFileOrder("staging")).toEqual([
      ".env.staging.local",
      ".env.local",
      ".env.staging",
      ".env",
    ]);
  });

  it("ne rend que des chemins relatifs, distincts", () => {
    const order = envFileOrder("production");
    expect(new Set(order).size).toBe(order.length);
    expect(order.every((file) => file.startsWith(".env"))).toBe(true);
  });
});

describe("missingNodeEnvNotice", () => {
  it("nomme la cause et la commande quand le serveur n'a que `.env.production`", () => {
    // Le cas constaté en production : shell sans NODE_ENV, configuration dans
    // `.env.production`, aucun `.env` — le script mourait sur DB_HOST sans dire
    // pourquoi.
    const notice = missingNodeEnvNotice(undefined, [".env.production"], "backfill:avatars");
    expect(notice).toContain("NODE_ENV");
    expect(notice).toContain(".env.production");
    expect(notice).toContain("NODE_ENV=production npm run backfill:avatars");
  });

  it("tient un NODE_ENV vide pour absent", () => {
    expect(missingNodeEnvNotice("", [".env.production"], "replay:deletions")).toContain(
      "NODE_ENV=production npm run replay:deletions",
    );
  });

  it("signale aussi un `.env.production.local` seul", () => {
    expect(missingNodeEnvNotice(undefined, [".env.production.local"])).toContain(
      ".env.production.local",
    );
  });

  it("écrit une commande générique quand le script n'est pas connu", () => {
    expect(missingNodeEnvNotice(undefined, [".env.production"])).toContain(
      "NODE_ENV=production npm run <script>",
    );
  });

  it("se tait dès que NODE_ENV est posé, quelle que soit sa valeur", () => {
    expect(missingNodeEnvNotice("production", [".env.production"])).toBeNull();
    expect(missingNodeEnvNotice("development", [".env.production"])).toBeNull();
  });

  it("se tait quand un fichier de développement fournira la configuration", () => {
    // Poste de développement qui garde un `.env.production` à côté de son
    // `.env` : rien ne manque, et avertir à chaque lancement serait du bruit.
    expect(missingNodeEnvNotice(undefined, [".env", ".env.production"])).toBeNull();
    expect(missingNodeEnvNotice(undefined, [".env.local", ".env.production"])).toBeNull();
    expect(
      missingNodeEnvNotice(undefined, [".env.development", ".env.production"]),
    ).toBeNull();
  });

  it("se tait quand le shell fournit déjà la configuration", () => {
    // `DB_HOST=… npm run backfill:avatars` sur une machine qui garde un
    // `.env.production` : le script tourne, lui conseiller de relancer
    // changerait sa source de configuration pour rien.
    expect(missingNodeEnvNotice(undefined, [".env.production"], "backfill:avatars", true)).toBeNull();
  });

  it("se tait quand il n'y a aucun fichier de production à manquer", () => {
    expect(missingNodeEnvNotice(undefined, [])).toBeNull();
    expect(missingNodeEnvNotice(undefined, [".env.staging"])).toBeNull();
  });
});

describe("PRODUCTION_ENV_FILES", () => {
  it("nomme exactement les fichiers que seule la production lit, dérivés d'envFileOrder", () => {
    expect([...PRODUCTION_ENV_FILES]).toEqual([".env.production.local", ".env.production"]);
    for (const file of PRODUCTION_ENV_FILES) {
      expect(envFileOrder("production")).toContain(file);
      expect(envFileOrder("development")).not.toContain(file);
    }
  });
});
