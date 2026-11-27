import Link from "next/link";
import { AlertBanner, type MethodologyItem } from "@/components/alert-banner";
import { AlertFilterForm, AlertPager } from "@/components/alert-filters";
import {
  AlertCard,
  AlertDisclosure,
  AlertEvidenceList,
  AlertFactStrip,
  AlertFlow,
  AlertMetaRow,
  AlertResultsBar,
  alertLinkClass,
} from "@/components/alert-ui";
import { ExternalLink } from "@/components/facts";
import { EmptyState, PageIntro, SetupNeeded } from "@/components/setup-needed";
import { Badge } from "@/components/ui/badge";
import { DatabaseMissingError, guard } from "@/lib/db";
import { parseAlertFilters, type AlertSearch } from "@/lib/alerts";
import { formatDate, formatEuro, formatNumber } from "@/lib/format";
import { listPuertas, type PuertaAlert } from "@/lib/puertas";

const TIPOS = [
  { value: "despues", label: "Después del cese" },
  { value: "durante", label: "Durante el mandato" },
];

const ROLES: Record<string, string> = {
  alcalde: "Alcaldía",
  concejal: "Concejal electo",
  consejero_insular: "Cabildo",
  diputado: "Diputado autonómico",
  alto_cargo: "Alto cargo",
};

const COHERENCIA: Record<string, string> = {
  municipio: "Mismo municipio",
  mancomunidad: "Mancomunidad",
  isla: "Misma isla",
  provincia: "Misma provincia",
  ministerio: "Mismo ministerio",
  parlamento: "Parlamento",
};

const METHODOLOGY: MethodologyItem[] = [
  {
    label: "Patrón detectado",
    text: "Un cargo deja el órgano y, en los 4 años siguientes, el BORME le nombra administrador o consejero en una sociedad que cobró ayudas o contratos de ese órgano.",
  },
  {
    label: "Ceses supuestos",
    text: "Los electos de 2015 no repetidos cierran el 14 jun 2019; los de 2019 cierran el 16 jun 2023 (sin padrón de 2023). Altos cargos salen de la sección II.A del BOE.",
  },
  {
    label: "Límites",
    text: "Un homónimo basta para coincidir el nombre, quien repitió en 2023 puede figurar como cesado y las fechas de concejal son las del mandato, no la dimisión.",
  },
];

const roleLabel = (rol: string) => ROLES[rol] ?? rol;

const coherenciaLabel = (value: string) => COHERENCIA[value] ?? value;

const scoreLabel = (value: number) => `${Math.round(value * 100).toLocaleString("es-ES")} %`;

const CompanyName = ({ alert }: { alert: PuertaAlert }) => {
  if (!alert.beneficiarioId) {
    return alert.empresa;
  }
  return (
    <Link href={`/beneficiarios/${alert.beneficiarioId}`} className={alertLinkClass}>
      {alert.empresa}
    </Link>
  );
};

const connectorText = (alert: PuertaAlert) => {
  if (alert.tipo === "durante") {
    return "Durante el mandato";
  }
  return `+${formatNumber(alert.dias)} días tras cese`;
};

