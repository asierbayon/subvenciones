import type { Metadata } from "next";
import { Providers } from "@/components/providers";
import { SiteFrame } from "@/components/site-frame";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Faro · subvenciones públicas",
    template: "%s · Faro",
  },
  description:
    "Explora convocatorias, concesiones y beneficiarios de la Base de Datos Nacional de Subvenciones a partir del volcado abierto de Jaime Obregón.",
};

const RootLayout = ({ children }: { children: React.ReactNode }) => (
  <html lang="es" className="h-full" suppressHydrationWarning>
    <body className="min-h-full text-ink antialiased">
      <Providers>
        <a href="#contenido" className="xp-skip xp-button">
          Saltar al contenido
        </a>
        <SiteFrame>{children}</SiteFrame>
      </Providers>
    </body>
  </html>
);

export default RootLayout;
