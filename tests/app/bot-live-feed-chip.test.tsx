import { describe, expect, it } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import { BotLiveFeed } from "@/components/bot/BotLiveFeed";
import { readSource } from "../helpers/read-source";

/**
 * La pastille de pause du flux de `/bot`. `chip-on` y était posé quand le flux
 * **n'était pas** en pause : invisible tant que la classe n'avait aucun style,
 * l'inversion est devenue un « ■ PAUSE » bleu sur un flux qui défile — qui se
 * lit « en pause ». L'état allumé dit l'état posé, pas l'action offerte.
 */
describe("BotLiveFeed — la pastille de pause", () => {
  it("n'est pas allumée pendant que le flux défile", () => {
    // Les effets ne tournent pas au rendu serveur : aucun `EventSource` n'est
    // ouvert, seul l'état initial (flux en marche) est rendu.
    const html = renderToStaticMarkup(<BotLiveFeed />);
    expect(html).toContain("■ PAUSE");
    expect(html).toMatch(/class="chip"[^>]*>■ PAUSE/);
    expect(html).not.toContain("chip-on");
  });

  it("ne s'allume que sur la pause posée", () => {
    // L'état « en pause » ne se rend pas sans DOM : on tient l'expression.
    const source = readSource("components/bot/BotLiveFeed.tsx");
    expect(source).toContain("(paused ? ' chip-on' : '')");
    expect(source).not.toMatch(/paused \? '' : 'chip-on'/);
  });
});
