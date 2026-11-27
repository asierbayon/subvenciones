import Link from "next/link";
import { AlertBanner, type MethodologyItem } from "@/components/alert-banner";
import { AlertFilterForm, AlertPager } from "@/components/alert-filters";
import {
  AlertCard,
  AlertDisclosure,
  AlertFactStrip,
  AlertMetaRow,
  AlertMeter,
  AlertResultsBar,
  alertLinkClass,
} from "@/components/alert-ui";
import { EmptyState, PageIntro, SetupNeeded } from "@/components/setup-needed";
import { Badge } from "@/components/ui/badge";
import { listCalendario, parseAlertFilters, type AlertSearch, type CalendarioRow } from "@/lib/alerts";
import { DatabaseMissingError, guard } from "@/lib/db";
import { formatDate, formatEuro, formatNumber } from "@/lib/format";

const TIPOS = [
  { value: "elecciones", label: "Antes de elecciones" },
  { value: "diciembre", label: "Diciembre" },
  { value: "gobierno", label: "Tras un cambio de gobierno" },
  { value: "reemplazo", label: "Relevo de beneficiarios" },
];

const METHODOLOGY: MethodologyItem[] = [
  {
    label: "Elecciones y gobierno",
    text: "Compara los 45 días previos a una elección (o posteriores a un cambio de gobierno) con los 45 días anteriores, exigiendo al menos el doble de concesiones.",
  },
  {
    label: "Relevo (Jaccard)",
    text: "Compara quién cobra en dos años consecutivos (mínimo 15 perceptores por año) y marca cuando coinciden menos del 30 %.",
  },
  {
    label: "Diciembre (oculto por defecto)",
    text: "Solo entra si triplica la media del resto del año. Suele ser cierre presupuestario; usa el filtro de señal para consultarlo.",
  },
];

const tipoLabel = (tipo: string) => TIPOS.find((item) => item.value === tipo)?.label ?? tipo;

const ratioText = (n: number, ref: number) => {
  if (ref <= 0) {
    return `${formatNumber(n)} vs 0`;
  }
  const multiple = n / ref;
  return `${multiple.toLocaleString("es-ES", { maximumFractionDigits: 1 })}×`;
};

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

const CalendarioBody = ({ row }: { row: CalendarioRow }) => {
  if (row.tipo === "reemplazo") {
    const overlapPct = Math.round(row.referencia * 100);
    return (
      <div className="grid gap-3">
        <AlertMeter
          percent={overlapPct}
          tone="terra"
          label="Coincidencia de beneficiarios entre ambos años (índice de Jaccard)"
          valueLabel={`${overlapPct} % (umbral < 30 %)`}
          ariaLabel={`Coincidencia de beneficiarios: ${overlapPct} por ciento`}
        />
        <AlertFactStrip
          columns={3}
          items={[
            { label: "Beneficiarios año nuevo", value: formatNumber(row.n) },
            { label: "Coincidencia", value: `${overlapPct} %`, highlight: true },
            { label: "Periodo", value: `${formatDate(row.fechaInicio)} – ${formatDate(row.fechaFin)}` },
          ]}
        />
      </div>
    );
  }

  const windowLabel =
    row.tipo === "elecciones"
      ? "45 días previos"
      : row.tipo === "gobierno"
        ? "45 días posteriores"
        : "En diciembre";
  const baselineLabel = row.tipo === "diciembre" ? "Media otros meses" : "45 días anteriores";
  const baselineValue =
    row.tipo === "diciembre"
      ? row.referencia.toLocaleString("es-ES", { maximumFractionDigits: 1 })
      : formatNumber(Math.round(row.referencia));

  return (
    <AlertFactStrip
      columns={4}
      items={[
        { label: windowLabel, value: `${formatNumber(row.n)} ayudas`, highlight: true },
        { label: baselineLabel, value: `${baselineValue} ayudas` },
        { label: "Ritmo relativo", value: ratioText(row.n, row.referencia), highlight: true },
        { label: "Importe ventana", value: row.importe > 0 ? formatEuro(row.importe) : "—" },
      ]}
    />
  );
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
        <p>Episodios en los que un organismo acelera concesiones o renueva bruscamente a sus beneficiarios.</p>
      </PageIntro>
      <AlertBanner methodology={METHODOLOGY}>
        Un pico antes de una elección o en diciembre puede deberse al ritmo habitual de tramitación o al cierre del
        presupuesto.
      </AlertBanner>
      <AlertFilterForm
        action="/alertas/calendario"
        filters={filters}
        ccaa={loaded.ccaa}
        anios={loaded.anios}
        organismos={loaded.organismos}
        tipos={TIPOS}
      />
      <AlertResultsBar
        total={loaded.total}
        shown={loaded.rows.length}
        page={filters.page}
        pageSize={loaded.pageSize}
        singular="episodio"
        plural="episodios"
      />
      {loaded.rows.length === 0 ? (
        <EmptyState>Ningún indicador de calendario con estos filtros.</EmptyState>
      ) : (
        <ol className="grid gap-4">
          {loaded.rows.map((row) => {
            const isReemplazo = row.tipo === "reemplazo";
            const metric = isReemplazo
              ? `${Math.round(row.referencia * 100)} % coincidencia`
              : row.importe > 0
                ? formatEuro(row.importe)
                : `${formatNumber(row.n)} ayudas`;
            const metricLabel = isReemplazo
              ? `${formatNumber(row.n)} beneficiarios`
              : `${ratioText(row.n, row.referencia)} sobre periodo base`;

            return (
              <li key={row.id}>
                <AlertCard
                  tone={row.tipo === "diciembre" ? "accent" : "terra"}
                  badges={
                    <>
                      <Badge tone={row.tipo === "diciembre" ? "neutral" : "terra"}>{tipoLabel(row.tipo)}</Badge>
                      <Badge>{row.anio}</Badge>
                    </>
                  }
                  title={row.etiqueta}
                  subtitle={
                    <AlertMetaRow
                      items={[
                        row.organismo,
                        row.ccaa,
                        `${formatDate(row.fechaInicio)} – ${formatDate(row.fechaFin)}`,
                      ]}
                    />
                  }
                  metric={metric}
                  metricLabel={metricLabel}
                  footer={
                    <>
                      <div className="flex flex-wrap items-center gap-3 text-xs">
                        <Link
                          href={concesionesHref(row.organismo, row.fechaInicio, isReemplazo ? "" : row.fechaFin)}
                          className={alertLinkClass}
                        >
                          Ver {formatNumber(row.n)}{" "}
                          {isReemplazo ? "concesiones del organismo" : "concesiones de esta ventana"}
                        </Link>
                      </div>
                      <AlertDisclosure label="Explicación detallada">
                        <p className="text-xs leading-relaxed text-muted">{row.motivo}</p>
                      </AlertDisclosure>
                    </>
                  }
                >
                  <CalendarioBody row={row} />
                </AlertCard>
              </li>
            );
          })}
        </ol>
      )}
      <AlertPager path="/alertas/calendario" filters={filters} total={loaded.total} pageSize={loaded.pageSize} />
    </>
  );
};

export default CalendarioPage;
