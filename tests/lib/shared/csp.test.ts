import { CSP_HEADER, CSP_MODE, CSP_REPORT_PATH, contentSecurityPolicy } from "@/lib/shared/csp";

/** Lit une directive de la politique, sans son nom. */
function directive(policy: string, name: string): string | undefined {
  const found = policy.split("; ").find((part) => part === name || part.startsWith(`${name} `));
  return found === undefined ? undefined : found.slice(name.length).trim();
}

describe("contentSecurityPolicy", () => {
  it("nomme le nonce de la requête dans script-src", () => {
    const policy = contentSecurityPolicy("abc123==", { dev: false });
    expect(directive(policy, "script-src")).toContain("'nonce-abc123=='");
  });

  it("porte 'strict-dynamic', sans quoi Next ne pourrait pas charger ses morceaux", () => {
    // Next charge ses fragments depuis un script nommé : sans cette clause, le
    // second serait refusé alors que le premier est autorisé.
    expect(directive(contentSecurityPolicy("n", { dev: false }), "script-src")).toContain(
      "'strict-dynamic'",
    );
  });

  it("n'autorise 'unsafe-eval' qu'en développement", () => {
    // Le rafraîchissement à chaud de Next en a besoin ; la production, jamais.
    expect(contentSecurityPolicy("n", { dev: true })).toContain("'unsafe-eval'");
    expect(contentSecurityPolicy("n", { dev: false })).not.toContain("'unsafe-eval'");
  });

  it("ferme ce que le site n'utilise pas", () => {
    const policy = contentSecurityPolicy("n", { dev: false });
    // Aucune iframe dans le site, ni de son côté ni du nôtre.
    expect(directive(policy, "frame-src")).toBe("'none'");
    expect(directive(policy, "object-src")).toBe("'none'");
    // `base-uri` n'a pas d'équivalent ailleurs : une balise `<base>` injectée
    // réécrirait toutes les URL relatives de la page.
    expect(directive(policy, "base-uri")).toBe("'self'");
    expect(directive(policy, "form-action")).toBe("'self'");
  });

  it("double X-Frame-Options, que les navigateurs récents ignorent au profit de la CSP", () => {
    expect(directive(contentSecurityPolicy("n", { dev: false }), "frame-ancestors")).toBe("'self'");
  });

  it("désigne le collecteur, sans quoi les violations ne vivraient que dans la console du visiteur", () => {
    expect(directive(contentSecurityPolicy("n", { dev: false }), "report-uri")).toBe(
      CSP_REPORT_PATH,
    );
  });

  it("admet l'hôte des avatars Google, que le site ne relaie pas encore", () => {
    // Relevé par le mode rapport dès le premier chargement : `UserAvatar` rend
    // l'URL de `picture` en `unoptimized`, donc le navigateur va la chercher
    // chez Google. Une politique qui décrit un site qui n'existe pas ne pourra
    // jamais être appliquée. Voir `ERREUR.txt`.
    expect(directive(contentSecurityPolicy("n", { dev: false }), "img-src")).toContain(
      "https://lh3.googleusercontent.com",
    );
  });

  it("tire un en-tête qui n'applique rien tant que le mode est report-only", () => {
    // Le garde-fou du basculement : tant que ce mot n'a pas changé, aucune
    // page ne peut casser à cause de la politique.
    expect(CSP_MODE).toBe("report-only");
    expect(CSP_HEADER).toBe("content-security-policy-report-only");
  });

  it("change de nonce à chaque requête, sinon il ne nomme plus rien", () => {
    const first = contentSecurityPolicy("aaa", { dev: false });
    const second = contentSecurityPolicy("bbb", { dev: false });
    expect(first).not.toBe(second);
    expect(first).toContain("'nonce-aaa'");
    expect(second).toContain("'nonce-bbb'");
  });
});
