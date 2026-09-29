import type { Metadata } from "next";
import Link from "next/link";
import { CyberButton } from "@/components/cyber";
import { PublicPageShell } from "@/components/cyber/landing/PublicPageShell";
import { ErrorPanel } from "@/components/error-page/ErrorPanel";
import { NOT_FOUND_COPY, NOT_FOUND_LINKS } from "@/lib/shared/error-pages";

export const metadata: Metadata = {
  title: NOT_FOUND_COPY.title,
  robots: { index: false, follow: false },
};

/**
 * Page introuvable : toute URL inconnue et tout `notFound()` sans limite plus
 * proche. En français, dans le gabarit de la vitrine (en-tête, pied de page),
 * avec des chemins de retour — la page par défaut de Next n'en avait aucun.
 */
export default function NotFound() {
  return (
    <PublicPageShell>
      <ErrorPanel copy={NOT_FOUND_COPY}>
        {NOT_FOUND_LINKS.map((link, index) => (
          <CyberButton key={link.href} asChild variant={index === 0 ? "primary" : "ghost"}>
            <Link href={link.href}>{link.label}</Link>
          </CyberButton>
        ))}
      </ErrorPanel>
    </PublicPageShell>
  );
}
