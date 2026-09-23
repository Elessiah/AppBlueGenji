import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  PROFILE_SECTION_BY_ID,
  PROFILE_SECTIONS,
  profileSectionIdFromHash,
  visibleProfileSections,
  type ProfileSection,
} from "@/app/(secured)/profil/_lib/profile-sections";

// Le registre est `as const` : chaque entrée garde son type littéral, si bien
// que `requires` n'existe pas sur celles qui ne le portent pas. Le test lit le
// registre sous son type déclaré, comme `visibleProfileSections`.
const SECTIONS: readonly ProfileSection[] = PROFILE_SECTIONS;

const ROOT = join(__dirname, "..", "..");
const page = readFileSync(join(ROOT, "app/(secured)/profil/page.tsx"), "utf8");
const connectedApps = readFileSync(
  join(ROOT, "app/(secured)/profil/ConnectedAppsSection.tsx"),
  "utf8",
);
const css = readFileSync(join(ROOT, "app/(secured)/profil/profil.module.css"), "utf8");
const arenaNav = readFileSync(join(ROOT, "components/arena-nav.module.css"), "utf8");

/**
 * `/profil` empilait onze blocs dans un seul formulaire, sans un titre pour dire
 * où l'on passait d'un sujet à l'autre, et avec le bouton qui efface le compte
 * au fil du texte, sous la même apparence qu'un réglage.
 *
 * Le registre nomme les sections **une fois** et sert deux lecteurs : la
 * navigation d'ancres et les titres. Deux listes auraient dérivé, et la dérive
 * se serait vue sous la forme d'un lien qui ne mène nulle part —
 * `scrollIntoView` sur une ancre absente ne fait rien du tout, sans erreur.
 */
