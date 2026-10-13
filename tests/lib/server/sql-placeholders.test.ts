import { describe, expect, it } from "@jest/globals";
import { chunkIds, SQL_ID_CHUNK, sqlPlaceholders } from "@/lib/server/sql-placeholders";

describe("sqlPlaceholders", () => {
  it("rend un « ? » par valeur, séparés par une virgule", () => {
    expect(sqlPlaceholders(3)).toBe("?, ?, ?");
    expect(sqlPlaceholders(1)).toBe("?");
    expect(sqlPlaceholders(0)).toBe("");
  });
});

describe("chunkIds", () => {
  it("découpe par paquets de 500 par défaut, sans perdre ni réordonner", () => {
    const ids = Array.from({ length: 1201 }, (_, index) => index);
    const chunks = chunkIds(ids);
    expect(SQL_ID_CHUNK).toBe(500);
    expect(chunks.map((chunk) => chunk.length)).toEqual([500, 500, 201]);
    expect(chunks.flat()).toEqual(ids);
  });

  it("accepte une taille choisie, et rend une liste vide pour rien", () => {
    expect(chunkIds([1, 2, 3], 2)).toEqual([[1, 2], [3]]);
    expect(chunkIds([])).toEqual([]);
  });
});
