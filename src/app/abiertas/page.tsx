import Link from "next/link";
import { DataView, type Column } from "@/components/data-view";
import { ExternalLink } from "@/components/facts";
import { FilterForm } from "@/components/filter-form";
import { PaginationBar } from "@/components/pagination-bar";
import { PageIntro, SetupNeeded } from "@/components/setup-needed";
import { guard } from "@/lib/db";
import { formatDate, formatNumber } from "@/lib/format";
import { parseFilters, type SearchParams } from "@/lib/params";
import { getFacets, getMeta, searchConvocatorias, windowStart, type Convocatoria } from "@/lib/queries";
import { bdnsConvocatoriaUrl } from "@/lib/utils";

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
    cell: (row) => row.organismo,
  },
  {
    id: "territorio",
    header: "Territorio",
    cell: (row) => row.ccaa,
  },
  {
    id: "oficial",
    header: "Plazo real",
    cell: (row) => <ExternalLink href={bdnsConvocatoriaUrl(row.codigoBdns)}>Comprobar en la BDNS</ExternalLink>,
  },
];

const AbiertasPage = async ({ searchParams }: { searchParams: Promise<SearchParams> }) => {
  const filters = parseFilters(await searchParams, "fecha");
  const loaded = await guard(async () => {
    const meta = await getMeta();
    const hasta = meta.convFechaMax ?? "";
    const desde = hasta ? windowStart(hasta) : "";
    const forced = { ...filters, desde, hasta };
    const [facets, page] = await Promise.all([getFacets(), searchConvocatorias(forced)]);
    return { meta, facets, page, forced, desde, hasta };
  });
  if (loaded === "missing") {
    return <SetupNeeded />;
  }

  const today = new Intl.DateTimeFormat("es-ES", { dateStyle: "long", timeZone: "Europe/Madrid" }).format(new Date());

  return (
    <>
      <PageIntro eyebrow="Abiertas ahora" title="El volcado no sabe qué plazo sigue vivo">
        <p>
          Los CSV no traen fecha de inicio ni de fin de solicitud, así que Faro no puede marcar convocatorias abiertas a
          día {today}. El fichero se detiene el {formatDate(loaded.hasta)}.
        </p>
      </PageIntro>
      <div className="mb-6 rounded-3xl border border-terra/40 bg-highlight px-5 py-4 text-ink">
        <p className="font-semibold">Lo más cercano a un plazo vigente</p>
        <p className="mt-1 text-sm leading-relaxed">
          Estas son las convocatorias registradas entre el {formatDate(loaded.desde)} y el {formatDate(loaded.hasta)},
          los 60 días finales del volcado. Abre la ficha oficial para ver si el plazo sigue abierto: la BDNS en línea sí
          publica ese dato, este repositorio no.
        </p>
      </div>
      <FilterForm
        action="/abiertas"
        filters={loaded.forced}
        facets={loaded.facets}
        showFechas={false}
        showImporte={false}
        showMrr
        extraHidden={{ desde: loaded.desde, hasta: loaded.hasta }}
      />
      <p className="mb-3 text-sm text-muted">{formatNumber(loaded.page.total)} convocatorias en esa franja.</p>
      <DataView
        rows={loaded.page.rows}
        columns={columns}
        path="/abiertas"
        filters={loaded.forced}
        rowKey={(row) => String(row.id)}
        caption="Convocatorias registradas al cierre del volcado"
      />
      <PaginationBar path="/abiertas" filters={loaded.forced} total={loaded.page.total} pageSize={loaded.page.pageSize} />
    </>
  );
};

export default AbiertasPage;
