import type { Metadata } from "next";
import { PublicHeader } from "@/components/cyber/landing/PublicHeader";
import { PublicFooter } from "@/components/cyber/landing/PublicFooter";
import { BotLegalDoc } from "@/components/legal/BotLegalDoc";
import { PRIVACY_POLICY } from "@/lib/shared/bot-legal-content";

export const metadata: Metadata = {
  title: "BlueGenji Bot — Politique de Confidentialité / Privacy Policy",
  description:
    "Politique de Confidentialité du bot Discord BlueGenji Bot, disponible en français et en anglais.",
};

export default function PrivacyPolicyBotPage() {
  return (
    <main style={{ position: "relative", zIndex: 1 }}>
      <PublicHeader />
      <BotLegalDoc doc={PRIVACY_POLICY} />
      <PublicFooter />
    </main>
  );
}
