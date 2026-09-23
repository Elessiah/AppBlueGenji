/**
 * L'hébergeur du site — une seule fois, pour les deux pages qui le nomment.
 *
 * Les mentions légales (`/mentions-legales#hebergement`) le doivent au lecteur
 * (LCEN), le registre des traitements (`/rgpd/registre`) le déclare comme
 * **sous-traitant** : c'est lui qui héberge les données. Deux copies de cette
 * adresse auraient fini par diverger — et le registre aurait alors déclaré un
 * hébergeur que les mentions légales ne connaissent plus.
 */
export const SITE_HOST = {
  name: "Keryan Houssin",
  status: "Auto-entrepreneur",
  address: "13 rue du Chemin Fourchue, 14000 Caen, France",
  phone: "06 02 22 49 56",
  siren: "930 888 342",
  /** Pays où les données sont hébergées — c'est ce qui décide d'un transfert hors UE. */
  country: "France",
} as const;
