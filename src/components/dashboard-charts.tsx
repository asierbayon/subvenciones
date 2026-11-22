"use client";

import { useTheme } from "next-themes";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatCompactEuro, formatEuro, formatNumber, shorten } from "@/lib/format";

type Point = { label: string; n: number; importe: number };
type YearPoint = { anio: number; n: number; importe: number };

const usePalette = () => {
  const { resolvedTheme } = useTheme();
  if (resolvedTheme === "dark") {
    return { ink: "#f4eee4", muted: "#c3b8a6", accent: "#8fd8b8", grid: "#31403a", panel: "#1c2420" };
  }
  return { ink: "#1c1915", muted: "#5c564c", accent: "#0e6b56", grid: "#e4d9c8", panel: "#fffdf8" };
};

const EuroTooltip = ({
  active,
  label,
  payload,
}: {
  active?: boolean;
  label?: string | number;
  payload?: ReadonlyArray<{ value?: number | string }>;
}) => {
  if (!active || !payload || payload.length === 0) {
    return null;
  }
  const value = Number(payload[0]?.value ?? 0);
  return (
    <div className="rounded-xl border border-line bg-elev px-3 py-2 text-sm shadow-sm">
      <p className="font-semibold text-ink">{label}</p>
      <p className="text-muted">{formatEuro(value)}</p>
    </div>
  );
};

export const YearChart = ({ data }: { data: YearPoint[] }) => {
  const palette = usePalette();
  return (
    <div className="h-72 w-full" aria-hidden="true">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={palette.grid} vertical={false} />
          <XAxis dataKey="anio" tick={{ fill: palette.muted, fontSize: 12 }} tickFormatter={(value) => String(value)} />
          <YAxis tick={{ fill: palette.muted, fontSize: 12 }} tickFormatter={(value) => formatCompactEuro(Number(value))} width={72} />
          <Tooltip content={<EuroTooltip />} cursor={{ fill: palette.grid }} />
          <Bar dataKey="importe" fill={palette.accent} radius={[6, 6, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
};

export const HorizontalBars = ({ data }: { data: Point[] }) => {
  const palette = usePalette();
  const rows = data.map((item) => ({ ...item, short: shorten(item.label, 36) }));
  return (
    <div className="h-96 w-full" aria-hidden="true">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
          <CartesianGrid stroke={palette.grid} horizontal={false} />
          <XAxis type="number" tick={{ fill: palette.muted, fontSize: 12 }} tickFormatter={(value) => formatCompactEuro(Number(value))} />
          <YAxis type="category" dataKey="short" width={150} tick={{ fill: palette.ink, fontSize: 12 }} />
          <Tooltip content={<EuroTooltip />} cursor={{ fill: palette.grid }} />
          <Bar dataKey="importe" name="Importe" fill={palette.accent} radius={[0, 6, 6, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
};

export const DataTable = ({ data, firstColumn }: { data: Point[]; firstColumn: string }) => (
  <details className="mt-3">
    <summary className="cursor-pointer text-sm font-semibold text-accent">Tabla de datos</summary>
    <div className="mt-2 overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-muted">
            <th scope="col" className="py-1 pr-3 font-semibold">{firstColumn}</th>
            <th scope="col" className="py-1 pr-3 text-right font-semibold">Concesiones</th>
            <th scope="col" className="py-1 text-right font-semibold">Importe</th>
          </tr>
        </thead>
        <tbody>
          {data.map((row) => (
            <tr key={row.label} className="border-t border-line">
              <th scope="row" className="py-1.5 pr-3 text-left font-medium">{row.label}</th>
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
