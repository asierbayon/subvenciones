import Link from "next/link";
import { AlertBanner, type MethodologyItem } from "@/components/alert-banner";
import { AlertFilterForm, AlertPager } from "@/components/alert-filters";
import {
  AlertCard,
  AlertDisclosure,
  AlertEvidenceList,
  AlertFactStrip,
  AlertMetaRow,
  AlertMeter,
  AlertResultsBar,
  alertLinkClass,
} from "@/components/alert-ui";
import { EmptyState, PageIntro, SetupNeeded } from "@/components/setup-needed";
import { Badge } from "@/components/ui/badge";
import { DatabaseMissingError, guard } from "@/lib/db";
import { listFraccionamiento, parseAlertFilters, type AlertSearch } from "@/lib/alerts";
import { formatDate, formatEuro, formatNumber } from "@/lib/format";

const METHODOLOGY: MethodologyItem[] = [
  {
    label: "Reglas de umbral",
    text: "Cada ayuda entre el 90 % y el 100 % del de minimis (200.000 €) en 90 días, o piezas de al menos 50.000 € que suman 190.000–200.000 € en 180 días.",
  },
  {
    label: "Filtro de rareza",
    text: "Misma convocatoria y mismo organismo. La mediana del bloque debe superar el percentil 75 de lo que ese organismo concede a entidades privadas.",
  },
  {
    label: "Qué queda fuera",
    text: "NIF públicos/asociativos (P, Q, S, R, G), universidades, importes idénticos, pagos de convocatorias distintas y meses con más de 3 beneficiarios en el mismo patrón.",
  },
];

const umbralLabel = (codigo: string, umbral: number) => {
  if (codigo === "de_minimis") {
    return `De minimis (${formatEuro(umbral)})`;
  }
  if (codigo === "contrato_menor_servicios") {
    return `Menor servicios (${formatEuro(umbral)})`;
  }
  if (codigo === "contrato_menor_obras") {
    return `Menor obras (${formatEuro(umbral)})`;
  }
  return formatEuro(umbral);
};

const daysBetween = (start: string, end: string) => {
  const from = Date.parse(start);
  const to = Date.parse(end);
  if (Number.isNaN(from) || Number.isNaN(to)) {
    return null;
  }
  return Math.max(0, Math.round((to - from) / 86_400_000));
};

const FraccionamientoPage = async ({ searchParams }: { searchParams: Promise<AlertSearch> }) => {
  const filters = parseAlertFilters(await searchParams);
  const loaded = await guard(async () => {
    try {
      return await listFraccionamiento(filters);
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
      <PageIntro eyebrow="Fraccionamiento" title="Falta calcular este indicador">
        <p>
          El índice de concesiones está, pero todavía no se ha generado la tabla de alertas. En la raíz del proyecto:{" "}
          <code>python3 pipeline/alerts.py fraccionamiento</code>.
        </p>
      </PageIntro>
    );
  }

  return (
    <>
      <PageIntro eyebrow="Fraccionamiento" title="Varias ayudas justo por debajo de un umbral">
        <p>Entidades privadas que encadenan ayudas de la misma convocatoria muy cerca del límite de minimis.</p>
      </PageIntro>
      <AlertBanner methodology={METHODOLOGY}>
        Un beneficiario puede cobrar varias ayudas regulares. Esta señal solo ordena cercanía al umbral y concentración
        en el tiempo.
      </AlertBanner>
      <AlertFilterForm
        action="/alertas/fraccionamiento"
        filters={filters}
        ccaa={loaded.ccaa}
        anios={loaded.anios}
        organismos={loaded.organismos}
      />
      <AlertResultsBar
        total={loaded.total}
        shown={loaded.alerts.length}
        page={filters.page}
        pageSize={loaded.pageSize}
      />
      {loaded.alerts.length === 0 ? (
        <EmptyState>Ningún indicador con estos filtros.</EmptyState>
      ) : (
        <ol className="grid gap-4">
          {loaded.alerts.map((alert) => {
            const spanDays = daysBetween(alert.fechaInicio, alert.fechaFin);
            const avgAmount = alert.n > 0 ? alert.importeSuma / alert.n : alert.importeSuma;
            const thresholdRef = alert.regla === "suma" ? alert.importeSuma : avgAmount;
            const proximityPct = alert.umbral > 0 ? Math.min(100, (thresholdRef / alert.umbral) * 100) : 0;

            return (
              <li key={alert.id}>
                <AlertCard
                  tone="terra"
                  badges={
                    <>
                      <Badge tone="terra">{umbralLabel(alert.umbralCodigo, alert.umbral)}</Badge>
                      <Badge tone="accent">
                        {alert.regla === "suma" ? "Suma cerca del tope" : "Piezas en banda 90–100 %"}
                      </Badge>
                      <Badge>{Math.round(alert.puntuacion)}/100 pts</Badge>
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
                      items={[alert.organismo, alert.ccaa, <span key="nif" className="font-mono">{alert.nif}</span>]}
                    />
                  }
                  metric={formatEuro(alert.importeSuma)}
                  metricLabel={`${formatNumber(alert.n)} concesiones`}
                  footer={
                    <>
                      {alert.items.length > 0 ? (
                        <AlertDisclosure label="Ver concesiones del bloque" count={alert.items.length}>
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
                  <div className="grid gap-3">
                    <AlertMeter
                      percent={proximityPct}
                      tone="terra"
                      label={alert.regla === "suma" ? "Suma frente al umbral" : "Importe medio frente al umbral"}
                      valueLabel={`${Math.round(proximityPct)} % de ${formatEuro(alert.umbral)}`}
                      ariaLabel={`Cercanía al umbral: ${Math.round(proximityPct)} por ciento`}
                    />
                    <AlertFactStrip
                      columns={4}
                      items={[
                        {
                          label: "Ventana temporal",
                          value: spanDays !== null ? `${formatNumber(spanDays)} días` : "—",
                          hint: `${formatDate(alert.fechaInicio)} – ${formatDate(alert.fechaFin)}`,
                        },
                        {
                          label: "Concesiones",
                          value: formatNumber(alert.n),
                          hint: "Misma convocatoria",
                        },
                        {
                          label: "Importe medio",
                          value: formatEuro(avgAmount),
                          highlight: true,
                        },
                        {
                          label: "Habitual organismo (p75)",
                          value: alert.medianaOrganismo > 0 ? formatEuro(alert.medianaOrganismo) : "—",
                          hint: "Referencia a privados",
                        },
                      ]}
                    />
                  </div>
                </AlertCard>
              </li>
            );
          })}
        </ol>
      )}
      <AlertPager path="/alertas/fraccionamiento" filters={filters} total={loaded.total} pageSize={loaded.pageSize} />
    </>
  );
};

export default FraccionamientoPage;
