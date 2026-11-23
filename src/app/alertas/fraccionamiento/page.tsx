import Link from "next/link";
import { AlertBanner } from "@/components/alert-banner";
import { AlertFilterForm, AlertPager } from "@/components/alert-filters";
import { EmptyState, PageIntro, SetupNeeded } from "@/components/setup-needed";
import { DatabaseMissingError, guard } from "@/lib/db";
import { listFraccionamiento, parseAlertFilters, type AlertSearch } from "@/lib/alerts";
import { formatDate, formatEuro } from "@/lib/format";

const umbralLabel = (codigo: string, umbral: number) => {
  if (codigo === "de_minimis") {
    return `De minimis ${formatEuro(umbral)}`;
  }
  if (codigo === "contrato_menor_servicios") {
    return `Referencia ${formatEuro(umbral)} (menor de servicios)`;
  }
  if (codigo === "contrato_menor_obras") {
    return `Referencia ${formatEuro(umbral)} (menor de obras)`;
  }
  return formatEuro(umbral);
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
        <p>
          Solo entidades privadas, y solo si las ayudas salen de convocatorias distintas. Cada importe está entre el 90 %
          y el 100 % de un umbral (15.000 €, 40.000 € o 200.000 €) en 90 días, o varias piezas de al menos 50.000 €
          suman entre 190.000 € y 200.000 € en 180 días. Además, la mediana del grupo tiene que superar lo que ese
          organismo suele conceder a privados (percentil 75). Se descartan pagos de la misma convocatoria, importes
          idénticos, beneficiarios públicos o universidades, y los meses en los que el organismo repite el patrón con
          más de tres beneficiarios: eso parece un programa, no un fraccionamiento.
        </p>
      </PageIntro>
      <AlertBanner>
        Un mismo beneficiario puede cobrar varias ayudas legales. El indicador solo señala la cercanía al umbral y la
        repetición. Abre cada concesión para ver el expediente.
      </AlertBanner>
      <AlertFilterForm
        action="/alertas/fraccionamiento"
        filters={filters}
        ccaa={loaded.ccaa}
        anios={loaded.anios}
        organismos={loaded.organismos}
      />
      {loaded.alerts.length === 0 ? (
        <EmptyState>Ningún indicador con estos filtros.</EmptyState>
      ) : (
        <ol className="grid gap-4">
          {loaded.alerts.map((alert) => (
            <li key={alert.id} className="xp-card">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="xp-heading">
                  {alert.beneficiarioId ? (
                    <Link href={`/beneficiarios/${alert.beneficiarioId}`} className="xp-link font-normal">
                      {alert.nombre}
                    </Link>
                  ) : (
                    alert.nombre
                  )}
                </h2>
                <p className="text-sm font-semibold tabular-nums">
                  {Math.round(alert.puntuacion)} pts · {formatEuro(alert.importeSuma)}
                </p>
              </div>
              <p className="mt-1 text-sm text-muted">
                {alert.nif} · {alert.organismo} · {alert.ccaa} · {umbralLabel(alert.umbralCodigo, alert.umbral)} ·{" "}
                {alert.regla === "suma" ? "por la suma" : "por la banda"}
              </p>
              <p className="mt-3 text-sm leading-relaxed">{alert.motivo}</p>
              <p className="mt-2 text-sm text-muted">
                {formatDate(alert.fechaInicio)} – {formatDate(alert.fechaFin)} · {alert.n} concesiones
              </p>
              <ul className="mt-3 xp-inset-list">
                {alert.items.map((item) => (
                  <li key={item.concesionId} className="flex flex-col gap-1 px-3 py-2 text-sm sm:flex-row sm:items-baseline sm:justify-between">
                    <Link href={`/concesiones/${item.concesionId}`} className="xp-link">
                      {formatEuro(item.importe)} el {formatDate(item.fecha)}
                    </Link>
                    <span className="text-muted sm:max-w-[60%] sm:text-right">{item.titulo}</span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      )}
      <AlertPager path="/alertas/fraccionamiento" filters={filters} total={loaded.total} pageSize={loaded.pageSize} />
    </>
  );
};

export default FraccionamientoPage;
