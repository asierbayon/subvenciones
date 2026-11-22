import Link from "next/link";
import { AlertBanner } from "@/components/alert-banner";
import { PageIntro, SetupNeeded } from "@/components/setup-needed";
import { DatabaseMissingError, getDb, guard } from "@/lib/db";
import { countBormeAlerts } from "@/lib/registro";

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
    href: "/alertas/sociedades",
    title: "Sociedades recientes",
    text: "Empresas constituidas poco antes de la ayuda, con capital mínimo, que se extinguen enseguida o cuya subvención es muy grande respecto del capital publicado en el BORME.",
    table: "alert_borme_sociedad",
  },
  {
    href: "/alertas/vinculos",
    title: "Administradores compartidos",
    text: "Varios beneficiarios del mismo organismo que, según el BORME, comparten administrador, socio único o domicilio social.",
    table: "alert_borme_vinculo",
  },
];

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
    let sociedad: number | null = null;
    let vinculo: number | null = null;
    try {
      const borme = await countBormeAlerts();
      sociedad = borme.sociedad;
      vinculo = borme.vinculo;
    } catch (error) {
      if (error instanceof DatabaseMissingError) {
        throw error;
      }
      const message = error instanceof Error ? error.message : "";
      if (!message.includes("no such table")) {
        throw error;
      }
    }
    return { fraccion, concentracion, recurrentes, calendario, benford, directa, sociedad, vinculo };
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
              <p className="mt-3 text-sm font-semibold text-accent">
                {signal.table === "alert_fraccion" && counts.fraccion !== null
                  ? `${counts.fraccion.toLocaleString("es-ES")} indicadores`
                  : ""}
                {signal.table === "alert_concentracion" && counts.concentracion !== null
                  ? `${counts.concentracion.toLocaleString("es-ES")} organismos marcados`
                  : ""}
                {signal.table === "alert_concentracion" && counts.recurrentes !== null
                  ? ` · ${counts.recurrentes.toLocaleString("es-ES")} que repiten`
                  : ""}
                {signal.table === "alert_fraccion" && counts.fraccion === null ? "Sin calcular" : ""}
                {signal.table === "alert_concentracion" && counts.concentracion === null ? "Sin calcular" : ""}
                {signal.table === "alert_calendario" && counts.calendario !== null
                  ? `${counts.calendario.toLocaleString("es-ES")} indicadores`
                  : ""}
                {signal.table === "alert_calendario" && counts.calendario === null ? "Sin calcular" : ""}
                {signal.table === "alert_benford" && counts.benford !== null
                  ? `${counts.benford.toLocaleString("es-ES")} organismos lejos de Benford`
                  : ""}
                {signal.table === "alert_benford" && counts.benford === null ? "Sin calcular" : ""}
                {signal.table === "alert_directa" && counts.directa !== null
                  ? `${counts.directa.toLocaleString("es-ES")} organismos con esa pista`
                  : ""}
                {signal.table === "alert_directa" && counts.directa === null ? "Sin calcular" : ""}
                {signal.table === "alert_borme_sociedad" && counts.sociedad !== null
                  ? `${counts.sociedad.toLocaleString("es-ES")} indicadores`
                  : ""}
                {signal.table === "alert_borme_sociedad" && counts.sociedad === null ? "Sin calcular" : ""}
                {signal.table === "alert_borme_vinculo" && counts.vinculo !== null
                  ? `${counts.vinculo.toLocaleString("es-ES")} indicadores`
                  : ""}
                {signal.table === "alert_borme_vinculo" && counts.vinculo === null ? "Sin calcular" : ""}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
};

export default AlertasPage;
