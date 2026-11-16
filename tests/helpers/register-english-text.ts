/**
 * Le texte anglais publié du registre (`/en/rgpd/registre`), tel qu'il sort
 * des modules : depuis LEGAL-FILES-DEDUP, les deux langues s'écrivent côte à
 * côte dans `lib/shared/processing-register.ts` (`frEn`), et
 * `processing-register-en.ts` ne fait que réexporter. Un contrôle qui lisait
 * la source anglaise lit donc ce texte résolu — le source français, qui porte
 * aussi les moitiés françaises, n'y suffirait pas.
 */
import { ALL_TRANSFER_RECIPIENTS } from "@/lib/shared/processing-register";
import * as registerFr from "@/lib/shared/processing-register";
import * as registerEn from "@/lib/shared/processing-register-en";

/** Nom d'un export anglais : `…_EN` ou `…En`. */
const ENGLISH_EXPORT = /(?:_EN|En)$/;

/**
 * Chaque texte anglais exporté de `processing-register.ts`, **réexporté ou
 * non** par `processing-register-en.ts` : un `FOO_EN` que seule une autre page
 * importe du module français n'échappe pas aux gardes. Une fonction anglaise
 * autre que celles qu'appelle {@link englishRegisterText} fait échouer : il
 * faut lui dire comment l'appeler.
 */
export function englishRegisterExports(): Record<string, unknown> {
  const texts: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(registerFr)) {
    if (!ENGLISH_EXPORT.test(name)) continue;
    if (typeof value === "function") {
      if (name !== "transferBasisEn" && name !== "registerControllerEn") {
        throw new Error(`englishRegisterText : fonction anglaise ${name} non appelée`);
      }
      continue;
    }
    texts[name] = value;
  }
  return texts;
}

/**
 * Chaque export anglais du registre (module anglais et `…_EN` du module
 * français), et `transferBasisEn` appelé destinataire
 * par destinataire : une branche que n'atteindrait qu'un sous-ensemble de
 * destinataires ne reste pas hors de portée des gardes de texte.
 */
export function englishRegisterText(): string {
  const { registerControllerEn, transferBasisEn, ...texts } = registerEn;
  return JSON.stringify([
    texts,
    englishRegisterExports(),
    registerControllerEn(),
    transferBasisEn(ALL_TRANSFER_RECIPIENTS),
    ...ALL_TRANSFER_RECIPIENTS.map((recipient) => transferBasisEn([recipient])),
  ]);
}
