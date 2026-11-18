import { describe, expect, it, jest } from "@jest/globals";
import type { AnchorHTMLAttributes } from "react";

/**
 * Navigation de `/devdoc` : ses centaines de liens ne se préchargent pas.
 * Chaque lien visible aurait lancé, en production, un rendu serveur de la
 * mise en page (session comprise) pour un document qu'on ne lira peut-être
 * jamais (`docs/features/DEVDOC.md`).
 */
const linkProps: { href: string; prefetch?: boolean | null }[] = [];
jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, prefetch, children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; prefetch?: boolean | null }) => {
    linkProps.push({ href, prefetch });
    return (
      <a href={href} {...rest}>
        {children}
      </a>
    );
  },
}));
jest.mock("next/navigation", () => ({
  usePathname: () => "/devdoc",
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined, prefetch: () => undefined }),
}));

import { DevDocNav } from "@/app/(secured)/devdoc/_components/DevDocNav";
import { AppLocaleProvider } from "@/components/i18n/locale-context";
import { messagesFor } from "@/lib/server/i18n-messages";
import { groupDevDocs, type DevDocSummary } from "@/lib/shared/dev-docs";
import { renderToStaticMarkup } from "react-dom/server";

const docs: DevDocSummary[] = [
  { repo: "site", slug: "features/INDEX", path: "docs/features/INDEX.md", title: "Index" },
  { repo: "site", slug: "features/I18N", path: "docs/features/I18N.md", title: "Langues" },
  { repo: "bot", slug: "help", path: "help.md", title: "Aide" },
];

describe("DevDocNav — préchargement", () => {
  it("DevDocNav_everyDocLink_disablesPrefetch", () => {
    linkProps.length = 0;
    const html = renderToStaticMarkup(
      <AppLocaleProvider locale="fr">
        <DevDocNav groups={groupDevDocs(docs)} locale="fr" messages={messagesFor("fr").devdoc} />
      </AppLocaleProvider>,
    );
    expect(html).toContain("/devdoc/site/features/I18N");
    expect(linkProps).toHaveLength(docs.length);
    expect(linkProps.every((link) => link.prefetch === false)).toBe(true);
  });
});
