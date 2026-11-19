import { describe, expect, it, jest } from "@jest/globals";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BanRuleSegments } from "@/app/(secured)/tournois/[id]/_components/BanRuleSegments";
import { FIRST_BAN_RULES, type FirstBanRule } from "@/lib/shared/round-maps";

/**
 * Segments radio des règles de ban (`docs/features/ROUND_MAPS.md`, § Fenêtre allégée) :
 * choix, envoi en cours, touche Entrée. Sans DOM : le composant (sans hook) est appelé
 * comme une fonction et ses `<input>` sont cherchés dans l'arbre rendu.
 */

type InputProps = {
  value: string;
  onChange: () => void;
  onKeyDown: (event: { key: string; currentTarget: { type: string }; preventDefault: () => void }) => void;
};

const LABELS: Record<FirstBanRule, string> = { NON_HOST: "L'équipe non hôte", HOST: "L'équipe hôte" };

function props(overrides: Partial<Parameters<typeof BanRuleSegments<FirstBanRule>>[0]> = {}) {
  return {
    legend: "Premier ban",
    name: "rules-first",
    rules: FIRST_BAN_RULES,
    value: "HOST" as FirstBanRule,
    busy: false,
    isBusy: () => false,
    labelOf: (rule: FirstBanRule) => LABELS[rule],
    onChange: jest.fn<(rule: FirstBanRule) => void>(),
    ...overrides,
  };
}

function inputs(node: ReactNode): InputProps[] {
  if (Array.isArray(node)) return node.flatMap(inputs);
  if (!isValidElement(node)) return [];
  const element = node as ReactElement<{ children?: ReactNode }>;
  if (element.type === "input") return [element.props as unknown as InputProps];
  return inputs(element.props.children);
}

function radio(node: ReactNode, value: string): InputProps {
  const found = inputs(node).find((input) => input.value === value);
  if (!found) throw new Error(`radio ${value} absente`);
  return found;
}

function keyEvent(key: string) {
  return { key, currentTarget: { type: "radio" }, preventDefault: jest.fn<() => void>() };
}

describe("BanRuleSegments", () => {
  it("banRuleSegments_storedValue_onlyThatRadioChecked", () => {
    const html = renderToStaticMarkup(<BanRuleSegments {...props()} />);

    expect(html).toContain('<legend class="radio-segments-legend">Premier ban</legend>');
    expect(html.match(/type="radio" name="rules-first"/g)).toHaveLength(2);
    expect(html).toContain('checked="" value="HOST"');
    expect(html).not.toContain('checked="" value="NON_HOST"');
    expect(html).toContain("L&#x27;équipe non hôte");
    expect(html).not.toContain("aria-disabled");
  });

  it("banRuleSegments_chooseWhenIdle_callsOnChangeWithRule", () => {
    const given = props();

    radio(BanRuleSegments(given), "NON_HOST").onChange();

    expect(given.onChange).toHaveBeenCalledWith("NON_HOST");
  });

  it("banRuleSegments_chooseWhileBusy_ignoresGesture", () => {
    const given = props({ isBusy: () => true });

    radio(BanRuleSegments(given), "NON_HOST").onChange();

    expect(given.onChange).not.toHaveBeenCalled();
  });

  it("banRuleSegments_busy_radiosAriaDisabled", () => {
    const html = renderToStaticMarkup(<BanRuleSegments {...props({ busy: true })} />);

    expect(html.match(/aria-disabled="true"/g)).toHaveLength(2);
  });

  it("banRuleSegments_enterKey_preventsFormSubmit", () => {
    const event = keyEvent("Enter");

    radio(BanRuleSegments(props()), "HOST").onKeyDown(event);

    expect(event.preventDefault).toHaveBeenCalled();
  });

  it("banRuleSegments_arrowKey_keepsNativeBehaviour", () => {
    const event = keyEvent("ArrowRight");

    radio(BanRuleSegments(props()), "HOST").onKeyDown(event);

    expect(event.preventDefault).not.toHaveBeenCalled();
  });
});
