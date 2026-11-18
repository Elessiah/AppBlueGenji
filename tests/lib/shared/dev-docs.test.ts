import { describe, expect, it } from "@jest/globals";
import {
  DEFAULT_DEV_DOC,
  devDocHref,
  devDocSlug,
  filterDevDocs,
  groupDevDocs,
  guessDocLanguage,
  normalizeRepoPath,
  parseDevDocParams,
  resolveDevDocCodeRef,
  resolveDevDocLink,
  type DevDocLookup,
  type DevDocRepo,
  type DevDocSummary,
} from "@/lib/shared/dev-docs";
import { BOT_SOURCE_URL, SOURCE_CODE_URL } from "@/lib/shared/source-code";

function doc(repo: DevDocRepo, path: string, title = path): DevDocSummary {
  return { repo, path, title, slug: devDocSlug(repo, path) ?? path };
}

const DOCS: DevDocSummary[] = [
  doc("site", "docs/features/INDEX.md", "Index des fonctionnalités"),
  doc("site", "docs/features/BUSY_BUTTONS.md", "Boutons occupés"),
  doc("site", "docs/features/AUTH_SYSTEM.md", "Système d'authentification"),
  doc("site", "docs/DATABASE_SCHEMA.md", "Schéma de la base"),
  doc("site", "CLAUDE.md", "CLAUDE.md"),
  doc("bot", "doc/main.md", "Main.js"),
  doc("bot", "helpfr.md", "Aide"),
];

const lookup: DevDocLookup = (repo, path) => DOCS.find((d) => d.repo === repo && d.path === path) ?? null;
const FROM_FEATURE = { repo: "site" as const, path: "docs/features/BUSY_BUTTONS.md" };

describe("devDocSlug", () => {
  it("devDocSlug_siteDocsFile_dropsDocsPrefixAndExtension", () => {
    expect(devDocSlug("site", "docs/features/BUSY_BUTTONS.md")).toBe("features/BUSY_BUTTONS");
  });

  it("devDocSlug_siteRootFile_keepsName", () => {
    expect(devDocSlug("site", "CLAUDE.md")).toBe("CLAUDE");
  });

  it("devDocSlug_botFile_keepsRepoRelativePath", () => {
    expect(devDocSlug("bot", "doc/src/Bdd.md")).toBe("doc/src/Bdd");
  });

  it("devDocSlug_notMarkdown_returnsNull", () => {
    expect(devDocSlug("site", "docs/notes.txt")).toBeNull();
  });
});

describe("devDocHref", () => {
  it("devDocHref_slugWithHash_encodesEachSegment", () => {
    expect(devDocHref("bot", "LegalTerms/Politique de confidentialité", "#a")).toBe(
      "/devdoc/bot/LegalTerms/Politique%20de%20confidentialit%C3%A9#a",
    );
  });
});

describe("parseDevDocParams", () => {
  it("parseDevDocParams_noSegments_returnsDefaultDoc", () => {
    expect(parseDevDocParams(undefined)).toEqual(DEFAULT_DEV_DOC);
  });

  it("parseDevDocParams_validDeepLink_returnsRepoAndSlug", () => {
    expect(parseDevDocParams(["site", "features", "BUSY_BUTTONS"])).toEqual({ repo: "site", slug: "features/BUSY_BUTTONS" });
  });

  it("parseDevDocParams_encodedSegment_isDecoded", () => {
    expect(parseDevDocParams(["bot", "doc", "a%20b"])).toEqual({ repo: "bot", slug: "doc/a b" });
  });

  it("parseDevDocParams_unknownRepo_returnsNull", () => {
    expect(parseDevDocParams(["secret", "x"])).toBeNull();
  });

  it("parseDevDocParams_repoOnly_returnsNull", () => {
    expect(parseDevDocParams(["site"])).toBeNull();
  });

  it("parseDevDocParams_parentSegment_returnsNull", () => {
    expect(parseDevDocParams(["site", "..", "..", ".env"])).toBeNull();
  });

  it("parseDevDocParams_dotSegment_returnsNull", () => {
    expect(parseDevDocParams(["site", ".", "INDEX"])).toBeNull();
  });

  it("parseDevDocParams_encodedSlash_returnsNull", () => {
    expect(parseDevDocParams(["site", "..%2F..%2F.env"])).toBeNull();
  });

  it("parseDevDocParams_backslash_returnsNull", () => {
    expect(parseDevDocParams(["site", "..\\..\\.env"])).toBeNull();
  });

  it("parseDevDocParams_nulCharacter_returnsNull", () => {
    expect(parseDevDocParams(["site", "INDEX%00"])).toBeNull();
  });

  it("parseDevDocParams_badEncoding_returnsNull", () => {
    expect(parseDevDocParams(["site", "%E0%A4%A"])).toBeNull();
  });

  it("parseDevDocParams_emptySegment_returnsNull", () => {
    expect(parseDevDocParams(["site", ""])).toBeNull();
  });
});

