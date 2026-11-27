import Link from "next/link";
import { AlertBanner, type MethodologyItem } from "@/components/alert-banner";
import { AlertFilterForm, AlertPager } from "@/components/alert-filters";
import {
  AlertCard,
  AlertDisclosure,
  AlertEvidenceList,
  AlertFactStrip,
  AlertMetaRow,
  AlertResultsBar,
  AlertTabs,
  alertLinkClass,
  type AlertFactItem,
} from "@/components/alert-ui";
import { ExternalLink } from "@/components/facts";
import { EmptyState, PageIntro, SetupNeeded } from "@/components/setup-needed";
import { Badge } from "@/components/ui/badge";
import { alertQuery } from "@/lib/alerts";
import { DatabaseMissingError, guard } from "@/lib/db";
import { formatDate, formatEuro, formatNumber } from "@/lib/format";
import {
  confianzaLabel,
  listSociedades,
  parseAlertFilters,
  reglaLabel,
  SOCIEDAD_REGLAS,
  type AlertSearch,
} from "@/lib/registro";

const METHODOLOGY: MethodologyItem[] = [
  {
    label: "Reglas BORME (2016–2023)",
    text: "Subvención dineraria ≥ 10.000 € a sociedad recién constituida con capital ≤ 3.100 €, disuelta poco después o cuya ayuda supera 10× su capital.",
  },
  {
    label: "Vehículos de proyecto",
    text: "En convocatorias de IDAE e incentivos regionales es habitual crear una sociedad vehículo con capital mínimo; se ocultan por defecto salvo señal adicional.",
  },
  {
    label: "Cruce por nombre",
    text: "El BORME rara vez publica el NIF, así que el emparejamiento se hace por denominación normalizada e indica si la confianza es alta o media.",
  },
];

const ratioText = (ratio: number | null) => {
  if (ratio === null || ratio <= 0) {
    return null;
  }
  return `${ratio.toLocaleString("es-ES", { maximumFractionDigits: ratio >= 10 ? 0 : 1 })}× el capital`;
};

const SociedadesPage = async ({ searchParams }: { searchParams: Promise<AlertSearch> }) => {
  const raw = await searchParams;
  const filters = parseAlertFilters(raw);
  const vehiculos = raw.vehiculos;
  const includeVehicles = vehiculos === "1" || (Array.isArray(vehiculos) && vehiculos[0] === "1");
  const loaded = await guard(async () => {
    try {
      return await listSociedades(filters, includeVehicles);
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
      <PageIntro eyebrow="Registro mercantil" title="Falta calcular este indicador">
        <p>
          El índice de concesiones está, pero todavía no se ha cruzado con el BORME. En la raíz del proyecto:{" "}
          <code>python3 pipeline/borme.py run</code>. El paso es opcional: el índice base se construye sin él.
        </p>
      </PageIntro>
    );
  }

  const baseQuery = alertQuery(filters, { page: 1 });
  const mainTabHref = `/alertas/sociedades${baseQuery}`;
  const vehiclesTabHref = baseQuery
    ? `/alertas/sociedades${baseQuery}&vehiculos=1`
    : "/alertas/sociedades?vehiculos=1";

  return (
    <>
      <PageIntro eyebrow="Registro mercantil" title="Sociedades recién creadas o de poco capital">
        <p>Empresas constituidas poco antes de la ayuda, con capital mínimo o disueltas poco después según el BORME.</p>
      </PageIntro>
      <AlertBanner methodology={METHODOLOGY}>
        El capital social no refleja el patrimonio ni la facturación. Una sociedad limitada con 3.000 € puede operar con
        total normalidad.
      </AlertBanner>
      <AlertTabs
        label="Incluir vehículos de proyecto"
        items={[
          { href: mainTabHref, label: "Señales principales", active: !includeVehicles },
          { href: vehiclesTabHref, label: "Incluir vehículos de proyecto", active: includeVehicles },
        ]}
      />
      <AlertFilterForm
        action="/alertas/sociedades"
        filters={filters}
        ccaa={loaded.ccaa}
        anios={loaded.anios}
        organismos={loaded.organismos}
        tipos={SOCIEDAD_REGLAS}
        hiddenFields={includeVehicles ? { vehiculos: "1" } : undefined}
        clearHref={includeVehicles ? "/alertas/sociedades?vehiculos=1" : "/alertas/sociedades"}
      />
      <AlertResultsBar
        total={loaded.total}
        shown={loaded.alerts.length}
        page={filters.page}
        pageSize={loaded.pageSize}
        singular="sociedad"
        plural="sociedades"
      />
      {loaded.alerts.length === 0 ? (
        <EmptyState>Ningún indicador con estos filtros.</EmptyState>
      ) : (
        <ol className="grid gap-4">
          {loaded.alerts.map((alert) => {
            const ratioLabel = ratioText(alert.ratio);
            const facts: AlertFactItem[] = [
              { label: "Ayuda recibida", value: formatEuro(alert.importe), highlight: true },
              {
                label: "Capital BORME",
                value: alert.capital !== null ? formatEuro(alert.capital) : "—",
                hint: ratioLabel ?? undefined,
              },
              {
                label: "Constitución",
                value: alert.fechaConstitucion ? formatDate(alert.fechaConstitucion) : "—",
              },
              {
                label: alert.fechaDisolucion ? "Cierre publicado" : "Desfase temporal",
                value: alert.fechaDisolucion
                  ? formatDate(alert.fechaDisolucion)
                  : alert.dias !== null
                    ? `${formatNumber(alert.dias)} días`
                    : "—",
                highlight: Boolean(alert.fechaDisolucion),
              },
            ];

            return (
              <li key={alert.id}>
                <AlertCard
                  tone="terra"
                  badges={
                    <>
                      <Badge tone="terra">{reglaLabel(alert.regla)}</Badge>
                      <Badge tone={alert.confianza === "alta" ? "accent" : "neutral"}>
                        {confianzaLabel(alert.confianza)}
                      </Badge>
                      {ratioLabel ? <Badge>{ratioLabel}</Badge> : null}
                    </>
                  }
                  title={
                    alert.beneficiarioId ? (
                      <Link href={`/beneficiarios/${alert.beneficiarioId}`} className={alertLinkClass}>
                        {alert.nombre}
                      </Link>
                    ) : (
                      alert.nombre
                    )
                  }
                  subtitle={
                    <AlertMetaRow
                      items={[
                        alert.organismo,
                        alert.ccaa,
                        <span key="nif" className="font-mono">{alert.nif}</span>,
                        alert.anio || "sin año",
                      ]}
                    />
                  }
                  metric={formatEuro(alert.importe)}
                  metricLabel={alert.capital !== null ? `Capital: ${formatEuro(alert.capital)}` : undefined}
                  footer={
                    <>
                      {alert.fuenteUrl ? (
                        <div className="text-xs">
                          <ExternalLink href={alert.fuenteUrl}>{alert.fuenteCve || "Anuncio en el BORME"}</ExternalLink>
                        </div>
                      ) : null}
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
                  <AlertFactStrip columns={4} items={facts} />
                </AlertCard>
              </li>
            );
          })}
        </ol>
      )}
      <AlertPager
        path="/alertas/sociedades"
        filters={filters}
        total={loaded.total}
        pageSize={loaded.pageSize}
        extraParams={includeVehicles ? { vehiculos: "1" } : undefined}
      />
    </>
  );
};

export default SociedadesPage;
