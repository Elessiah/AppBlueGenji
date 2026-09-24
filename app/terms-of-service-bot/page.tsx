import type { Metadata } from "next";
import { pageMetadata } from "@/lib/shared/page-metadata";
import { PublicPageShell } from "@/components/cyber/landing/PublicPageShell";
import { BotLegalDoc } from "@/components/legal/BotLegalDoc";
import { TERMS_OF_SERVICE } from "@/lib/shared/bot-legal-content";

export const metadata: Metadata = pageMetadata({
  title: "Bot — Conditions d'Utilisation / Terms of Service",
  description:
    "Conditions d'Utilisation du bot Discord BlueGenji Bot, disponibles en français et en anglais.",
  path: "/terms-of-service-bot",
});

export default function TermsOfServiceBotPage() {
  return (
    <PublicPageShell>
      <BotLegalDoc doc={TERMS_OF_SERVICE} />
    </PublicPageShell>
  );
}
