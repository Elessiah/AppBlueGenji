/**
 * Courriels et numéros de téléphone du site, **jamais en clair** — module pur.
 *
 * Une adresse ou un numéro écrit dans une page est moissonné par les robots et
 * finit en cible de spam ou de démarchage ; écrit dans ce dépôt, qui est public,
 * il l'est tout autant. Les coordonnées sont donc **stockées encodées** — ici
 * pour celles qui sont fixes, à la sortie du serveur pour celles qu'on édite en
 * base (`contact_email` du pied de page) — et ne sont assemblées que dans le
 * navigateur, **après un geste** du visiteur (`ProtectedContact`) : ni le HTML
 * rendu par le serveur, ni la charge utile des composants, ni le dépôt ne
 * portent la valeur lisible.
 *
 * L'encodage n'est pas un chiffrement et ne prétend pas l'être : il suffit à
 * écarter les robots qui cherchent des motifs (`x@y.z`, `06 12 …`), et un humain
 * obtient la valeur d'un clic. Base64 du texte UTF-8, **inversé** : un base64
 * brut se reconnaît et se décode tout seul, l'inversion lui retire cette forme.
 *
 * Un balayage (`tests/lib/shared/legal-contact.test.ts`) refuse tout
 * courriel ou numéro français en clair dans `app/`, `components/` et `lib/`.
 */

export type ContactKind = "email" | "phone";

function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(encoded: string): string {
  const binary = atob(encoded);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** Encode une coordonnée pour la stocker ou la faire voyager. Vide → vide. */
export function encodeContact(plain: string): string {
  if (!plain) return "";
  return toBase64(plain).split("").reverse().join("");
}

/**
 * Décode une coordonnée encodée par `encodeContact`. Une valeur illisible rend
 * `""` plutôt que de lever : un pied de page ne doit pas tomber pour un réglage
 * abîmé, il tait simplement le canal.
 */
export function decodeContact(encoded: string): string {
  if (!encoded) return "";
  try {
    return fromBase64(encoded.split("").reverse().join(""));
  } catch {
    return "";
  }
}

/**
 * Lien d'une coordonnée décodée : `mailto:` pour un courriel, `tel:` au format
 * international pour un numéro français (`06 12 …` → `tel:+33612…`), que les
 * téléphones composent depuis l'étranger comme depuis la France.
 */
export function contactHref(kind: ContactKind, plain: string): string {
  if (kind === "email") return `mailto:${plain.trim()}`;
  const digits = plain.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return `tel:${digits}`;
  if (digits.startsWith("0")) return `tel:+33${digits.slice(1)}`;
  return `tel:${digits}`;
}

/**
 * Coordonnées **fixes** de l'association et de l'hébergeur, encodées. Elles ne
 * s'écrivent qu'ici ; les pages les reçoivent telles quelles et les confient à
 * `ProtectedContact`. Pour en changer une : `encodeContact("nouvelle valeur")`
 * dans une console Node, puis coller le résultat.
 */
export const ASSOCIATION_EMAIL_ENCODED = "==QbvNmLslWYtdGQ0J3bwNXZppmbldWZ1xmY";
export const ASSOCIATION_PHONE_ENCODED = "=MDMgIDNgkjMgMDOgcDM";
export const SITE_HOST_PHONE_ENCODED = "=YDNgkDNgIjMgIDMgYDM";

export const SITE_HOST_EMAIL_ENCODED = "==gcm5yav9Gb0V3bAhmLuFWeyV2a";

/**
 * Coordonnées de la **personne à contacter pour les demandes relatives aux
 * données** : l'hébergeur, désigné **en tant que tel** (`DATA_CONTACT_NAME`,
 * `lib/shared/legal-contact.ts`). Ce sont les siennes, sans copie — une
 * correction du numéro les répare partout, et nom, courriel et téléphone ne
 * peuvent pas désigner deux personnes différentes.
 */
export const DATA_CONTACT_EMAIL_ENCODED = SITE_HOST_EMAIL_ENCODED;
export const DATA_CONTACT_PHONE_ENCODED = SITE_HOST_PHONE_ENCODED;
