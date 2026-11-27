import { formatCompactEuro, formatEuro, formatNumber, shorten } from "@/lib/format";

type Point = { label: string; n: number; importe: number };
type YearPoint = { anio: number; n: number; importe: number };

const PARTIAL_YEAR = 2022;

const maxImporte = (rows: { importe: number }[]) =>
  rows.reduce((highest, row) => (row.importe > highest ? row.importe : highest), 0);

const yearTick = (anio: number) => {
  if (anio !== PARTIAL_YEAR) {
    return <span className="text-center text-xs font-semibold text-ink tabular-nums">{anio}</span>;
  }
  return (
    <span className="text-center text-xs font-semibold text-ink tabular-nums">
      {anio}
      <abbr title="Parcial: el volcado de concesiones termina en marzo de 2022" className="text-muted no-underline">
        *
      </abbr>
    </span>
  );
};

export const YearChart = ({ data }: { data: YearPoint[] }) => {
  const highest = maxImporte(data);
  if (data.length === 0 || highest <= 0) {
    return <p className="text-sm text-muted">Sin importes en este periodo.</p>;
  }
  const showsPartialYear = data.some((item) => item.anio === PARTIAL_YEAR);

  return (
    <>
      <div
        className="mt-4 flex h-64 items-end gap-3 border-b border-line pb-3"
        role="img"
        aria-label={
          showsPartialYear
            ? "Importe concedido por año. 2022 es parcial porque el volcado termina en marzo."
            : "Importe concedido por año"
        }
      >
        {data.map((item) => {
          const height = Math.max(6, Math.round((item.importe / highest) * 100));
          return (
            <div key={item.anio} className="group flex h-full min-w-0 flex-1 flex-col justify-end gap-1.5">
              <span className="truncate text-center text-[11px] font-medium text-muted tabular-nums">
                {formatCompactEuro(item.importe)}
              </span>
              <div className="flex min-h-0 flex-1 items-end">
                <div
                  className="w-full rounded-t-md bg-accent/85 transition-colors group-hover:bg-accent"
                  style={{ height: `${height}%` }}
                />
              </div>
              {yearTick(item.anio)}
            </div>
          );
        })}
      </div>
      {showsPartialYear ? (
        <p className="mt-2 text-xs text-muted">* 2022 es parcial: el volcado de concesiones termina en marzo.</p>
      ) : null}
    </>
  );
};

export const HorizontalBars = ({ data }: { data: Point[] }) => {
  const highest = maxImporte(data);
  if (data.length === 0 || highest <= 0) {
    return <p className="text-sm text-muted">Sin importes para esta vista.</p>;
  }

  return (
    <ul className="mt-4 grid gap-3.5">
      {data.map((item) => {
        const width = Math.max(2, Math.round((item.importe / highest) * 100));
        return (
          <li key={item.label}>
            <div className="mb-1.5 flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 truncate font-medium text-ink" title={item.label}>
                {shorten(item.label, 52)}
              </span>
              <span className="shrink-0 text-xs font-semibold tabular-nums text-muted">
                {formatCompactEuro(item.importe)}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-subtle">
              <span
                className="block h-full rounded-full bg-accent/85"
                style={{ width: `${width}%` }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
};

export const DataTable = ({ data, firstColumn }: { data: Point[]; firstColumn: string }) => (
  <details className="mt-4">
    <summary className="cursor-pointer text-xs font-semibold text-accent hover:text-accent-strong hover:underline underline-offset-4">
      Ver tabla de datos
    </summary>
    <div className="mt-3 overflow-x-auto rounded-lg border border-line">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-line bg-subtle/70 text-left text-xs font-semibold text-muted">
            <th scope="col" className="px-3 py-2">
              {firstColumn}
            </th>
            <th scope="col" className="px-3 py-2 text-right">
              Concesiones
            </th>
            <th scope="col" className="px-3 py-2 text-right">
              Importe
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {data.map((row) => (
            <tr key={row.label} className="transition-colors hover:bg-highlight/50">
              <th scope="row" className="px-3 py-2 text-left font-medium text-ink">
                {row.label}
              </th>
              <td className="px-3 py-2 text-right tabular-nums text-muted">{formatNumber(row.n)}</td>
              <td className="px-3 py-2 text-right font-medium tabular-nums text-ink">{formatEuro(row.importe)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </details>
);

export const YearTable = ({ data }: { data: YearPoint[] }) => (
  <DataTable
    firstColumn="Año"
    data={data.map((row) => ({ label: String(row.anio), n: row.n, importe: row.importe }))}
  />
);
