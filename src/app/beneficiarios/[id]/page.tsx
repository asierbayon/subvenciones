import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { DataTable, HorizontalBars, YearChart, YearTable } from "@/components/dashboard-charts";
import { DataView, type Column } from "@/components/data-view";
import { Fact } from "@/components/facts";
import { PaginationBar } from "@/components/pagination-bar";
import { AlertBanner } from "@/components/alert-banner";
import { PageIntro, SetupNeeded } from "@/components/setup-needed";
import { listVinculosBeneficiario, type VinculoAlert } from "@/lib/alerts";
import { guard } from "@/lib/db";
import { formatDate, formatEuro, formatNumber } from "@/lib/format";
import { parseFilters, type SearchParams } from "@/lib/params";
import { ContratosPublicos } from "@/components/contratos-publicos";
import { getBeneficiario, searchConcesiones, type Concesion } from "@/lib/queries";

type Params = { id: string };

const roleLabel = (rol: string) => {
  if (rol === "alcalde") {
    return "Alcaldía";
  }
  if (rol === "concejal") {
    return "Concejal electo";
  }
  if (rol === "consejero_insular") {
    return "Cabildo";
  }
  if (rol === "diputado") {
    return "Diputado autonómico";
  }
  if (rol === "alto_cargo") {
    return "Alto cargo";
  }
  return rol;
};

const CompanyRole = ({ cargo }: { cargo: string }) => {
  if (!cargo) {
    return null;
  }
  return <> ({cargo})</>;
};

const VinculoBlock = ({ rows }: { rows: VinculoAlert[] }) => {
  if (rows.length === 0) {
    return null;
  }
  return (
    <section className="mt-6" aria-label="Vínculos políticos">
      <h2 className="font-display text-3xl">Vínculos políticos</h2>
      <div className="mt-3">
        <AlertBanner>
          El nombre del administrador coincide con un cargo público del órgano que concede, por encima del 85 % de
          confianza. Puede haber homónimos. No demuestra que esa persona interviniera en el expediente.
        </AlertBanner>
      </div>
      <ul className="grid gap-3">
        {rows.map((alert) => (
          <li key={alert.id} className="rounded-3xl border border-line bg-elev p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="terra">{roleLabel(alert.rol)}</Badge>
              <Badge>Confianza {Math.round(alert.confianza * 100).toLocaleString("es-ES")} %</Badge>
            </div>
            <p className="mt-3 text-sm leading-relaxed">
              <span className="font-semibold">{alert.politicoNombre}</span>, {alert.cuerpo}. La ayuda la concede{" "}
              {alert.organismo} ({alert.anio}). En la sociedad consta como {alert.adminNombre}
              <CompanyRole cargo={alert.adminCargo} />.
            </p>
            <p className="mt-2 text-sm leading-relaxed text-muted">{alert.motivo}</p>
            <p className="mt-2 text-sm">
              <a
                href={alert.fuenteUrl}
                target="_blank"
                rel="noreferrer"
                className="font-semibold underline decoration-line underline-offset-2 hover:decoration-accent"
              >
                Fuente publicada
              </a>
            </p>
            <p className="mt-2 text-sm">
              <Link href="/alertas/vinculos" className="font-semibold underline decoration-line underline-offset-2 hover:decoration-accent">
                Ver el indicador completo
              </Link>
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
};

const columns: Column<Concesion>[] = [
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
      <Link href={`/concesiones/${row.id}`} className="font-semibold tabular-nums underline decoration-line underline-offset-2 hover:decoration-accent">
        {formatEuro(row.importe)}
      </Link>
    ),
  },
  {
    id: "organismo",
    header: "Organismo",
    cell: (row) => row.organismo,
  },
  {
    id: "titulo",
    header: "Convocatoria",
    cell: (row) =>
      row.codigoBdns ? (
        <Link href={`/convocatorias/${row.codigoBdns}`} className="underline decoration-line underline-offset-2 hover:decoration-accent">
          {row.titulo}
        </Link>
      ) : (
        row.titulo
      ),
  },
];

export const generateMetadata = async ({ params }: { params: Promise<Params> }): Promise<Metadata> => {
  const { id } = await params;
  const numeric = Number(id);
  if (!Number.isInteger(numeric)) {
    return { title: "Beneficiario" };
  }
  const loaded = await guard(() => getBeneficiario(numeric));
  if (loaded === "missing" || !loaded) {
    return { title: "Beneficiario" };
  }
  return { title: loaded.beneficiario.nombre };
};

const BeneficiarioPage = async ({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<SearchParams>;
}) => {
  const { id } = await params;
  const numeric = Number(id);
  if (!Number.isInteger(numeric) || numeric < 0) {
    notFound();
  }
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
    const found = await getBeneficiario(numeric);
    if (!found) {
      return null;
    }
    const grants = await searchConcesiones(cleared, { beneficiarioId: numeric });
    const vinculos = await listVinculosBeneficiario(found.beneficiario.nif);
    return { found, grants, vinculos };
  });
  if (loaded === "missing") {
    return <SetupNeeded />;
  }
  if (!loaded) {
    notFound();
  }

  const row = loaded.found.beneficiario;
  const path = `/beneficiarios/${row.id}`;

  return (
    <>
      <PageIntro eyebrow={row.nif || "Sin NIF"} title={row.nombre}>
        <p>
          {formatNumber(row.nConcesiones)} concesiones y {formatEuro(row.importeTotal)} acumulados en este volcado.
          El tipo sale de la letra del NIF.
        </p>
      </PageIntro>
      <div className="mb-4">
        <Badge tone="accent">{row.tipo}</Badge>
      </div>
      <dl className="grid gap-3 sm:grid-cols-3">
        <Fact label="NIF" value={row.nif || "—"} />
        <Fact label="Concesiones" value={formatNumber(row.nConcesiones)} />
        <Fact label="Importe" value={formatEuro(row.importeTotal)} />
      </dl>
      <VinculoBlock rows={loaded.vinculos} />
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <figure className="rounded-3xl border border-line bg-elev p-4">
          <figcaption className="mb-2 font-display text-2xl">Importe por año</figcaption>
          <YearChart data={loaded.found.years} />
          <YearTable data={loaded.found.years} />
        </figure>
        <figure className="rounded-3xl border border-line bg-elev p-4">
          <figcaption className="mb-2 font-display text-2xl">De dónde llega</figcaption>
          <HorizontalBars data={loaded.found.territorios} />
          <DataTable data={loaded.found.territorios} firstColumn="Territorio" />
        </figure>
      </div>
      <ContratosPublicos nif={row.nif} />
      <h2 className="mt-10 font-display text-3xl">Todas las concesiones</h2>
      <div className="mt-4">
        <DataView
          rows={loaded.grants.rows}
          columns={columns}
          path={path}
          filters={cleared}
          rowKey={(item) => String(item.id)}
          caption="Concesiones del beneficiario"
        />
        <PaginationBar path={path} filters={cleared} total={loaded.grants.total} pageSize={loaded.grants.pageSize} />
      </div>
    </>
  );
};

export default BeneficiarioPage;
