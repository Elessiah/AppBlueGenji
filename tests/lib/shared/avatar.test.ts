import { describe, expect, it } from "@jest/globals";
import {
  avatarInitial,
  isLocalAvatarUrl,
  localAvatarUrl,
  visibleAvatarUrl,
} from "@/lib/shared/avatar";

/**
 * L'initiale est le **seul** repli d'avatar du site : il n'existe pas de
 * fichier par défaut dans `public/`. Elle doit donc rendre quelque chose pour
 * n'importe quel pseudo, y compris ceux que le formulaire ne produit pas —
 * compte anonymisé, pseudo réduit à des espaces.
 */
describe("avatarInitial", () => {
  it("rend la première lettre en majuscule", () => {
    expect(avatarInitial("nova")).toBe("N");
    expect(avatarInitial("Nova")).toBe("N");
  });

  it("ignore les espaces de tête", () => {
    expect(avatarInitial("  nova")).toBe("N");
  });

  it("retombe sur « ? » quand il n'y a rien à afficher", () => {
    expect(avatarInitial("")).toBe("?");
    expect(avatarInitial("   ")).toBe("?");
    expect(avatarInitial(null)).toBe("?");
    expect(avatarInitial(undefined)).toBe("?");
  });

  // `pseudo[0]` coupait au milieu d'une paire de substitution UTF-16 et rendait
  // un caractère de remplacement.
  it("compte en caractères, pas en unités UTF-16", () => {
    expect(avatarInitial("🐉Dragons")).toBe("🐉");
  });

  it("laisse tel quel ce qui n'a pas de majuscule", () => {
    expect(avatarInitial("42e régiment")).toBe("4");
  });
});

/**
 * La règle des logos partenaires, appliquée aux comptes : **le `src` d'une
 * image est toujours une adresse du site**. La photo de profil d'un compte
 * Google y échappait — rendue depuis `lh3.googleusercontent.com`, elle
 * annonçait l'IP du **visiteur** à Google sur chaque page qui la portait.
 *
 * La garantie est posée ici, à la sortie, et non au rendu : `visibleAvatarUrl`
 * est la dernière porte que franchit un avatar avant d'atteindre un client, et
 * c'est ce qui la rend totale — filtrer écran par écran l'aurait fait dépendre
 * du prochain écran écrit.
 */
describe("isLocalAvatarUrl", () => {
  it("reconnaît les deux formes que la colonne a portées", () => {
    // Forme servie, écrite par `/api/profile/avatar` depuis que l'import passe
    // par un route handler…
    expect(isLocalAvatarUrl("/api/uploads/avatars/12-ab.webp")).toBe(true);
    // …et forme disque, telle qu'elle subsiste en base ancienne.
    expect(isLocalAvatarUrl("/uploads/avatars/12-ab.webp")).toBe(true);
  });

  it("refuse une origine étrangère, quelle qu'elle soit", () => {
    expect(isLocalAvatarUrl("https://lh3.googleusercontent.com/a/ACg8ocK=s96-c")).toBe(false);
    expect(isLocalAvatarUrl("https://exemple.invalid/photo.png")).toBe(false);
    // Une adresse protocole-relative n'est pas un chemin : elle désigne un
    // autre hôte, et c'est justement la forme qu'on ne voit pas passer.
    expect(isLocalAvatarUrl("//exemple.invalid/photo.png")).toBe(false);
  });

  it("traite l'absence comme une absence", () => {
    expect(isLocalAvatarUrl(null)).toBe(false);
    expect(isLocalAvatarUrl(undefined)).toBe(false);
    expect(isLocalAvatarUrl("")).toBe(false);
  });
});

describe("visibleAvatarUrl", () => {
  const local = "/api/uploads/avatars/12-ab.webp";
  const google = "https://lh3.googleusercontent.com/a/ACg8ocK=s96-c";

  it("laisse passer un fichier à nous quand le réglage l'autorise", () => {
    expect(visibleAvatarUrl(local, true)).toBe(local);
  });

  it("le retient quand le compte l'a masqué, sauf pour son propriétaire", () => {
    expect(visibleAvatarUrl(local, false)).toBeNull();
    expect(visibleAvatarUrl(local, false, true)).toBe(local);
  });

  // Le cœur de la correction : même autorisé, même pour son propriétaire, un
  // avatar hébergé ailleurs ne sort pas. L'écran retombe sur la pastille à
  // initiale, et le compte retrouve sa photo à sa prochaine connexion.
  it("n'émet jamais une URL étrangère, même au propriétaire du compte", () => {
    expect(visibleAvatarUrl(google, true)).toBeNull();
    expect(visibleAvatarUrl(google, true, true)).toBeNull();
    expect(visibleAvatarUrl(google, false, true)).toBeNull();
  });
});

/**
 * `visibleAvatarUrl` n'est pas la seule porte : `getCurrentUser` en est une
 * seconde, et elle ne consulte **pas** la visibilité — c'est son propre avatar
 * que le titulaire voit dans la barre de navigation et dans l'en-tête public.
 * Elle doit poser la même règle d'origine, faute de quoi la correction aurait
 * seulement transformé une fuite en **panne** : `unoptimized` retiré,
 * `next/image` lève sur une origine absente de `remotePatterns`, donc toutes
 * les pages du compte casseraient.
 */
describe("localAvatarUrl", () => {
  it("rend le fichier tel quel quand il vient de chez nous", () => {
    expect(localAvatarUrl("/api/uploads/avatars/12-ab.webp")).toBe(
      "/api/uploads/avatars/12-ab.webp",
    );
    expect(localAvatarUrl("/uploads/avatars/12-ab.webp")).toBe("/uploads/avatars/12-ab.webp");
  });

  it("rend null sur tout le reste", () => {
    expect(localAvatarUrl("https://lh3.googleusercontent.com/a/ACg8ocK=s96-c")).toBeNull();
    expect(localAvatarUrl("//exemple.invalid/p.png")).toBeNull();
    expect(localAvatarUrl(null)).toBeNull();
    expect(localAvatarUrl("")).toBeNull();
  });

  // Une seule réponse à « cette adresse est-elle la nôtre » : le prédicat et la
  // fonction qui filtre ne peuvent pas diverger.
  it("s'accorde avec le prédicat", () => {
    for (const url of [
      "/api/uploads/avatars/1.webp",
      "/uploads/avatars/1.webp",
      "https://lh3.googleusercontent.com/a/x",
      "",
      null,
    ]) {
      expect(localAvatarUrl(url) !== null).toBe(isLocalAvatarUrl(url));
    }
  });
});
