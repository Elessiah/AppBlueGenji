import type { Metadata } from "next";
import { pageMetadata } from "@/lib/shared/page-metadata";
import { PublicPageShell } from "@/components/cyber/landing/PublicPageShell";
import { BotLegalDoc } from "@/components/legal/BotLegalDoc";
import { PRIVACY_POLICY } from "@/lib/shared/bot-legal-content";

export const metadata: Metadata = pageMetadata({
  title: "Bot — Politique de Confidentialité / Privacy Policy",
  description:
    "Politique de Confidentialité du bot Discord BlueGenji Bot, disponible en français et en anglais.",
  path: "/privacy-policy-bot",
});

export default function PrivacyPolicyBotPage() {
  return (
    <PublicPageShell>
      <BotLegalDoc doc={PRIVACY_POLICY} />
    </PublicPageShell>
  );
}
