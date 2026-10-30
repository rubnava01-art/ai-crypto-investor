import type { Metadata } from "next";
import "./globals.css";
import { LanguageProvider } from "../lib/i18n";

export const metadata: Metadata = {
  title: "Plataforma — Invertir · Estudiar · Crear · CRM",
  description: "Plataforma unificada: trading (AI Crypto Investor), Academia, Forge y CRM",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className="dark">
      <body className="min-h-screen bg-zinc-950 text-zinc-100 antialiased">
        <LanguageProvider>{children}</LanguageProvider>
      </body>
    </html>
  );
}
