import Link from "next/link";
import { AlertBanner, type MethodologyItem } from "@/components/alert-banner";
import { AlertFilterForm, AlertPager } from "@/components/alert-filters";
import {
  AlertCard,
  AlertFactStrip,
  AlertMetaRow,
  AlertResultsBar,
  AlertTabs,
  InlinePercentBar,
  alertLinkClass,
} from "@/components/alert-ui";
import { EmptyState, PageIntro, SetupNeeded } from "@/components/setup-needed";
import { Badge } from "@/components/ui/badge";
import { alertQuery, listConcentracion, listRecurrentes, parseAlertFilters, type AlertSearch } from "@/lib/alerts";
import { DatabaseMissingError, guard } from "@/lib/db";
import { formatEuro, formatNumber } from "@/lib/format";

const METHODOLOGY: MethodologyItem[] = [
  {
    label: "Índice HHI (0 a 1)",
    text: "Suma los cuadrados de la cuota de cada beneficiario en subvenciones dinerarias. 0 es reparto total y 1 es un único perceptor.",
  },
  {
    label: "Umbral marcado",
    text: "Organismos con al menos 20 concesiones y 4 beneficiarios donde el HHI llega a 0,25 o el mayor perceptor supera el 50 % del importe.",
  },
  {
    label: "Ganadores recurrentes",
    text: "Entidades privadas (sin universidades ni NIF P/Q/S) que cobran del mismo organismo al menos 4 años y suman 1 M€ o más.",
  },
];

const percent = (value: number) =>
  new Intl.NumberFormat("es-ES", { style: "percent", maximumFractionDigits: 1 }).format(value);

