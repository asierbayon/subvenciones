import Link from "next/link";
import { AlertBanner } from "@/components/alert-banner";
import { AlertFilterForm, AlertPager } from "@/components/alert-filters";
import { ExternalLink } from "@/components/facts";
import { EmptyState, PageIntro, SetupNeeded } from "@/components/setup-needed";
import { Badge } from "@/components/ui/badge";
import { DatabaseMissingError, guard } from "@/lib/db";
import { listVinculos, parseAlertFilters, type AlertSearch, type VinculoAlert } from "@/lib/alerts";
import { formatDate, formatEuro } from "@/lib/format";

const linkClass =
  "font-medium text-accent underline decoration-accent/30 underline-offset-4 transition-colors hover:text-accent-strong hover:decoration-accent";

const ROLES = [
  { value: "alcalde", label: "Alcaldía" },
  { value: "concejal", label: "Concejal electo" },
  { value: "consejero_insular", label: "Cabildo" },
  { value: "diputado", label: "Diputado autonómico" },
  { value: "alto_cargo", label: "Alto cargo" },
];

const roleLabel = (rol: string) => ROLES.find((item) => item.value === rol)?.label ?? rol;

const confidenceLabel = (value: number) =>
  `${Math.round(value * 100).toLocaleString("es-ES")} %`;

const CompanyName = ({ alert }: { alert: VinculoAlert }) => {
  if (!alert.beneficiarioId) {
    return alert.empresa;
  }
  return (
    <Link href={`/beneficiarios/${alert.beneficiarioId}`} className={linkClass}>
      {alert.empresa}
    </Link>
  );
};

const NamesakeBadge = ({ lugares }: { lugares: number }) => {
  if (lugares <= 1) {
    return null;
  }
  return <Badge>Nombre repetido en otro órgano</Badge>;
};

const PartyName = ({ partido }: { partido: string }) => {
  if (!partido) {
    return null;
  }
  return <>, {partido}</>;
};

const CompanyTenure = ({ alert }: { alert: VinculoAlert }) => {
  if (!alert.adminDesde && !alert.adminHasta) {
    return <>, sin fechas de nombramiento</>;
  }
  return (
    <>
      , {formatDate(alert.adminDesde)} – {formatDate(alert.adminHasta)}
    </>
  );
};

const GrantLink = ({ id, children }: { id: number; children: string }) => (
  <Link href={`/concesiones/${id}`} className={linkClass}>
    {children}
  </Link>
);

const VinculosPage = async ({ searchParams }: { searchParams: Promise<AlertSearch> }) => {
  const filters = parseAlertFilters(await searchParams);
  const loaded = await guard(async () => {
    try {
      return await listVinculos(filters);
    } catch (error) {
      if (error instanceof DatabaseMissingError) {
        throw error;
      }
      const message = error instanceof Error ? error.message : "";
      if (message.includes("no such table")) {
        return null;
      }
      throw error;
    }
  });
  if (loaded === "missing") {
    return <SetupNeeded />;
  }
  if (!loaded) {
    return (
      <PageIntro eyebrow="Vínculos políticos" title="Falta calcular este indicador">
        <p>
          Hace falta la tabla de cargos públicos y, cuando exista, la de administradores societarios. En la raíz del
          proyecto:{" "}
          <code className="rounded bg-subtle px-1.5 py-0.5 font-mono text-xs text-ink">
            python3 pipeline/politicos.py
          </code>{" "}
          y después{" "}
          <code className="rounded bg-subtle px-1.5 py-0.5 font-mono text-xs text-ink">
            python3 pipeline/vinculos.py
          </code>
          . El segundo comando no escribe nada hasta que el índice tiene la tabla{" "}
          <code className="rounded bg-subtle px-1.5 py-0.5 font-mono text-xs text-ink">borme_admins</code>.
        </p>
      </PageIntro>
    );
  }

  return (
    <>
      <PageIntro eyebrow="Vínculos políticos" title="Ayudas a sociedades de cargos del mismo órgano">
        <p>
          Cruza el administrador de una sociedad con un cargo electo o un alto cargo del organismo que concede la
          subvención, en fechas que se solapan. El caso típico es la empresa de un concejal que cobra del ayuntamiento.
        </p>
      </PageIntro>
      <AlertBanner>
        Un homónimo puede compartir nombre y apellidos. No se publican coincidencias por debajo del 85 % de confianza,
        ni nombres que aparecen en tres o más órganos. No implica que la persona votara el expediente ni que la ayuda
        sea irregular.
      </AlertBanner>
      <AlertFilterForm
        action="/alertas/vinculos"
        filters={filters}
        ccaa={loaded.ccaa}
        anios={loaded.anios}
        organismos={loaded.organismos}
        tipos={ROLES}
      />
      {loaded.alerts.length === 0 ? (
        <EmptyState>Ningún indicador con estos filtros.</EmptyState>
      ) : (
        <ol className="grid gap-4">
          {loaded.alerts.map((alert) => (
            <li key={alert.id} className="rounded-xl border border-line bg-elev p-5 shadow-2xs">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="font-display text-base font-semibold text-ink">
                  <CompanyName alert={alert} />
                </h2>
                <p className="text-sm font-semibold text-ink tabular-nums">{formatEuro(alert.importeSuma)}</p>
              </div>
              <p className="mt-1 text-xs text-muted sm:text-sm">
                <span className="font-mono">{alert.nif}</span> · {alert.organismo} · {alert.ccaa} · {alert.anio}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Badge tone="terra">{roleLabel(alert.rol)}</Badge>
                <Badge>Confianza {confidenceLabel(alert.confianza)}</Badge>
                <NamesakeBadge lugares={alert.lugares} />
              </div>
              <p className="mt-3 text-sm leading-relaxed text-ink">
                <span className="font-semibold">{alert.politicoNombre}</span>
                <PartyName partido={alert.partido} />. {alert.cuerpo}. Mandato {formatDate(alert.mandatoDesde)} –{" "}
                {formatDate(alert.mandatoHasta)}. En la sociedad figura como {alert.adminCargo || "cargo no informado"} (
                {alert.adminNombre}
                <CompanyTenure alert={alert} />
                ).
              </p>
              <p className="mt-2 text-sm leading-relaxed text-muted">{alert.motivo}</p>
              <p className="mt-3 text-sm">
                <ExternalLink href={alert.fuenteUrl}>Fuente publicada</ExternalLink>
                <span className="text-muted"> · {alert.fuente}</span>
              </p>
              <ul className="mt-4 divide-y divide-line overflow-hidden rounded-lg border border-line bg-subtle/40">
                {alert.items.map((item) => (
                  <li
                    key={item.concesionId}
                    className="flex flex-col gap-1 px-3.5 py-2.5 text-sm sm:flex-row sm:items-baseline sm:justify-between"
                  >
                    <GrantLink id={item.concesionId}>
                      {`${formatEuro(item.importe)} el ${formatDate(item.fecha)}`}
                    </GrantLink>
                    <span className="text-muted sm:max-w-[60%] sm:text-right">{item.titulo}</span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      )}
      <AlertPager path="/alertas/vinculos" filters={filters} total={loaded.total} pageSize={loaded.pageSize} />
    </>
  );
};

export default VinculosPage;
