import { formatCompactEuro, formatEuro, formatNumber, shorten } from "@/lib/format";

type Point = { label: string; n: number; importe: number };
type YearPoint = { anio: number; n: number; importe: number };

const maxImporte = (rows: { importe: number }[]) =>
  rows.reduce((highest, row) => (row.importe > highest ? row.importe : highest), 0);

export const YearChart = ({ data }: { data: YearPoint[] }) => {
  const highest = maxImporte(data);
  if (data.length === 0 || highest <= 0) {
    return <p className="text-sm text-muted">Sin importes en este periodo.</p>;
  }

  return (
    <div className="flex h-72 items-end gap-2" role="img" aria-label="Importe concedido por año">
      {data.map((item) => {
        const height = Math.max(6, Math.round((item.importe / highest) * 100));
        return (
          <div key={item.anio} className="flex h-full min-w-0 flex-1 flex-col justify-end gap-1">
            <span className="truncate text-center text-[11px] text-muted tabular-nums">{formatCompactEuro(item.importe)}</span>
            <div className="flex min-h-0 flex-1 items-end">
              <div className="xp-column w-full" style={{ height: `${height}%` }} />
            </div>
            <span className="text-center text-xs font-semibold text-ink">{item.anio}</span>
          </div>
        );
      })}
    </div>
  );
};

export const HorizontalBars = ({ data }: { data: Point[] }) => {
  const highest = maxImporte(data);
  if (data.length === 0 || highest <= 0) {
    return <p className="text-sm text-muted">Sin importes para esta vista.</p>;
  }

  return (
    <ul className="grid gap-3">
      {data.map((item) => {
        const width = Math.max(2, Math.round((item.importe / highest) * 100));
        return (
          <li key={item.label}>
            <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 truncate text-ink" title={item.label}>
                {shorten(item.label, 52)}
              </span>
              <span className="shrink-0 tabular-nums text-muted">{formatCompactEuro(item.importe)}</span>
            </div>
            <div className="xp-progress">
              <span style={{ width: `${width}%` }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
};

export const DataTable = ({ data, firstColumn }: { data: Point[]; firstColumn: string }) => (
  <details className="mt-3">
    <summary className="xp-link cursor-pointer font-normal">Tabla de datos</summary>
    <div className="xp-table-frame mt-2">
      <table className="xp-table">
        <thead>
          <tr className="text-left text-muted">
            <th scope="col" className="py-1 pr-3 font-semibold">
              {firstColumn}
            </th>
            <th scope="col" className="py-1 pr-3 text-right font-semibold">
              Concesiones
            </th>
            <th scope="col" className="py-1 text-right font-semibold">
              Importe
            </th>
          </tr>
        </thead>
        <tbody>
          {data.map((row) => (
            <tr key={row.label} className="border-t border-line">
              <th scope="row" className="py-1.5 pr-3 text-left font-medium">
                {row.label}
              </th>
              <td className="py-1.5 pr-3 text-right tabular-nums">{formatNumber(row.n)}</td>
              <td className="py-1.5 text-right tabular-nums">{formatEuro(row.importe)}</td>
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