const ConcentracionPage = async ({ searchParams }: { searchParams: Promise<AlertSearch> }) => {
  const raw = await searchParams;
  const filters = parseAlertFilters(raw);
  const repeticion = raw.repeticion;
  const showRepeticion = repeticion === "1" || (Array.isArray(repeticion) && repeticion[0] === "1");
  const loaded = await guard(async () => {
    try {
      const concentracion = await listConcentracion(filters);
      const recurrentes = showRepeticion ? await listRecurrentes(filters) : null;
      return { concentracion, recurrentes };
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
      <PageIntro eyebrow="Concentración" title="Falta calcular este indicador">
        <p>
          Ejecuta <code>python3 pipeline/alerts.py concentracion</code>.
        </p>
      </PageIntro>
    );
  }

  const baseQuery = alertQuery(filters, { page: 1, pagina: 1 });
  const concentracionTabHref = `/alertas/concentracion${baseQuery}`;
  const recurrentesTabHref = baseQuery
    ? `/alertas/concentracion${baseQuery}&repeticion=1`
    : "/alertas/concentracion?repeticion=1";
  const yearLabel = filters.anio ? filters.anio : "todo el periodo";

  return (
    <>
      <PageIntro eyebrow="Concentración" title="Quién se queda el importe de cada organismo">
        <p>Mide cuánto presupuesto concentran los mayores beneficiarios y quién cobra año tras año.</p>
      </PageIntro>
      <AlertBanner methodology={METHODOLOGY}>
        Concentrar ayudas en pocos centros o financiar al mismo beneficiario varios años puede responder a una política
        pública explícita.
      </AlertBanner>
      <AlertTabs
        label="Vista de concentración"
        items={[
          { href: concentracionTabHref, label: "Por organismo", active: !showRepeticion },
          { href: recurrentesTabHref, label: "Ganadores que repiten", active: showRepeticion },
        ]}
      />
      <AlertFilterForm
        action="/alertas/concentracion"
        filters={filters}
        ccaa={loaded.concentracion.ccaa}
        anios={loaded.concentracion.anios}
        organismos={loaded.concentracion.organismos}
        hiddenFields={showRepeticion ? { repeticion: "1" } : undefined}
        clearHref={showRepeticion ? "/alertas/concentracion?repeticion=1" : "/alertas/concentracion"}
      />

      {!showRepeticion ? (
        <>
          <AlertResultsBar
            total={loaded.concentracion.total}
            shown={loaded.concentracion.rows.length}
            page={filters.page}
            pageSize={loaded.concentracion.pageSize}
            singular="organismo"
            plural="organismos"
            extra={
              <span className="inline-flex flex-wrap items-center gap-2">
                <span>Periodo: {yearLabel}</span>
                <Badge tone="terra">{formatNumber(loaded.concentracion.flagged)} sobre el umbral</Badge>
              </span>
            }
          />
          {loaded.concentracion.rows.length === 0 ? (
            <EmptyState>Ningún organismo con estos filtros.</EmptyState>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-line bg-elev shadow-2xs">
              <table className="w-full border-collapse text-sm">
                <caption className="sr-only">Concentración del importe por organismo</caption>
                <thead>
                  <tr className="border-b border-line bg-subtle/70 text-left text-xs font-semibold tracking-wider text-muted uppercase">
                    <th scope="col" className="px-4 py-3">Organismo</th>
                    <th scope="col" className="px-4 py-3">Territorio</th>
                    <th scope="col" className="px-4 py-3 text-right">HHI</th>
                    <th scope="col" className="px-4 py-3 text-right">Mayor perceptor</th>
                    <th scope="col" className="px-4 py-3 text-right">Top 5</th>
                    <th scope="col" className="px-4 py-3 text-right">Concesiones</th>
                    <th scope="col" className="px-4 py-3 text-right">Importe</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {loaded.concentracion.rows.map((row) => (
                    <tr key={row.id} className="align-top transition-colors hover:bg-highlight/60">
                      <th scope="row" className="px-4 py-3 text-left font-medium">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link
                            href={`/concesiones?organismo=${encodeURIComponent(row.organismo)}`}
                            className={alertLinkClass}
                          >
                            {row.organismo}
                          </Link>
                          {row.alerta ? <Badge tone="terra">Concentrado</Badge> : null}
                        </div>
                      </th>
                      <td className="px-4 py-3 text-muted">{row.ccaa}</td>
                      <td className="px-4 py-3 text-right font-semibold text-ink tabular-nums">
                        {row.hhi.toLocaleString("es-ES", { maximumFractionDigits: 3 })}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <InlinePercentBar
                          ratio={row.top1}
                          label={percent(row.top1)}
                          tone={row.top1 >= 0.5 ? "terra" : "accent"}
                        />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <InlinePercentBar ratio={row.top5} label={percent(row.top5)} tone="accent" />
                      </td>
                      <td className="px-4 py-3 text-right text-muted tabular-nums">{formatNumber(row.n)}</td>
                      <td className="px-4 py-3 text-right font-semibold text-ink tabular-nums">
                        {formatEuro(row.importe)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <AlertPager
            path="/alertas/concentracion"
            filters={filters}
            total={loaded.concentracion.total}
            pageSize={loaded.concentracion.pageSize}
          />
        </>
      ) : (
        <>
          <AlertResultsBar
            total={loaded.recurrentes?.total ?? 0}
            shown={loaded.recurrentes?.rows.length ?? 0}
            page={filters.pagina}
            pageSize={loaded.recurrentes?.pageSize ?? 15}
            singular="beneficiario recurrente"
            plural="beneficiarios recurrentes"
          />
          {!loaded.recurrentes || loaded.recurrentes.rows.length === 0 ? (
            <EmptyState>Ningún beneficiario recurrente con estos filtros.</EmptyState>
          ) : (
            <ol className="grid gap-4">
              {loaded.recurrentes.rows.map((row) => (
                <li key={row.id}>
                  <AlertCard
                    tone="accent"
                    badges={
                      <>
                        <Badge tone="accent">{row.nAnios} años cobrando</Badge>
                        {row.anios.map((year) => (
                          <Badge key={year}>{year}</Badge>
                        ))}
                      </>
                    }
                    title={
                      row.beneficiarioId ? (
                        <Link href={`/beneficiarios/${row.beneficiarioId}`} className={alertLinkClass}>
                          {row.nombre}
                        </Link>
                      ) : (
                        row.nombre
                      )
                    }
                    subtitle={
                      <AlertMetaRow
                        items={[row.organismo, row.ccaa, <span key="nif" className="font-mono">{row.nif}</span>]}
                      />
                    }
                    metric={formatEuro(row.importe)}
                    metricLabel={`${formatNumber(row.n)} concesiones`}
                  >
                    <AlertFactStrip
                      columns={3}
                      items={[
                        {
                          label: "Continuidad",
                          value: `${row.nAnios} ejercicios`,
                          hint: `${row.anioMin} – ${row.anioMax}`,
                        },
                        {
                          label: "Concesiones",
                          value: formatNumber(row.n),
                        },
                        {
                          label: "Media por año",
                          value: formatEuro(row.nAnios > 0 ? row.importe / row.nAnios : row.importe),
                          highlight: true,
                        },
                      ]}
                    />
                  </AlertCard>
                </li>
              ))}
            </ol>
          )}
          {loaded.recurrentes ? (
            <AlertPager
              path="/alertas/concentracion"
              filters={filters}
              total={loaded.recurrentes.total}
              pageSize={loaded.recurrentes.pageSize}
              field="pagina"
              extraParams={{ repeticion: "1" }}
            />
          ) : null}
        </>
      )}
    </>
  );
};

export default ConcentracionPage;
