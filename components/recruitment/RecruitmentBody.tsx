import { formatRecruitmentBody } from "@/lib/shared/recruitment";
import styles from "./RecruitmentBody.module.css";

interface RecruitmentBodyProps {
  body: string | null | undefined;
  className?: string;
}

/**
 * Rendu long d'une description d'annonce. Le texte est saisi en brut dans un
 * `<textarea>` : `formatRecruitmentBody` en dérive des intertitres, des
 * paragraphes et des listes à puces (fonction pure, testée), qui sont ici rendus
 * en HTML sémantique — une description de deux mille signes devient lisible au
 * lieu d'être un bloc `pre-wrap` compact.
 *
 * Ne rend rien si la description est vide.
 */
export function RecruitmentBody({ body, className }: RecruitmentBodyProps) {
  const blocks = formatRecruitmentBody(body);
  if (blocks.length === 0) return null;

  return (
    <div className={className ? `${styles.body} ${className}` : styles.body}>
      {blocks.map((block, index) => {
        if (block.kind === "heading") {
          // Index en clé : les blocs sont dérivés d'un texte immuable, jamais
          // réordonnés ni insérés au milieu.
          return (
            <h4 key={index} className={styles.heading}>
              {block.text}
            </h4>
          );
        }
        if (block.kind === "list") {
          return (
            <ul key={index} className={styles.list}>
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{item}</li>
              ))}
            </ul>
          );
        }
        return (
          <p key={index} className={styles.paragraph}>
            {block.text}
          </p>
        );
      })}
    </div>
  );
}
