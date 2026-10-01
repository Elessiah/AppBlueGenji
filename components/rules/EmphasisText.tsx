import { Fragment } from "react";
import { parseEmphasis } from "@/lib/shared/inline-emphasis";

/**
 * Rend l'emphase Markdown (`**gras**`) d'un texte du registre des règles.
 *
 * Les segments sont montés en éléments React — jamais en HTML injecté : le
 * registre est du contenu de confiance, mais il n'y a aucune raison de lui
 * ouvrir `dangerouslySetInnerHTML` pour du gras.
 */
export function EmphasisText({ text }: Readonly<{ text: string }>) {
  return (
    <>
      {parseEmphasis(text).map((segment, index) => (
        <Fragment key={index} /* NOSONAR S6479 — segments dérivés d'un texte immuable */>
          {segment.bold ? <strong>{segment.text}</strong> : segment.text}
        </Fragment>
      ))}
    </>
  );
}
