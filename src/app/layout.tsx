import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Plus_Jakarta_Sans } from "next/font/google";
import { Providers } from "@/components/providers";
import { SiteFrame } from "@/components/site-frame";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-jakarta",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
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
  <html
    lang="es"
    className={`h-full ${inter.variable} ${jakarta.variable} ${jetbrainsMono.variable}`}
    suppressHydrationWarning
  >
    <body className="min-h-full bg-paper text-ink antialiased">
      <Providers>
        <a
          href="#contenido"
          className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-lg focus:bg-accent focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-accent-ink focus:shadow-lg focus:outline-none"
        >
          Saltar al contenido
        </a>
        <SiteFrame>{children}</SiteFrame>
      </Providers>
    </body>
  </html>
);

export default RootLayout;
