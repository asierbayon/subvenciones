import Link from "next/link";
import { AlertBanner, type MethodologyItem } from "@/components/alert-banner";
import { AlertFilterForm, AlertPager } from "@/components/alert-filters";
import {
  AlertCard,
  AlertDisclosure,
  AlertEvidenceList,
  AlertFlow,
  AlertMetaRow,
  AlertResultsBar,
  alertLinkClass,
} from "@/components/alert-ui";
import { ExternalLink } from "@/components/facts";
import { EmptyState, PageIntro, SetupNeeded } from "@/components/setup-needed";
import { Badge } from "@/components/ui/badge";
import { DatabaseMissingError, guard } from "@/lib/db";
import { listVinculos, parseAlertFilters, type AlertSearch, type VinculoAlert } from "@/lib/alerts";
import { formatDate, formatEuro, formatNumber } from "@/lib/format";

const ROLES = [
  { value: "alcalde", label: "Alcaldía" },
  { value: "concejal", label: "Concejal electo" },
  { value: "consejero_insular", label: "Cabildo" },
  { value: "diputado", label: "Diputado autonómico" },
  { value: "alto_cargo", label: "Alto cargo" },
];

const METHODOLOGY: MethodologyItem[] = [
  {
    label: "Qué cruza",
    text: "Administradores societarios del BORME con cargos electos y altos cargos del organismo que concede la ayuda, en fechas que se solapan.",
  },
  {
    label: "Filtro de confianza",
    text: "Solo se muestran coincidencias con confianza ≥ 85 % y nombres que no aparecen en 3 o más órganos. Quedan fuera empresas municipales o públicas.",
  },
  {
    label: "Límites",
    text: "Las listas públicas no llevan DNI: un homónimo puede coincidir en nombre y apellidos. No implica voto ni intervención en el expediente.",
  },
];

const roleLabel = (rol: string) => ROLES.find((item) => item.value === rol)?.label ?? rol;

const confidenceLabel = (value: number) => `${Math.round(value * 100).toLocaleString("es-ES")} %`;

const CompanyName = ({ alert }: { alert: VinculoAlert }) => {
  if (!alert.beneficiarioId) {
    return alert.empresa;
  }
  return (
    <Link href={`/beneficiarios/${alert.beneficiarioId}`} className={alertLinkClass}>
      {alert.empresa}
    </Link>
  );
};

const companyTenure = (alert: VinculoAlert) => {
  if (!alert.adminDesde && !alert.adminHasta) {
    return "Sin fechas de nombramiento";
  }
  return `${formatDate(alert.adminDesde)} – ${formatDate(alert.adminHasta)}`;
};

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
          proyecto: <code>python3 pipeline/politicos.py</code> y después <code>python3 pipeline/vinculos.py</code>. El
          segundo comando no escribe nada hasta que el índice tiene la tabla <code>borme_admins</code>.
        </p>
      </PageIntro>
    );
  }

  return (
    <>
      <PageIntro eyebrow="Vínculos políticos" title="Ayudas a sociedades de cargos del mismo órgano">
        <p>Empresas cuyo administrador coincide con un cargo público del mismo organismo en fechas solapadas.</p>
      </PageIntro>
      <AlertBanner methodology={METHODOLOGY}>
        Un homónimo puede compartir nombre y apellidos. Esta coincidencia no implica intervención en el expediente ni
        irregularidad.
      </AlertBanner>
      <AlertFilterForm
        action="/alertas/vinculos"
        filters={filters}
        ccaa={loaded.ccaa}
        anios={loaded.anios}
        organismos={loaded.organismos}
        tipos={ROLES}
      />
      <AlertResultsBar
        total={loaded.total}
        shown={loaded.alerts.length}
        page={filters.page}
        pageSize={loaded.pageSize}
        singular="coincidencia"
        plural="coincidencias"
      />
      {loaded.alerts.length === 0 ? (
        <EmptyState>Ningún indicador con estos filtros.</EmptyState>
      ) : (
        <ol className="grid gap-4">
          {loaded.alerts.map((alert) => {
            const partyDetail = alert.partido ? `${alert.cuerpo} · ${alert.partido}` : alert.cuerpo;
            return (
              <li key={alert.id}>
                <AlertCard
                  tone="terra"
                  badges={
                    <>
                      <Badge tone="terra">{roleLabel(alert.rol)}</Badge>
                      <Badge tone="accent">Confianza {confidenceLabel(alert.confianza)}</Badge>
                      {alert.lugares > 1 ? <Badge>Nombre repetido en otro órgano</Badge> : null}
                    </>
                  }
                  title={<CompanyName alert={alert} />}
                  subtitle={
                    <AlertMetaRow
                      items={[
                        alert.organismo,
                        alert.ccaa,
                        <span key="nif" className="font-mono">{alert.nif}</span>,
                        alert.anio,
                      ]}
                    />
                  }
                  metric={formatEuro(alert.importeSuma)}
                  metricLabel={`${formatNumber(alert.n)} ${alert.n === 1 ? "concesión" : "concesiones"}`}
                  footer={
                    <>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                        {alert.fuenteUrl ? <ExternalLink href={alert.fuenteUrl}>Fuente del cargo</ExternalLink> : null}
                        {alert.fuente ? <span className="text-muted">{alert.fuente}</span> : null}
                      </div>
                      {alert.items.length > 0 ? (
                        <AlertDisclosure label="Ver concesiones" count={alert.items.length}>
                          <AlertEvidenceList
                            items={alert.items.map((item) => ({
                              key: String(item.concesionId),
                              amount: item.importe,
                              date: item.fecha,
                              title: item.titulo,
                              href: `/concesiones/${item.concesionId}`,
                            }))}
                          />
                        </AlertDisclosure>
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
                      detail: partyDetail,
                      dates: `Mandato: ${formatDate(alert.mandatoDesde)} – ${formatDate(alert.mandatoHasta)}`,
                    }}
                    right={{
                      eyebrow: "En la sociedad",
                      title: alert.adminNombre,
                      detail: alert.adminCargo || "Cargo no informado",
                      dates: companyTenure(alert),
                    }}
                  />
                </AlertCard>
              </li>
            );
          })}
        </ol>
      )}
      <AlertPager path="/alertas/vinculos" filters={filters} total={loaded.total} pageSize={loaded.pageSize} />
    </>
  );
};

export default VinculosPage;
