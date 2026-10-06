/**
 * Éditeur bilingue des textes de la vitrine (`EditableCopy`, D9) : français et
 * anglais côte à côte, anglais obligatoire, refus rattaché au champ anglais,
 * marque « EN » des textes à rattraper (`docs/features/EDITABLE_SITE_COPY.md`).
 */
import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }) }));
jest.mock("@/components/ui/toast", () => ({
  useToast: () => ({ showError: jest.fn(), showSuccess: jest.fn() }),
}));
// Rendu serveur sans DOM : on ouvre l'éditeur en forçant le premier état
// (`editing`) et on simule un refus déjà posé sur un champ.
const state = { openEditor: false };
jest.mock("react", () => {
  const actual = jest.requireActual<typeof import("react")>("react");
  return {
    ...actual,
    useState: (initial: unknown) => {
      if (state.openEditor && initial === false) {
        state.openEditor = false;
        return [true, () => undefined];
      }
      return actual.useState(initial);
    },
  };
});
const flagged: { field: "fr" | "en" | null } = { field: null };
jest.mock("@/lib/shared/hooks/useFieldErrors", () => {
  const { fieldAria } = jest.requireActual<typeof import("@/lib/shared/field-errors")>("@/lib/shared/field-errors");
  return {
    useFieldErrors: (_map: unknown, ids: Record<"fr" | "en", string>) => ({
      invalidField: flagged.field,
      report: () => true,
      flag: () => undefined,
      clear: () => undefined,
      aria: (field: "fr" | "en", ...help: Array<string | false | null | undefined>) => fieldAria(ids[field], flagged.field === field, ...help),
      message: (field: "fr" | "en") => (flagged.field === field ? "La traduction anglaise est requise." : null),
    }),
  };
});

import { renderToStaticMarkup } from "react-dom/server";
import { EditableCopy, SiteCopyEditorProvider, submitSiteCopy } from "@/components/cyber/landing/EditableCopy";
import { AppLocaleProvider } from "@/components/i18n/locale-context";
import { fieldForError } from "@/lib/shared/field-errors";
import { SITE_COPY_FIELD_ERRORS, resolveSiteCopy, type SiteCopyEditorEntry } from "@/lib/shared/site-copy";

function render(entry: SiteCopyEditorEntry, { open = false, locale = "fr" as "fr" | "en" } = {}): string {
  const entries = { ...resolveSiteCopy(new Map()).editor, "home.hero.title": entry };
  state.openEditor = open;
  return renderToStaticMarkup(
    <AppLocaleProvider locale={locale}>
      <SiteCopyEditorProvider entries={entries}>
        <EditableCopy copyKey="home.hero.title" value={entry.fr} canEdit>
          <h1>{entry.fr}</h1>
        </EditableCopy>
      </SiteCopyEditorProvider>
    </AppLocaleProvider>,
  );
}

beforeEach(() => {
  flagged.field = null;
  state.openEditor = false;
});

