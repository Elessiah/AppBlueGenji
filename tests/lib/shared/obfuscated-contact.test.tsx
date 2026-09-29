import { describe, expect, it } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ASSOCIATION_EMAIL_ENCODED,
  ASSOCIATION_PHONE_ENCODED,
  SITE_HOST_PHONE_ENCODED,
  contactHref,
  decodeContact,
  encodeContact,
} from "@/lib/shared/obfuscated-contact";
import { ProtectedContact } from "@/components/ui/protected-contact";
import { readSource } from "../../helpers/read-source";

// Composées plutôt qu'écrites : un test reste un fichier du dépôt public.
const EMAIL = ["bluegenjiesport", "gmail.com"].join("@");
const ASSOCIATION_PHONE = ["07", "83", "29", "42", "03"].join(" ");
const HOST_PHONE = ["06", "02", "22", "49", "56"].join(" ");

describe("encodeContact / decodeContact", () => {
  it.each([EMAIL, ASSOCIATION_PHONE, "é@exemple.invalid"])("aller-retour : %s", (plain) => {
    const encoded = encodeContact(plain);
    expect(encoded).not.toContain(plain);
    expect(decodeContact(encoded)).toBe(plain);
  });

  it("l'encodé ne se lit ni comme un courriel ni comme un base64 direct", () => {
    const encoded = encodeContact(EMAIL);
    expect(encoded).not.toContain("@");
    // Inversé : décodé tel quel, il ne rend pas l'adresse.
    expect(Buffer.from(encoded, "base64").toString("utf8")).not.toContain(EMAIL);
  });

  it("vide → vide, et une valeur illisible se tait au lieu de lever", () => {
    expect(encodeContact("")).toBe("");
    expect(decodeContact("")).toBe("");
    expect(decodeContact("%%%")).toBe("");
  });

  it("les coordonnées fixes décodent vers les valeurs décidées", () => {
    expect(decodeContact(ASSOCIATION_EMAIL_ENCODED)).toBe(EMAIL);
    expect(decodeContact(ASSOCIATION_PHONE_ENCODED)).toBe(ASSOCIATION_PHONE);
    expect(decodeContact(SITE_HOST_PHONE_ENCODED)).toBe(HOST_PHONE);
  });
});

describe("contactHref", () => {
  it("mailto: pour un courriel", () => {
    expect(contactHref("email", " a@b.invalid ")).toBe("mailto:a@b.invalid");
  });

  it("tel: international pour un numéro français", () => {
    expect(contactHref("phone", ASSOCIATION_PHONE)).toBe("tel:+33783294203");
    expect(contactHref("phone", "+33 7 83 29 42 03")).toBe("tel:+33783294203");
    expect(contactHref("phone", "112")).toBe("tel:112");
  });
});

describe("ProtectedContact", () => {
  it("le rendu serveur ne contient que le bouton, jamais la valeur", () => {
    const html = renderToStaticMarkup(
      <ProtectedContact encoded={ASSOCIATION_EMAIL_ENCODED} kind="email" owner="de l'association" />,
    );
    expect(html).not.toContain(EMAIL);
    expect(html).not.toContain("mailto:");
    expect(html).toContain("<button");
    expect(html).toContain('type="button"');
    expect(html).toContain("tap-target");
    expect(html).toContain(">Afficher l&#x27;adresse</button>");
  });

  it("le nom accessible commence par le texte visible et dit à qui appartient la coordonnée", () => {
    const html = renderToStaticMarkup(
      <ProtectedContact encoded={SITE_HOST_PHONE_ENCODED} kind="phone" owner="de l'hébergeur" />,
    );
    expect(html).toContain('aria-label="Afficher le numéro de téléphone de l&#x27;hébergeur"');
    expect(html).toContain(">Afficher le numéro</button>");
  });

  it("le clic décode puis rend un lien qui prend le focus", () => {
    // Pas de DOM dans cette suite (environnement node) : on tient le contrat
    // sur la source, la mécanique de décodage étant testée plus haut.
    const source = readSource("components/ui/protected-contact.tsx");
    expect(source).toContain("const decoded = decodeContact(encoded);");
    expect(source).toContain("href={contactHref(kind, plain)}");
    expect(source).toContain("linkRef.current?.focus();");
  });

  it("une valeur vide ne rend rien", () => {
    expect(renderToStaticMarkup(<ProtectedContact encoded="" kind="email" owner="de l'association" />)).toBe("");
  });
});
