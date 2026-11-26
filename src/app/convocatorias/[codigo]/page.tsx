import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { DataView, type Column } from "@/components/data-view";
import { ExternalLink, Fact } from "@/components/facts";
import { PaginationBar } from "@/components/pagination-bar";
import { PageIntro, SetupNeeded } from "@/components/setup-needed";
import { guard } from "@/lib/db";
import { formatDate, formatEuro, formatNumber } from "@/lib/format";
import { parseFilters, type SearchParams } from "@/lib/params";
import { ContratosPublicos } from "@/components/contratos-publicos";
import { getConvocatoria, searchConcesiones, type Concesion } from "@/lib/queries";
import { bdnsConvocatoriaUrl } from "@/lib/utils";

type Params = { codigo: string };

const linkClass =
  "font-medium text-accent underline decoration-accent/30 underline-offset-4 transition-colors hover:text-accent-strong hover:decoration-accent";

const columns: Column<Concesion>[] = [
  {
    id: "beneficiario",
    header: "Beneficiario",
    sortKey: "beneficiario",
    cell: (row) =>
      row.beneficiarioId ? (
        <Link href={`/beneficiarios/${row.beneficiarioId}`} className={linkClass}>
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
    cell: (row) => <span className="whitespace-nowrap text-muted">{formatDate(row.fecha)}</span>,
  },
  {
    id: "importe",
    header: "Importe",
    sortKey: "importe",
    align: "right",
    cell: (row) => (
      <Link href={`/concesiones/${row.id}`} className={`${linkClass} tabular-nums`}>
        {formatEuro(row.importe)}
      </Link>
    ),
  },
  {
    id: "tipo",
    header: "Tipo",
    cell: (row) => <span className="text-muted">{row.tipoBeneficiario}</span>,
  },
];

export const generateMetadata = async ({ params }: { params: Promise<Params> }): Promise<Metadata> => {
  const { codigo } = await params;
  const loaded = await guard(() => getConvocatoria(codigo));
  if (loaded === "missing" || !loaded) {
    return { title: "Convocatoria" };
  }
  return { title: loaded.convocatoria.titulo };
};

const ConvocatoriaPage = async ({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<SearchParams>;
}) => {
  const { codigo } = await params;
  const filters = parseFilters(await searchParams, "fecha");
  const cleared = {
    ...filters,
    q: "",
    ccaa: "",
    sector: "",
    tipo: "",
    instrumento: "",
    organismo: "",
    desde: "",
    hasta: "",
    importeMin: "",
    importeMax: "",
    mrr: false,
  };
  const loaded = await guard(async () => {
    const found = await getConvocatoria(codigo);
    if (!found) {
      return null;
    }
    const grants = await searchConcesiones(cleared, { convocatoriaId: found.convocatoria.id });
    return { found, grants };
  });
  if (loaded === "missing") {
    return <SetupNeeded />;
  }
  if (!loaded) {
    notFound();
  }

  const row = loaded.found.convocatoria;
  const path = `/convocatorias/${row.codigoBdns}`;
  const bases = row.urlBases.startsWith("http") ? row.urlBases : "";

  return (
    <>
      <PageIntro eyebrow={`BDNS ${row.codigoBdns}`} title={row.titulo}>
        <p>
          Registrada el {formatDate(row.fecha)}. El sector «{row.sector}» y el territorio «{row.ccaa}» los calcula Faro;
          no vienen como campos propios del volcado.
        </p>
      </PageIntro>
      <div className="mb-5 flex flex-wrap gap-2">
        <Badge tone="accent">{row.ccaa}</Badge>
        <Badge>{row.sector}</Badge>
        {row.mrr ? <Badge tone="terra">MRR</Badge> : null}
      </div>
      <dl className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-3">
        <Fact label="Organismo" value={row.organismo} />
        <Fact label="Administración" value={row.administracion || "—"} />
        <Fact label="Órgano" value={row.organo || "—"} />
        <Fact label="Concesiones" value={formatNumber(row.nConcesiones)} />
        <Fact label="Subvenciones" value={formatEuro(row.importeSubvencion)} />
        {row.nGarantia > 0 ? <Fact label="Garantías" value={formatEuro(row.importeGarantia)} /> : null}
        <Fact
          label="Fuentes"
          value={
            <span className="flex flex-col gap-1">
              <ExternalLink href={bdnsConvocatoriaUrl(row.codigoBdns)}>Ficha oficial en la BDNS</ExternalLink>
              {bases ? <ExternalLink href={bases}>Bases reguladoras</ExternalLink> : <span className="font-normal text-muted">Sin URL de bases</span>}
            </span>
          }
        />
      </dl>
      {row.tituloCooficial ? <p className="mt-4 text-sm text-muted">Título cooficial: {row.tituloCooficial}</p> : null}
      {loaded.found.duplicates > 1 ? (
        <p className="mt-4 text-sm font-medium text-terra">
          Hay {loaded.found.duplicates} filas con este código BDNS. Se muestra la que acumula más concesiones.
        </p>
      ) : null}
      <ContratosPublicos organismo={row.organismo} exact />
      <h2 className="mt-10 font-display text-xl font-bold tracking-tight text-ink">Concesiones de esta convocatoria</h2>
      <div className="mt-4">
        <DataView
          rows={loaded.grants.rows}
          columns={columns}
          path={path}
          filters={cleared}
          rowKey={(item) => String(item.id)}
          caption="Concesiones de la convocatoria"
          empty="Esta convocatoria no tiene concesiones a personas jurídicas en el volcado."
        />
        <PaginationBar path={path} filters={cleared} total={loaded.grants.total} pageSize={loaded.grants.pageSize} />
      </div>
    </>
  );
};

export default ConvocatoriaPage;
