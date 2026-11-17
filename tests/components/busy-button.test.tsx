import { describe, expect, it, jest } from "@jest/globals";
import { createRef, type MouseEvent, type ReactElement, type Ref } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BusyButton, type BusyButtonProps } from "@/components/ui/busy-button";

/**
 * `BusyButton` (`docs/features/BUSY_BUTTONS.md`) : `aria-disabled` + `aria-busy`
 * et la garde de l'activation viennent du **même** état — une raison de refus
 * ne peut plus être oubliée dans un gestionnaire. Environnement Node : le
 * bouton rendu est un élément React dont on appelle le `onClick`.
 */
type ClickHandler = (event: MouseEvent<HTMLButtonElement>) => void;

function fakeClick() {
  const preventDefault = jest.fn();
  return { event: { preventDefault } as unknown as MouseEvent<HTMLButtonElement>, preventDefault };
}

// `forwardRef` : le rendu est la fonction `render(props, ref)` de l'objet exporté.
type ForwardRendered = { render: (props: BusyButtonProps, ref: Ref<HTMLButtonElement> | null) => ReactElement };
const renderBusy = (props: BusyButtonProps, ref: Ref<HTMLButtonElement> | null = null) =>
  (BusyButton as unknown as ForwardRendered).render(props, ref) as ReactElement<{ onClick: ClickHandler }> & {
    ref: unknown;
  };

function clickOf(props: BusyButtonProps): ClickHandler {
  return renderBusy(props).props.onClick;
}

describe("BusyButton", () => {
  it("BusyButton_idle_callsOnClickAndHasNoAriaState", () => {
    const onClick = jest.fn<ClickHandler>();
    const { event, preventDefault } = fakeClick();

    clickOf({ busy: false, onClick })(event);

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(preventDefault).not.toHaveBeenCalled();
    const html = renderToStaticMarkup(<BusyButton busy={false}>Enregistrer</BusyButton>);
    expect(html).toBe('<button type="button">Enregistrer</button>');
  });

  it("BusyButton_busy_swallowsClickAndAnnouncesBusy", () => {
    const onClick = jest.fn<ClickHandler>();
    const onBlockedClick = jest.fn<ClickHandler>();
    const { event, preventDefault } = fakeClick();

    clickOf({ busy: true, blocked: true, onClick, onBlockedClick })(event);

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
    expect(onBlockedClick).not.toHaveBeenCalled();
    const html = renderToStaticMarkup(<BusyButton busy>Enregistrer</BusyButton>);
    expect(html).toBe('<button type="button" aria-disabled="true" aria-busy="true">Enregistrer</button>');
  });

  it("BusyButton_blocked_swallowsClickWithoutBusy", () => {
    const onClick = jest.fn<ClickHandler>();
    const { event, preventDefault } = fakeClick();

    clickOf({ busy: false, blocked: true, onClick })(event);

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
    const html = renderToStaticMarkup(<BusyButton busy={false} blocked>Enregistrer</BusyButton>);
    expect(html).toBe('<button type="button" aria-disabled="true">Enregistrer</button>');
  });

  it("BusyButton_blockedWithExplanation_callsOnBlockedClickOnly", () => {
    const onClick = jest.fn<ClickHandler>();
    const onBlockedClick = jest.fn<ClickHandler>();
    const { event, preventDefault } = fakeClick();

    clickOf({ busy: false, blocked: true, onClick, onBlockedClick })(event);

    expect(onBlockedClick).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
    expect(preventDefault).toHaveBeenCalledTimes(1);
  });

  it("BusyButton_submitType_blockedCancelsImplicitSubmission", () => {
    // Entrée dans un champ soumet par un clic synthétique sur ce bouton : l'annuler suffit.
    const { event, preventDefault } = fakeClick();

    clickOf({ busy: false, blocked: true, type: "submit" })(event);

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(renderToStaticMarkup(<BusyButton busy={false} blocked type="submit">Envoyer</BusyButton>)).toContain('type="submit"');
  });

  it("BusyButton_render_neverNativeDisabled", () => {
    const html = renderToStaticMarkup(
      <BusyButton busy blocked className="btn">
        Envoyer
      </BusyButton>,
    );

    expect(html).not.toMatch(/(?<!aria-)disabled=/);
    expect(html).toContain('class="btn"');
  });

  it("BusyButton_ref_forwardedToTheNativeButton", () => {
    // Un écran rend le focus à un bouton précis après l'envoi (flèches de l'ordre
    // des engagés, « Prêt » du centre de lancement) : la `ref` doit l'atteindre.
    const ref = createRef<HTMLButtonElement>();

    expect(renderBusy({ busy: false }, ref).ref).toBe(ref);
    expect(renderBusy({ busy: true }).ref).toBeNull();
  });
});
