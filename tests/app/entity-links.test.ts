import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

/**
 * Un nom d'équipe ou de joueur mène à sa fiche, partout où il est affiché.
 *
 * Ces écrans sont des composants clients au JSX purement présentationnel : on
 * garde leur structure au niveau source, comme `phase-card.test.ts`. Ce qui est
 * gardé ici n'est pas une apparence mais deux invariants :
 *
 * 1. **un nom mène quelque part** — la régression typique est un `<span>` qui
 *    remplace un lien au fil d'une refonte de mise en page ;
 * 2. **jamais un `<a>` dans un `<a>`** — les cartes d'annuaire mènent à une
 *    fiche *et* portent des liens imbriqués (roster, équipe du joueur) : le lien
 *    principal doit rester une plaque posée par-dessus, sous peine d'erreur
 *    d'hydratation React et de destination indistincte au clavier.
 */

/** Retire commentaires de bloc et de ligne : ils citent des balises en prose. */
function stripComments(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
}

const ANCHOR_TAGS = "a|Link|EntityLink|TeamLink|PlayerLink|EntrantLink";
const ANCHOR_TOKENS = new RegExp(
  `<(?:${ANCHOR_TAGS})\\b[^>]*?/>|<(?:${ANCHOR_TAGS})\\b|</(?:${ANCHOR_TAGS})>`,
  "g",
);

/** Profondeur maximale d'imbrication des ancres (`<a>` et ses composants) dans le JSX. */
function maxAnchorDepth(code: string): number {
  let depth = 0;
  let max = 0;
  for (const token of code.match(ANCHOR_TOKENS) ?? []) {
    if (token.endsWith("/>")) {
      max = Math.max(max, depth + 1); // auto-fermante : ouverte et refermée aussitôt
    } else if (token.startsWith("</")) {
      depth -= 1;
    } else {
      max = Math.max(max, (depth += 1));
    }
  }
  expect(depth).toBe(0); // balises appariées : sans quoi la mesure ne veut rien dire
  return max;
}

describe("maxAnchorDepth — le garde-fou du garde-fou", () => {
  it("voit l'imbrication qu'il interdit", () => {
    expect(maxAnchorDepth("<a><a></a></a>")).toBe(2);
    expect(maxAnchorDepth("<Link><TeamLink></TeamLink></Link>")).toBe(2);
  });

  it("compte une ancre auto-fermante sans la laisser ouverte", () => {
    expect(maxAnchorDepth('<Link href="/x" />\n<a>y</a>')).toBe(1);
  });
});

