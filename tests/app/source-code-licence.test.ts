import { describe, expect, it } from "@jest/globals";
import { FR_SHELL_MESSAGES } from "@/lib/shared/shell-text";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CODE_COPYRIGHT_HOLDER,
  CODE_LICENSE_SPDX,
  CODE_LICENSE_URL,
  SOURCE_CODE_LINK_LABEL,
  SOURCE_CODE_URL,
} from "@/lib/shared/source-code";

const ROOT = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");

describe("licence files", () => {
  const licence = read("LICENSE");

  it("ships the official GNU AGPL v3 text, whole", () => {
    expect(licence.startsWith("                    GNU AFFERO GENERAL PUBLIC LICENSE\n                       Version 3, 19 November 2007\n")).toBe(true);
    expect(licence).toContain("13. Remote Network Interaction; Use with the GNU General Public License.");
    expect(licence).toContain("END OF TERMS AND CONDITIONS");
    expect(licence).toContain("How to Apply These Terms to Your New Programs");
    expect(licence.trimEnd().split("\n")).toHaveLength(661);
  });

  it("keeps the FSF text verbatim: the copyright line lives in NOTICE", () => {
    expect(licence).not.toContain(CODE_COPYRIGHT_HOLDER);
    const notice = read("NOTICE");
    expect(notice).toContain(`Copyright (C) 2026 ${CODE_COPYRIGHT_HOLDER}`);
    expect(notice).toContain(`SPDX-License-Identifier: ${CODE_LICENSE_SPDX}`);
    expect(notice).toContain(SOURCE_CODE_URL);
  });

  it("declares the same SPDX identifier in package.json and its lockfile", () => {
    const pkg = JSON.parse(read("package.json")) as { license?: string };
    expect(pkg.license).toBe(CODE_LICENSE_SPDX);
    const lock = JSON.parse(read("package-lock.json")) as { packages: Record<string, { license?: string }> };
    expect(lock.packages[""].license).toBe(CODE_LICENSE_SPDX);
  });

  it("points to the public repository and the FSF licence page over https", () => {
    expect(SOURCE_CODE_URL).toMatch(/^https:\/\/github\.com\/[^/]+\/[^/]+$/);
    expect(CODE_LICENSE_URL).toBe("https://www.gnu.org/licenses/agpl-3.0.html");
  });
});

describe("AGPL art. 13: the source is offered on every page", () => {
  it.each(["components/cyber/landing/PublicFooter.tsx", "components/legal/SiteFooterBar.tsx"])(
    "%s links the source code in a new tab",
    (file) => {
      const source = read(file);
      expect(source).toMatch(/href=\{SOURCE_CODE_URL\} target="_blank" rel="noreferrer"/);
      expect(source).toMatch(/\{t\("(footer\.)?links\.sourceCode"\)\}/);
    },
  );

  it("labels the link the same everywhere", () => {
    expect(SOURCE_CODE_LINK_LABEL).toBe("Code source");
    expect(FR_SHELL_MESSAGES.footer.links.sourceCode).toBe(SOURCE_CODE_LINK_LABEL);
  });

  it("drops the blanket « tous droits réservés », which the AGPL contradicts for the code", () => {
    expect(read("components/cyber/landing/PublicFooter.tsx")).not.toMatch(/TOUS DROITS RÉSERVÉS/i);
  });
});

describe("mentions légales", () => {
  const source = read("app/mentions-legales/page.tsx");

  it("states the licence, the rights holder and links the source", () => {
    expect(source).toContain('id: "propriete-intellectuelle"');
    expect(source).toContain("{CODE_LICENSE_NAME}");
    expect(source).toContain("{CODE_COPYRIGHT_HOLDER}");
    expect(source).toContain("href={SOURCE_CODE_URL}");
    expect(source).toContain("href={CODE_LICENSE_URL}");
  });

  it("no longer claims the association owns the code, nor names an unsourced owner", () => {
    expect(source).not.toMatch(/sont la propriété de l&apos;association/);
    expect(source).not.toMatch(/DROITS RÉSERVÉS/);
  });

  it("no longer promises data go to the association alone", () => {
    expect(source).not.toMatch(/exclusivement/);
    expect(source).not.toMatch(/cédées à des tiers/);
    expect(source).toContain('href="/rgpd#destinataires"');
  });

  it("points at an anchor that exists on /rgpd", () => {
    expect(read("app/rgpd/page.tsx")).toContain('id="destinataires"');
  });
});
