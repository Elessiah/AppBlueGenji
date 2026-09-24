import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  avatarDeleteErrorMessage,
  avatarUploadErrorMessage,
  profileErrorMessage,
} from "@/app/(secured)/profil/profile-errors";
import { ACCOUNT_DELETED_ERROR, ACCOUNT_DELETED_WRITE_MESSAGE } from "@/lib/shared/account-deletion";

const ROOT = join(__dirname, "..", "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

// L'autocomplétion vit dans son propre composant depuis qu'elle sert aussi
// l'attribution d'une fantôme.
const MEMBERS = read("app/(secured)/equipes/[id]/_components/PlayerPseudoCombobox.tsx");
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
    expect(MEMBERS).toMatch(/\.filter\(\s*\(p\) =>\s*!p\.isDeleted/);
  });

  it("traduit ACCOUNT_DELETED sur **toutes** les écritures du profil", () => {
    // Sauvegarde du profil et retrait du tag Discord partent vers
    // `PATCH /api/profile` ; téléversement et retrait d'avatar vers
    // `/api/profile/avatar`. Les quatre peuvent perdre leur course contre la
    // suppression et recevoir le 409 : chacune passe par un registre qui
    // connaît le code.
    expect(profileErrorMessage(ACCOUNT_DELETED_ERROR)).toBe(ACCOUNT_DELETED_WRITE_MESSAGE);
    expect(avatarUploadErrorMessage(ACCOUNT_DELETED_ERROR)).toBe(ACCOUNT_DELETED_WRITE_MESSAGE);
    expect(avatarDeleteErrorMessage(ACCOUNT_DELETED_ERROR)).toBe(ACCOUNT_DELETED_WRITE_MESSAGE);
    // Les deux écritures du profil traduisent dans leur `catch` par ce registre.
    expect(PROFIL.match(/showError\(profileErrorMessage\(/g) ?? []).toHaveLength(2);
    expect(PROFIL).toContain("showError(avatarUploadErrorMessage((e as Error).message))");
    expect(PROFIL).toContain("showError(avatarDeleteErrorMessage((e as Error).message))");
  });

  it("ne traduit plus deux fois : la phrase du compte supprimé survit à la sauvegarde", () => {
    // La sauvegarde levait la phrase déjà traduite puis la repassait dans le
    // registre, qui ne la reconnaissait pas : le joueur lisait « La sauvegarde a
    // échoué » à la place de la seule explication juste. On lève le code.
    expect(PROFIL).not.toContain("accountDeletedWriteMessage");
    expect(PROFIL).toContain('throw new Error(payload.error || "PROFILE_UPDATE_FAILED")');
  });

  it("ne laisse plus aucun message brut remonter au toast", () => {
    // Ni un code serveur, ni le message anglais d'un `TypeError` réseau : tout
    // `showError` de la page passe par une traduction.
    expect(PROFIL).not.toContain("showError((e as Error).message)");
    for (const code of [
      "PROFILE_UPDATE_FAILED",
      "AVATAR_UPLOAD_FAILED",
      "AVATAR_DELETE_FAILED",
    ]) {
      expect(PROFIL).not.toContain(`showError(payload.error || "${code}")`);
    }
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

const ANNUAIRE = read("app/(secured)/joueurs/page.tsx");
const FICHE = read("app/(secured)/joueurs/[id]/page.tsx");

/**
 * Deux demandes qui tirent en sens inverse, et chacune a son écran.
 *
 * - **L'annuaire** : la bascule des comptes supprimés ne doit pas se voir. Un
 *   libellé « Comptes supprimés (N) » en tête de liste invitait au clic et
 *   perdait le lecteur loin des joueurs qu'il cherchait ; c'est une icône seule,
 *   que son nom accessible décrit.
 * - **La fiche** : au contraire, un compte supprimé doit se voir au premier
 *   regard — son pseudo d'emprunt se lit comme un pseudo ordinaire.
 */
describe("interface — discret dans l'annuaire, évident sur la fiche", () => {
  it("fait de la bascule de l'annuaire une icône sans texte visible", () => {
    expect(ANNUAIRE).not.toContain("<Coche");
    expect(ANNUAIRE).toContain("<UserX");
    expect(ANNUAIRE).toContain("aria-pressed={showDeleted}");
    expect(ANNUAIRE).toMatch(/aria-label=\{`Afficher les comptes supprimés \(\$\{deletedCount\}\)`\}/);
    // Aucun libellé rendu en clair entre les balises du bouton.
    const button = ANNUAIRE.slice(
      ANNUAIRE.indexOf("className={`${s.deletedToggle}"),
      ANNUAIRE.indexOf("</button>", ANNUAIRE.indexOf("className={`${s.deletedToggle}")),
    );
    expect(button.slice(button.indexOf(">") + 1)).not.toMatch(/Comptes supprimés/);
  });

  it("garde les comptes supprimés masqués par défaut", () => {
    expect(ANNUAIRE).toContain("useState(false);");
    expect(ANNUAIRE).toMatch(/showDeleted \? players : players\.filter\(\(p\) => !p\.isDeleted\)/);
  });

  it("annonce le compte supprimé en tête de fiche", () => {
    expect(FICHE).toContain("const deleted = Boolean(data.profile.isDeleted);");
    expect(FICHE).toMatch(/\{deleted && \(\s*<span className=\{styles\.deletedBadge\}>/);
    expect(FICHE).toContain("Compte supprimé");
    expect(FICHE).toContain("pseudo d'emprunt");
  });

  it("n'affiche plus d'informations ni de gestion des rôles sur un compte supprimé", () => {
    expect(FICHE).toContain("{!deleted && (");
    expect(FICHE).toContain("{data.viewerIsAdmin && !data.isSelf && !deleted && (");
  });
});
