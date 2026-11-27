import { CleanGetForm } from "@/components/clean-get-form";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import type { Filters } from "@/lib/params";
import type { Facets } from "@/lib/queries";
import { compareCcaa } from "@/lib/utils";

type FilterFormProps = {
  action: string;
  filters: Filters;
  facets: Facets;
  showQuery?: boolean;
  showCcaa?: boolean;
  showSector?: boolean;
  showTipo?: boolean;
  showInstrumento?: boolean;
  showOrganismo?: boolean;
  showFechas?: boolean;
  showImporte?: boolean;
  showMrr?: boolean;
  importeHint?: string;
  extraHidden?: Record<string, string>;
  defaultSort?: string;
};

const Field = ({ id, label, children }: { id: string; label: string; children: React.ReactNode }) => (
  <div className="flex flex-col gap-1.5">
    <label htmlFor={id} className="text-xs font-medium text-muted">
      {label}
    </label>
    {children}
  </div>
);

export const FilterForm = ({
  action,
  filters,
  facets,
  showQuery = true,
  showCcaa = true,
  showSector = true,
  showTipo = false,
  showInstrumento = false,
  showOrganismo = true,
  showFechas = true,
  showImporte = true,
  showMrr = false,
  importeHint = "Importe",
  extraHidden,
  defaultSort = "fecha",
}: FilterFormProps) => {
  const territorios = [...facets.ccaa].sort(compareCcaa);
  const keepsSort = filters.sort !== defaultSort;
  const keepsAscending = filters.dir === "asc";

  return (
    <CleanGetForm action={action} className="mb-6" omitValues={{ sort: defaultSort, dir: "desc" }}>
      {keepsSort ? <input type="hidden" name="sort" value={filters.sort} /> : null}
      {keepsAscending ? <input type="hidden" name="dir" value={filters.dir} /> : null}
      {Object.entries(extraHidden ?? {}).map(([key, value]) => (
        <input key={key} type="hidden" name={key} value={value} />
      ))}
      <fieldset className="rounded-xl border border-line bg-elev p-5 shadow-2xs">
        <legend className="px-1.5 text-xs font-semibold tracking-wider text-muted uppercase">
          Filtros
        </legend>
        <div className="mt-2 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {showQuery ? (
            <Field id="q-filtro" label="Texto">
              <Input id="q-filtro" name="q" defaultValue={filters.q} placeholder="Título, organismo o NIF" />
            </Field>
          ) : null}
          {showCcaa ? (
            <Field id="ccaa" label="Territorio">
              <Select id="ccaa" name="ccaa" defaultValue={filters.ccaa}>
                <option value="">Cualquier territorio</option>
                {territorios.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          {showSector ? (
            <Field id="sector" label="Sector estimado">
              <Select id="sector" name="sector" defaultValue={filters.sector}>
                <option value="">Cualquier sector</option>
                {facets.sectores.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          {showTipo ? (
            <Field id="tipo" label="Tipo de beneficiario">
              <Select id="tipo" name="tipo" defaultValue={filters.tipo}>
                <option value="">Cualquier tipo</option>
                {facets.tipos.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          {showInstrumento ? (
            <Field id="instrumento" label="Instrumento">
              <Select id="instrumento" name="instrumento" defaultValue={filters.instrumento}>
                <option value="">Cualquier instrumento</option>
                {facets.instrumentos.map((item) => (
                  <option key={item.slug} value={item.slug}>
                    {item.label}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          {showOrganismo ? (
            <Field id="organismo" label="Organismo">
              <Input
                id="organismo"
                name="organismo"
                list="organismos"
                defaultValue={filters.organismo}
                placeholder="Empieza a escribir el nombre"
                autoComplete="off"
              />
            </Field>
          ) : null}
          {showFechas ? (
            <Field id="desde" label="Desde">
              <Input id="desde" name="desde" type="date" defaultValue={filters.desde} />
            </Field>
          ) : null}
          {showFechas ? (
            <Field id="hasta" label="Hasta">
              <Input id="hasta" name="hasta" type="date" defaultValue={filters.hasta} />
            </Field>
          ) : null}
          {showImporte ? (
            <Field id="min" label={`${importeHint} mínimo (€)`}>
              <Input id="min" name="min" inputMode="decimal" defaultValue={filters.importeMin} placeholder="0" />
            </Field>
          ) : null}
          {showImporte ? (
            <Field id="max" label={`${importeHint} máximo (€)`}>
              <Input id="max" name="max" inputMode="decimal" defaultValue={filters.importeMax} placeholder="Sin tope" />
            </Field>
          ) : null}
        </div>
        <datalist id="organismos">
          {facets.organismos.map((nombre) => (
            <option key={nombre} value={nombre} />
          ))}
        </datalist>
        <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-line pt-4">
          {showMrr ? (
            <label className="mr-2 inline-flex cursor-pointer items-center gap-2 text-sm text-ink" htmlFor="mrr">
              <input
                id="mrr"
                name="mrr"
                value="1"
                type="checkbox"
                defaultChecked={filters.mrr}
                className="size-4 rounded border-line-strong accent-accent"
              />
              Solo convocatorias MRR
            </label>
          ) : null}
          <Button type="submit">Aplicar filtros</Button>
          <a
            href={action}
            className="inline-flex h-9 items-center rounded-lg px-3 text-sm font-medium text-muted transition-colors hover:bg-highlight hover:text-ink"
          >
            Limpiar
          </a>
        </div>
      </fieldset>
    </CleanGetForm>
  );
};