describe("groupDevDocs", () => {
  it("groupDevDocs_mixedDocs_rootFolderFirstThenAlphabetical", () => {
    const site = groupDevDocs(DOCS)[0];
    expect(site.folders.map((f) => f.folder)).toEqual(["", "docs", "docs/features"]);
  });

  it("groupDevDocs_folderWithIndex_putsIndexFirst", () => {
    const features = groupDevDocs(DOCS)[0].folders[2];
    expect(features.docs.map((d) => d.path)).toEqual([
      "docs/features/INDEX.md",
      "docs/features/AUTH_SYSTEM.md",
      "docs/features/BUSY_BUTTONS.md",
    ]);
  });

  it("groupDevDocs_repoWithoutDocs_isStillListedEmpty", () => {
    const groups = groupDevDocs(DOCS.filter((d) => d.repo === "site"));
    expect(groups.map((g) => g.repo)).toEqual(["site", "bot"]);
    expect(groups[1].folders).toEqual([]);
  });
});

describe("filterDevDocs", () => {
  it("filterDevDocs_emptyQuery_returnsAll", () => {
    expect(filterDevDocs(DOCS, "   ")).toHaveLength(DOCS.length);
  });

  it("filterDevDocs_accentsAndCase_matchTitle", () => {
    expect(filterDevDocs(DOCS, "SCHEMA").map((d) => d.path)).toEqual(["docs/DATABASE_SCHEMA.md"]);
  });

  it("filterDevDocs_spaceForUnderscore_matchesPath", () => {
    expect(filterDevDocs(DOCS, "busy buttons").map((d) => d.path)).toEqual(["docs/features/BUSY_BUTTONS.md"]);
  });

  it("filterDevDocs_severalTerms_requiresEach", () => {
    expect(filterDevDocs(DOCS, "boutons auth")).toEqual([]);
  });
});

describe("normalizeRepoPath", () => {
  it("normalizeRepoPath_parentInside_resolves", () => {
    expect(normalizeRepoPath("docs/features/../DATABASE_SCHEMA.md")).toBe("docs/DATABASE_SCHEMA.md");
  });

  it("normalizeRepoPath_escapesRepo_returnsNull", () => {
    expect(normalizeRepoPath("docs/../../.env")).toBeNull();
  });
});

