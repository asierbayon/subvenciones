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
};

const Field = ({ id, label, children }: { id: string; label: string; children: React.ReactNode }) => (
  <div className="xp-field">
    <label htmlFor={id}>{label}</label>
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
}: FilterFormProps) => {
  const territorios = [...facets.ccaa].sort(compareCcaa);

  return (
    <form action={action} method="get" className="mb-4">
      <input type="hidden" name="sort" value={filters.sort} />
      <input type="hidden" name="dir" value={filters.dir} />
      {Object.entries(extraHidden ?? {}).map(([key, value]) => (
        <input key={key} type="hidden" name={key} value={value} />
      ))}
      <fieldset className="xp-group">
      <legend>Filtros</legend>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
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
      <div className="mt-4 flex flex-wrap items-center gap-3">
        {showMrr ? (
          <label className="inline-flex items-center gap-2 text-sm text-ink" htmlFor="mrr">
            <input id="mrr" name="mrr" value="1" type="checkbox" defaultChecked={filters.mrr} className="size-3.5 accent-accent" />
            Solo convocatorias MRR
          </label>
        ) : null}
        <Button type="submit">Aplicar filtros</Button>
        <a href={action} className="xp-link font-normal">
          Limpiar
        </a>
      </div>
      </fieldset>
    </form>
  );
};
