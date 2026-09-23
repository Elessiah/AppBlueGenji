import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { formatFinalRank } from "@/app/(secured)/equipes/[id]/_lib/team-history";
import { jsonRequest, teamApi } from "@/app/(secured)/equipes/[id]/_lib/team-api";
import { membershipErrorMessage, teamErrorMessage } from "@/app/(secured)/equipes/_lib/team-errors";

/**
 * Fiche d'équipe en mode gestion.
 *
 * Le harnais tourne en environnement `node` : un composant React n'y est pas
 * montable. Les défauts de rendu corrigés se gardent donc sur la **source** —
 * mais ce sont des invariants réels, et chacun a été constaté dans un
 * navigateur avant d'être écrit ici (voir `docs/features/TEAM_MANAGEMENT_PAGE.md`).
 */

const ROOT = join(__dirname, "..", "..");
const PAGE_DIR = join(ROOT, "app", "(secured)", "equipes", "[id]");
const read = (...parts: string[]) => readFileSync(join(PAGE_DIR, ...parts), "utf8");
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

const components = readdirSync(join(PAGE_DIR, "_components")).filter((f) => f.endsWith(".tsx"));

describe("modales de la fiche", () => {
  const dialog = stripComments(read("_components", "TeamDialog.tsx"));

  it("sont portées dans document.body", () => {
    // Rendues dans `<section class="fade-in">`, elles héritaient du transform
    // que l'animation laisse posé : `position: fixed` se calait sur la section,
    // la modale se centrait au milieu de la page, sous le bord de l'écran.
    expect(dialog).toMatch(/createPortal\([\s\S]*document\.body\s*,?\s*\)/);
  });

  it("confient focus, Échap et piège de tabulation à useDialogBehavior, une fois montées", () => {
    expect(dialog).toContain("useDialogBehavior({ open: mounted");
    expect(dialog).toMatch(/locked: busy/);
    expect(dialog).toContain('"aria-modal": true');
    expect(dialog).toContain('"aria-labelledby": titleId');
  });

  it.each(components.filter((f) => f !== "TeamDialog.tsx"))(
    "%s ne recopie pas son propre cadre fixe",
    (file) => {
      const src = stripComments(read("_components", file));
      expect(src).not.toMatch(/position:\s*["']fixed["']/);
      expect(src).not.toMatch(/role="dialog"/);
    },
  );

  it.each(["RolesDialog.tsx", "TransferOwnershipDialog.tsx", "ClaimGhostTeamDialog.tsx", "ConfirmDialog.tsx"])(
    "%s passe par le cadre commun",
    (file) => {
      expect(read("_components", file)).toContain("<TeamDialog");
    },
  );

  it("la modale des rôles ne se ferme que sur un succès", () => {
    const roles = stripComments(read("_components", "RolesDialog.tsx"));
    expect(roles).toContain("onSave: (selected: TeamRole[]) => Promise<boolean>");
    expect(roles).toMatch(/if \(!ok\) setPending\(false\)/);
    const members = stripComments(read("_components", "MembersSection.tsx"));
    expect(members).toMatch(/const ok = await updateRoles[\s\S]*if \(ok\) setRolesTarget\(null\)/);
  });
});

describe("roster et invitation", () => {
  const members = stripComments(read("_components", "MembersSection.tsx"));
  const css = read("team.module.css");

  it("affiche les rôles en pastilles, plus en codes séparés par des virgules", () => {
    expect(members).toContain("<RolePills");
    expect(members).not.toMatch(/roles\.join\(/);
  });

  it("confirme une exclusion au lieu de la lancer au premier clic", () => {
    expect(members).toMatch(/onClick=\{\(\) => setKickTarget\(member\)\}/);
    expect(members).toContain("<ConfirmDialog");
  });

  it("ne vide le formulaire d'invitation que sur un succès", () => {
    expect(members).toMatch(/const ok = await addMember[\s\S]*if \(ok\) \{\s*setMemberPseudo\(""\)/);
  });

  it("lève la coupe du bloc qui porte l'autocomplétion", () => {
    // `.ds-block { overflow: hidden }` rognait six suggestions sur huit.
    expect(members).toContain("styles.overflowBlock");
    const rule = css.match(/:global\(\.ds-block\)\.overflowBlock \{([^}]*)\}/);
    expect(rule?.[1]).toMatch(/overflow:\s*visible/);
    expect(rule?.[1]).toMatch(/z-index:\s*1/);
  });

  it("ne charge la liste des joueurs qu'avec le champ qui s'en sert", () => {
    // La page téléchargeait l'annuaire entier pour tout visiteur.
    expect(members).not.toContain("/api/players");
    expect(read("_components", "PlayerPseudoCombobox.tsx")).toContain('fetch("/api/players"');
  });

  it("l'autocomplétion suit le motif combobox de l'ARIA", () => {
    const combo = stripComments(read("_components", "PlayerPseudoCombobox.tsx"));
    expect(combo).toContain('role="combobox"');
    expect(combo).toContain('role="listbox"');
    expect(combo).toContain('role="option"');
    expect(combo).toContain("aria-activedescendant");
    for (const key of ["ArrowDown", "ArrowUp", "Enter", "Escape"]) expect(combo).toContain(`"${key}"`);
  });
});

describe("page", () => {
  const page = stripComments(read("page.tsx"));

  it("ne relit plus /api/profile pour savoir qui regarde", () => {
    expect(page).not.toContain("/api/profile");
    expect(page).toContain("team.viewerUserId");
  });

  it("place les paramètres sous le roster", () => {
    expect(page.indexOf("<MembersSection")).toBeLessThan(page.indexOf("<TeamSettings"));
  });

  it("ne montre le formulaire d'identité qu'à qui peut l'enregistrer", () => {
    const settings = stripComments(read("_components", "TeamSettings.tsx"));
    expect(settings).toContain('team.viewerMembership === "OWNER" || managedAsGhost');
    expect(settings).toMatch(/\{ownsIdentity \? \(\s*<form onSubmit=\{saveMeta\}/);
  });

  it("relit la fiche sans repasser par « Chargement… »", () => {
    const hook = stripComments(read("_hooks", "useTeamDetail.ts"));
    expect(hook).toContain("refresh: revalidate");
    const loader = readFileSync(join(ROOT, "lib", "shared", "hooks", "useResourceLoader.ts"), "utf8");
    expect(loader).toContain('if (!silent) setState({ status: "loading"');
  });

  it("aucun composant de la fiche n'affiche un code d'erreur brut", () => {
    for (const file of components) {
      const src = stripComments(read("_components", file));
      expect(src).not.toMatch(/showError\(\(e as Error\)\.message\)/);
    }
  });
});

describe("formatFinalRank", () => {
  it.each([
    [1, "1er"],
    [2, "2e"],
    [11, "11e"],
    [null, "—"],
    [0, "—"],
    [1.5, "—"],
  ])("%p → %s", (rank, expected) => {
    expect(formatFinalRank(rank as number | null)).toBe(expected);
  });
});

describe("teamApi", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  const respond = (status: number, body: string) =>
    jest.fn(async () => new Response(body, { status, headers: { "content-type": "application/json" } }));

  it("rend le corps d'une réponse réussie", async () => {
    global.fetch = respond(200, JSON.stringify({ result: "JOINED" })) as never;
    await expect(teamApi("/x", undefined, "FALLBACK")).resolves.toEqual({ result: "JOINED" });
  });

  it("lève le code du serveur", async () => {
    global.fetch = respond(409, JSON.stringify({ error: "ALREADY_INVITED" })) as never;
    await expect(teamApi("/x", undefined, "FALLBACK")).rejects.toThrow("ALREADY_INVITED");
  });

  it("lève le code de repli quand la réponse n'est pas du JSON", async () => {
    // Une page d'erreur HTML faisait lever `response.json()` : le toast
    // affichait « Unexpected token '<' ».
    global.fetch = respond(502, "<html>Bad gateway</html>") as never;
    await expect(teamApi("/x", undefined, "TEAM_UPDATE_FAILED")).rejects.toThrow("TEAM_UPDATE_FAILED");
  });

  it("lève NETWORK_ERROR quand la requête n'aboutit pas", async () => {
    global.fetch = jest.fn(async () => {
      throw new TypeError("Failed to fetch");
    }) as never;
    await expect(teamApi("/x", undefined, "FALLBACK")).rejects.toThrow("NETWORK_ERROR");
    expect(teamErrorMessage("NETWORK_ERROR")).toMatch(/réseau/);
  });

  it("jsonRequest pose méthode, en-tête et corps", () => {
    expect(jsonRequest("PATCH", { a: 1 })).toEqual({
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: '{"a":1}',
    });
  });
});

describe("messages qui changent de sujet", () => {
  it("USER_ALREADY_IN_TEAM parle de l'invité côté gestion, de soi côté joueur", () => {
    expect(teamErrorMessage("USER_ALREADY_IN_TEAM")).toMatch(/^Ce joueur/);
    expect(membershipErrorMessage("USER_ALREADY_IN_TEAM")).toMatch(/^Tu /);
  });

  it("les deux registres s'accordent sur tout le reste", () => {
    expect(membershipErrorMessage("ALREADY_REQUESTED")).toBe(teamErrorMessage("ALREADY_REQUESTED"));
  });

  it("ne rend jamais une fonction pour un nom hérité d'Object", () => {
    expect(typeof teamErrorMessage("constructor")).toBe("string");
    expect(teamErrorMessage("toString")).toBe(teamErrorMessage("UN_CODE_INCONNU"));
  });
});

describe("correctifs de la première revue", () => {
  const css = read("team.module.css");
  const block = (selector: string) => {
    const start = css.indexOf(`${selector} {`);
    expect(start).toBeGreaterThan(-1);
    return css.slice(start, css.indexOf("}", start));
  };

  it("un lien d'entrée solo ne fait pas clignoter « introuvable » pendant la redirection", () => {
    const hook = stripComments(read("_hooks", "useTeamDetail.ts"));
    expect(hook).toContain("setRedirecting(true)");
    expect(hook).toMatch(/error: !redirecting &&/);
    expect(hook).toMatch(/loading: status === "loading" \|\| redirecting/);
  });

  it("la piste d'actions du roster a une largeur fixe, jamais `auto`", () => {
    const withActions = block(".withActions");
    expect(withActions).toMatch(/grid-template-columns:[^;]*\d+px;/);
    expect(withActions).not.toMatch(/\bauto\b/);
  });

  it("le panneau d'une modale ne défile ni ne rogne : c'est le voile qui défile", () => {
    const dialog = stripComments(block(".dialog"));
    expect(dialog).not.toMatch(/overflow/);
    expect(dialog).not.toMatch(/max-height/);
    expect(dialog).toMatch(/margin:\s*auto/);
    expect(css).not.toContain("data-allow-overflow");
  });

  it("la liste du transfert défile par ScrollArea", () => {
    const transfer = read("_components", "TransferOwnershipDialog.tsx");
    expect(transfer).toMatch(/<ScrollArea orientation="y" className=\{styles\.choiceList\}/);
    expect(stripComments(block(".choiceList"))).not.toMatch(/overflow/);
  });

  it("un refus de rôles se dit en notification, pas en ligne", () => {
    const roles = stripComments(read("_components", "RolesDialog.tsx"));
    const members = stripComments(read("_components", "MembersSection.tsx"));
    for (const src of [roles, members]) {
      expect(src).toContain('showError(teamErrorMessage("MISSING_ROLE"))');
      expect(src).not.toContain('role="status"');
    }
  });

  it("Échap revient d'abord au contrôle qui a quelque chose d'ouvert", () => {
    const hook = readFileSync(join(ROOT, "lib", "shared", "hooks", "useDialogBehavior.ts"), "utf8");
    const escape = hook.slice(hook.indexOf('event.key === "Escape"'), hook.indexOf("closeRef.current()"));
    expect(escape).toContain('getAttribute?.("aria-expanded") === "true"');
  });

  it("les relectures ne s'appliquent que si elles sont les dernières lancées", () => {
    const loader = stripComments(readFileSync(join(ROOT, "lib", "shared", "hooks", "useResourceLoader.ts"), "utf8"));
    expect(loader).toContain("const seq = ++latestRef.current");
    const ready = loader.slice(0, loader.indexOf('setState({ status: "ready"'));
    expect(ready.slice(ready.lastIndexOf("res.json()"))).toContain("if (!isLatest()) return;");
  });
});
