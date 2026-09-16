import { readFileSync } from "fs";
import { join } from "path";
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

  it("n'admet aucune origine étrangère en image", () => {
    // L'hôte des avatars Google y a figuré le temps d'une PR, le mode rapport
    // l'ayant relevé dès le premier chargement. La photo est désormais copiée
    // chez nous à la connexion (`user-avatar-import.ts`) et `visibleAvatarUrl`
    // écarte toute URL qui ne serait pas la nôtre : la directive est redevenue
    // le détecteur qu'elle doit être, et ce test la garde fermée.
    expect(directive(contentSecurityPolicy("n", { dev: false }), "img-src")).toBe(
      "'self' data: blob:",
    );
  });

  it("tire l'en-tête du mode, et les deux ne peuvent pas diverger", () => {
    // Ce test gardait `CSP_MODE === "report-only"` : c'était le garde-fou du
    // basculement, et il a fait son office — il est le seul à avoir échoué le
    // jour où le mot a changé. Ce qu'il doit tenir maintenant est autre chose :
    // que l'en-tête **suive** le mode. Poser un `-report-only` en croyant
    // appliquer serait une politique qui ne refuse rien sans que rien ne le
    // dise, et l'inverse casserait les pages sans qu'on l'ait voulu.
    const expected =
      CSP_MODE === "enforce"
        ? "content-security-policy"
        : "content-security-policy-report-only";
    expect(CSP_HEADER).toBe(expected);
  });

  it("change de nonce à chaque requête, sinon il ne nomme plus rien", () => {
    const first = contentSecurityPolicy("aaa", { dev: false });
    const second = contentSecurityPolicy("bbb", { dev: false });
    expect(first).not.toBe(second);
    expect(first).toContain("'nonce-aaa'");
    expect(second).toContain("'nonce-bbb'");
  });
});

/**
 * Ce qui rend l'application possible, et qui ne se voit nulle part ailleurs.
 *
 * Le HTML de chaque page dépend du nonce, donc d'un en-tête de requête ; Next ne
 * compte pas cette lecture comme une dépendance dynamique et prérendait les
 * pages dont rien d'autre ne l'était — leurs scripts partaient **sans nonce**,
 * et en application ils seraient refusés. `await headers()` dans la mise en page
 * racine déclare cette dépendance.
 *
 * La garde est posée sur la **source** faute de mieux : la preuve réelle est
 * dans `.next/prerender-manifest.json` après compilation, qui ne doit plus
 * contenir que `/opengraph-image`, et la suite de tests ne compile pas. Le test
 * est donc faible là où l'enjeu est fort — retirer cette ligne casserait
 * `/connexion` en production —, ce qui est justement une raison de l'écrire :
 * il dit *pourquoi* la ligne est là, à celui qui la croira inutile.
 */
/**
 * Retire les commentaires du source avant lecture.
 *
 * Même précaution que `tests/scripts/deploy-scripts.test.ts` et
 * `tests/app/team-card-logo.test.tsx` : le bloc de `app/layout.tsx` **cite** en
 * prose le `force-dynamic` qu'on a écarté, et expliquer pourquoi on ne fait pas
 * une chose est la meilleure façon d'éviter qu'on la refasse. C'est la garde
 * qui doit s'accommoder de l'explication, pas l'inverse.
 *
 * Les commentaires de ligne ne sont retirés que s'ils ne suivent pas un `:`,
 * pour ne pas couper un `https://…` au milieu d'une chaîne.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("mise en page racine — la dépendance qui interdit le prérendu", () => {
  const source = stripComments(
    readFileSync(join(__dirname, "..", "..", "..", "app", "layout.tsx"), "utf8"),
  );

  it("déclare la dépendance à un en-tête de requête", () => {
    expect(source).toMatch(/from "next\/headers"/);
    expect(source).toMatch(/await headers\(\)/);
  });

  it("garde la mise en page asynchrone, sans quoi l'attente ne compilerait pas", () => {
    expect(source).toMatch(/export default async function RootLayout/);
  });

  it("n'annote aucune route à la main, la liste ayant déjà dérivé une fois", () => {
    // Une liste de `force-dynamic` route par route est ce qu'on a failli écrire :
    // elle aurait redemandé la liste exacte des pages prérendues, celle-là même
    // qui annonçait cinq routes quand il y en avait trois.
    expect(source).not.toMatch(/force-dynamic/);
  });
});
