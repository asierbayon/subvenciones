import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { formatNumber } from "@/lib/format";
import { toQuery, type Filters } from "@/lib/params";

type PaginationBarProps = {
  path: string;
  filters: Filters;
  total: number;
  pageSize: number;
};

const pagerButtonClass =
  "inline-flex h-9 items-center gap-1.5 rounded-lg border border-line-strong bg-elev px-3 text-sm font-medium text-ink transition-colors hover:bg-highlight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40";

const pagerDisabledClass =
  "inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-subtle/60 px-3 text-sm font-medium text-muted/60 cursor-not-allowed";

export const PaginationBar = ({ path, filters, total, pageSize }: PaginationBarProps) => {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(filters.page, pages);
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const previousHref = page > 1 ? `${path}${toQuery(filters, { page: page - 1 })}` : null;
  const nextHref = page < pages ? `${path}${toQuery(filters, { page: page + 1 })}` : null;
  const capped = page >= 400 && total > page * pageSize;

  return (
    <nav
      aria-label="Paginación"
      className="mt-6 flex flex-col gap-3 border-t border-line pt-4 sm:flex-row sm:items-center sm:justify-between"
    >
      <p className="text-sm text-muted tabular-nums">
        Mostrando {formatNumber(from)}–{formatNumber(to)} de {formatNumber(total)}
        {capped ? " · Acota los filtros para pasar de la página 400." : ""}
      </p>
      <div className="flex items-center gap-2">
        {previousHref ? (
          <Link href={previousHref} className={pagerButtonClass}>
            <ChevronLeft aria-hidden="true" size={15} />
            Anterior
          </Link>
        ) : (
          <span className={pagerDisabledClass} aria-disabled="true">
            <ChevronLeft aria-hidden="true" size={15} />
            Anterior
          </span>
        )}
        <span className="px-2.5 text-sm font-medium text-muted tabular-nums">
          {formatNumber(page)} / {formatNumber(pages)}
        </span>
        {nextHref ? (
          <Link href={nextHref} className={pagerButtonClass}>
            Siguiente
            <ChevronRight aria-hidden="true" size={15} />
          </Link>
        ) : (
          <span className={pagerDisabledClass} aria-disabled="true">
            Siguiente
            <ChevronRight aria-hidden="true" size={15} />
          </span>
        )}
      </div>
    </nav>
  );
};