describe("EditableCopy — éditeur bilingue", () => {
  it("montre le français et l'anglais côte à côte, chacun dans sa langue", () => {
    const markup = render({ fr: "Organiser", en: "Organize", enMissing: false }, { open: true });
    expect(markup).toContain('<label class="langLabel" for="copy-home.hero.title">Français</label>');
    expect(markup).toContain('<label class="langLabel" for="copy-home.hero.title-en">Anglais (obligatoire)</label>');
    expect(markup).toMatch(/<textarea[^>]*id="copy-home.hero.title"[^>]*lang="fr"[^>]*required=""/);
    expect(markup).toMatch(/<textarea[^>]*id="copy-home.hero.title-en"[^>]*lang="en"/);
    expect(markup).toContain(">Organize</textarea>");
  });

  it("rattache le refus au champ anglais (aria-invalid, phrase en aria-describedby)", () => {
    flagged.field = "en";
    const markup = render({ fr: "Organiser", en: "", enMissing: false }, { open: true });
    expect(markup).toMatch(/id="copy-home.hero.title-en"[^>]*aria-invalid="true"[^>]*aria-describedby="copy-home.hero.title-en-error"/);
    expect(markup).toContain('<span id="copy-home.hero.title-en-error" class="sr-only">La traduction anglaise est requise.</span>');
    expect(markup).not.toMatch(/id="copy-home.hero.title"[^>]*aria-invalid/);
  });

  it("texte à rattraper : crayon marqué EN, champ anglais vide et décrit par l'aide", () => {
    const pencil = render({ fr: "Titre édité", en: "", enMissing: true });
    expect(pencil).toContain('aria-label="Modifier : Hero — titre (EN à rédiger)"');
    expect(pencil).toContain('<span class="missing">EN</span>');

    const editor = render({ fr: "Titre édité", en: "", enMissing: true }, { open: true });
    expect(editor).toMatch(/id="copy-home.hero.title-en"[^>]*aria-describedby="copy-home.hero.title-en-hint"/);
    expect(editor).toContain('id="copy-home.hero.title-en-hint"');
  });

  it("texte déjà bilingue : crayon ordinaire", () => {
    const markup = render({ fr: "Organiser", en: "Organize", enMissing: false });
    expect(markup).toContain('aria-label="Modifier : Hero — titre"');
    expect(markup).not.toContain("missing");
  });

  it("sous /en, l'éditeur du staff se déclare en français (D4)", () => {
    expect(render({ fr: "A", en: "B", enMissing: false }, { locale: "en" })).toMatch(/<button[^>]*lang="fr"/);
    expect(render({ fr: "A", en: "B", enMissing: false }, { open: true, locale: "en" })).toMatch(/<div class="editor" lang="fr">/);
    expect(render({ fr: "A", en: "B", enMissing: false })).not.toContain('lang="fr"');
  });
});

describe("submitSiteCopy", () => {
  const response = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  it("refuse un anglais vide sans rien envoyer, et le refus désigne le champ anglais", async () => {
    const fetcher = jest.fn<typeof fetch>();
    const outcome = await submitSiteCopy(fetcher, "home.hero.title", "Titre", "  ");
    expect(fetcher).not.toHaveBeenCalled();
    expect(outcome).toEqual({ ok: false, code: "COPY_EN_EMPTY", fallback: "La traduction anglaise est requise." });
    expect(fieldForError(outcome.ok ? null : outcome.code, SITE_COPY_FIELD_ERRORS)).toBe("en");
  });

  it("envoie les deux langues", async () => {
    const fetcher = jest.fn<typeof fetch>().mockResolvedValue(response(200, { copy: {} }));
    await expect(submitSiteCopy(fetcher, "home.hero.title", "Titre", "Title")).resolves.toEqual({ ok: true });
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("/api/site-copy");
    expect(JSON.parse(String(init?.body))).toEqual({ key: "home.hero.title", value: "Titre", valueEn: "Title" });
  });

  it("rend le code d'un refus du serveur", async () => {
    const fetcher = jest.fn<typeof fetch>().mockResolvedValue(response(400, { error: "COPY_EN_TOO_LONG" }));
    const outcome = await submitSiteCopy(fetcher, "home.hero.title", "Titre", "Title");
    expect(outcome).toMatchObject({ ok: false, code: "COPY_EN_TOO_LONG" });
    expect(fieldForError(outcome.ok ? null : outcome.code, SITE_COPY_FIELD_ERRORS)).toBe("en");
  });

  it("un échec réseau ne désigne aucun champ", async () => {
    const fetcher = jest.fn<typeof fetch>().mockRejectedValue(new TypeError("Failed to fetch"));
    const outcome = await submitSiteCopy(fetcher, "home.hero.title", "Titre", "Title");
    expect(outcome).toEqual({ ok: false, code: "", fallback: "Erreur réseau, réessaye." });
    expect(fieldForError("", SITE_COPY_FIELD_ERRORS)).toBeNull();
  });
});
