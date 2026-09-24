import { describe, expect, it, jest } from "@jest/globals";
import { type BackdropGesture, backdropHandlers, isBackdropDismiss } from "@/lib/shared/backdrop-dismiss";

// Des objets suffisent : la règle ne compare que des identités de cibles.
const backdrop = { name: "voile" } as unknown as EventTarget;
const field = { name: "champ" } as unknown as EventTarget;
const panel = { name: "panneau" } as unknown as EventTarget;

describe("isBackdropDismiss", () => {
  it("ferme sur un appui et un relâchement sur le voile", () => {
    expect(isBackdropDismiss(backdrop, backdrop, backdrop)).toBe(true);
  });

  // Dans les deux cas suivants, le `click` part vers l'ancêtre commun — le
  // voile — : seules les cibles de l'appui et du relâchement les distinguent.
  it("ne ferme pas une sélection de texte commencée dans un champ et relâchée sur le voile", () => {
    expect(isBackdropDismiss(field, backdrop, backdrop)).toBe(false);
  });

  it("ne ferme pas un appui sur le voile relâché dans le panneau", () => {
    expect(isBackdropDismiss(backdrop, field, backdrop)).toBe(false);
  });

  it("ne ferme pas un clic dans le panneau", () => {
    expect(isBackdropDismiss(panel, panel, backdrop)).toBe(false);
  });

  it("ne ferme pas sans appui ou relâchement connu (clic synthétique)", () => {
    expect(isBackdropDismiss(null, backdrop, backdrop)).toBe(false);
    expect(isBackdropDismiss(backdrop, null, backdrop)).toBe(false);
  });

  it("ne ferme jamais sans voile", () => {
    expect(isBackdropDismiss(null, null, null)).toBe(false);
  });
});

describe("backdropHandlers — séquence d'un navigateur (appui, relâchement, clic)", () => {
  const setup = (disabled = false) => {
    const gesture: BackdropGesture = { press: null, release: null };
    const onDismiss = jest.fn<() => void>();
    return { gesture, onDismiss, handlers: backdropHandlers(gesture, onDismiss, disabled) };
  };
  const on = (target: EventTarget) => ({ target, currentTarget: backdrop });

  // Chaque geste : appui sur `down`, relâchement sur `up`, puis le clic que le
  // navigateur envoie à l'ancêtre commun — ici toujours le voile.
  const gestureOf = (handlers: ReturnType<typeof backdropHandlers>, down: EventTarget, up: EventTarget) => {
    handlers.onPointerDown(on(down));
    handlers.onPointerUp(on(up));
    handlers.onClick(on(backdrop));
  };

  it("ferme sur un appui et un relâchement sur le voile", () => {
    const { onDismiss, handlers } = setup();
    gestureOf(handlers, backdrop, backdrop);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("garde la modale ouverte après une sélection glissée hors du panneau", () => {
    const { onDismiss, handlers } = setup();
    gestureOf(handlers, field, backdrop);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("garde la modale ouverte après un appui sur le voile relâché dans un champ", () => {
    const { onDismiss, handlers } = setup();
    gestureOf(handlers, backdrop, field);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("ne ferme pas pendant une opération en cours", () => {
    const { onDismiss, handlers } = setup(true);
    gestureOf(handlers, backdrop, backdrop);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("oublie le geste après chaque clic : un clic isolé qui suit ne ferme pas", () => {
    const { gesture, onDismiss, handlers } = setup();
    gestureOf(handlers, field, backdrop);
    expect(gesture).toEqual({ press: null, release: null });
    handlers.onClick(on(backdrop));
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("un nouvel appui efface le relâchement du geste précédent", () => {
    const { gesture, handlers } = setup();
    handlers.onPointerUp(on(backdrop));
    handlers.onPointerDown(on(backdrop));
    expect(gesture.release).toBeNull();
  });
});
