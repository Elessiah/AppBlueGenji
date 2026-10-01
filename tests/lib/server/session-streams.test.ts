import { afterEach, describe, expect, it, jest } from "@jest/globals";
import {
  closeSessionStreams,
  closeUserStreams,
  registerSessionStream,
  registeredStreamCount,
} from "@/lib/server/session-streams";

const cleanups: (() => void)[] = [];
function register(userId: number, tokenHash: string, close: () => void = jest.fn()): () => void {
  const unregister = registerSessionStream(userId, tokenHash, close);
  cleanups.push(unregister);
  return unregister;
}

afterEach(() => {
  cleanups.splice(0).forEach((fn) => fn());
});

describe("session-streams", () => {
  it("ferme tous les flux d'un compte, et seulement les siens", () => {
    const a1 = jest.fn();
    const a2 = jest.fn();
    const b = jest.fn();
    register(1, "h1", a1);
    register(1, "h2", a2);
    register(2, "h3", b);

    expect(closeUserStreams(1)).toBe(2);
    expect(a1).toHaveBeenCalledTimes(1);
    expect(a2).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();
    expect(registeredStreamCount()).toBe(1);
  });

  it("garde les flux de la session courante", () => {
    const current = jest.fn();
    const other = jest.fn();
    register(1, "courante", current);
    register(1, "autre", other);

    expect(closeUserStreams(1, { keepTokenHash: "courante" })).toBe(1);
    expect(current).not.toHaveBeenCalled();
    expect(other).toHaveBeenCalledTimes(1);
  });

  it("garde l'empreinte vide quand c'est elle qu'on garde (contournement de développement)", () => {
    const dev = jest.fn();
    const real = jest.fn();
    register(1, "", dev);
    register(1, "vraie", real);

    closeUserStreams(1, { keepTokenHash: "" });
    expect(dev).not.toHaveBeenCalled();
    expect(real).toHaveBeenCalledTimes(1);
  });

  it("ferme les flux d'une session, tous comptes confondus", () => {
    const same = jest.fn();
    const other = jest.fn();
    register(1, "h", same);
    register(1, "h2", other);

    expect(closeSessionStreams("h")).toBe(1);
    expect(same).toHaveBeenCalledTimes(1);
    expect(other).not.toHaveBeenCalled();
  });

  it("une empreinte vide ne désigne aucune session", () => {
    const dev = jest.fn();
    register(1, "", dev);
    expect(closeSessionStreams("")).toBe(0);
    expect(dev).not.toHaveBeenCalled();
  });

  it("ne ferme un flux qu'une fois, même révoqué deux fois", () => {
    const close = jest.fn();
    register(1, "h", close);
    closeUserStreams(1);
    closeUserStreams(1);
    closeSessionStreams("h");
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("continue de fermer les suivants quand une fermeture lève", () => {
    const broken = jest.fn(() => {
      throw new Error("déjà fermé");
    });
    const next = jest.fn();
    register(1, "a", broken);
    register(1, "b", next);

    expect(closeUserStreams(1)).toBe(2);
    expect(next).toHaveBeenCalledTimes(1);
    expect(registeredStreamCount()).toBe(0);
  });

  it("la désinscription est idempotente et retire le flux", () => {
    const close = jest.fn();
    const unregister = register(1, "h", close);
    unregister();
    unregister();
    expect(registeredStreamCount()).toBe(0);
    expect(closeUserStreams(1)).toBe(0);
    expect(close).not.toHaveBeenCalled();
  });

  it("supporte qu'une fermeture désinscrive son propre flux pendant le parcours", () => {
    let unregister: () => void = () => undefined;
    const close = jest.fn(() => unregister());
    unregister = register(1, "h", close);
    register(1, "h2");

    expect(closeUserStreams(1)).toBe(2);
    expect(registeredStreamCount()).toBe(0);
  });
});
