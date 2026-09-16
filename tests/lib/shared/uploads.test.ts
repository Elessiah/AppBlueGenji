import { describe, expect, it } from "@jest/globals";
import { localUploadUrl, toDiskUploadPath, toServedUploadUrl } from "@/lib/shared/uploads";

describe("toServedUploadUrl", () => {
  it("maps a disk path to the served api path", () => {
    expect(toServedUploadUrl("/uploads/sponsors/a.webp")).toBe("/api/uploads/sponsors/a.webp");
  });

  it("leaves non-upload paths untouched", () => {
    expect(toServedUploadUrl("https://cdn/x.png")).toBe("https://cdn/x.png");
  });
});

describe("toDiskUploadPath", () => {
  it("maps a served api path back to the disk path", () => {
    expect(toDiskUploadPath("/api/uploads/sponsors/a.webp")).toBe("/uploads/sponsors/a.webp");
  });

  it("passes a legacy disk path through unchanged", () => {
    expect(toDiskUploadPath("/uploads/sponsors/a.webp")).toBe("/uploads/sponsors/a.webp");
  });

  it("returns null for external urls", () => {
    expect(toDiskUploadPath("https://cdn/x.png")).toBeNull();
  });

  it("returns null for empty/nullish input", () => {
    expect(toDiskUploadPath(null)).toBeNull();
    expect(toDiskUploadPath(undefined)).toBeNull();
    expect(toDiskUploadPath("")).toBeNull();
  });
});

/**
 * Le prédicat qui tient la règle « une image servie par le site vient du site ».
 *
 * Trois colonnes se remplissent à partir d'une saisie — `bg_teams.logo_url`,
 * `bg_users.avatar_url`, `bg_benevoles.photo_url` — et `next/image` **lève** au
 * rendu sur un hôte absent de `remotePatterns`, dont le projet ne déclare aucun.
 */
describe("localUploadUrl", () => {
  it("laisse passer les deux formes d'un fichier à nous", () => {
    // La forme servie, et l'ancienne forme disque encore présente en base.
    expect(localUploadUrl("/api/uploads/teams/1-ab.webp")).toBe("/api/uploads/teams/1-ab.webp");
    expect(localUploadUrl("/uploads/avatars/1-ab.webp")).toBe("/uploads/avatars/1-ab.webp");
  });

  it("écarte une origine étrangère", () => {
    // Le cas réel et reproductible : `seed.ts` écrivait cette URL pour toute
    // équipe à logo, et le drapeau `unoptimized` la laissait atteindre le
    // navigateur du visiteur.
    expect(localUploadUrl("https://placehold.co/128x128")).toBeNull();
    expect(localUploadUrl("https://lh3.googleusercontent.com/a/x=s96-c")).toBeNull();
    expect(localUploadUrl("http://127.0.0.1/x.png")).toBeNull();
  });

  it("écarte un chemin du site qui n'est pas un téléversement", () => {
    // Volontairement strict, et aligné sur `isLocalAvatarUrl` : ces colonnes ne
    // portent que des téléversements. Un `/logo.webp` y serait une valeur que
    // rien n'écrit — et l'admettre ferait du prédicat deux règles au lieu d'une.
    expect(localUploadUrl("/logo.webp")).toBeNull();
    expect(localUploadUrl("/vercel.svg")).toBeNull();
  });

  it("tolère l'absence de valeur, qui est le cas ordinaire", () => {
    // Une équipe sans logo, un compte sans avatar : le repli est l'initiale.
    expect(localUploadUrl(null)).toBeNull();
    expect(localUploadUrl(undefined)).toBeNull();
    expect(localUploadUrl("")).toBeNull();
  });

  it("ne se laisse pas ouvrir par une adresse qui commence comme la nôtre", () => {
    // `//evil.test/api/uploads/x.webp` est une URL **protocole-relative** : le
    // navigateur la résout chez `evil.test`. Elle ne commence pas par un de nos
    // deux préfixes, donc elle tombe — mais le cas mérite d'être fixé.
    expect(localUploadUrl("//evil.test/api/uploads/x.webp")).toBeNull();
    expect(localUploadUrl("https://evil.test/api/uploads/x.webp")).toBeNull();
  });
});
