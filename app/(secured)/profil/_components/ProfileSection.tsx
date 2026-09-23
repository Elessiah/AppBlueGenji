"use client";

import type { ProfileSection as Section } from "../_lib/profile-sections";
import s from "../profil.module.css";

/**
 * Une section de `/profil` : son ancre, son titre, sa promesse, son contenu.
 *
 * Le titre et l'ancre viennent du **registre** et non du JSX : la navigation en
 * tête de page pointe vers les mêmes identifiants, et un lien d'ancre vers une
 * cible absente ne fait rien du tout — pas d'erreur, pas de déplacement, rien à
 * remarquer.
 *
 * `aria-labelledby` plutôt qu'un `aria-label` recopié : le nom accessible de la
 * région *est* son titre visible, et deux chaînes finiraient par diverger.
 */
export function ProfileSection({
  section,
  className,
  children,
}: {
  section: Section;
  className?: string;
  children: React.ReactNode;
}): React.ReactElement {
  const headingId = `${section.id}-title`;
  return (
    <section
      id={section.id}
      aria-labelledby={headingId}
      className={`ds-block ${s.section} ${className ?? ""}`}
    >
      <div className={s.sectionHead}>
        <h2 id={headingId} className={s.sectionTitle}>
          {section.title}
        </h2>
        <p className={s.sectionLead}>{section.lead}</p>
      </div>
      {children}
    </section>
  );
}
