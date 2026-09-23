import { describe, expect, it } from "@jest/globals";
import {
  BATTLETAG_LOCKED,
  battletagLockNotice,
  checkBattletagEdit,
  isBattletagLocked,
} from "@/lib/shared/battletag-lock";

/**
 * **Un compte Blizzard rattaché possède son BattleTag.**
 *
 * Le champ avait deux écrivains qui ne se connaissaient pas — la saisie de
 * `/profil` et Blizzard, qui le **réécrit à chaque connexion**. Le formulaire
 * acceptait donc une correction que la connexion suivante effaçait sans rien
 * dire, et un BattleTag faux ne se constate qu'au moment où l'ajout en jeu
 * échoue.
 *
 * La règle a **deux lecteurs qui doivent dire la même chose** : l'écran (qui
 * met le champ en lecture seule et explique) et `updateOwnProfile` (qui refuse
 * en 409). Un champ grisé n'est pas une garde — il suffit d'un `curl` —, et une
 * garde sans champ grisé est un formulaire qui mène à une erreur.
 */

describe("checkBattletagEdit", () => {
  it("verrouille dès qu'un compte Blizzard est rattaché", () => {
    expect(checkBattletagEdit({ linked: true })).toBe("LINKED_ACCOUNT");
    expect(isBattletagLocked({ linked: true })).toBe(true);
  });

  it("laisse le champ ouvert quand rien n'est rattaché", () => {
    expect(checkBattletagEdit({ linked: false })).toBeNull();
    expect(isBattletagLocked({ linked: false })).toBe(false);
  });

  it("verrouille aussi sur un état **inconnu**, et c'est le seul défaut tenable", () => {
    // Les deux erreurs ne se valent pas : verrouiller à tort fait attendre un
    // rechargement, ouvrir à tort laisse saisir une valeur que la route refusera
    // en 409 — et ce refus emporte **toute** la sauvegarde, le `PATCH` étant
    // indivisible.
    expect(checkBattletagEdit({ linked: null })).toBe("UNKNOWN_LINK");
    expect(isBattletagLocked({ linked: null })).toBe(true);
  });

  it("range toute valeur hors des deux booléens dans l'inconnu", () => {
    // L'écran alimente cet état depuis une réponse JSON que rien ne valide : un
    // corps sans `linked` produit `undefined`, qui ne doit surtout pas **ouvrir**
    // le champ. Écrit dans l'autre sens (`=== null` d'abord), il y glissait.
    for (const linked of [undefined, "true", 1, {}]) {
      expect(isBattletagLocked({ linked } as never)).toBe(true);
    }
  });
});

describe("battletagLockNotice", () => {
  it("dit l'attente comme une attente, sans cause ni geste", () => {
    // Le profil se rend dès que `GET /api/profile` répond, régulièrement avant
    // la liste des rattachements : annoncer une panne pendant ce temps-là
    // ferait chercher une cause qui n'existe pas.
    const notice = battletagLockNotice({ tag: null, linked: null, pending: true });

    expect(notice).toContain("Lecture");
    expect(notice).not.toContain("Impossible");
  });

  it("nomme le verrou et sa sortie quand la lecture a échoué", () => {
    const notice = battletagLockNotice({ tag: null, linked: null });

    expect(notice).toContain("Impossible");
    // On n'affirme **ni** un rattachement ni son absence : rien ne le soutient.
    expect(notice).not.toContain("est rattaché");
  });

  it("explique le verrou, et nomme les deux gestes qui restent", () => {
    const notice = battletagLockNotice({ tag: "Nova#2143", linked: true });

    // Le geste qui **change** la valeur…
    expect(notice).toContain("Applications connectées");
    // …et celui qui cesse de la **publier**, qui n'est pas le même. Le refus
    // qui n'en nommerait qu'un enverrait la moitié des joueurs au mauvais
    // endroit.
    expect(notice).toContain("BattleTag OW");
  });

  it("couvre le compte rattaché **sans** BattleTag sans inventer de cause", () => {
    const notice = battletagLockNotice({ tag: null, linked: true });

    expect(notice).toContain("aucun BattleTag");
    expect(notice).toContain("Applications connectées");
  });

  it("ne laisse jamais sortir un jeton en capitales", () => {
    for (const state of [
      { tag: null, linked: null, pending: true },
      { tag: null, linked: null },
      { tag: null, linked: true },
      { tag: "Nova#2143", linked: true },
    ]) {
      expect(battletagLockNotice(state)).not.toContain(BATTLETAG_LOCKED);
      expect(battletagLockNotice(state)).not.toMatch(/[A-Z]{4,}_[A-Z]{4,}/);
    }
  });
});

describe("le code de refus", () => {
  it("est celui que la route et le registre français partagent", () => {
    // Recopié des deux côtés, il dériverait sans qu'aucun test ne le voie : le
    // joueur lirait « La sauvegarde a échoué » sur un refus qu'on sait nommer.
    expect(BATTLETAG_LOCKED).toBe("BATTLETAG_LOCKED");
  });
});