describe("resolveDevDocLink", () => {
  it("resolveDevDocLink_anchor_keptAsIs", () => {
    expect(resolveDevDocLink("#regles", FROM_FEATURE, lookup)).toBe("#regles");
  });

  it("resolveDevDocLink_external_keptAsIs", () => {
    expect(resolveDevDocLink("https://example.org/a", FROM_FEATURE, lookup)).toBe("https://example.org/a");
  });

  it("resolveDevDocLink_mailto_keptAsIs", () => {
    expect(resolveDevDocLink("mailto:a@b.c", FROM_FEATURE, lookup)).toBe("mailto:a@b.c");
  });

  it("resolveDevDocLink_sitePath_keptAsIs", () => {
    expect(resolveDevDocLink("/regles", FROM_FEATURE, lookup)).toBe("/regles");
  });

  it("resolveDevDocLink_protocolRelative_returnsNull", () => {
    expect(resolveDevDocLink("//evil.example", FROM_FEATURE, lookup)).toBeNull();
  });

  it("resolveDevDocLink_javascriptScheme_returnsNull", () => {
    expect(resolveDevDocLink("javascript:alert(1)", FROM_FEATURE, lookup)).toBeNull();
  });

  it("resolveDevDocLink_relativeDocWithHash_rewritesToDevdoc", () => {
    expect(resolveDevDocLink("../DATABASE_SCHEMA.md#bg_users", FROM_FEATURE, lookup)).toBe(
      "/devdoc/site/DATABASE_SCHEMA#bg_users",
    );
  });

  it("resolveDevDocLink_siblingDoc_rewritesToDevdoc", () => {
    expect(resolveDevDocLink("./AUTH_SYSTEM.md", FROM_FEATURE, lookup)).toBe("/devdoc/site/features/AUTH_SYSTEM");
  });

  it("resolveDevDocLink_sourceFile_pointsToGithub", () => {
    expect(resolveDevDocLink("../../lib/shared/permissions.ts", FROM_FEATURE, lookup)).toBe(
      `${SOURCE_CODE_URL}/blob/main/lib/shared/permissions.ts`,
    );
  });

  it("resolveDevDocLink_botSourceFile_pointsToBotGithub", () => {
    expect(resolveDevDocLink("../src/index.ts", { repo: "bot", path: "doc/main.md" }, lookup)).toBe(
      `${BOT_SOURCE_URL}/blob/main/src/index.ts`,
    );
  });

  it("resolveDevDocLink_escapesRepo_returnsNull", () => {
    expect(resolveDevDocLink("../../../../.env", FROM_FEATURE, lookup)).toBeNull();
  });

  it("resolveDevDocLink_badEncoding_returnsNull", () => {
    expect(resolveDevDocLink("%E0%A4%A.md", FROM_FEATURE, lookup)).toBeNull();
  });
});

describe("resolveDevDocCodeRef", () => {
  it("resolveDevDocCodeRef_bareFeatureNameFromRootDoc_linksFeature", () => {
    expect(resolveDevDocCodeRef("AUTH_SYSTEM.md", { repo: "site", path: "CLAUDE.md" }, lookup)).toBe(
      "/devdoc/site/features/AUTH_SYSTEM",
    );
  });

  it("resolveDevDocCodeRef_repoRelativePath_linksDoc", () => {
    expect(resolveDevDocCodeRef("docs/DATABASE_SCHEMA.md", FROM_FEATURE, lookup)).toBe("/devdoc/site/DATABASE_SCHEMA");
  });

  it("resolveDevDocCodeRef_botDocName_linksBotDoc", () => {
    expect(resolveDevDocCodeRef("main.md", { repo: "bot", path: "helpfr.md" }, lookup)).toBe("/devdoc/bot/doc/main");
  });

  it("resolveDevDocCodeRef_unknownDoc_returnsNull", () => {
    expect(resolveDevDocCodeRef("NOPE.md", FROM_FEATURE, lookup)).toBeNull();
  });

  it("resolveDevDocCodeRef_notMarkdown_returnsNull", () => {
    expect(resolveDevDocCodeRef("ERREUR.txt", FROM_FEATURE, lookup)).toBeNull();
  });
});

describe("guessDocLanguage", () => {
  it("guessDocLanguage_frenchProse_returnsFr", () => {
    expect(guessDocLanguage("Le bot relaie les annonces et la page est servie pour les membres.")).toBe("fr");
  });

  it("guessDocLanguage_englishProse_returnsEn", () => {
    expect(guessDocLanguage("It is the main file of the project and it manages the commands.")).toBe("en");
  });

  it("guessDocLanguage_onlyCode_defaultsToFr", () => {
    expect(guessDocLanguage("```\nthe and is of to\n```")).toBe("fr");
  });
});
