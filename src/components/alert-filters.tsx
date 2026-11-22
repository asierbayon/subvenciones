import Link from "next/link";
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
};

export const AlertFilterForm = ({ action, filters, ccaa, anios, organismos }: AlertFilterFormProps) => {
  const territorios = [...ccaa].sort(compareCcaa);
  return (
    <form action={action} method="get" className="mb-6 rounded-3xl border border-line bg-elev p-4">
      <div className="grid gap-3 md:grid-cols-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="alerta-ccaa" className="text-xs font-semibold tracking-wide text-muted uppercase">
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
        <div className="flex flex-col gap-1">
          <label htmlFor="alerta-anio" className="text-xs font-semibold tracking-wide text-muted uppercase">
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
        <div className="flex flex-col gap-1">
          <label htmlFor="alerta-organismo" className="text-xs font-semibold tracking-wide text-muted uppercase">
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
      </div>
      <datalist id="alerta-organismos">
        {organismos.map((nombre) => (
          <option key={nombre} value={nombre} />
        ))}
      </datalist>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button type="submit">Aplicar filtros</Button>
        <a href={action} className="text-sm font-semibold text-muted underline-offset-2 hover:text-ink hover:underline">
          Limpiar
        </a>
      </div>
    </form>
  );
};

export const AlertPager = ({
  path,
  filters,
  total,
  pageSize,
  field = "page",
}: {
  path: string;
  filters: AlertFilters;
  total: number;
  pageSize: number;
  field?: "page" | "pagina";
}) => {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(field === "pagina" ? filters.pagina : filters.page, pages);
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const previousPatch = field === "pagina" ? { pagina: page - 1 } : { page: page - 1 };
  const nextPatch = field === "pagina" ? { pagina: page + 1 } : { page: page + 1 };
  const previousHref = page > 1 ? `${path}${alertQuery(filters, previousPatch)}` : null;
  const nextHref = page < pages ? `${path}${alertQuery(filters, nextPatch)}` : null;
  return (
    <nav aria-label="Paginación de alertas" className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-muted">
        {formatNumber(from)}–{formatNumber(to)} de {formatNumber(total)}
      </p>
      <div className="flex gap-2">
        {previousHref ? (
          <Link href={previousHref} className="rounded-full border border-line bg-elev px-4 py-2 text-sm font-semibold hover:bg-highlight">
            Anterior
          </Link>
        ) : (
          <span className="rounded-full border border-line px-4 py-2 text-sm text-muted">Anterior</span>
        )}
        <span className="px-2 py-2 text-sm text-muted">
          {formatNumber(page)} / {formatNumber(pages)}
        </span>
        {nextHref ? (
          <Link href={nextHref} className="rounded-full border border-line bg-elev px-4 py-2 text-sm font-semibold hover:bg-highlight">
            Siguiente
          </Link>
        ) : (
          <span className="rounded-full border border-line px-4 py-2 text-sm text-muted">Siguiente</span>
        )}
      </div>
    </nav>
  );
};
