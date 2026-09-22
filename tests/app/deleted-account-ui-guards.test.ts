import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

const MEMBERS = read("app/(secured)/equipes/[id]/_components/MembersSection.tsx");
const PROFIL = read("app/(secured)/profil/page.tsx");

/**
 * Deux écrans que la suppression de compte touche sans qu'aucun rendu ne le
 * montre — d'où un contrôle sur la source, faute de panne observable.
 *
 * 1. **L'autocomplétion d'ajout de membre** se sert de `/api/players`, la
 *    liste même que l'annuaire filtre désormais : sans le même filtre ici, elle
 *    proposait `compte_supprime_412` comme recrue. Le serveur le refuse (une
 *    ligne morte n'est plus résolue par son pseudo), donc la suggestion ne
 *    menait qu'à un refus — un nom proposé est un nom qui ment.
 * 2. **Les deux écritures du profil** peuvent désormais rendre le code
 *    `ACCOUNT_DELETED`, et `showError` affiche **la chaîne levée**. Sans
 *    traduction, le joueur lisait le code interne dans sa notification, contre
 *    la règle « toute l'interface est en français ».
 */
describe("interface — un compte supprimé ne se propose ni ne se raconte en code", () => {
  it("écarte les comptes supprimés des suggestions de recrutement", () => {
    expect(MEMBERS).toMatch(/\.filter\(\(p\) => !p\.isDeleted/);
  });

  it("traduit ACCOUNT_DELETED sur les deux écritures du profil", () => {
    // Sauvegarde du profil **et** téléversement d'avatar : ce sont les deux
    // seules écritures qui peuvent perdre leur course contre la suppression.
    const calls = PROFIL.match(/accountDeletedWriteMessage\(/g) ?? [];
    expect(calls).toHaveLength(2);
    expect(PROFIL).toContain('accountDeletedWriteMessage(payload.error, "PROFILE_UPDATE_FAILED")');
    expect(PROFIL).toContain('accountDeletedWriteMessage(payload.error, "AVATAR_UPLOAD_FAILED")');
  });

  it("ne laisse plus le code brut remonter au toast sur ces deux chemins", () => {
    expect(PROFIL).not.toContain('payload.error || "PROFILE_UPDATE_FAILED"');
    expect(PROFIL).not.toContain('payload.error || "AVATAR_UPLOAD_FAILED"');
  });

  /**
   * L'aperçu du plan de suppression peut ne pas répondre. L'écran partait alors
   * — et restait — sur `TOURNAMENTS`, la phrase qui promet que le compte
   * devient anonyme et que les statistiques restent, quand le serveur, qui
   * re-décide sur son propre instantané, pouvait **effacer entièrement**. Un
   * accord donné à la moitié rassurante d'un geste irréversible.
   */
  it("n'invente aucun sort de compte avant que l'aperçu ait répondu", () => {
    expect(PROFIL).toContain("ConfirmationSubject = RETENTION_UNKNOWN");
    // L'hypothèse initiale a disparu : plus aucun motif codé en dur.
    expect(PROFIL).not.toContain('= "TOURNAMENTS"');
  });
});
