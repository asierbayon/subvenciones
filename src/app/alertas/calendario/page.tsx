import Link from "next/link";
import { AlertBanner } from "@/components/alert-banner";
import { AlertFilterForm, AlertPager } from "@/components/alert-filters";
import { EmptyState, PageIntro, SetupNeeded } from "@/components/setup-needed";
import { Badge } from "@/components/ui/badge";
import { listCalendario, parseAlertFilters, type AlertSearch } from "@/lib/alerts";
import { DatabaseMissingError, guard } from "@/lib/db";
import { formatDate, formatEuro, formatNumber } from "@/lib/format";

const linkClass =
  "font-medium text-accent underline decoration-accent/30 underline-offset-4 transition-colors hover:text-accent-strong hover:decoration-accent";

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
          Ejecuta{" "}
          <code className="rounded bg-subtle px-1.5 py-0.5 font-mono text-xs text-ink">
            python3 pipeline/alerts.py calendario
          </code>
          .
        </p>
      </PageIntro>
    );
  }

  return (
    <>
      <PageIntro eyebrow="Calendario" title="Cuándo se concentra la concesión">
        <p>
          Se comparan 45 días antes de una elección con los 45 anteriores, y 45 días después de un cambio de gobierno
          con los 45 previos. El relevo mide el índice de Jaccard entre los beneficiarios de dos años seguidos: por
          debajo de 0,30, y solo si cada año tenía al menos 15 perceptores. Diciembre no sale en esta lista: hace falta
          el triple de la media del resto del año y, aun así, suele ser el cierre del presupuesto. El filtro lo muestra.
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
        <ol className="grid gap-4">
          {loaded.rows.map((row) => (
            <li key={row.id} className="rounded-xl border border-line bg-elev p-5 shadow-2xs">
              <Badge tone="terra">{tipoLabel(row.tipo)}</Badge>
              <h2 className="mt-2 font-display text-base font-semibold text-ink">{row.etiqueta}</h2>
              <p className="mt-1 text-xs text-muted sm:text-sm">
                {row.organismo} · {row.ccaa} · {formatDate(row.fechaInicio)} – {formatDate(row.fechaFin)}
              </p>
              <p className="mt-3 text-sm leading-relaxed text-ink/90">{row.motivo}</p>
              <p className="mt-3 text-sm">
                <Link
                  href={concesionesHref(row.organismo, row.fechaInicio, row.tipo === "reemplazo" ? "" : row.fechaFin)}
                  className={linkClass}
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
