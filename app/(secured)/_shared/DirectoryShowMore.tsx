import { DIRECTORY_PAGE_SIZE } from "@/lib/shared/progressive-list";
import s from "./annuaire.module.css";

/**
 * « Voir plus » d'un annuaire : absent quand tout est affiché. Le libellé dit
 * combien de cartes s'ajoutent et combien restent ; le nom accessible commence
 * par le texte visible (WCAG 2.5.3) et nomme l'annuaire.
 */
export function DirectoryShowMore({
  hidden,
  noun,
  onShowMore,
}: {
  hidden: number;
  /** Nom au pluriel des éléments listés (« joueurs », « équipes »). */
  noun: string;
  onShowMore: () => void;
}) {
  if (hidden <= 0) return null;
  const step = Math.min(hidden, DIRECTORY_PAGE_SIZE);
  const label = `Voir plus (${step} sur ${hidden} restant${hidden > 1 ? "s" : ""})`;
  return (
    <div className={s.showMoreRow}>
      <button type="button" onClick={onShowMore} className={s.showMoreBtn} aria-label={`${label} · ${noun}`}>
        {label}
      </button>
    </div>
  );
}