describe("Classe `.entity-link` — l'affordance d'un nom cliquable", () => {
  const css = read("app/globals.css");

  it("existe, puisque `a` est global sans décoration", () => {
    // Sans marque au survol, un nom cliquable ne se distingue pas d'un nom mort.
    expect(css).toMatch(/^a \{\r?\n {2}color: inherit;\r?\n {2}text-decoration: none;/m);
    expect(css).toContain(".entity-link {");
  });

  it("se signale au survol comme au focus clavier", () => {
    expect(css).toMatch(/\.entity-link:hover,\r?\n\.entity-link:focus-visible \{/);
    expect(css).toMatch(/\.entity-link:focus-visible \{\r?\n {2}outline:/);
  });
});

describe("Composants de lien d'entité", () => {
  const source = read("components/entity-link.tsx");

  it("posent les deux destinations du site, et rien d'autre", () => {
    expect(source).toContain("`/equipes/${teamId}`");
    expect(source).toContain("`/joueurs/${userId}`");
  });

  it("concatènent la classe reçue plutôt que de l'écraser", () => {
    // Les appelants passent des classes de mise en page (ellipse, grille) : les
    // perdre casserait le gabarit qui les entoure.
    expect(source).toContain('className ? `entity-link ${className}` : "entity-link"');
  });
});

describe("Page de tournoi — engagés cliquables", () => {
  const files: Record<string, string> = {
    "MatchRow.tsx": "app/(secured)/tournois/[id]/_components/MatchRow.tsx",
    "PhaseStandingsTable.tsx": "app/(secured)/tournois/[id]/_components/PhaseStandingsTable.tsx",
    "SurvivalView.tsx": "app/(secured)/tournois/[id]/_components/SurvivalView.tsx",
    "SwissView.tsx": "app/(secured)/tournois/[id]/_components/SwissView.tsx",
    "EnduranceView.tsx": "app/(secured)/tournois/[id]/_components/EnduranceView.tsx",
    "SeedingEditor.tsx": "app/(secured)/tournois/[id]/_components/SeedingEditor.tsx",
    "BracketPreview.tsx": "app/(secured)/tournois/[id]/_components/BracketPreview.tsx",
    "TournamentProgress.tsx": "app/(secured)/tournois/[id]/_components/TournamentProgress.tsx",
  };

  for (const [name, path] of Object.entries(files)) {
    it(`${name} passe par EntrantLink, jamais par un chemin écrit à la main`, () => {
      const code = stripComments(read(path));
      expect(code).toContain("<EntrantLink");
      // Un engagé est une équipe **ou** un joueur selon le tournoi : seul le
      // contexte (`soloUserIds`) sait lequel. Un `/equipes/${id}` écrit ici
      // mènerait à « Équipe non trouvée » sur un tournoi individuel.
      expect(code).not.toContain("`/equipes/${");
      expect(code).not.toContain("`/joueurs/${");
    });
  }

  it("nomme la championne d'une survie et d'une ronde suisse par un lien", () => {
    for (const path of [files["SurvivalView.tsx"], files["SwissView.tsx"]]) {
      const code = stripComments(read(path));
      const banner = code.slice(code.indexOf("Championne"));
      expect(banner.slice(0, 200)).toContain("<EntrantLink teamId={champion.teamId}>");
    }
  });

  it("mène la liste des inscriptions vers la fiche de chaque engagé", () => {
    const code = stripComments(read("app/(secured)/tournois/[id]/page.tsx"));
    expect(code).toContain("<EntityLink href={entrantHref(reg.teamId, detail.soloUserIds)}>");
  });
});

describe("Cartes d'annuaire — deux destinations, sans ancre imbriquée", () => {
  const cards = {
    TeamCard: "app/(secured)/equipes/cards/TeamCard.tsx",
    PlayerCard: "app/(secured)/joueurs/cards/PlayerCard.tsx",
  };

  for (const [name, path] of Object.entries(cards)) {
    it(`${name} n'imbrique jamais une ancre dans une autre`, () => {
      expect(maxAnchorDepth(stripComments(read(path)))).toBe(1);
    });

    it(`${name} porte son lien principal sur une plaque, pas sur le contenu`, () => {
      const code = stripComments(read(path));
      expect(code).toContain("className={s.cardOverlay}");
      // La plaque n'a pas de texte : son seul intitulé est ce nom accessible.
      expect(code).toMatch(/aria-label=\{`Voir la fiche de \$\{[^}]+\}`\}/);
    });
  }

  it("mène chaque visage du roster au profil du joueur", () => {
    const code = stripComments(read(cards.TeamCard));
    expect(code).toContain("<PlayerLink");
    expect(code).toContain("userId={m.userId}");
    // L'avatar est décoratif dès lors que le lien porte son propre intitulé :
    // un `alt` répéterait le pseudo au lecteur d'écran.
    expect(code).toContain('alt=""');
  });

  it("mène le nom d'équipe d'un joueur à la fiche de l'équipe", () => {
    const code = stripComments(read(cards.PlayerCard));
    expect(code).toContain("<TeamLink");
    expect(code).toContain("teamId={player.team.id}");
    // Sans remonter au-dessus de la plaque, le lien serait recouvert par elle.
    expect(code).toContain("className={s.aboveOverlay}");
  });

  it("couvre toute la carte", () => {
    for (const css of [
      read("app/(secured)/equipes/cards/TeamCard.module.css"),
      read("app/(secured)/_shared/annuaire.module.css"),
    ]) {
      expect(css).toContain(".cardOverlay {");
      expect(css).toMatch(/\.cardOverlay \{[\s\S]*?position: absolute;[\s\S]*?inset: 0;/);
    }
  });

  /**
   * La plaque doit passer **au-dessus** des enfants positionnés de la carte
   * (pastille de rang, sigil, cadre d'avatar) : en `z-index: auto`, ils peignent
   * après elle dans l'ordre du DOM et intercepteraient le clic — alors qu'ils
   * faisaient partie du lien quand celui-ci enveloppait la carte. Et **en
   * dessous** des liens imbriqués, qui mènent ailleurs.
   */
  const zIndexOf = (css: string, selector: string): number => {
    const block = css.slice(css.indexOf(`${selector} {`));
    const match = block.slice(0, block.indexOf("}")).match(/z-index:\s*(-?\d+)/);
    expect(match).not.toBeNull();
    return Number(match![1]);
  };

  it("passe la plaque au-dessus des décorations positionnées de la carte", () => {
    for (const [css, decorations] of [
      [read("app/(secured)/equipes/cards/TeamCard.module.css"), [".rank", ".sigil"]],
      [read("app/(secured)/_shared/annuaire.module.css"), [".plAvatarWrap"]],
    ] as [string, string[]][]) {
      // Ces décorations n'ont pas de `z-index` : elles se rangent dans la couche
      // des positionnés `auto`, que la plaque doit dominer avec un entier > 0.
      for (const selector of decorations) {
        const block = css.slice(css.indexOf(`${selector} {`));
        expect(block.slice(0, block.indexOf("}"))).not.toMatch(/z-index:/);
      }
      expect(zIndexOf(css, ".cardOverlay")).toBeGreaterThan(0);
    }
  });

  it("laisse les liens imbriqués au-dessus de la plaque", () => {
    const team = read("app/(secured)/equipes/cards/TeamCard.module.css");
    expect(zIndexOf(team, ".rosterItem")).toBeGreaterThan(zIndexOf(team, ".cardOverlay"));

    const annuaire = read("app/(secured)/_shared/annuaire.module.css");
    expect(zIndexOf(annuaire, ".aboveOverlay")).toBeGreaterThan(
      zIndexOf(annuaire, ".cardOverlay"),
    );
  });

  it("aligne la pastille « +N » sur la mise en page de `.avatar`", () => {
    // Elle porte les deux classes : un `display` différent sur `.rosterItem`
    // l'emporterait sur `.avatar` par simple ordre de source, et le « +N »
    // sortirait de son cercle.
    const css = read("app/(secured)/equipes/cards/TeamCard.module.css");
    const roster = css.slice(css.indexOf(".rosterItem {"));
    const block = roster.slice(0, roster.indexOf("}"));
    expect(block).toContain("display: grid;");
    expect(block).toContain("place-items: center;");
    expect(block).not.toContain("line-height: 0;");
  });

  it("allume le bouton d'appel au survol de la carte, pas du bouton", () => {
    // La plaque couvre le bouton : `.cta:hover` ne se déclencherait plus jamais.
    const css = read("app/(secured)/equipes/cards/TeamCard.module.css");
    expect(css).toContain(".card:hover .cta {");
  });

  it("décale les visages du roster sur l'élément du roster, pas sur la pastille", () => {
    // `.avatar` est tantôt un `img`, tantôt un `span` : `:first-of-type` ne
    // saurait pas les départager une fois les liens intercalés.
    const css = read("app/(secured)/equipes/cards/TeamCard.module.css");
    expect(css).toContain(".rosterItem + .rosterItem {");
    expect(css).not.toContain(".avatar:first-of-type");
  });
});

describe("Autres écrans — noms cliquables", () => {
  const cases: [string, string, string][] = [
    [
      "roster d'une équipe",
      "app/(secured)/equipes/[id]/_components/MembersSection.tsx",
      "<PlayerLink userId={member.userId}>{member.pseudo}</PlayerLink>",
    ],
    [
      "demandes d'adhésion",
      "app/(secured)/equipes/[id]/_components/MembershipActions.tsx",
      "<PlayerLink userId={r.userId}>{r.pseudo}</PlayerLink>",
    ],
    [
      "invitations reçues",
      "app/(secured)/profil/page.tsx",
      "<TeamLink teamId={inv.teamId}>{inv.teamName}</TeamLink>",
    ],
    [
      "historique d'équipes d'un joueur",
      "app/(secured)/joueurs/[id]/page.tsx",
      "<TeamLink teamId={entry.teamId}>{entry.teamName}</TeamLink>",
    ],
    [
      "adversaire favori et bête noire",
      "components/stats/StatsPanel.tsx",
      "<TeamLink teamId={opponent.teamId}>{opponent.teamName}</TeamLink>",
    ],
    [
      "classement de l'accueil",
      "components/cyber/landing/Leaderboard.tsx",
      "<TeamLink teamId={row.teamId}",
    ],
  ];

  for (const [label, path, expected] of cases) {
    it(`${label} : le nom mène à la fiche`, () => {
      expect(stripComments(read(path))).toContain(expected);
    });
  }

  it("carte du direct : le chemin vient du serveur, pas d'un `/equipes/` codé ici", () => {
    // Le match à l'antenne peut opposer des joueurs (tournoi individuel) : la
    // carte de l'accueil n'a pas de quoi trancher, le serveur l'a déjà fait.
    const code = stripComments(read("components/cyber/landing/LiveCard.tsx"));
    expect(code).toContain("href={currentMatch.team1Href}");
    expect(code).toContain("href={currentMatch.team2Href}");
    expect(code).not.toContain("/equipes/");
    // Une place vide (bye, adversaire à désigner) ne mène nulle part.
    expect(code).toContain("if (!href) return <>{name}</>;");
  });
});
