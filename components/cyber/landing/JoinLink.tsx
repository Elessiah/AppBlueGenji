"use client";

import { useEffect, useState, type ComponentProps } from "react";
import { LocaleLink } from "@/components/i18n/locale-navigation";
import { withRedirectAnchor } from "@/lib/shared/spectator-view";

/**
 * « Rejoindre » de l'en-tête de la vitrine. Sur la page sans compte d'un
 * tournoi, le lien ramène après connexion à la fiche connectée
 * (`joinHrefFor`, côté serveur) ; l'ancre `#match-…`, que le serveur ne voit
 * jamais, s'y ajoute ici après l'hydratation — le premier rendu reste celui du
 * serveur, sans écart.
 */
export function JoinLink({ href, ...rest }: Readonly<ComponentProps<typeof LocaleLink> & { href: string }>) {
  const [target, setTarget] = useState(href);
  useEffect(() => {
    const update = () => setTarget(withRedirectAnchor(href, globalThis.location.hash));
    update();
    globalThis.addEventListener("hashchange", update);
    return () => globalThis.removeEventListener("hashchange", update);
  }, [href]);
  // Les propriétés du bouton (`CyberButton asChild`, classe et style) passent.
  return <LocaleLink {...rest} href={target} />;
}
