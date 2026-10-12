/**
 * Lot 9-3 — envois mis de côté du champ « Langue des notifications » : un choix
 * fait pendant un envoi part à la suite, et « enregistré » ne se dit que si le
 * dernier choix l'est.
 */
import { describe, expect, it } from "@jest/globals";
import { runQueuedSaves } from "@/app/(secured)/profil/_lib/queued-saves";

type Locale = "fr" | "en";

/** Un envoi qu'on résout à la main, pour choisir pendant qu'il court. */
function harness(results: boolean[]) {
  const sent: Locale[] = [];
  const shown: Locale[] = [];
  const pending: Array<(ok: boolean) => void> = [];
  let queued: Locale | null = null;
  const put = (value: Locale) =>
    new Promise<boolean>((resolve) => {
      sent.push(value);
      pending.push(resolve);
    });
  const flush = async () => {
    await Promise.resolve();
    await Promise.resolve();
  };
  /** Résout l'envoi en cours avec le résultat prévu. */
  const settle = async () => {
    const resolve = pending.shift();
    resolve?.(results.shift() ?? true);
    await flush();
  };
  return {
    sent,
    shown,
    choose: (value: Locale) => {
      queued = value;
    },
    settle,
    run: (start: Locale, first: Locale) =>
      runQueuedSaves<Locale>({
        start,
        first,
        put,
        takeQueued: () => {
          const choice = queued;
          queued = null;
          return choice;
        },
        show: (value) => shown.push(value),
      }),
  };
}

describe("runQueuedSaves", () => {
  it("un seul choix réussi : envoyé, affiché, confirmé", async () => {
    const h = harness([true]);
    const done = h.run("fr", "en");
    await h.settle();
    expect(await done).toEqual({ saved: "en", stored: true, confirmed: true, upToDate: true });
    expect(h.sent).toEqual(["en"]);
    expect(h.shown).toEqual(["en", "en"]);
  });

  it("un second choix pendant l'envoi part à la suite, jamais en parallèle", async () => {
    const h = harness([true, true]);
    const done = h.run("fr", "en");
    h.choose("fr");
    expect(h.sent).toEqual(["en"]);
    await h.settle();
    expect(h.sent).toEqual(["en", "fr"]);
    await h.settle();
    expect(await done).toEqual({ saved: "fr", stored: true, confirmed: true, upToDate: true });
    expect(h.shown.at(-1)).toBe("fr");
  });

  it("le dernier choix échoue : rien n'est confirmé, le champ revient à ce que le serveur a retenu", async () => {
    const h = harness([true, false]);
    const done = h.run("fr", "en");
    h.choose("fr");
    await h.settle();
    await h.settle();
    expect(await done).toEqual({ saved: "en", stored: true, confirmed: false, upToDate: false });
    expect(h.shown.at(-1)).toBe("en");
  });

  it("un échec seul : le champ revient au départ, rien d'enregistré", async () => {
    const h = harness([false]);
    const done = h.run("fr", "en");
    await h.settle();
    expect(await done).toEqual({ saved: "fr", stored: false, confirmed: false, upToDate: false });
    expect(h.shown).toEqual(["en", "fr"]);
  });

  it("retour au départ pendant un envoi qui échoue : rien de confirmé, mais le champ est à jour (refus effacé)", async () => {
    const h = harness([false]);
    const done = h.run("fr", "en");
    h.choose("fr");
    await h.settle();
    expect(await done).toEqual({ saved: "fr", stored: false, confirmed: false, upToDate: true });
    expect(h.sent).toEqual(["en"]);
    expect(h.shown.at(-1)).toBe("fr");
  });

  it("un choix mis de côté égal à ce qui vient d'être retenu ne repart pas", async () => {
    const h = harness([true]);
    const done = h.run("fr", "en");
    h.choose("en");
    await h.settle();
    expect(await done).toEqual({ saved: "en", stored: true, confirmed: true, upToDate: true });
    expect(h.sent).toEqual(["en"]);
  });
});
