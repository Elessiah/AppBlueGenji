import { describe, expect, it, jest } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import { NumberInput, NumberInputReadOnlyContext } from "@/components/ui/number-input";

/**
 * `NumberInputReadOnlyContext` fige tous les champs numériques d'un formulaire
 * en cours d'envoi, sous-formulaires compris (`TournamentForm`,
 * `docs/features/BUSY_BUTTONS.md`).
 */
const field = (readOnly?: boolean) => (
  <NumberInput id="rounds" value={5} onValueChange={jest.fn<(value: number) => void>()} readOnly={readOnly} />
);

describe("NumberInput — lecture seule par contexte", () => {
  it("NumberInput_noProviderNoProp_notReadOnly", () => {
    const html = renderToStaticMarkup(field());

    expect(html).not.toContain("readonly");
  });

  it("NumberInput_providerTrue_rendersReadOnly", () => {
    const html = renderToStaticMarkup(
      <NumberInputReadOnlyContext.Provider value={true}>{field()}</NumberInputReadOnlyContext.Provider>,
    );

    expect(html).toContain('readonly=""');
  });

  it("NumberInput_providerFalseExplicitReadOnly_keepsReadOnly", () => {
    const html = renderToStaticMarkup(
      <NumberInputReadOnlyContext.Provider value={false}>{field(true)}</NumberInputReadOnlyContext.Provider>,
    );

    expect(html).toContain('readonly=""');
  });

  it("NumberInput_providerFalse_notReadOnly", () => {
    const html = renderToStaticMarkup(
      <NumberInputReadOnlyContext.Provider value={false}>{field()}</NumberInputReadOnlyContext.Provider>,
    );

    expect(html).not.toContain("readonly");
  });
});
