/**
 * Le texte anglais publié du registre (`/en/rgpd/registre`), tel qu'il sort
 * des modules : depuis LEGAL-FILES-DEDUP, les deux langues s'écrivent côte à
 * côte dans `lib/shared/processing-register.ts` (`frEn`), et
 * `processing-register-en.ts` ne fait que réexporter. Un contrôle qui lisait
 * la source anglaise lit donc ce texte résolu — le source français, qui porte
 * aussi les moitiés françaises, n'y suffirait pas.
 */
import { ALL_TRANSFER_RECIPIENTS } from "@/lib/shared/processing-register";
import * as registerEn from "@/lib/shared/processing-register-en";

export function englishRegisterText(): string {
  const { registerControllerEn, transferBasisEn, ...texts } = registerEn;
  return JSON.stringify([texts, registerControllerEn(), transferBasisEn(ALL_TRANSFER_RECIPIENTS)]);
}
