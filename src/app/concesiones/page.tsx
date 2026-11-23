import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { DataView, type Column } from "@/components/data-view";
import { FilterForm } from "@/components/filter-form";
import { PaginationBar } from "@/components/pagination-bar";
import { PageIntro, SetupNeeded } from "@/components/setup-needed";
import { guard } from "@/lib/db";
import { formatDate, formatEuro } from "@/lib/format";
import { formatNumber } from "@/lib/format";
import { parseFilters, type SearchParams } from "@/lib/params";
import { ContratosPublicos } from "@/components/contratos-publicos";
import { getFacets, searchConcesiones, type Concesion } from "@/lib/queries";

const columns: Column<Concesion>[] = [
  {
    id: "beneficiario",
    header: "Beneficiario",
    sortKey: "beneficiario",
    cell: (row) =>
      row.beneficiarioId ? (
        <Link href={`/beneficiarios/${row.beneficiarioId}`} className="xp-link">
          {row.beneficiarioNombre}
        </Link>
      ) : (
        row.beneficiarioNombre
      ),
  },
  {
    id: "fecha",
    header: "Fecha",
    sortKey: "fecha",
    cell: (row) => formatDate(row.fecha),
  },
  {
    id: "importe",
    header: "Importe",
    sortKey: "importe",
    align: "right",
    cell: (row) => (
      <Link href={`/concesiones/${row.id}`} className="xp-link tabular-nums">
        {formatEuro(row.importe)}
      </Link>
    ),
  },
  {
    id: "instrumento",
    header: "Instrumento",
    cell: (row) => <Badge>{row.instrumento}</Badge>,
  },
  {
    id: "organismo",
    header: "Organismo",
    sortKey: "organismo",
    cell: (row) => row.organismo,
  },
  {
    id: "titulo",
    header: "Convocatoria",
    sortKey: "titulo",
    cell: (row) =>
      row.codigoBdns ? (
        <Link href={`/convocatorias/${row.codigoBdns}`} className="xp-link font-normal">
          {row.titulo}
        </Link>
      ) : (
        row.titulo
      ),
  },
];

const ConcesionesPage = async ({ searchParams }: { searchParams: Promise<SearchParams> }) => {
  const filters = parseFilters(await searchParams, "fecha");
  const loaded = await guard(async () => {
    const [facets, page] = await Promise.all([getFacets(), searchConcesiones(filters)]);
    return { facets, page };
  });
  if (loaded === "missing") {
    return <SetupNeeded />;
  }

  return (
    <>
      <PageIntro eyebrow="Concesiones" title="A quién se le concedió">
        <p>
          {formatNumber(loaded.page.total)} concesiones a personas jurídicas. Cada fila enlaza con su beneficiario y con
          la convocatoria.
        </p>
      </PageIntro>
      <FilterForm
        action="/concesiones"
        filters={filters}
        facets={loaded.facets}
        showTipo
        showInstrumento
        importeHint="Importe"
      />
      {filters.organismo ? <ContratosPublicos organismo={filters.organismo} /> : null}
      <DataView
        rows={loaded.page.rows}
        columns={columns}
        path="/concesiones"
        filters={filters}
        rowKey={(row) => String(row.id)}
        caption="Concesiones de ayudas"
      />
      <PaginationBar path="/concesiones" filters={filters} total={loaded.page.total} pageSize={loaded.page.pageSize} />
    </>
  );
};

export default ConcesionesPage;
