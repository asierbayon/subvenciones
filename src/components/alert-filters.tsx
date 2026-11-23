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
  tipos?: { value: string; label: string }[];
};

export const AlertFilterForm = ({ action, filters, ccaa, anios, organismos, tipos }: AlertFilterFormProps) => {
  const territorios = [...ccaa].sort(compareCcaa);
  return (
    <form action={action} method="get" className="mb-4">
      <fieldset className="xp-group">
      <legend>Filtros</legend>
      <div className={tipos ? "grid gap-3 md:grid-cols-4" : "grid gap-3 md:grid-cols-3"}>
        <div className="xp-field">
          <label htmlFor="alerta-ccaa">
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
        {anios.length > 0 ? (
          <div className="xp-field">
            <label htmlFor="alerta-anio">
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
        <div className="xp-field">
          <label htmlFor="alerta-organismo">
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
        {tipos ? (
          <div className="xp-field">
            <label htmlFor="alerta-tipo">
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
      <datalist id="alerta-organismos">
        {organismos.map((nombre) => (
          <option key={nombre} value={nombre} />
        ))}
      </datalist>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button type="submit">Aplicar filtros</Button>
        <a href={action} className="xp-link font-normal">
          Limpiar
        </a>
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
