import type { Metadata } from "next";
import { PublicHeader } from "@/components/cyber/landing/PublicHeader";
import { PublicFooter } from "@/components/cyber/landing/PublicFooter";
import { BotLegalDoc } from "@/components/legal/BotLegalDoc";
import { TERMS_OF_SERVICE } from "@/lib/shared/bot-legal-content";

export const metadata: Metadata = {
  title: "BlueGenji Bot — Conditions d'Utilisation / Terms of Service",
  description:
    "Conditions d'Utilisation du bot Discord BlueGenji Bot, disponibles en français et en anglais.",
};

export default function TermsOfServiceBotPage() {
  return (
    <main style={{ position: "relative", zIndex: 1 }}>
      <PublicHeader />
      <BotLegalDoc doc={TERMS_OF_SERVICE} />
      <PublicFooter />
    </main>
  );
}
