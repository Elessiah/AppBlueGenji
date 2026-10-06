/**
 * Champ bilingue des éditeurs de la page association (lot 5b, D9) : français et
 * anglais côte à côte, anglais obligatoire, refus rattaché au champ anglais,
 * aide du rattrapage — même contrat que l'éditeur des textes de la vitrine
 * (`editable-copy-bilingual.test.tsx`).
 */
import { describe, expect, it } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import { BilingualField, EnglishMissingMark, withEnglishMissing } from "@/components/ui/bilingual-field";
import { fieldAria, fieldForError } from "@/lib/shared/field-errors";
import type { FieldErrors } from "@/lib/shared/hooks/useFieldErrors";
import { BUREAU_FIELD_ERRORS, validateBureauInput } from "@/lib/shared/bureau";
import { RECRUITMENT_FIELD_ERRORS, validateRecruitmentAdInput } from "@/lib/shared/recruitment";
import { englishErrorMessage, ENGLISH_BACKFILL_HINT } from "@/lib/shared/staff-translation";

type Field = "role" | "roleEn";
const IDS = { role: "bureau-role", roleEn: "bureau-role-en" } as const;

/** Un `useFieldErrors` figé, le champ `flagged` signalé avec `message`. */
function errors(flagged: Field | null, message = "La traduction anglaise est requise."): FieldErrors<Field> {
  return {
    invalidField: flagged,
    report: () => true,
    flag: () => undefined,
    clear: () => undefined,
    aria: (field, ...help) => fieldAria(IDS[field], flagged === field, ...help),
    message: (field) => (flagged === field ? message : null),
  };
}

function render(props: { flagged?: Field | null; en?: string; enMissing?: boolean; required?: boolean; fr?: string } = {}): string {
  return renderToStaticMarkup(
    <BilingualField
      label="Rôle"
      ids={{ fr: IDS.role, en: IDS.roleEn }}
      fields={{ fr: "role", en: "roleEn" }}
      errors={errors(props.flagged ?? null)}
      values={{ fr: props.fr ?? "Président", en: props.en ?? "" }}
      onChange={() => undefined}
      maxLength={120}
      required={props.required}
      enMissing={props.enMissing}
    />,
  );
}

