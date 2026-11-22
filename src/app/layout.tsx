import type { Metadata } from "next";
import { Fraunces, Source_Sans_3 } from "next/font/google";
import { Providers } from "@/components/providers";
import { SiteFrame } from "@/components/site-frame";
import "./globals.css";

const sans = Source_Sans_3({
  subsets: ["latin"],
  variable: "--font-source",
  display: "swap",
});

const display = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Faro · subvenciones públicas",
    template: "%s · Faro",
  },
  description:
    "Explora convocatorias, concesiones y beneficiarios de la Base de Datos Nacional de Subvenciones a partir del volcado abierto de Jaime Obregón.",
};

const RootLayout = ({ children }: { children: React.ReactNode }) => (
  <html lang="es" className={`${sans.variable} ${display.variable} h-full`} suppressHydrationWarning>
    <body className="min-h-full font-sans text-ink antialiased">
      <Providers>
        <a
          href="#contenido"
          className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:rounded-full focus:bg-accent focus:px-4 focus:py-2 focus:text-accent-ink"
        >
          Saltar al contenido
        </a>
        <SiteFrame>{children}</SiteFrame>
      </Providers>
    </body>
  </html>
);

export default RootLayout;
