import Link from "next/link";
import { EmptyState } from "@/components/setup-needed";
import { toQuery, type Filters } from "@/lib/params";
import { cn } from "@/lib/utils";

export type Column<T> = {
  id: string;
  header: string;
  sortKey?: string;
  align?: "left" | "right";
  cell: (row: T) => React.ReactNode;
};

type DataViewProps<T> = {
  rows: T[];
  columns: Column<T>[];
  path: string;
  filters: Filters;
  rowKey: (row: T) => string;
  caption: string;
  empty?: string;
};

export const DataView = <T,>({
  rows,
  columns,
  path,
  filters,
  rowKey,
  caption,
  empty = "Ningún resultado con estos filtros. Prueba a quitar algún criterio.",
}: DataViewProps<T>) => {
  if (rows.length === 0) {
    return <EmptyState>{empty}</EmptyState>;
  }

  return (
    <>
      <div className="hidden overflow-hidden rounded-3xl border border-line bg-elev md:block">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead className="bg-sidebar text-left text-xs tracking-wide text-muted uppercase">
            <tr>
              {columns.map((column) => {
                const active = column.sortKey === filters.sort;
                const nextDir = active && filters.dir === "asc" ? "desc" : "asc";
                const align = column.align === "right" ? "text-right" : "text-left";
                return (
                  <th key={column.id} scope="col" aria-sort={active ? (filters.dir === "asc" ? "ascending" : "descending") : "none"} className={cn("px-4 py-3 font-semibold", align)}>
                    {column.sortKey ? (
                      <Link
                        href={`${path}${toQuery(filters, { sort: column.sortKey, dir: nextDir, page: 1 })}`}
                        className="inline-flex items-center gap-1 rounded hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                      >
                        {column.header}
                        {active && filters.dir === "asc" ? " ↑" : ""}
                        {active && filters.dir === "desc" ? " ↓" : ""}
                      </Link>
                    ) : (
                      column.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={rowKey(row)} className="border-t border-line align-top hover:bg-highlight/60">
                {columns.map((column) => (
                  <td key={column.id} className={cn("px-4 py-3", column.align === "right" ? "text-right tabular-nums" : "")}>
                    {column.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="grid gap-3 md:hidden">
        {rows.map((row) => (
          <li key={rowKey(row)} className="rounded-3xl border border-line bg-elev p-4">
            <dl className="grid gap-2">
              {columns.map((column) => (
                <div key={column.id}>
                  <dt className="text-xs font-semibold tracking-wide text-muted uppercase">{column.header}</dt>
                  <dd className="text-sm">{column.cell(row)}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>
    </>
  );
};
