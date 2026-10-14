import { describe, expect, it } from "@jest/globals";
import { authGateLoginHref } from "@/app/(secured)/_shared/AuthGate";
import { loginDestination } from "@/lib/shared/safe-redirect";
import { MATCH_DM_SETTINGS_PATH } from "@/lib/shared/discord-notifications";
import { readSource } from "../helpers/read-source";

/**
 * Revue UI/UX #445 : le lien de fin des messages privés de match mène à
 * `/profil#notifications`. Ouvert sans session, la carte « Connexion requise »
 * doit repasser l'ancre à `/connexion`, sinon le joueur retombe en haut de son
 * profil, loin de l'interrupteur.
 */
describe("AuthGate — l'ancre de la page demandée suit la connexion", () => {
  it("chemin, requête et ancre repassés à /connexion?redirect=", () => {
    const href = authGateLoginHref("/profil", "", "#notifications");
    expect(href).toBe(`/connexion?redirect=${encodeURIComponent(MATCH_DM_SETTINGS_PATH)}`);
    expect(authGateLoginHref("/en/equipes/12", "tab=roster", "#membres")).toBe(
      `/connexion?redirect=${encodeURIComponent("/en/equipes/12?tab=roster#membres")}`,
    );
  });

  it("sans ancre (ou ancre vide « # ») : le chemin et la requête seuls, comme avant", () => {
    expect(authGateLoginHref("/profil", "", "")).toBe("/connexion?redirect=%2Fprofil");
    expect(authGateLoginHref("/profil", "", "#")).toBe("/connexion?redirect=%2Fprofil");
    expect(authGateLoginHref("/tournois", "x=1", "")).toBe(`/connexion?redirect=${encodeURIComponent("/tournois?x=1")}`);
  });

  it("la destination avec ancre passe le filtre de la page de connexion, en FR comme sous /en", () => {
    const destination = decodeURIComponent(authGateLoginHref("/profil", "", "#notifications").split("redirect=")[1]);
    expect(loginDestination(destination, "fr")).toBe("/profil#notifications");
    expect(loginDestination(destination, "en")).toBe("/en/profil#notifications");
  });

  it("l'ancre n'est lue qu'au navigateur, après hydratation, et suit un changement d'ancre", () => {
    const gate = readSource("app/(secured)/_shared/AuthGate.tsx");
    expect(gate).toContain('const [hash, setHash] = useState("");');
    expect(gate).toContain('addEventListener("hashchange", read)');
    // Relue à chaque navigation client (la mise en page reste montée ; pushState ne déclenche pas hashchange).
    expect(gate).toContain("}, [pathname, query]);");
    expect(gate).toContain("authGateLoginHref(pathname, query, hash)");
  });

  it("au clic, l'ancre du moment l'emporte : une navigation client qui ne change que l'ancre ne déclenche pas hashchange", () => {
    const gate = readSource("app/(secured)/_shared/AuthGate.tsx");
    expect(gate).toContain("const fresh = authGateLoginHref(pathname, query, globalThis.location.hash);");
    expect(gate).toContain("if (fresh === loginHref) return;");
    expect(gate).toContain("router.push(fresh);");
    expect(gate).toContain("<LocaleLink href={loginHref} onClick={goToLogin}>{text.login}</LocaleLink>");
    // Un clic qui ouvre un nouvel onglet garde le href rendu.
    expect(gate).toContain("if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;");
  });

  it("la documentation d'AuthGate reste collée au composant", () => {
    const gate = readSource("app/(secured)/_shared/AuthGate.tsx");
    const component = gate.indexOf("export function AuthGate(");
    // Rien entre la fin de sa documentation et sa déclaration.
    const before = gate.slice(0, component).trimEnd();
    expect(before.endsWith("Sans prop (tests), le français.\n */") || before.endsWith("Sans prop (tests), le français.\r\n */")).toBe(true);
  });
});
