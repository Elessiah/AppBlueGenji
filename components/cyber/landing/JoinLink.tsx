"use client";

import { useCallback, useEffect, useState, type ComponentProps } from "react";
import { LocaleLink } from "@/components/i18n/locale-navigation";
import { withRedirectAnchor } from "@/lib/shared/spectator-view";

/**
 * « Rejoindre » de l'en-tête de la vitrine. Sur la page sans compte d'un
 * tournoi, le lien ramène après connexion à la fiche connectée
 * (`joinHrefFor`, côté serveur) ; l'ancre `#match-…`, que le serveur ne voit
 * jamais, s'y ajoute ici après l'hydratation — le premier rendu reste celui du
 * serveur, sans écart.
 */
export function JoinLink({
  href,
  onPointerDown,
  onFocus,
  ...rest
}: Readonly<ComponentProps<typeof LocaleLink> & { href: string }>) {
  const [target, setTarget] = useState(href);
  const update = useCallback(() => setTarget(withRedirectAnchor(href, globalThis.location.hash)), [href]);
  useEffect(() => {
    update();
    globalThis.addEventListener("hashchange", update);
    return () => globalThis.removeEventListener("hashchange", update);
  }, [update]);
  // Les propriétés du bouton (`CyberButton asChild`, classe et style) passent.
  // Une navigation client (`pushState`) ne déclenche pas `hashchange` : l'ancre
  // est relue aussi juste avant le geste (pointeur, ou focus avant Entrée).
  return (
    <LocaleLink
      {...rest}
      href={target}
      onPointerDown={(event) => {
        update();
        onPointerDown?.(event);
      }}
      onFocus={(event) => {
        update();
        onFocus?.(event);
      }}
    />
  );
}
