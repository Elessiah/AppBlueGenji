"use client";

import type { ProfileSection as Section, ProfileSectionId } from "../_lib/profile-sections";
import { useProfileText } from "@/components/i18n/profile-text";
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
 *
 * Titre et promesse se lisent dans la langue de la page (`profile.sections`,
 * lot 9-2) par l'ancre de la section ; le français du registre les égale.
 */
export function ProfileSection({
  section,
  className,
  children,
}: Readonly<{
  section: Section;
  className?: string;
  children: React.ReactNode;
}>): React.ReactElement {
  const { t } = useProfileText();
  const headingId = `${section.id}-title`;
  const id = section.id as ProfileSectionId;
  return (
    <section
      id={section.id}
      aria-labelledby={headingId}
      data-tone={section.tone}
      className={`ds-block ${s.section} ${className ?? ""}`}
    >
      <div className={s.sectionHead}>
        <h2 id={headingId} className={s.sectionTitle}>
          {t(`sections.${id}.title`)}
        </h2>
        <p className={s.sectionLead}>{t(`sections.${id}.lead`)}</p>
      </div>
      {children}
    </section>
  );
}