const AlertList = ({ alerts }: { alerts: PuertaAlert[] }) => {
  if (alerts.length === 0) {
    return <EmptyState>Ningún indicador con estos filtros.</EmptyState>;
  }
  return (
    <ol className="grid gap-4">
      {alerts.map((alert) => {
        const partyText = alert.partido ? `${alert.cuerpo} · ${alert.partido}` : alert.cuerpo;
        const movementsCount = alert.items.length;

        return (
          <li key={alert.id}>
            <AlertCard
              tone={alert.tipo === "despues" ? "terra" : "accent"}
              badges={
                <>
                  {alert.tipo === "durante" ? (
                    <Badge tone="accent">Durante el mandato</Badge>
                  ) : (
                    <Badge tone="terra">Después del cese</Badge>
                  )}
                  <Badge tone="terra">{roleLabel(alert.rol)}</Badge>
                  <Badge>{coherenciaLabel(alert.coherencia)}</Badge>
                  <Badge>Puntuación {scoreLabel(alert.puntuacion)}</Badge>
                </>
              }
              title={alert.politicoNombre}
              subtitle={
                <AlertMetaRow
                  items={[
                    <CompanyName key="co" alert={alert} />,
                    <span key="nif" className="font-mono">{alert.nif}</span>,
                    alert.organismo,
                  ]}
                />
              }
              metric={formatEuro(alert.importeMandato)}
              metricLabel="En el mandato"
              footer={
                <>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                    {alert.fuenteUrl ? (
                      <ExternalLink href={alert.fuenteUrl}>
                        {alert.fuenteBorme ? `Anuncio ${alert.fuenteBorme}` : "Anuncio en el BORME"}
                      </ExternalLink>
                    ) : (
                      <span className="text-muted">BORME sin identificador</span>
                    )}
                    {alert.fuentePoliticoUrl ? (
                      <ExternalLink href={alert.fuentePoliticoUrl}>Fuente del cargo</ExternalLink>
                    ) : null}
                  </div>
                  {movementsCount > 0 ? (
                    <AlertDisclosure label="Ver subvenciones y contratos" count={movementsCount}>
                      <AlertEvidenceList
                        items={alert.items.map((item) => ({
                          key: `${item.clase}-${item.ref}-${item.fecha}`,
                          amount: item.importe,
                          date: item.fecha,
                          title: item.titulo,
                          tag: item.clase === "contrato" ? "Contrato" : "Subvención",
                          href:
                            item.clase === "contrato"
                              ? item.url || undefined
                              : item.ref
                                ? `/concesiones/${item.ref}`
                                : undefined,
                          external: item.clase === "contrato",
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
              <div className="grid gap-3">
                <AlertFlow
                  connector={connectorText(alert)}
                  connectorTone={alert.tipo === "despues" ? "terra" : "accent"}
                  left={{
                    eyebrow: "1. Cargo público",
                    title: partyText,
                    detail: `Cese supuesto: ${formatDate(alert.cese)}`,
                    dates: `Mandato: ${formatDate(alert.mandatoDesde)} – ${formatDate(alert.mandatoHasta)}`,
                  }}
                  right={{
                    eyebrow: "2. Entra en la sociedad",
                    title: alert.adminCargo || "Administrador",
                    detail: `${alert.adminNombre} · ${alert.empresa}`,
                    dates: `Nombramiento BORME: ${formatDate(alert.nombramiento)}`,
                  }}
                />
                <AlertFactStrip
                  columns={4}
                  items={[
                    { label: "Cobrado en mandato", value: formatEuro(alert.importeMandato), highlight: true },
                    { label: "Total hasta nombramiento", value: formatEuro(alert.importePrevio) },
                    { label: "Subvenciones", value: formatNumber(alert.nAyudas) },
                    { label: "Contratos", value: formatNumber(alert.nContratos) },
                  ]}
                />
              </div>
            </AlertCard>
          </li>
        );
      })}
    </ol>
  );
};

const PartialNote = ({ parcial }: { parcial: boolean }) => {
  if (!parcial) {
    return null;
  }
  return (
    <AlertBanner title="Cálculo parcial">
      Esta tabla se calculó con una muestra de anuncios del BORME (<code>--limit</code>), no el pase completo.
    </AlertBanner>
  );
};

const PuertasPage = async ({ searchParams }: { searchParams: Promise<AlertSearch> }) => {
  const filters = parseAlertFilters(await searchParams);
  const loaded = await guard(async () => {
    try {
      return await listPuertas(filters);
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
      <PageIntro eyebrow="Puertas giratorias" title="Falta calcular este indicador">
        <p>
          Hace falta el índice, los cargos y el extracto del BORME con la tabla <code>acto</code> (fechas de anuncio).
          En la raíz del proyecto: <code>python3 pipeline/puertas_giratorias.py</code>. No reconstruye la base ni vuelve
          a bajar el BORME.
        </p>
      </PageIntro>
    );
  }

  return (
    <>
      <PageIntro eyebrow="Puertas giratorias" title="Quien deja el cargo y entra en la empresa que cobró">
        <p>Cargos públicos nombrados administradores en empresas que cobraron ayudas o contratos de su antiguo órgano.</p>
      </PageIntro>
      <AlertBanner methodology={METHODOLOGY}>
        Un homónimo puede coincidir en el nombre y quien repitió en 2023 puede salir como cesado. No demuestra que
        firmara el expediente.
      </AlertBanner>
      <PartialNote parcial={loaded.meta.parcial} />
      <AlertFilterForm
        action="/alertas/puertas-giratorias"
        filters={filters}
        ccaa={loaded.ccaa}
        anios={loaded.anios}
        organismos={loaded.organismos}
        tipos={TIPOS}
      />
      <AlertResultsBar
        total={loaded.total}
        shown={loaded.alerts.length}
        page={filters.page}
        pageSize={loaded.pageSize}
        singular="caso"
        plural="casos"
      />
      <AlertList alerts={loaded.alerts} />
      <AlertPager
        path="/alertas/puertas-giratorias"
        filters={filters}
        total={loaded.total}
        pageSize={loaded.pageSize}
      />
    </>
  );
};

export default PuertasPage;
