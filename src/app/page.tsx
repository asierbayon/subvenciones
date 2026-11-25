import Link from "next/link";
import { DataTable, HorizontalBars, YearChart, YearTable } from "@/components/dashboard-charts";
import { Kpi } from "@/components/facts";
import { PageIntro, SetupNeeded } from "@/components/setup-needed";
import { guard } from "@/lib/db";
import { formatCompactEuro, formatDate, formatEuro, formatNumber } from "@/lib/format";
import { parseFilters, toQuery, type SearchParams } from "@/lib/params";
import { getDashboard } from "@/lib/queries";

const tabClass = (active: boolean) => {
  if (active) {
    return "xp-tab xp-tab-active";
  }
  return "xp-tab";
};

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

  return (
    <>
      <PageIntro eyebrow="Panel" title="El mapa del dinero concedido">
        <p>
          Volcado de la BDNS entre {formatDate(data.meta.convFechaMin)} y {formatDate(data.meta.convFechaMax)}.
          Las personas físicas no están en los ficheros publicados. El sector y la comunidad autónoma se estiman
          a partir del título y del organismo.
        </p>
      </PageIntro>
      <div className="xp-tabs" role="tablist" aria-label="Qué importes se suman">
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
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Importe" value={formatCompactEuro(importe)} hint={vistaLabel} />
        <Kpi label="Concesiones" value={formatNumber(concesiones)} hint={vistaLabel} />
        <Kpi label="Convocatorias" value={formatNumber(data.meta.nConvocatorias)} hint="En el volcado completo" />
        <Kpi label="Beneficiarios" value={formatNumber(data.meta.nBeneficiarios)} hint="Personas jurídicas, agrupadas por NIF" />
      </section>
      <p className="mt-4 max-w-3xl text-sm leading-relaxed text-muted">
        Las garantías y los avales (ICO, CERSA y el resto del instrumento Garantía) no son una entrega de dinero y no
        entran en la suma de subvenciones ({formatEuro(data.meta.importeSubvencion)}, {formatNumber(data.meta.nSubvencion)}{" "}
        concesiones). Las garantías suman {formatEuro(data.meta.importeGarantia)} en {formatNumber(data.meta.nGarantia)}{" "}
        filas. El total de todos los instrumentos, ya sin contar dos veces la misma concesión, es{" "}
        {formatEuro(data.meta.importeTotal)}.
      </p>
      <div className="mt-8 grid gap-4 xl:grid-cols-2">
        <figure className="xp-group">
          <figcaption className="xp-heading">Importe por año</figcaption>
          <YearChart data={data.anios} />
          <YearTable data={data.anios} />
        </figure>
        <figure className="xp-group">
          <figcaption className="xp-heading">Por territorio</figcaption>
          <HorizontalBars data={ccaa} />
          <DataTable data={ccaa} firstColumn="Territorio" />
        </figure>
        <figure className="xp-group">
          <figcaption className="xp-heading">Mayores organismos</figcaption>
          <HorizontalBars data={data.organismos} />
          <DataTable data={data.organismos} firstColumn="Organismo" />
        </figure>
        <figure className="xp-group">
          <figcaption className="xp-heading">Por instrumento, todo el volcado</figcaption>
          <HorizontalBars data={data.instrumentos} />
          <DataTable data={data.instrumentos} firstColumn="Instrumento" />
        </figure>
      </div>
      <section className="xp-group">
        <h2 className="xp-heading">Beneficiarios con más importe</h2>
        <div className="xp-table-frame mt-3">
          <table className="xp-table">
            <caption className="sr-only">Doce beneficiarios con mayor importe en la vista seleccionada</caption>
            <thead>
              <tr>
                <th scope="col">Beneficiario</th>
                <th scope="col">Tipo</th>
                <th scope="col" className="text-right">Concesiones</th>
                <th scope="col" className="text-right">Importe</th>
              </tr>
            </thead>
            <tbody>
              {data.top.map((row) => (
                <tr key={row.id}>
                  <th scope="row" className="text-left">
                    <Link href={`/beneficiarios/${row.id}`}>
                      {row.nombre}
                    </Link>
                    {row.nif ? <span className="mt-0.5 block font-mono text-xs font-normal text-muted">{row.nif}</span> : null}
                  </th>
                  <td>{row.tipo}</td>
                  <td className="text-right tabular-nums">{formatNumber(row.n)}</td>
                  <td className="text-right tabular-nums">{formatEuro(row.importe)}</td>
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
