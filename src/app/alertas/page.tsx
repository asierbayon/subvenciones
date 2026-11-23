import Link from "next/link";
import { AlertBanner } from "@/components/alert-banner";
import { PageIntro, SetupNeeded } from "@/components/setup-needed";
import { DatabaseMissingError, getDb, guard } from "@/lib/db";

const signals = [
  {
    href: "/alertas/fraccionamiento",
    title: "Fraccionamiento",
    text: "El mismo NIF cobra varias subvenciones del mismo organismo, juntas en el tiempo y justo por debajo de un umbral de referencia.",
    table: "alert_fraccion",
  },
  {
    href: "/alertas/concentracion",
    title: "Concentración y repetición",
    text: "Qué parte del importe de un organismo se queda en pocos beneficiarios, y quién cobra de ese organismo año tras año.",
    table: "alert_concentracion",
  },
  {
    href: "/alertas/calendario",
    title: "Calendario",
    text: "Picos en los 45 días previos a unas elecciones, diciembres muy por encima del resto del año, y relevos bruscos de quién cobra.",
    table: "alert_calendario",
  },
  {
    href: "/alertas/estadistica",
    title: "Señales estadísticas",
    text: "Primer dígito frente a la ley de Benford, exceso de importes múltiplos de mil euros, y concesiones muy por encima de las de su mismo tipo.",
    table: "alert_benford",
  },
  {
    href: "/alertas/directa",
    title: "Concesión directa",
    text: "Proxy de título: organismos cuya subvención dice «concesión directa» o «nominativa». El fichero no trae el procedimiento.",
    table: "alert_directa",
  },
  {
    href: "/alertas/vinculos",
    title: "Vínculos políticos",
    text: "Sociedades cuyo administrador coincide con un cargo electo o un alto cargo del organismo que concede la ayuda.",
    table: "alert_vinculo",
  },
];

const signalCount = (
  table: string,
  counts: {
    fraccion: number | null;
    concentracion: number | null;
    recurrentes: number | null;
    calendario: number | null;
    benford: number | null;
    directa: number | null;
    vinculo: number | null;
  },
) => {
  if (table === "alert_fraccion") {
    if (counts.fraccion === null) {
      return "Sin calcular";
    }
    return `${counts.fraccion.toLocaleString("es-ES")} indicadores`;
  }
  if (table === "alert_concentracion") {
    if (counts.concentracion === null) {
      return "Sin calcular";
    }
    const marked = `${counts.concentracion.toLocaleString("es-ES")} organismos marcados`;
    if (counts.recurrentes === null) {
      return marked;
    }
    return `${marked} · ${counts.recurrentes.toLocaleString("es-ES")} que repiten`;
  }
  if (table === "alert_calendario") {
    if (counts.calendario === null) {
      return "Sin calcular";
    }
    return `${counts.calendario.toLocaleString("es-ES")} indicadores`;
  }
  if (table === "alert_benford") {
    if (counts.benford === null) {
      return "Sin calcular";
    }
    return `${counts.benford.toLocaleString("es-ES")} organismos lejos de Benford`;
  }
  if (table === "alert_directa") {
    if (counts.directa === null) {
      return "Sin calcular";
    }
    return `${counts.directa.toLocaleString("es-ES")} organismos con esa pista`;
  }
  if (table === "alert_vinculo") {
    if (counts.vinculo === null) {
      return "Sin calcular";
    }
    return `${counts.vinculo.toLocaleString("es-ES")} indicadores`;
  }
  return "";
};

const countTable = async (sql: string) => {
  const db = await getDb();
  try {
    const row = db.prepare(sql).get() as { n: number } | undefined;
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
  const counts = await guard(async () => {
    const fraccion = await countTable("SELECT COUNT(*) AS n FROM alert_fraccion");
    const concentracion = await countTable(
      "SELECT COUNT(*) AS n FROM alert_concentracion WHERE anio = 0 AND alerta = 1",
    );
    const recurrentes = await countTable("SELECT COUNT(*) AS n FROM alert_recurrente");
    const calendario = await countTable("SELECT COUNT(*) AS n FROM alert_calendario");
    const benford = await countTable("SELECT COUNT(*) AS n FROM alert_benford WHERE alerta = 1");
    const directa = await countTable("SELECT COUNT(*) AS n FROM alert_directa");
    const vinculo = await countTable("SELECT COUNT(*) AS n FROM alert_vinculo");
    return { fraccion, concentracion, recurrentes, calendario, benford, directa, vinculo };
  });
  if (counts === "missing") {
    return <SetupNeeded />;
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
              <p className="mt-3 text-sm font-semibold text-accent">{signalCount(signal.table, counts)}</p>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
};

export default AlertasPage;
