import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { ExternalLink, Fact } from "@/components/facts";
import { PageIntro, SetupNeeded } from "@/components/setup-needed";
import { guard } from "@/lib/db";
import { formatDate, formatEuroExact } from "@/lib/format";
import { ContratosPublicos } from "@/components/contratos-publicos";
import { getConcesion, getConvocatoria } from "@/lib/queries";
import { bdnsConvocatoriaUrl } from "@/lib/utils";

type Params = { id: string };

export const generateMetadata = async ({ params }: { params: Promise<Params> }): Promise<Metadata> => {
  const { id } = await params;
  const numeric = Number(id);
  if (!Number.isInteger(numeric)) {
    return { title: "Concesión" };
  }
  const loaded = await guard(() => getConcesion(numeric));
  if (loaded === "missing" || !loaded) {
    return { title: "Concesión" };
  }
  return { title: `${loaded.beneficiarioNombre} · ${formatEuroExact(loaded.importe)}` };
};

const ConcesionPage = async ({ params }: { params: Promise<Params> }) => {
  const { id } = await params;
  const numeric = Number(id);
  if (!Number.isInteger(numeric) || numeric < 0) {
    notFound();
  }
  const loaded = await guard(async () => {
    const concesion = await getConcesion(numeric);
    if (!concesion) {
      return null;
    }
    const convocatoria = concesion.codigoBdns ? await getConvocatoria(concesion.codigoBdns) : null;
    return { concesion, convocatoria };
  });
  if (loaded === "missing") {
    return <SetupNeeded />;
  }
  if (!loaded) {
    notFound();
  }

  const row = loaded.concesion;
  const bases = row.urlBases.startsWith("http") ? row.urlBases : "";

  return (
    <>
      <PageIntro eyebrow="Concesión" title={formatEuroExact(row.importe)}>
        <p>
          Concedida el {formatDate(row.fecha)} a {row.beneficiarioNombre}. La ficha oficial de la BDNS corresponde a la
          convocatoria, no a cada pago.
        </p>
      </PageIntro>
      <div className="mb-4 flex flex-wrap gap-2">
        <Badge tone="accent">{row.instrumento}</Badge>
        <Badge>{row.tipoBeneficiario}</Badge>
        <Badge>{row.ccaa}</Badge>
      </div>
      <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <Fact
          label="Beneficiario"
          value={
            row.beneficiarioId ? (
              <Link href={`/beneficiarios/${row.beneficiarioId}`} className="xp-link font-normal">
                {row.beneficiarioNombre}
              </Link>
            ) : (
              row.beneficiarioNombre
            )
          }
        />
        <Fact label="NIF" value={row.nif || "—"} />
        <Fact label="Ayuda equivalente" value={formatEuroExact(row.ayudaEquivalente)} />
        <Fact label="Organismo" value={row.organismo} />
        <Fact label="Administración" value={row.administracion || "—"} />
        <Fact label="Aplicación presupuestaria" value={row.aplicacion || "—"} />
        <Fact label="Sector estimado" value={row.sector} />
        <Fact
          label="Convocatoria"
          value={
            row.codigoBdns ? (
              <Link href={`/convocatorias/${row.codigoBdns}`} className="xp-link font-normal">
                {row.titulo}
              </Link>
            ) : (
              row.titulo
            )
          }
        />
        <Fact
          label="Fuentes"
          value={
            <span className="flex flex-col gap-1">
              {row.codigoBdns ? (
                <ExternalLink href={bdnsConvocatoriaUrl(row.codigoBdns)}>Ficha oficial de la convocatoria</ExternalLink>
              ) : (
                <span>Sin código BDNS</span>
              )}
              {bases ? <ExternalLink href={bases}>Bases reguladoras</ExternalLink> : null}
            </span>
          }
        />
      </dl>
      <ContratosPublicos nif={row.nif} organismo={row.organismo} />
      {loaded.convocatoria ? (
        <p className="mt-6 text-sm text-muted">
          Esta convocatoria acumula {formatEuroExact(loaded.convocatoria.convocatoria.importeTotal)} en{" "}
          {loaded.convocatoria.convocatoria.nConcesiones} concesiones del volcado.
        </p>
      ) : null}
    </>
  );
};

export default ConcesionPage;
