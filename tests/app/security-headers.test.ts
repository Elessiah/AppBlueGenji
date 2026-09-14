import { describe, expect, it } from "@jest/globals";
import nextConfig from "@/next.config";

/**
 * Les en-têtes de sécurité, qui n'existaient pas.
 *
 * Rien ici ne peut être vérifié par un test de comportement — Jest ne sert pas
 * de requête HTTP à travers Next — mais la configuration, elle, se relit : ce
 * test tient la **liste** et son **périmètre**, les deux façons de perdre la
 * protection sans rien casser d'autre (un en-tête retiré, ou un `source` qui
 * cesse de couvrir toutes les routes).
 */
describe("en-têtes de sécurité", () => {
  it("pose les trois en-têtes sur toutes les réponses", async () => {
    const rules = await nextConfig.headers!();

    expect(rules).toHaveLength(1);
    expect(rules[0].source).toBe("/:path*");

    const byKey = new Map(rules[0].headers.map((header) => [header.key, header.value]));
    expect(byKey.get("X-Content-Type-Options")).toBe("nosniff");
    expect(byKey.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(byKey.get("X-Frame-Options")).toBe("SAMEORIGIN");
  });

  it("n'annonce ni CSP ni HSTS", async () => {
    // Les deux sont volontairement absents : une politique de contenu écrite à
    // l'aveugle casserait les scripts en ligne de Next sans qu'un test le voie,
    // et HSTS s'appliquerait à un déploiement servi en clair — c'est au reverse
    // proxy, qui termine le chiffrement, de l'annoncer.
    const rules = await nextConfig.headers!();
    const keys = rules[0].headers.map((header) => header.key);

    expect(keys).not.toContain("Content-Security-Policy");
    expect(keys).not.toContain("Strict-Transport-Security");
  });
});
