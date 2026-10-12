/**
 * `isDocumentLoad` — une mise en page ne sérialise un dictionnaire qu'au
 * chargement complet d'une page, jamais dans une réponse du routeur (revue de
 * performance du lot 9-2).
 */
import { beforeEach, describe, expect, it, jest } from "@jest/globals";

let mockHeaders: Record<string, string> = {};
jest.mock("next/headers", () => ({ headers: async () => new Headers(mockHeaders) }));
let mockSignedIn = true;
jest.mock("@/lib/server/auth", () => ({ getCurrentUser: async () => (mockSignedIn ? { id: 1 } : null) }));

import { isDocumentLoad } from "@/lib/server/layout-messages";

beforeEach(() => {
  mockHeaders = {};
  mockSignedIn = true;
});

describe("isDocumentLoad", () => {
  it("chargement complet dit par le middleware : vrai", async () => {
    mockHeaders = { "x-bg-document": "1" };
    expect(await isDocumentLoad()).toBe(true);
  });

  it("requête du routeur (navigation, préchargement, router.refresh()) : faux", async () => {
    mockHeaders = { "x-bg-document": "0" };
    expect(await isDocumentLoad()).toBe(false);
  });

  it("en-tête absent (requête que le middleware n'a pas vue, en-têtes forgés par le client) : faux — la règle échoue fermée", async () => {
    expect(await isDocumentLoad()).toBe(false);
  });

  it("valeur forgée autre que « 1 » : faux", async () => {
    mockHeaders = { "x-bg-document": "true" };
    expect(await isDocumentLoad()).toBe(false);
  });

  it("sans session : faux — la carte « Connexion requise » remplace les pages, le dictionnaire ne servirait à rien", async () => {
    mockSignedIn = false;
    mockHeaders = { "x-bg-document": "1" };
    expect(await isDocumentLoad()).toBe(false);
  });
});
