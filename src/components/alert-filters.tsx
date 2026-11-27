import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { alertQuery, type AlertFilters } from "@/lib/alerts";
import { formatNumber } from "@/lib/format";
import { compareCcaa } from "@/lib/utils";

type AlertFilterFormProps = {
  action: string;
  filters: AlertFilters;
  ccaa: string[];
  anios: number[];
  organismos: string[];
  tipos?: { value: string; label: string }[];
  hiddenFields?: Record<string, string>;
  clearHref?: string;
};

const pagerButtonClass =
  "inline-flex h-9 items-center gap-1.5 rounded-lg border border-line-strong bg-elev px-3 text-sm font-medium text-ink transition-colors hover:bg-highlight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40";

const pagerDisabledClass =
  "inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-subtle/60 px-3 text-sm font-medium text-muted/60 cursor-not-allowed";

const gridClass = (count: number) => {
  if (count >= 4) {
    return "mt-2 grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4";
  }
  if (count === 3) {
    return "mt-2 grid gap-3.5 sm:grid-cols-3";
  }
  return "mt-2 grid gap-3.5 sm:grid-cols-2";
};

export const AlertFilterForm = ({
  action,
  filters,
  ccaa,
  anios,
  organismos,
  tipos,
  hiddenFields,
  clearHref,
}: AlertFilterFormProps) => {
  const territorios = [...ccaa].sort(compareCcaa);
  const showCcaa = territorios.length > 0;
  const showAnios = anios.length > 0;
  const showTipos = Boolean(tipos && tipos.length > 0);
  const fieldCount = (showCcaa ? 1 : 0) + (showAnios ? 1 : 0) + 1 + (showTipos ? 1 : 0);
  const hasActiveFilter = Boolean(
    filters.ccaa || filters.anio || filters.organismo || (showTipos && filters.tipo),
  );
  const resetHref = clearHref ?? action;

  return (
    <form action={action} method="get" className="mb-5">
      {hiddenFields
        ? Object.entries(hiddenFields).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))
        : null}
      <fieldset className="rounded-xl border border-line bg-elev p-4 shadow-2xs sm:p-5">
        <legend className="px-1.5 text-xs font-semibold tracking-wider text-muted uppercase">
          Filtros
        </legend>
        <div className={gridClass(fieldCount)}>
          {showCcaa ? (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="alerta-ccaa" className="text-xs font-medium text-muted">
                Territorio
              </label>
              <Select id="alerta-ccaa" name="ccaa" defaultValue={filters.ccaa}>
                <option value="">Cualquier territorio</option>
                {territorios.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </Select>
            </div>
          ) : null}
          {showAnios ? (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="alerta-anio" className="text-xs font-medium text-muted">
                Año
              </label>
              <Select id="alerta-anio" name="anio" defaultValue={filters.anio}>
                <option value="">Cualquier año</option>
                {anios.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </Select>
            </div>
          ) : null}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="alerta-organismo" className="text-xs font-medium text-muted">
              Organismo
            </label>
            <Input
              id="alerta-organismo"
              name="organismo"
              list="alerta-organismos"
              defaultValue={filters.organismo}
              placeholder="Empieza a escribir el nombre"
              autoComplete="off"
            />
          </div>
          {showTipos && tipos ? (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="alerta-tipo" className="text-xs font-medium text-muted">
                Señal
              </label>
              <Select id="alerta-tipo" name="tipo" defaultValue={filters.tipo}>
                <option value="">Cualquier señal</option>
                {tipos.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </Select>
            </div>
          ) : null}
        </div>
        {organismos.length > 0 ? (
          <datalist id="alerta-organismos">
            {organismos.map((nombre) => (
              <option key={nombre} value={nombre} />
            ))}
          </datalist>
        ) : null}
        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-3.5">
          <Button type="submit" size="sm">
            Aplicar filtros
          </Button>
          {hasActiveFilter ? (
            <a
              href={resetHref}
              className="inline-flex h-8 items-center rounded-lg px-3 text-xs font-medium text-muted transition-colors hover:bg-highlight hover:text-ink"
            >
              Limpiar filtros
            </a>
          ) : null}
        </div>
      </fieldset>
    </form>
  );
};

export const AlertPager = ({
  path,
  filters,
  total,
  pageSize,
  field = "page",
  extraParams,
}: {
  path: string;
  filters: AlertFilters;
  total: number;
  pageSize: number;
  field?: "page" | "pagina";
  extraParams?: Record<string, string>;
}) => {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(field === "pagina" ? filters.pagina : filters.page, pages);
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);

  const buildHref = (targetPage: number) => {
    const patch = field === "pagina" ? { pagina: targetPage } : { page: targetPage };
    const baseQuery = alertQuery(filters, patch);
    if (!extraParams || Object.keys(extraParams).length === 0) {
      return `${path}${baseQuery}`;
    }
    const params = new URLSearchParams(baseQuery.startsWith("?") ? baseQuery.slice(1) : baseQuery);
    for (const [key, value] of Object.entries(extraParams)) {
      params.set(key, value);
    }
    return `${path}?${params.toString()}`;
  };

  const previousHref = page > 1 ? buildHref(page - 1) : null;
  const nextHref = page < pages ? buildHref(page + 1) : null;

  return (
    <nav
      aria-label="Paginación de alertas"
      className="mt-6 flex flex-col gap-3 border-t border-line pt-4 sm:flex-row sm:items-center sm:justify-between"
    >
      <p className="text-sm text-muted tabular-nums">
        Mostrando {formatNumber(from)}–{formatNumber(to)} de {formatNumber(total)}
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
