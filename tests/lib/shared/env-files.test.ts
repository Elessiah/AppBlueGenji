import { envFileOrder } from "@/lib/shared/env-files";

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
