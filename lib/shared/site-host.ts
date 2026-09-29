/**
 * L'hébergeur du site — une seule fois, pour les deux pages qui le nomment.
 *
 * Les mentions légales (`/mentions-legales#hebergement`) le doivent au lecteur
 * (LCEN), le registre des traitements (`/rgpd/registre`) le déclare comme
 * **sous-traitant** : c'est lui qui héberge les données. Deux copies de cette
 * adresse auraient fini par diverger — et le registre aurait alors déclaré un
 * hébergeur que les mentions légales ne connaissent plus.
 *
 * Le téléphone n'y figure qu'**encodé** (`lib/shared/obfuscated-contact.ts`) :
 * les mentions légales le révèlent au clic, jamais dans le HTML.
 */
import { SITE_HOST_PHONE_ENCODED } from "@/lib/shared/obfuscated-contact";

export const SITE_HOST = {
  name: "Keryan Houssin",
  /**
   * Particulier, et non professionnel : l'hébergement est un service rendu
   * bénévolement à l'association. Aucun SIREN à publier — l'hébergeur n'en a
   * pas, et la LCEN ne demande de lui que nom, adresse et téléphone.
   */
  status: "Particulier, bénévole de l'association",
  address: "13 rue du Chemin Fourchue, 14000 Caen, France",
  phoneEncoded: SITE_HOST_PHONE_ENCODED,
  /** Machine qui fait tourner le site et le bot Discord. */
  machine: "un Raspberry Pi, à Caen",
  /** Pays où les données sont hébergées — c'est ce qui décide d'un transfert hors UE. */
  country: "France",
} as const;
