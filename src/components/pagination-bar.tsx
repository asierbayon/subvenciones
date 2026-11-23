import Link from "next/link";
import { formatNumber } from "@/lib/format";
import { toQuery, type Filters } from "@/lib/params";

type PaginationBarProps = {
  path: string;
  filters: Filters;
  total: number;
  pageSize: number;
};

export const PaginationBar = ({ path, filters, total, pageSize }: PaginationBarProps) => {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(filters.page, pages);
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const previousHref = page > 1 ? `${path}${toQuery(filters, { page: page - 1 })}` : null;
  const nextHref = page < pages ? `${path}${toQuery(filters, { page: page + 1 })}` : null;
  const capped = page >= 400 && total > page * pageSize;

  return (
    <nav aria-label="Paginación" className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-muted">
        {formatNumber(from)}–{formatNumber(to)} de {formatNumber(total)}
        {capped ? " · Acota los filtros para pasar de la página 400." : ""}
      </p>
      <div className="flex gap-2">
        {previousHref ? (
          <Link href={previousHref} className="xp-button">
            Anterior
          </Link>
        ) : (
          <span className="xp-button" aria-disabled="true">Anterior</span>
        )}
        <span className="px-2 py-2 text-sm text-muted">
          {formatNumber(page)} / {formatNumber(pages)}
        </span>
        {nextHref ? (
          <Link href={nextHref} className="xp-button">
            Siguiente
          </Link>
        ) : (
          <span className="xp-button" aria-disabled="true">Siguiente</span>
        )}
      </div>
    </nav>
  );
};
