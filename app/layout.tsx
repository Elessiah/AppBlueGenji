import type { Metadata } from "next";
import { Exo_2, Rajdhani } from "next/font/google";
import "./globals.css";
import { ToastProvider } from "@/components/ui/toast";
import { Background3D } from "@/components/bg-canvas-3d";
import { PaletteProvider } from "@/lib/palette-context";

const titleFont = Rajdhani({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-title",
});

const bodyFont = Exo_2({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-body",
});

export const metadata: Metadata = {
  title: "BlueGenji Arena",
  description:
    "Plateforme BlueGenji pour l'esport amateur Marvel Rivals: bot Discord, association et gestion de tournois.",
  icons: {
    icon: "/favicon.png",
    apple: "/apple-touch-icon.png",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body className={`${titleFont.variable} ${bodyFont.variable}`}>
        <PaletteProvider>
          <Background3D />
          <ToastProvider>{children}</ToastProvider>
        </PaletteProvider>
      </body>
    </html>
  );
}