describe("Registre des sections", () => {
  it("donne à chaque section une ancre, un titre et une promesse", () => {
    for (const section of PROFILE_SECTIONS) {
      expect(section.id).toMatch(/^[a-z]+$/);
      expect(section.title.length).toBeGreaterThan(0);
      expect(section.lead.length).toBeGreaterThan(0);
    }
  });

  it("n'emploie jamais deux fois la même ancre", () => {
    const ids = PROFILE_SECTIONS.map((section) => section.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("finit par le compte — exporter et effacer ne sont pas des réglages", () => {
    expect(PROFILE_SECTIONS[PROFILE_SECTIONS.length - 1].id).toBe("compte");
  });
});

describe("visibleProfileSections", () => {
  it("cache les invitations quand il n'y en a aucune", () => {
    const ids = visibleProfileSections({ invitations: 0 }).map((s) => s.id);
    expect(ids).not.toContain("invitations");
  });

  it("les montre dès la première", () => {
    const ids = visibleProfileSections({ invitations: 1 }).map((s) => s.id);
    expect(ids).toContain("invitations");
  });

  it("ne filtre que les sections qui déclarent un `requires`", () => {
    const hidden = visibleProfileSections({ invitations: 0 }).map((s) => s.id);
    for (const section of SECTIONS) {
      if (section.requires === undefined) expect(hidden).toContain(section.id);
    }
  });

  it("lit le compteur nommé par `requires`, jamais une ancre écrite en dur", () => {
    // La section conditionnelle du registre doit nommer sa condition : sans
    // cela, le filtre retomberait sur un `id !== "invitations"` en dur qu'une
    // deuxième section conditionnelle porterait sans effet.
    const conditional = SECTIONS.filter((s) => s.requires !== undefined);
    expect(conditional.length).toBeGreaterThan(0);
    for (const section of conditional) {
      expect(section.requires).toBe("invitations");
    }
  });

  it("ne touche à rien d'autre", () => {
    const withInvites = visibleProfileSections({ invitations: 2 });
    expect(withInvites).toHaveLength(PROFILE_SECTIONS.length);
  });

  it("garde l'ordre du registre", () => {
    const ids = visibleProfileSections({ invitations: 3 }).map((s) => s.id);
    expect(ids).toEqual(PROFILE_SECTIONS.map((s) => s.id));
  });
});

describe("La page descend du registre", () => {
  it("bâtit sa navigation depuis les sections visibles", () => {
    expect(page).toContain("visibleProfileSections({ invitations: invitations.length })");
    expect(page).toContain('href={`#${entry.id}`}');
  });

  it("rend chaque section par le même composant", () => {
    for (const section of PROFILE_SECTIONS) {
      expect(page).toContain(`sectionById.${section.id}`);
    }
  });

  it("ne réécrit aucun titre de section à la main", () => {
    for (const section of PROFILE_SECTIONS) {
      expect(page).not.toContain(`<h2>${section.title}</h2>`);
    }
  });

  it("isole la suppression du compte dans sa propre section", () => {
    const danger = page.slice(page.indexOf("sectionById.compte"));
    expect(danger).toContain("onDeleteAccount");
    expect(danger).toContain("dangerSection");
  });
});

describe("La page dit ce qu'elle fait des identifiants", () => {
  it("prévient que Blizzard réécrit le BattleTag", () => {
    expect(page).toContain("BLIZZARD_BATTLETAG_NOTICE");
  });

  it("énonce l'exposition du tag Discord par la source partagée avec /connexion", () => {
    expect(page).toContain("DISCORD_TAG_UNVERIFIED_AUDIENCE");
  });

  it("n'écrit pas de branche que l'état ne peut pas atteindre", () => {
    // `verified` implique `linked` (`writeVerifiedTag` écrit `discord_id`, et
    // détacher Discord décertifie), donc implique `discordLocked` : une branche
    // « certifié, non verrouillé » ne serait jamais rendue. Deux cas donc, et
    // deux seulement — la phrase du verrou, puis celle du tag non certifié.
    // L'attente passe à la phrase plutôt que d'être devinée : « pas encore lu »
    // et « lecture échouée » se confondaient en un seul `linked: null`, et le
    // verrou annonçait une panne pendant le temps normal d'un aller-retour.
    expect(page).toContain(
      "discordTagLockNotice({ ...discordState, pending: discordStateBusy })",
    );
    expect(page).toContain("DISCORD_TAG_UNVERIFIED_AUDIENCE");
  });

  it("ne recopie pas à la main l'exposition d'un tag certifié", () => {
    // Elle est énoncée par `discordTagLockNotice` ; une seconde rédaction ici
    // divergerait de la promesse faite sur `/connexion`.
    expect(page).not.toMatch(/les administrateurs le voient/);
  });

  it("ne recopie plus l'aide des tags de jeu deux fois", () => {
    expect(page).toContain("GAME_TAG_NOTICE");
    expect(page).not.toContain("jamais pour des statistiques");
  });
});

describe("PROFILE_SECTION_BY_ID", () => {
  it("indexe le registre entier, sections conditionnelles comprises", () => {
    for (const section of PROFILE_SECTIONS) {
      expect(PROFILE_SECTION_BY_ID[section.id]).toBe(section);
    }
    expect(Object.keys(PROFILE_SECTION_BY_ID)).toHaveLength(PROFILE_SECTIONS.length);
  });

  it("garde l'invitation même quand la navigation ne l'annonce pas", () => {
    // La recherche par ancre est totale : la liste filtrée rendrait `undefined`
    // ici, et `<ProfileSection>` planterait sur `section.id`.
    expect(PROFILE_SECTION_BY_ID.invitations).toBeDefined();
    expect(visibleProfileSections({ invitations: 0 }).map((s) => s.id)).not.toContain(
      "invitations",
    );
  });
});

/**
 * Le navigateur n'honore le fragment d'une URL collée qu'au chargement du
 * document — quand `/profil` n'affiche encore que « Chargement du profil… ».
 * Le saut se rejoue donc une fois la section montée, sur une ancre reconnue
 * dans le registre : un fragment vient du navigateur.
 */
describe("profileSectionIdFromHash", () => {
  it("reconnaît une ancre du registre, avec ou sans dièse", () => {
    expect(profileSectionIdFromHash("#connexions")).toBe("connexions");
    expect(profileSectionIdFromHash("compte")).toBe("compte");
  });

  it("reconnaît la section conditionnelle, qui est bien une ancre", () => {
    expect(profileSectionIdFromHash("#invitations")).toBe("invitations");
  });

  it("refuse ce qui ne nomme aucune section", () => {
    expect(profileSectionIdFromHash("")).toBeNull();
    expect(profileSectionIdFromHash("#")).toBeNull();
    expect(profileSectionIdFromHash("#inconnu")).toBeNull();
    expect(profileSectionIdFromHash("#compte-title")).toBeNull();
    expect(profileSectionIdFromHash("##compte")).toBeNull();
  });
});

describe("La page rejoue le saut vers l'ancre", () => {
  it("lit le fragment par la fonction du registre", () => {
    expect(page).toContain("profileSectionIdFromHash(window.location.hash)");
  });

  it("le lit une seule fois, au montage, et non à chaque rafraîchissement", () => {
    // `data` est remplacé à chaque sauvegarde : relire `window.location.hash`
    // à ce moment-là ramènerait le lecteur à l'ancre cliquée bien plus tôt.
    const capture = page.indexOf("profileSectionIdFromHash(window.location.hash)");
    const effect = page.indexOf("sectionHonoured.current = true");
    expect(capture).toBeLessThan(effect);
    expect(page).toContain("useState<string | null>(() =>");
    const effectBody = page.slice(page.indexOf("if (!data || !requestedSection"), effect);
    expect(effectBody).not.toContain("window.location.hash");
  });

  it("indexe par le registre total et non par la liste filtrée", () => {
    expect(page).toContain("const sectionById = PROFILE_SECTION_BY_ID");
  });
});

/**
 * « Applications connectées » se dessinait tout seul du temps où il vivait sans
 * section autour. Rendu depuis `<ProfileSection>`, son cadre et son titre
 * faisaient doublon : une carte dans une carte, le même `<h2>` deux fois.
 */
describe("Aucune section ne se dessine deux fois", () => {
  it("laisse le cadre et le titre à ProfileSection", () => {
    expect(connectedApps).not.toContain("ds-block");
    expect(connectedApps).not.toContain("<h2>");
  });

  it("garde son texte d'aide, que le registre ne porte pas", () => {
    expect(connectedApps).toContain("la dernière ne peut pas être retirée");
  });
});

/**
 * `/profil` vit sous `ArenaNav`, barre `position: sticky; top: 0`. Une ancre qui
 * tombe à la hauteur exacte de la section la range **derrière** la barre : le
 * titre visé devient le seul élément qu'on ne voit pas.
 */
describe("L'ancre tombe sous la barre de navigation", () => {
  it("réserve au moins la hauteur de la barre", () => {
    const margin = css.match(/scroll-margin-top:\s*(\d+)px/);
    expect(margin).not.toBeNull();
    // 52 px de pastille + 2 × 14 px de rembourrage : la barre est haute de 80.
    expect(Number(margin![1])).toBeGreaterThanOrEqual(80);
  });

  it("mesure bien la barre que la page a au-dessus d'elle", () => {
    // Le jour où la barre grandit, ce test dit où relire la marge.
    expect(arenaNav).toContain("position: sticky");
    expect(arenaNav).toMatch(/width:\s*52px/);
    expect(arenaNav).toMatch(/padding:\s*14px 0/);
  });
});

/**
 * Le formulaire couvre quatre sections pour un seul bouton : posé au fond de la
 * dernière, il était hors de vue de qui arrive par une ancre — et la navigation
 * de cette page invite précisément à sauter au milieu du formulaire.
 */
describe("La sauvegarde reste atteignable", () => {
  it("sort le pied de la dernière section pour le rendre au formulaire", () => {
    const foot = page.indexOf("s.formFoot");
    const lastSectionClose = page.lastIndexOf("</ProfileSection>", foot);
    const formClose = page.indexOf("</form>", foot);
    expect(foot).toBeGreaterThan(lastSectionClose);
    expect(formClose).toBeGreaterThan(foot);
  });

  it("n'a toujours qu'un seul bouton de soumission", () => {
    expect(page.match(/type="submit"/g)).toHaveLength(1);
  });

  it("colle le pied au bas de la fenêtre", () => {
    const rule = css.slice(css.indexOf(".formFoot {"));
    expect(rule.slice(0, rule.indexOf("}"))).toContain("position: sticky");
  });

  it("lui donne sa propre surface, et non la couleur de la page", () => {
    // Les cartes défilent dessous : un fond à la couleur de la page les
    // barrerait, `.ds-block` étant translucide et bien plus clair.
    const rule = css.slice(css.indexOf(".formFoot {"));
    const body = rule.slice(0, rule.indexOf("}"));
    expect(body).not.toContain("var(--bg-0)");
    expect(body).toContain("border:");
    expect(body).toContain("backdrop-filter");
  });
});

/**
 * Le `.btn` global n'a aucun état désactivé : sans règle ici, un bouton qui
 * refuse le clic garde le survol, le soulèvement et `cursor: pointer`.
 */
/**
 * Le champ Discord est en lecture seule dès que le compte est rattaché, et c'est
 * le seul endroit où le tag s'affiche : après une sauvegarde, il doit montrer ce
 * qui est **enregistré**, sinon la pastille et la phrase du verrou annoncent un
 * tag à côté d'un autre.
 */
describe("La sauvegarde réaligne le tag affiché", () => {
  it("relit le tag depuis la réponse du PATCH", () => {
    const save = page.slice(page.indexOf('method: "PATCH"'));
    const afterSetData = save.slice(save.indexOf("setData(payload)"));
    expect(afterSetData.slice(0, afterSetData.indexOf("showSuccess"))).toContain(
      "setDiscordPseudo(payload.profile.discordPseudo",
    );
  });
});

describe("Un contrôle désactivé se voit", () => {
  it("habille le `.btn` global, en `:global` sans quoi la règle est hachée", () => {
    expect(css).toContain(":global(.btn:disabled)");
    expect(css).toContain("cursor: not-allowed");
  });

  it("éteint aussi son survol", () => {
    expect(css).toContain(":global(.btn:disabled:hover)");
  });
});

/**
 * « Avatar » n'étiquette aucun champ : le `<input type="file">` est caché et les
 * deux contrôles sont des boutons. Un `<label>` sans `for` n'étiquette rien.
 */
describe("Le groupe « Avatar » porte un nom", () => {
  it("nomme un groupe plutôt qu'un champ", () => {
    expect(page).toContain('role="group" aria-labelledby="profile-avatar-label"');
    expect(page).not.toContain('<label id="profile-avatar-label">');
  });

  it("lève l'ambiguïté du second « Supprimer » sans perdre son texte visible", () => {
    // WCAG 2.5.3 : le nom accessible commence par le texte affiché.
    expect(page).toContain('aria-label="Supprimer mon avatar"');
  });
});
