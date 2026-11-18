import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildDevDocIndex, type DevDocIndex } from "@/lib/server/dev-docs";

/**
 * Faux dépôt temporaire pour les tests de `/devdoc` : un site dont `docs/`
 * porte `files` (chemin relatif → contenu), un bot absent, et son index.
 */
export interface DevDocFixture {
  base: string;
  index: DevDocIndex;
  cleanup: () => Promise<void>;
}

export async function makeDevDocFixture(prefix: string, files: Readonly<Record<string, string>>): Promise<DevDocFixture> {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  const site = path.join(base, "site");
  for (const [relative, content] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(site, relative)), { recursive: true });
    await fs.writeFile(path.join(site, relative), content);
  }
  const index = await buildDevDocIndex({
    site: { root: site, dirs: ["docs"], files: [] },
    bot: { root: path.join(base, "absent"), dirs: ["doc"], files: [] },
  });
  return { base, index, cleanup: () => fs.rm(base, { recursive: true, force: true }) };
}

/** `next/navigation` simulé : adresse courante lue à chaque rendu, `notFound` qui lève. */
export function devDocNavigationMock(pathname: () => string) {
  return {
    usePathname: pathname,
    useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined, prefetch: () => undefined }),
    notFound: () => {
      throw new Error("NEXT_NOT_FOUND");
    },
  };
}
