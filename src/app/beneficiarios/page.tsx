import Link from "next/link";
import { DataView, type Column } from "@/components/data-view";
import { FilterForm } from "@/components/filter-form";
import { PaginationBar } from "@/components/pagination-bar";
import { PageIntro, SetupNeeded } from "@/components/setup-needed";
import { guard } from "@/lib/db";
import { formatEuro, formatNumber } from "@/lib/format";
import { parseFilters, type SearchParams } from "@/lib/params";
import { getFacets, searchBeneficiarios, type Beneficiario } from "@/lib/queries";

const linkClass =
  "font-medium text-accent underline decoration-accent/30 underline-offset-4 transition-colors hover:text-accent-strong hover:decoration-accent";

const columns: Column<Beneficiario>[] = [
  {
    id: "nombre",
    header: "Beneficiario",
    sortKey: "nombre",
    cell: (row) => (
      <Link href={`/beneficiarios/${row.id}`} className={linkClass}>
        {row.nombre}
        {row.nif ? <span className="mt-0.5 block font-mono text-xs font-normal text-muted no-underline">{row.nif}</span> : null}
      </Link>
    ),
  },
  {
    id: "tipo",
    header: "Tipo",
    cell: (row) => <span className="text-muted">{row.tipo}</span>,
  },
  {
    id: "concesiones",
    header: "Concesiones",
    sortKey: "concesiones",
    align: "right",
    cell: (row) => formatNumber(row.nConcesiones),
  },
  {
    id: "importe",
    header: "Importe total",
    sortKey: "importe",
    align: "right",
    cell: (row) => <span className="font-semibold">{formatEuro(row.importeTotal)}</span>,
  },
];

const BeneficiariosPage = async ({ searchParams }: { searchParams: Promise<SearchParams> }) => {
  const filters = parseFilters(await searchParams, "importe");
  if (!filters.sort || filters.sort === "fecha") {
    filters.sort = "importe";
  }
  const loaded = await guard(async () => {
    const [facets, page] = await Promise.all([getFacets(), searchBeneficiarios(filters)]);
    return { facets, page };
  });
  if (loaded === "missing") {
    return <SetupNeeded />;
  }

  return (
    <>
      <PageIntro eyebrow="Beneficiarios" title="Quién recibió las ayudas">
        <p>
          {formatNumber(loaded.page.total)} personas jurídicas, agrupadas por NIF. El importe es el total de todos los instrumentos, garantías incluidas. En el inicio, la pestaña Solo subvenciones cuenta solo las dinerarias. El volcado no incluye personas físicas.
        </p>
      </PageIntro>
      <FilterForm
        action="/beneficiarios"
        filters={filters}
        facets={loaded.facets}
        showSector={false}
        showOrganismo={false}
        showFechas={false}
        showImporte={false}
        showTipo
        showCcaa
        defaultSort="importe"
      />
      <DataView
        rows={loaded.page.rows}
        columns={columns}
        path="/beneficiarios"
        filters={filters}
        rowKey={(row) => String(row.id)}
        caption="Beneficiarios de concesiones"
        defaultSort="importe"
      />
      <PaginationBar
        path="/beneficiarios"
        filters={filters}
        total={loaded.page.total}
        pageSize={loaded.page.pageSize}
        defaultSort="importe"
      />
    </>
  );
};

export default BeneficiariosPage;
