import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { PROCESSING_ACTIVITIES, REGISTER_UPDATED_AT } from "@/lib/shared/processing-register";
import { PRIVACY_CHANGES } from "@/lib/shared/privacy-changes";

/**
 * `/rgpd#cookies` se dit la liste **complète** de ce que le site dépose ou lit
 * dans le navigateur (les mentions légales y renvoient comme telle). Elle avait
 * dérivé : deux valeurs du stockage de session et le cache du service worker y
 * manquaient. Le balayage relève toute constante de clé ou de cookie du site
 * (`…KEY` / `…COOKIE` valant `bg_…` ou `bg:…`) et exige qu'elle y soit nommée ;
 * une clé ajoutée demain sans sa ligne fait échouer ce test.
 */
const root = process.cwd();
const rgpd = readFileSync(join(root, "app/rgpd/page.tsx"), "utf8");
const cookiesStart = rgpd.indexOf('id="cookies"');
const cookies = rgpd.slice(cookiesStart, rgpd.indexOf("</section>", cookiesStart));
const audienceStart = rgpd.indexOf('id="audience"');
const audience = rgpd.slice(audienceStart, rgpd.indexOf("</section>", audienceStart));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\./.test(name) ? [path] : [];
  });
}

const STORAGE_CONSTANT = /\b([A-Z_]*(?:KEY|COOKIE)[A-Z_]*)(?:\s*:[^=]+)?\s*=\s*"(bg[_:][^"]+)"/g;

/** Clés que le site ne pose plus : il ne fait que les effacer. */
const REMOVED_ONLY = new Set(["LEGACY_ONE_TAP_STORAGE_KEY"]);

function storageKeys(): Array<{ file: string; name: string; value: string }> {
  const files = [...sourceFiles(join(root, "app")), ...sourceFiles(join(root, "components")), ...sourceFiles(join(root, "lib"))];
  return files.flatMap((file) => {
    const text = readFileSync(file, "utf8");
    return [...text.matchAll(STORAGE_CONSTANT)]
      .filter((match) => !REMOVED_ONLY.has(match[1]))
      .map((match) => ({ file: relative(root, file), name: match[1], value: match[2] }));
  });
}

describe("/rgpd — inventaire des cookies et du stockage", () => {
  it("trouve les sections", () => {
    expect(cookiesStart).toBeGreaterThan(-1);
    expect(audienceStart).toBeGreaterThan(-1);
  });

  it("relève bien les clés connues (le balayage n'est pas vide)", () => {
    const values = storageKeys().map((key) => key.value);
    for (const expected of ["bg_session", "bg_match_launch_dismissed", "bg_lazy_chunk_reload_at", "bg:last-visit-ping"]) {
      expect(values).toContain(expected);
    }
  });

  it("nomme chaque cookie et chaque clé de stockage du site", () => {
    const missing = storageKeys().filter((key) => !cookies.includes(key.value));
    expect(missing).toEqual([]);
  });

  it("nomme le cache du service worker, posé pour tout visiteur", () => {
    const worker = readFileSync(join(root, "public/push-sw.js"), "utf8");
    const prefix = /OFFLINE_CACHE_PREFIX = "([^"]+)"/.exec(worker)?.[1];
    expect(prefix).toBeDefined();
    expect(cookies).toContain(prefix!.replace(/-$/, ""));
    expect(cookies).toContain("/push-sw.js");
  });

  it("dit que le jeton de session est dans le cookie et son empreinte en base", () => {
    expect(cookies).not.toContain("jeton opaque haché");
    expect(cookies).toMatch(/n&apos;en gardent que\s+l&apos;empreinte/);
  });

  it("cite l'article 82 et non une « exemption cookies fonctionnels »", () => {
    expect(cookies).not.toMatch(/exemption cookies fonctionnels|ePrivacy/);
    expect(cookies).toContain("article 82");
    // Le traceur de mesure d'audience n'est pas rangé sous la dispense.
    expect(cookies).toMatch(/exception de <strong>bg:last-visit-ping<\/strong>/);
  });
});

describe("/rgpd — mesure d'audience", () => {
  it("donne finalité, base légale, durées, destinataires et opposition", () => {
    for (const heading of ["Finalité.", "Base légale.", "Durée de conservation.", "Destinataires.", "droit d&apos;opposition."]) {
      expect(audience).toContain(heading);
    }
    expect(audience).toContain("{SITE_VISIT_DETAIL_RETENTION_DAYS}");
    expect(audience).toContain("art. 6.1.f");
    expect(audience).toContain("art. 21");
    expect(audience).toContain("/stats-site");
  });

  it("présente l'empreinte comme pseudonymisée, pas anonyme", () => {
    expect(audience).toContain("pseudonymisée, pas anonyme");
    expect(audience).toContain("sans limite de durée");
    expect(audience).not.toMatch(/non réversible|remonter à (toi|vous)/);
  });

  it("ne dit plus « aucun traceur analytique » en tête de page", () => {
    expect(rgpd).not.toMatch(/aucun traceur publicitaire ni\s+analytique/);
  });

  it("est reprise par la fiche T06 du registre, datée du jour de la mise à jour", () => {
    const t06 = PROCESSING_ACTIVITIES.find((entry) => entry.ref === "T06")!;
    const text = JSON.stringify(t06);
    expect(text).toContain("pseudonymisée");
    expect(text).toContain("/stats-site");
    expect(text).toContain("y compris après la suppression du compte");
    expect(text).not.toContain("ne désigne aucune personne");
    expect(REGISTER_UPDATED_AT).toBe("2026-09-30");
  });

  it("ne laisse aucune entrée des changements affirmer une empreinte irréversible", () => {
    const text = JSON.stringify(PRIVACY_CHANGES);
    expect(text).not.toMatch(/non réversible|ne permet pas de remonter à toi/);
  });

  it("ne promet plus, sur la connexion, qu'aucune donnée n'est enregistrée", () => {
    const modal = readFileSync(join(root, "components/cyber/RgpdConsentModal.tsx"), "utf8");
    expect(modal).not.toContain("aucune donnée ne sera enregistrée");
    expect(modal).toContain("mesure d&apos;audience");
  });

  it("est annoncée par les mentions légales", () => {
    const mentions = readFileSync(join(root, "app/mentions-legales/page.tsx"), "utf8");
    expect(mentions).toContain('href="/rgpd#audience"');
  });
});
