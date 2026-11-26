import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { DataView, type Column } from "@/components/data-view";
import { FilterForm } from "@/components/filter-form";
import { PaginationBar } from "@/components/pagination-bar";
import { PageIntro, SetupNeeded } from "@/components/setup-needed";
import { guard } from "@/lib/db";
import { formatDate, formatEuro, formatNumber } from "@/lib/format";
import { parseFilters, type SearchParams } from "@/lib/params";
import { ContratosPublicos } from "@/components/contratos-publicos";
import { getFacets, searchConvocatorias, type Convocatoria } from "@/lib/queries";

const linkClass =
  "font-medium text-accent underline decoration-accent/30 underline-offset-4 transition-colors hover:text-accent-strong hover:decoration-accent";

const columns: Column<Convocatoria>[] = [
  {
    id: "titulo",
    header: "Convocatoria",
    sortKey: "titulo",
    cell: (row) => (
      <Link href={`/convocatorias/${row.codigoBdns}`} className={linkClass}>
        {row.titulo}
      </Link>
    ),
  },
  {
    id: "fecha",
    header: "Registro",
    sortKey: "fecha",
    cell: (row) => <span className="whitespace-nowrap text-muted">{formatDate(row.fecha)}</span>,
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
    cell: (row) => <span className="text-muted">{row.ccaa}</span>,
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
    cell: (row) => <span className="font-semibold">{formatEuro(row.importeTotal)}</span>,
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
      {filters.organismo ? <ContratosPublicos organismo={filters.organismo} /> : null}
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
