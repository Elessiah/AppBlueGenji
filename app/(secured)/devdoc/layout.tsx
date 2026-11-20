import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { permissionMetadata } from "@/components/error-page/NotFoundContent";
import { PodiumTiersOff } from "@/components/podium-tiers";
import { getCurrentUser } from "@/lib/server/auth";
import { loadDevDocIndex } from "@/lib/server/dev-docs";
import { messagesFor } from "@/lib/server/i18n-messages";
import { requestLocale } from "@/lib/server/request-locale";
import { groupDevDocs } from "@/lib/shared/dev-docs";
import { segmentTitle } from "@/lib/shared/page-metadata";
import { can } from "@/lib/shared/permissions";
import { segmentAccess } from "@/lib/shared/segment-access";
import { scopedText } from "@/lib/shared/scoped-text";
import { DevDocNav } from "./_components/DevDocNav";
import styles from "./devdoc.module.css";

/** Accès au segment, lu par l'onglet et par la mise en page. */
function devAccess(user: Awaited<ReturnType<typeof getCurrentUser>>) {
  return segmentAccess(user, (reader) => can(reader, "dev"));
}

/**
 * Le titre de l'onglet n'est posé que pour un lecteur autorisé ; un compte
 * sans la permission lit celui de la page introuvable qu'il reçoit, un
 * visiteur sans session aucun (l'espace rend « Connexion requise »).
 */
export async function generateMetadata(): Promise<Metadata> {
  return permissionMetadata(devAccess(await getCurrentUser()), async () => {
    const { devdoc } = messagesFor(await requestLocale());
    return { title: segmentTitle(devdoc.meta.title) };
  });
}

/**
 * La documentation développeur n'existe que pour la permission `dev`
 * (administrateurs et rôle `DEV`, `docs/features/DEVDOC.md`) : pour tout autre
 * compte connecté, la page est introuvable (404), comme le panneau des
 * signalements. Sans session, l'espace sécurisé montre déjà « Connexion
 * requise ». Ce garde n'est pas une frontière (les segments enfants sont rendus
 * en parallèle) : la page refait le contrôle avant de lire le moindre fichier.
 *
 * L'en-tête et la navigation vivent ici, pas dans la page : la mise en page
 * n'est pas rendue de nouveau d'un document à l'autre, si bien que
 * l'arborescence (la liste des ~200 documents) n'est envoyée qu'une fois par
 * visite, et que la recherche, les dossiers dépliés et le défilement de la
 * navigation survivent au choix d'un document.
 */
export default async function DevDocLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const access = devAccess(await getCurrentUser());
  if (access === "anonymous") return null;
  if (access === "denied") notFound();

  const [locale, index] = await Promise.all([requestLocale(), loadDevDocIndex()]);
  const messages = messagesFor(locale).devdoc;
  const { t } = scopedText(locale, messages);

  return (
    <PodiumTiersOff>
      <section className={`container ${styles.page}`}>
        <header className={styles.head}>
          <span className="eyebrow">{t("eyebrow")}</span>
          <h1 className={`display text-gradient ${styles.title}`}>{t("title")}</h1>
          <p className={styles.lead}>{t("lead")}</p>
        </header>

        <div className={styles.layout}>
          <DevDocNav groups={groupDevDocs(index.docs)} locale={locale} messages={messages} />
          {children}
        </div>
      </section>
    </PodiumTiersOff>
  );
}
