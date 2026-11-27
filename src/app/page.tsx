import Link from "next/link";
import { DataTable, HorizontalBars, YearChart, YearTable } from "@/components/dashboard-charts";
import { Kpi } from "@/components/facts";
import { PageIntro, SetupNeeded } from "@/components/setup-needed";
import { guard } from "@/lib/db";
import { formatCompactEuro, formatDate, formatEuro, formatNumber } from "@/lib/format";
import { parseFilters, toQuery, type SearchParams } from "@/lib/params";
import { getDashboard } from "@/lib/queries";
import { cn } from "@/lib/utils";

const tabClass = (active: boolean) =>
  cn(
    "whitespace-nowrap rounded-lg px-3.5 py-1.5 text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
    active
      ? "bg-elev text-ink shadow-xs ring-1 ring-line"
      : "text-muted hover:text-ink",
  );

const Panel = async ({ searchParams }: { searchParams: Promise<SearchParams> }) => {
  const filters = parseFilters(await searchParams);
  const data = await guard(() => getDashboard(filters.vista));
  if (data === "missing") {
    return <SetupNeeded />;
  }

  const subvencionHref = `/${toQuery(filters, { vista: "subvencion", page: 1 })}`;
  const garantiaHref = `/${toQuery(filters, { vista: "garantia", page: 1 })}`;
  const todosHref = `/${toQuery(filters, { vista: "todos", page: 1 })}`;
  const ccaa = data.ccaa;
  const importe =
    filters.vista === "garantia"
      ? data.meta.importeGarantia
      : filters.vista === "todos"
        ? data.meta.importeTotal
        : data.meta.importeSubvencion;
  const concesiones =
    filters.vista === "garantia"
      ? data.meta.nGarantia
      : filters.vista === "todos"
        ? data.meta.nConcesiones
        : data.meta.nSubvencion;
  const vistaLabel =
    filters.vista === "garantia"
      ? "garantías y avales"
      : filters.vista === "todos"
        ? "todos los instrumentos"
        : "subvenciones dinerarias";
  const topHeading =
    filters.vista === "garantia"
      ? "Beneficiarios con más importe en garantías"
      : filters.vista === "todos"
        ? "Beneficiarios con más importe, todos los instrumentos"
        : "Beneficiarios con más importe en subvenciones dinerarias";
  const topCaption =
    filters.vista === "garantia"
      ? "Doce beneficiarios con mayor importe en garantías"
      : filters.vista === "todos"
        ? "Doce beneficiarios con mayor importe, todos los instrumentos"
        : "Doce beneficiarios con mayor importe en subvenciones dinerarias";
  const startsIn2018 = data.anios.length > 0 && data.anios[0].anio === 2018;

  return (
    <>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <PageIntro eyebrow="Panel general" title="El mapa del dinero concedido">
          <p>
            Volcado de la BDNS entre {formatDate(data.meta.convFechaMin)} y {formatDate(data.meta.convFechaMax)}.
            Las personas físicas no están en los ficheros publicados. El sector y la comunidad autónoma se estiman
            a partir del título y del organismo.
          </p>
        </PageIntro>

        <div
          className="mb-6 inline-flex shrink-0 self-start rounded-xl border border-line bg-subtle/80 p-1"
          role="tablist"
          aria-label="Qué importes se suman"
        >
          <Link
            href={subvencionHref}
            role="tab"
            aria-selected={filters.vista === "subvencion"}
            className={tabClass(filters.vista === "subvencion")}
          >
            Solo subvenciones
          </Link>
          <Link
            href={garantiaHref}
            role="tab"
            aria-selected={filters.vista === "garantia"}
            className={tabClass(filters.vista === "garantia")}
          >
            Garantías
          </Link>
          <Link
            href={todosHref}
            role="tab"
            aria-selected={filters.vista === "todos"}
            className={tabClass(filters.vista === "todos")}
          >
            Todos los instrumentos
          </Link>
        </div>
      </div>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Resumen de cifras">
        <Kpi label="Importe" value={formatCompactEuro(importe)} hint={vistaLabel} />
        <Kpi label="Concesiones" value={formatNumber(concesiones)} hint={vistaLabel} />
        <Kpi label="Convocatorias" value={formatNumber(data.meta.nConvocatorias)} hint="Todo el volcado, no cambia con la pestaña" />
        <Kpi label="Beneficiarios" value={formatNumber(data.meta.nBeneficiarios)} hint="Todo el volcado, personas jurídicas por NIF" />
      </section>

      <p className="mt-5 rounded-xl border border-line bg-elev/70 px-4 py-3 text-sm leading-relaxed text-muted">
        Las garantías y los avales (ICO, CERSA y el resto del instrumento Garantía) no son una entrega de dinero y no
        entran en la suma de subvenciones ({formatEuro(data.meta.importeSubvencion)}, {formatNumber(data.meta.nSubvencion)}{" "}
        concesiones). Las garantías suman {formatEuro(data.meta.importeGarantia)} en {formatNumber(data.meta.nGarantia)}{" "}
        filas. El total de todos los instrumentos, ya sin contar dos veces la misma concesión, es{" "}
        <span className="font-semibold text-ink">{formatEuro(data.meta.importeTotal)}</span>.
      </p>

      <div className="mt-8 grid gap-5 xl:grid-cols-2">
        <figure className="rounded-xl border border-line bg-elev p-5 shadow-2xs">
          <figcaption className="font-display text-base font-bold tracking-tight text-ink">
            Importe por año
          </figcaption>
          <YearChart data={data.anios} />
          {startsIn2018 ? (
            <p className="mt-2 text-xs text-muted">
              Los ficheros de concesiones de este volcado empiezan en 2018, aunque las convocatorias se remontan a años
              anteriores.
            </p>
          ) : null}
          <YearTable data={data.anios} />
        </figure>
        <figure className="rounded-xl border border-line bg-elev p-5 shadow-2xs">
          <figcaption className="font-display text-base font-bold tracking-tight text-ink">
            Por territorio
          </figcaption>
          <HorizontalBars data={ccaa} />
          <DataTable data={ccaa} firstColumn="Territorio" />
        </figure>
        <figure className="rounded-xl border border-line bg-elev p-5 shadow-2xs">
          <figcaption className="font-display text-base font-bold tracking-tight text-ink">
            Mayores organismos
          </figcaption>
          <HorizontalBars data={data.organismos} />
          <DataTable data={data.organismos} firstColumn="Organismo" />
        </figure>
        <figure className="rounded-xl border border-line bg-elev p-5 shadow-2xs">
          <figcaption className="font-display text-base font-bold tracking-tight text-ink">
            Por instrumento, todo el volcado
          </figcaption>
          <HorizontalBars data={data.instrumentos} />
          <DataTable data={data.instrumentos} firstColumn="Instrumento" />
        </figure>
      </div>

      <section className="mt-8 rounded-xl border border-line bg-elev p-5 shadow-2xs">
        <div className="mb-4 flex items-baseline justify-between gap-4">
          <h2 className="font-display text-lg font-bold tracking-tight text-ink">
            {topHeading}
          </h2>
          <Link
            href="/beneficiarios"
            className="text-sm font-medium text-accent hover:text-accent-strong hover:underline underline-offset-4"
          >
            Ver todos
          </Link>
        </div>
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">{topCaption}</caption>
            <thead>
              <tr className="border-b border-line bg-subtle/70 text-left text-xs font-semibold tracking-wider text-muted uppercase">
                <th scope="col" className="px-4 py-3">Beneficiario</th>
                <th scope="col" className="px-4 py-3">Tipo</th>
                <th scope="col" className="px-4 py-3 text-right">Concesiones</th>
                <th scope="col" className="px-4 py-3 text-right">Importe</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.top.map((row) => (
                <tr key={row.id} className="transition-colors hover:bg-highlight/60">
                  <th scope="row" className="px-4 py-3 text-left font-medium">
                    <Link
                      href={`/beneficiarios/${row.id}`}
                      className="font-medium text-accent underline decoration-accent/30 underline-offset-4 transition-colors hover:text-accent-strong hover:decoration-accent"
                    >
                      {row.nombre}
                    </Link>
                    {row.nif ? (
                      <span className="mt-0.5 block font-mono text-xs font-normal text-muted">{row.nif}</span>
                    ) : null}
                  </th>
                  <td className="px-4 py-3 text-muted">{row.tipo}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-muted">{formatNumber(row.n)}</td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums text-ink">{formatEuro(row.importe)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
};

export default Panel;
