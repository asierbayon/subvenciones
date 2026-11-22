import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { DataView, type Column } from "@/components/data-view";
import { FilterForm } from "@/components/filter-form";
import { PaginationBar } from "@/components/pagination-bar";
import { PageIntro, SetupNeeded } from "@/components/setup-needed";
import { guard } from "@/lib/db";
import { formatDate, formatEuro, formatNumber } from "@/lib/format";
import { parseFilters, type SearchParams } from "@/lib/params";
import { getFacets, searchConvocatorias, type Convocatoria } from "@/lib/queries";

const columns: Column<Convocatoria>[] = [
  {
    id: "titulo",
    header: "Convocatoria",
    sortKey: "titulo",
    cell: (row) => (
      <Link href={`/convocatorias/${row.codigoBdns}`} className="font-semibold underline decoration-line underline-offset-2 hover:decoration-accent">
        {row.titulo}
      </Link>
    ),
  },
  {
    id: "fecha",
    header: "Registro",
    sortKey: "fecha",
    cell: (row) => formatDate(row.fecha),
  },
  {
    id: "organismo",
    header: "Organismo",
    sortKey: "organismo",
    cell: (row) => row.organismo,
  },
  {
    id: "territorio",
    header: "Territorio",
    cell: (row) => row.ccaa,
  },
  {
    id: "sector",
    header: "Sector",
    cell: (row) => <Badge>{row.sector}</Badge>,
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

const ConvocatoriasPage = async ({ searchParams }: { searchParams: Promise<SearchParams> }) => {
  const filters = parseFilters(await searchParams, "fecha");
  const loaded = await guard(async () => {
    const [facets, page] = await Promise.all([getFacets(), searchConvocatorias(filters)]);
    return { facets, page };
  });
  if (loaded === "missing") {
    return <SetupNeeded />;
  }

  return (
    <>
      <PageIntro eyebrow="Convocatorias" title="Qué se convocó">
        <p>
          {formatNumber(loaded.page.total)} convocatorias en esta búsqueda. El importe es la suma de las concesiones
          ligadas a cada una.
        </p>
      </PageIntro>
      <FilterForm action="/convocatorias" filters={filters} facets={loaded.facets} showMrr importeHint="Importe concedido" />
      <DataView
        rows={loaded.page.rows}
        columns={columns}
        path="/convocatorias"
        filters={filters}
        rowKey={(row) => String(row.id)}
        caption="Convocatorias de subvenciones"
      />
      <PaginationBar path="/convocatorias" filters={filters} total={loaded.page.total} pageSize={loaded.page.pageSize} />
    </>
  );
};

export default ConvocatoriasPage;
