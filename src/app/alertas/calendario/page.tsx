import Link from "next/link";
import { AlertBanner } from "@/components/alert-banner";
import { AlertFilterForm, AlertPager } from "@/components/alert-filters";
import { EmptyState, PageIntro, SetupNeeded } from "@/components/setup-needed";
import { listCalendario, parseAlertFilters, type AlertSearch } from "@/lib/alerts";
import { DatabaseMissingError, guard } from "@/lib/db";
import { formatDate, formatEuro, formatNumber } from "@/lib/format";

const TIPOS = [
  { value: "elecciones", label: "Antes de elecciones" },
  { value: "diciembre", label: "Diciembre" },
  { value: "gobierno", label: "Tras un cambio de gobierno" },
  { value: "reemplazo", label: "Relevo de beneficiarios" },
];

const tipoLabel = (tipo: string) => TIPOS.find((item) => item.value === tipo)?.label ?? tipo;

const concesionesHref = (organismo: string, desde: string, hasta: string) => {
  const params = new URLSearchParams();
  params.set("organismo", organismo);
  if (desde) {
    params.set("desde", desde);
  }
  if (hasta) {
    params.set("hasta", hasta);
  }
  return `/concesiones?${params.toString()}`;
};

const CalendarioPage = async ({ searchParams }: { searchParams: Promise<AlertSearch> }) => {
  const filters = parseAlertFilters(await searchParams);
  const loaded = await guard(async () => {
    try {
      return await listCalendario(filters);
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
  });
  if (loaded === "missing") {
    return <SetupNeeded />;
  }
  if (!loaded) {
    return (
      <PageIntro eyebrow="Calendario" title="Falta calcular este indicador">
        <p>
          Ejecuta <code>python3 pipeline/alerts.py calendario</code>.
        </p>
      </PageIntro>
    );
  }

  return (
    <>
      <PageIntro eyebrow="Calendario" title="Cuándo se concentra la concesión">
        <p>
          Se comparan 45 días antes de una elección con los 45 anteriores, diciembre con el resto del año, y 45 días
          después de un cambio de gobierno con los 45 previos. El relevo mide el índice de Jaccard entre los
          beneficiarios de dos años seguidos: por debajo de 0,30, y solo si cada año tenía al menos 15 perceptores.
        </p>
      </PageIntro>
      <AlertBanner>
        Diciembre suele cerrar presupuesto y una elección no convierte una convocatoria en clientelar. El indicador
        ordena organismos cuyo ritmo se desvía del suyo propio.
      </AlertBanner>
      <AlertFilterForm
        action="/alertas/calendario"
        filters={filters}
        ccaa={loaded.ccaa}
        anios={loaded.anios}
        organismos={loaded.organismos}
        tipos={TIPOS}
      />
      {loaded.rows.length === 0 ? (
        <EmptyState>Ningún indicador de calendario con estos filtros.</EmptyState>
      ) : (
        <ol className="grid gap-3">
          {loaded.rows.map((row) => (
            <li key={row.id} className="xp-card">
              <p className="text-xs font-semibold tracking-wide text-terra uppercase">{tipoLabel(row.tipo)}</p>
              <h2 className="mt-1 xp-heading">{row.etiqueta}</h2>
              <p className="mt-1 text-sm text-muted">
                {row.organismo} · {row.ccaa} · {formatDate(row.fechaInicio)} – {formatDate(row.fechaFin)}
              </p>
              <p className="mt-3 text-sm leading-relaxed">{row.motivo}</p>
              <p className="mt-2 text-sm">
                <Link
                  href={concesionesHref(row.organismo, row.fechaInicio, row.tipo === "reemplazo" ? "" : row.fechaFin)}
                  className="xp-link"
                >
                  Ver las {formatNumber(row.n)} concesiones de este organismo
                  {row.importe > 0 ? ` (${formatEuro(row.importe)})` : ""}
                </Link>
              </p>
            </li>
          ))}
        </ol>
      )}
      <AlertPager path="/alertas/calendario" filters={filters} total={loaded.total} pageSize={loaded.pageSize} />
    </>
  );
};

export default CalendarioPage;
