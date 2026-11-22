import Link from "next/link";
import { AlertBanner } from "@/components/alert-banner";
import { PageIntro, SetupNeeded } from "@/components/setup-needed";
import { DatabaseMissingError, getDb, guard } from "@/lib/db";

const signals = [
  {
    href: "/alertas/fraccionamiento",
    title: "Fraccionamiento",
    text: "El mismo NIF cobra varias subvenciones del mismo organismo, juntas en el tiempo y justo por debajo de un umbral de referencia.",
  },
];

const countFraccion = async () => {
  const db = await getDb();
  try {
    const row = db.prepare("SELECT COUNT(*) AS n FROM alert_fraccion").get() as { n: number } | undefined;
    return Number(row?.n ?? 0);
  } catch (error) {
    if (error instanceof DatabaseMissingError) {
      throw error;
    }
    const message = error instanceof Error ? error.message : "";
    if (message.includes("no such table")) {
      return null;
    }
    throw error;
  }
};

const AlertasPage = async () => {
  const total = await guard(countFraccion);
  if (total === "missing") {
    return <SetupNeeded />;
  }
  if (total === null) {
    return (
      <PageIntro eyebrow="Alertas" title="Falta calcular los indicadores">
        <p>
          Genera el primero con <code>python3 pipeline/alerts.py fraccionamiento</code>.
        </p>
      </PageIntro>
    );
  }

  return (
    <>
      <PageIntro eyebrow="Alertas" title="Señales para mirar de cerca">
        <p>
          Cada tarjeta es un patrón calculado sobre el volcado. Sirve para ordenar expedientes, no para afirmar que
          alguien ha incumplido la ley.
        </p>
      </PageIntro>
      <AlertBanner>
        Los umbrales de contratación y el de minimis son referencias. Una ayuda puede quedar debajo por una razón
        administrativa perfectamente regular.
      </AlertBanner>
      <ul className="grid gap-3 md:grid-cols-2">
        {signals.map((signal) => (
          <li key={signal.href}>
            <Link href={signal.href} className="block rounded-3xl border border-line bg-elev p-5 hover:bg-highlight">
              <h2 className="font-display text-2xl">{signal.title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted">{signal.text}</p>
              <p className="mt-3 text-sm font-semibold text-accent">{total.toLocaleString("es-ES")} indicadores</p>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
};

export default AlertasPage;
