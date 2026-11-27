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
  defaultSort?: string;
};

export const DataView = <T,>({
  rows,
  columns,
  path,
  filters,
  rowKey,
  caption,
  empty = "Ningún resultado con estos filtros. Prueba a quitar algún criterio.",
  defaultSort = "fecha",
}: DataViewProps<T>) => {
  if (rows.length === 0) {
    return <EmptyState>{empty}</EmptyState>;
  }

  return (
    <>
      <div className="hidden overflow-x-auto rounded-xl border border-line bg-elev shadow-2xs md:block">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-b border-line bg-subtle/70">
              {columns.map((column) => {
                const active = column.sortKey === filters.sort;
                const nextDir = active && filters.dir === "asc" ? "desc" : "asc";
                const align = column.align === "right" ? "text-right" : "text-left";
                return (
                  <th
                    key={column.id}
                    scope="col"
                    aria-sort={active ? (filters.dir === "asc" ? "ascending" : "descending") : "none"}
                    className={cn(
                      "px-4 py-3 text-xs font-semibold tracking-wider text-muted uppercase",
                      align,
                    )}
                  >
                    {column.sortKey ? (
                      <Link
                        href={`${path}${toQuery(filters, { sort: column.sortKey, dir: nextDir, page: 1 }, defaultSort)}`}
                        className="inline-flex items-center gap-1 transition-colors hover:text-ink"
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
          <tbody className="divide-y divide-line">
            {rows.map((row) => (
              <tr key={rowKey(row)} className="align-top transition-colors hover:bg-highlight/60">
                {columns.map((column) => (
                  <td
                    key={column.id}
                    className={cn(
                      "px-4 py-3 text-ink",
                      column.align === "right" ? "text-right tabular-nums" : "",
                    )}
                  >
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
          <li key={rowKey(row)} className="rounded-xl border border-line bg-elev p-4 shadow-2xs">
            <dl className="grid gap-2.5">
              {columns.map((column) => (
                <div key={column.id}>
                  <dt className="text-[11px] font-semibold tracking-wider text-muted uppercase">
                    {column.header}
                  </dt>
                  <dd className="mt-0.5 text-sm text-ink">{column.cell(row)}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>
    </>
  );
};
