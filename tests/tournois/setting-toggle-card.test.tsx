import { describe, expect, it, jest } from "@jest/globals";
import type { ChangeEvent, ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SettingToggleCard } from "@/app/(secured)/tournois/_components/SettingToggleCard";

type CardProps = Parameters<typeof SettingToggleCard>[0];

function cardProps(overrides: Partial<CardProps> = {}): CardProps {
  return {
    id: "x",
    checked: true,
    editable: true,
    label: "Check-in des matchs",
    description: <p>Explication</p>,
    scopeHint: "Modifiable jusqu'à la clôture.",
    onChange: () => undefined,
    ...overrides,
  };
}

/** La balise `<input>` rendue. */
function inputTag(html: string): string {
  return html.match(/<input[^>]*>/)?.[0] ?? "";
}

/** L'élément `<input>` de l'arbre rendu (sans DOM). */
function inputElement(tree: ReactElement): ReactElement<{ onChange: (event: ChangeEvent<HTMLInputElement>) => void }> {
  const children = (tree.props as { children: ReactElement[] }).children;
  return children[0] as ReactElement<{ onChange: (event: ChangeEvent<HTMLInputElement>) => void }>;
}

describe("SettingToggleCard", () => {
  it("SettingToggleCard_editable_wiresLabelHintAndInfoButtonIds", () => {
    const html = renderToStaticMarkup(<SettingToggleCard {...cardProps()} />);

    const input = inputTag(html);
    expect(input).toContain('id="x"');
    expect(input).toContain('aria-labelledby="x-label"');
    expect(input).toContain('aria-describedby="x-more x-hint"');
    expect(input).toContain("checked");
    expect(input).not.toContain("disabled");
    expect(html).toContain('<label id="x-label" for="x"');
    expect(html).toContain('<p id="x-hint"');
    expect(html).toContain("Modifiable jusqu&#x27;à la clôture.");
  });

  it("SettingToggleCard_extraDescribedBy_appendsId", () => {
    const html = renderToStaticMarkup(<SettingToggleCard {...cardProps({ extraDescribedBy: "w" })} />);

    expect(inputTag(html)).toContain('aria-describedby="x-more x-hint w"');
  });

  it("SettingToggleCard_locked_checkboxDisabled", () => {
    const html = renderToStaticMarkup(<SettingToggleCard {...cardProps({ editable: false })} />);

    expect(inputTag(html)).toContain("disabled");
  });

  it("SettingToggleCard_click_callsOnChangeWithNewValue", () => {
    const onChange = jest.fn<(checked: boolean) => void>();
    const tree = SettingToggleCard(cardProps({ checked: false, onChange }));

    inputElement(tree).props.onChange({ target: { checked: true } } as ChangeEvent<HTMLInputElement>);

    expect(onChange).toHaveBeenCalledWith(true);
  });
});
