import Link from "next/link";
import { DataView, type Column } from "@/components/data-view";
import { FilterForm } from "@/components/filter-form";
import { PaginationBar } from "@/components/pagination-bar";
import { PageIntro, SetupNeeded } from "@/components/setup-needed";
import { guard } from "@/lib/db";
import { formatEuro, formatNumber } from "@/lib/format";
import { parseFilters, type SearchParams } from "@/lib/params";
import { getFacets, searchBeneficiarios, type Beneficiario } from "@/lib/queries";

const columns: Column<Beneficiario>[] = [
  {
    id: "nombre",
    header: "Beneficiario",
    sortKey: "nombre",
    cell: (row) => (
      <Link href={`/beneficiarios/${row.id}`} className="xp-link">
        {row.nombre}
        {row.nif ? <span className="mt-0.5 block font-mono text-xs font-normal text-muted">{row.nif}</span> : null}
      </Link>
    ),
  },
  {
    id: "tipo",
    header: "Tipo",
    cell: (row) => row.tipo,
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
    header: "Importe",
    sortKey: "importe",
    align: "right",
    cell: (row) => formatEuro(row.importeTotal),
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
          {formatNumber(loaded.page.total)} personas jurídicas. Se agrupan por NIF. El volcado no incluye personas físicas.
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
      />
      <DataView
        rows={loaded.page.rows}
        columns={columns}
        path="/beneficiarios"
        filters={filters}
        rowKey={(row) => String(row.id)}
        caption="Beneficiarios de concesiones"
      />
      <PaginationBar path="/beneficiarios" filters={filters} total={loaded.page.total} pageSize={loaded.page.pageSize} />
    </>
  );
};

export default BeneficiariosPage;