describe("BilingualField", () => {
  it("montre le français et l'anglais côte à côte, chacun dans sa langue, tous deux obligatoires", () => {
    const html = render();
    expect(html).toContain("<legend>Rôle</legend>");
    expect(html).toContain('<label class="lang" for="bureau-role">Français (obligatoire)</label>');
    expect(html).toContain('<label class="lang" for="bureau-role-en">Anglais (obligatoire)</label>');
    expect(html).toMatch(/<input[^>]*id="bureau-role"[^>]*lang="fr"[^>]*required=""/);
    expect(html).toMatch(/<input[^>]*id="bureau-role-en"[^>]*lang="en"[^>]*required=""/);
  });

  it("rattache le refus au champ anglais : aria-invalid, phrase en aria-describedby", () => {
    const html = render({ flagged: "roleEn" });
    expect(html).toMatch(/id="bureau-role-en"[^>]*aria-invalid="true"[^>]*aria-describedby="bureau-role-en-error"/);
    expect(html).toContain('<span id="bureau-role-en-error" class="sr-only">La traduction anglaise est requise.</span>');
    expect(html).not.toMatch(/id="bureau-role"[^>]*aria-invalid/);
  });

  it("contenu d'avant la traduction : l'aide du rattrapage, lue avec le champ anglais", () => {
    const html = render({ enMissing: true, flagged: "roleEn" });
    expect(html).toContain(`<span id="bureau-role-en-hint" class="hint">${ENGLISH_BACKFILL_HINT.replace(/'/g, "&#x27;")}</span>`);
    expect(html).toMatch(/aria-describedby="bureau-role-en-error bureau-role-en-hint"/);
  });

  it("l'aide du rattrapage se tait dès que l'anglais est saisi", () => {
    const html = render({ enMissing: true, en: "Chair" });
    expect(html).not.toContain("bureau-role-en-hint");
    expect(html).not.toContain(ENGLISH_BACKFILL_HINT.replace(/'/g, "&#x27;"));
  });

  it("champ facultatif : l'anglais n'est obligatoire qu'avec un français", () => {
    expect(render({ required: false, fr: "" })).not.toMatch(/id="bureau-role-en"[^>]*required=""/);
    expect(render({ required: false, fr: "Texte" })).toMatch(/id="bureau-role-en"[^>]*required=""/);
    expect(render({ required: false })).toContain("Anglais (obligatoire si le français est saisi)");
  });

  it("marque EN : visible, et dite par le nom du bouton", () => {
    expect(renderToStaticMarkup(<EnglishMissingMark />)).toBe('<span class="missing" aria-hidden="true">EN</span>');
    expect(withEnglishMissing("Modifier Léo", true)).toBe("Modifier Léo (EN à rédiger)");
    expect(withEnglishMissing("Modifier Léo", false)).toBe("Modifier Léo");
  });
});

describe("BilingualField — aide, compteurs, touche Entrée", () => {
  function renderWith(extra: Partial<React.ComponentProps<typeof BilingualField<Field>>>): string {
    return renderToStaticMarkup(
      <BilingualField
        label="Rôle"
        ids={{ fr: IDS.role, en: IDS.roleEn }}
        fields={{ fr: "role", en: "roleEn" }}
        errors={errors(null)}
        values={{ fr: "Président", en: "Chair" }}
        onChange={() => undefined}
        maxLength={120}
        {...extra}
      />,
    );
  }

  it("aide commune et compteur de chaque langue, lus avec leur contrôle", () => {
    const html = renderWith({ describedBy: "role-help", counter: true, counterClassName: (n) => (n > 5 ? "warn" : undefined) });
    expect(html).toMatch(/id="bureau-role"[^>]*aria-describedby="role-help bureau-role-count"/);
    expect(html).toMatch(/id="bureau-role-en"[^>]*aria-describedby="role-help bureau-role-en-count"/);
    expect(html).toContain('<span id="bureau-role-count" class="counter warn">9 / 120</span>');
    expect(html).toContain('<span id="bureau-role-en-count" class="counter">5 / 120</span>');
  });

  it("sans compteur demandé, aucun compteur", () => {
    expect(renderWith({})).not.toContain("-count");
  });

  it("avec onEnter : le français mène à l'anglais, l'anglais enregistre", () => {
    const html = renderWith({ onEnter: () => undefined });
    expect(html).toMatch(/id="bureau-role"[^>]*enterKeyHint="next"/i);
    expect(html).toMatch(/id="bureau-role-en"[^>]*enterKeyHint="done"/i);
    expect(renderWith({ enterKeyHint: "next" })).toMatch(/id="bureau-role-en"[^>]*enterKeyHint="next"/i);
  });
});

describe("refus d'anglais — un code, un champ, la phrase de l'éditeur des textes", () => {
  it("la validation partagée refuse l'anglais vide avant l'envoi, et le code désigne le champ anglais", () => {
    const bureau = validateBureauInput({ name: "Léo", role: "Président", roleEn: "" });
    expect(bureau).toEqual({ ok: false, error: "ROLE_EN_REQUIRED" });
    expect(bureau.ok ? null : fieldForError(bureau.error, BUREAU_FIELD_ERRORS)).toBe("roleEn");

    const ad = validateRecruitmentAdInput({ title: "Arbitres", titleEn: "Referees", roles: "Arbitrer" });
    expect(ad.ok ? null : fieldForError(ad.error, RECRUITMENT_FIELD_ERRORS)).toBe("rolesEn");
    expect(englishErrorMessage(ad.ok ? null : ad.error)).toBe("La traduction anglaise est requise.");
  });
});
