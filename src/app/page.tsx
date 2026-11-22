import Link from "next/link";
import { DataTable, HorizontalBars, YearChart, YearTable } from "@/components/dashboard-charts";
import { Kpi } from "@/components/facts";
import { PageIntro, SetupNeeded } from "@/components/setup-needed";
import { guard } from "@/lib/db";
import { formatCompactEuro, formatDate, formatEuro, formatNumber } from "@/lib/format";
import { parseFilters, toQuery, type SearchParams } from "@/lib/params";
import { getDashboard } from "@/lib/queries";

const Panel = async ({ searchParams }: { searchParams: Promise<SearchParams> }) => {
  const filters = parseFilters(await searchParams);
  const data = await guard(() => getDashboard(filters.vista));
  if (data === "missing") {
    return <SetupNeeded />;
  }

  const subvencionHref = `/${toQuery(filters, { vista: "subvencion", page: 1 })}`;
  const todosHref = `/${toQuery(filters, { vista: "todos", page: 1 })}`;
  const ccaa = data.ccaa;
  const importe = filters.vista === "subvencion" ? data.meta.importeSubvencion : data.meta.importeTotal;
  const concesiones = filters.vista === "subvencion" ? data.meta.nSubvencion : data.meta.nConcesiones;
  const vistaLabel = filters.vista === "subvencion" ? "subvenciones dinerarias" : "todos los instrumentos";

  return (
    <>
      <PageIntro eyebrow="Panel" title="El mapa del dinero concedido">
        <p>
          Volcado de la BDNS entre {formatDate(data.meta.convFechaMin)} y {formatDate(data.meta.convFechaMax)}.
          Las personas físicas no están en los ficheros publicados. El sector y la comunidad autónoma se estiman
          a partir del título y del organismo.
        </p>
      </PageIntro>
      <div className="mb-6 flex flex-wrap gap-2" role="group" aria-label="Qué importes se suman">
        <Link
          href={subvencionHref}
          aria-current={filters.vista === "subvencion" ? "page" : undefined}
          className={filters.vista === "subvencion" ? "rounded-full bg-accent px-4 py-2 text-sm font-semibold text-accent-ink" : "rounded-full border border-line bg-elev px-4 py-2 text-sm font-semibold"}
        >
          Solo subvenciones
        </Link>
        <Link
          href={todosHref}
          aria-current={filters.vista === "todos" ? "page" : undefined}
          className={filters.vista === "todos" ? "rounded-full bg-accent px-4 py-2 text-sm font-semibold text-accent-ink" : "rounded-full border border-line bg-elev px-4 py-2 text-sm font-semibold"}
        >
          Todos los instrumentos
        </Link>
      </div>
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Importe" value={formatCompactEuro(importe)} hint={vistaLabel} />
        <Kpi label="Concesiones" value={formatNumber(concesiones)} hint={vistaLabel} />
        <Kpi label="Convocatorias" value={formatNumber(data.meta.nConvocatorias)} hint="En el volcado completo" />
        <Kpi label="Beneficiarios" value={formatNumber(data.meta.nBeneficiarios)} hint="Personas jurídicas, agrupadas por NIF" />
      </section>
      <p className="mt-4 max-w-3xl text-sm leading-relaxed text-muted">
        Las garantías y los préstamos no son una entrega de dinero. Por eso el panel abre en subvenciones dinerarias
        ({formatEuro(data.meta.importeSubvencion)}). El total de todos los instrumentos es {formatEuro(data.meta.importeTotal)}.
      </p>
      <div className="mt-8 grid gap-4 xl:grid-cols-2">
        <figure className="rounded-3xl border border-line bg-elev p-4">
          <figcaption className="mb-2 font-display text-2xl">Importe por año</figcaption>
          <YearChart data={data.anios} />
          <YearTable data={data.anios} />
        </figure>
        <figure className="rounded-3xl border border-line bg-elev p-4">
          <figcaption className="mb-2 font-display text-2xl">Por territorio</figcaption>
          <HorizontalBars data={ccaa} />
          <DataTable data={ccaa} firstColumn="Territorio" />
        </figure>
        <figure className="rounded-3xl border border-line bg-elev p-4">
          <figcaption className="mb-2 font-display text-2xl">Mayores organismos</figcaption>
          <HorizontalBars data={data.organismos} />
          <DataTable data={data.organismos} firstColumn="Organismo" />
        </figure>
        <figure className="rounded-3xl border border-line bg-elev p-4">
          <figcaption className="mb-2 font-display text-2xl">Por instrumento, todo el volcado</figcaption>
          <HorizontalBars data={data.instrumentos} />
          <DataTable data={data.instrumentos} firstColumn="Instrumento" />
        </figure>
      </div>
      <section className="mt-4 rounded-3xl border border-line bg-elev p-4">
        <h2 className="font-display text-2xl">Beneficiarios con más importe</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Doce beneficiarios con mayor importe en la vista seleccionada</caption>
            <thead>
              <tr className="text-left text-xs tracking-wide text-muted uppercase">
                <th scope="col" className="py-2 pr-3">Beneficiario</th>
                <th scope="col" className="py-2 pr-3">Tipo</th>
                <th scope="col" className="py-2 pr-3 text-right">Concesiones</th>
                <th scope="col" className="py-2 text-right">Importe</th>
              </tr>
            </thead>
            <tbody>
              {data.top.map((row) => (
                <tr key={row.id} className="border-t border-line">
                  <th scope="row" className="py-2 pr-3 text-left font-semibold">
                    <Link href={`/beneficiarios/${row.id}`} className="underline decoration-line underline-offset-2 hover:decoration-accent">
                      {row.nombre}
                    </Link>
                    {row.nif ? <span className="mt-0.5 block font-mono text-xs font-normal text-muted">{row.nif}</span> : null}
                  </th>
                  <td className="py-2 pr-3">{row.tipo}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{formatNumber(row.n)}</td>
                  <td className="py-2 text-right tabular-nums">{formatEuro(row.importe)}</td>
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
