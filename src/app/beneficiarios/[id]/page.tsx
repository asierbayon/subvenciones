import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { DataTable, HorizontalBars, YearChart, YearTable } from "@/components/dashboard-charts";
import { DataView, type Column } from "@/components/data-view";
import { ExternalLink, Fact } from "@/components/facts";
import { RegistroMercantil } from "@/components/registro-mercantil";
import { PaginationBar } from "@/components/pagination-bar";
import { AlertBanner } from "@/components/alert-banner";
import { AlertCard, AlertDisclosure, AlertFlow } from "@/components/alert-ui";
import { PageIntro, SetupNeeded } from "@/components/setup-needed";
import { listVinculosBeneficiario, type VinculoAlert } from "@/lib/alerts";
import { guard } from "@/lib/db";
import { formatDate, formatEuro, formatNumber } from "@/lib/format";
import { parseFilters, type SearchParams } from "@/lib/params";
import { ContratosPublicos } from "@/components/contratos-publicos";
import { getBeneficiario, searchConcesiones, type Concesion } from "@/lib/queries";

type Params = { id: string };

const linkClass =
  "font-medium text-accent underline decoration-accent/30 underline-offset-4 transition-colors hover:text-accent-strong hover:decoration-accent";

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

const VinculoBlock = ({ rows }: { rows: VinculoAlert[] }) => {
  if (rows.length === 0) {
    return null;
  }
  return (
    <section className="mt-10" aria-label="Vínculos políticos">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-xl font-bold tracking-tight text-ink">Vínculos políticos</h2>
        <Link href="/alertas/vinculos" className={`${linkClass} text-sm`}>
          Ver todos los vínculos
        </Link>
      </div>
      <AlertBanner>
        Coincidencia por nombre (≥ 85 % de confianza) con un cargo público del organismo concedente. Puede haber
        homónimos.
      </AlertBanner>
      <ul className="grid gap-4">
        {rows.map((alert) => (
          <li key={alert.id}>
            <AlertCard
              tone="terra"
              badges={
                <>
                  <Badge tone="terra">{roleLabel(alert.rol)}</Badge>
                  <Badge tone="accent">
                    Confianza {Math.round(alert.confianza * 100).toLocaleString("es-ES")} %
                  </Badge>
                </>
              }
              title={alert.politicoNombre}
              subtitle={
                <p className="text-xs text-muted">
                  {alert.organismo} · {alert.anio}
                </p>
              }
              metric={formatEuro(alert.importeSuma)}
              metricLabel={`${formatNumber(alert.n)} ${alert.n === 1 ? "ayuda" : "ayudas"}`}
              footer={
                <>
                  {alert.fuenteUrl ? (
                    <div className="text-xs">
                      <ExternalLink href={alert.fuenteUrl}>Fuente del cargo</ExternalLink>
                    </div>
                  ) : null}
                  <AlertDisclosure label="Explicación detallada">
                    <p className="text-xs leading-relaxed text-muted">{alert.motivo}</p>
                  </AlertDisclosure>
                </>
              }
            >
              <AlertFlow
                connector="Mismo órgano"
                connectorTone="terra"
                left={{
                  eyebrow: "Cargo público",
                  title: alert.politicoNombre,
                  detail: alert.cuerpo,
                }}
                right={{
                  eyebrow: "En la sociedad",
                  title: alert.adminNombre,
                  detail: alert.adminCargo || "Cargo no informado",
                }}
              />
            </AlertCard>
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
    cell: (row) => <span className="whitespace-nowrap text-muted">{formatDate(row.fecha)}</span>,
  },
  {
    id: "importe",
    header: "Importe",
    sortKey: "importe",
    align: "right",
    cell: (row) => (
      <Link href={`/concesiones/${row.id}`} className={`${linkClass} font-semibold tabular-nums`}>
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
        <Link href={`/convocatorias/${row.codigoBdns}`} className={linkClass}>
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
          {formatNumber(row.nSubvencion)} subvenciones dinerarias y {formatEuro(row.importeSubvencion)} acumulados en
          este volcado.
          {row.nGarantia > 0
            ? ` Aparte, ${formatNumber(row.nGarantia)} garantías por ${formatEuro(row.importeGarantia)}, que no son una entrega de dinero.`
            : ""}{" "}
          El tipo sale de la letra del NIF.
        </p>
      </PageIntro>
      <div className="mb-5">
        <Badge tone="accent">{row.tipo}</Badge>
      </div>
      <dl className="grid gap-3.5 sm:grid-cols-3">
        <Fact label="NIF" value={<span className="font-mono">{row.nif || "—"}</span>} />
        <Fact label="Subvenciones" value={<span className="tabular-nums">{formatNumber(row.nSubvencion)}</span>} />
        <Fact label="Importe subvenciones" value={<span className="tabular-nums">{formatEuro(row.importeSubvencion)}</span>} />
        {row.nGarantia > 0 ? (
          <Fact label="Garantías" value={`${formatNumber(row.nGarantia)} · ${formatEuro(row.importeGarantia)}`} />
        ) : null}
      </dl>
      <RegistroMercantil beneficiarioId={row.id} nif={row.nif} />
      <VinculoBlock rows={loaded.vinculos} />
      <div className="mt-8 grid gap-5 lg:grid-cols-2">
        <figure className="rounded-xl border border-line bg-elev p-5 shadow-2xs">
          <figcaption className="font-display text-base font-bold tracking-tight text-ink">
            Importe por año
          </figcaption>
          <YearChart data={loaded.found.years} />
          <YearTable data={loaded.found.years} />
        </figure>
        <figure className="rounded-xl border border-line bg-elev p-5 shadow-2xs">
          <figcaption className="font-display text-base font-bold tracking-tight text-ink">
            De dónde llega
          </figcaption>
          <HorizontalBars data={loaded.found.territorios} />
          <DataTable data={loaded.found.territorios} firstColumn="Territorio" />
        </figure>
      </div>
      <ContratosPublicos nif={row.nif} />
      <h2 className="mt-10 font-display text-xl font-bold tracking-tight text-ink">Todas las concesiones</h2>
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
