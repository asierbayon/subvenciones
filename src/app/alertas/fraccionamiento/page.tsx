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
          Mismo NIF y mismo organismo. O bien cada importe cae entre el 80 % y el 100 % de un umbral en 90 días, o bien
          varias piezas de cierto tamaño suman justo menos de 200.000 € en 180 días.
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
            <li key={alert.id} className="rounded-3xl border border-line bg-elev p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="font-display text-2xl">
                  {alert.beneficiarioId ? (
                    <Link href={`/beneficiarios/${alert.beneficiarioId}`} className="underline decoration-line underline-offset-2 hover:decoration-accent">
                      {alert.nombre}
                    </Link>
                  ) : (
                    alert.nombre
                  )}
                </h2>
                <p className="text-sm font-semibold tabular-nums">{formatEuro(alert.importeSuma)}</p>
              </div>
              <p className="mt-1 text-sm text-muted">
                {alert.nif} · {alert.organismo} · {alert.ccaa} · {umbralLabel(alert.umbralCodigo, alert.umbral)} ·{" "}
                {alert.regla === "suma" ? "por la suma" : "por la banda"}
              </p>
              <p className="mt-3 text-sm leading-relaxed">{alert.motivo}</p>
              <p className="mt-2 text-sm text-muted">
                {formatDate(alert.fechaInicio)} – {formatDate(alert.fechaFin)} · {alert.n} concesiones
              </p>
              <ul className="mt-3 divide-y divide-line rounded-2xl border border-line">
                {alert.items.map((item) => (
                  <li key={item.concesionId} className="flex flex-col gap-1 px-3 py-2 text-sm sm:flex-row sm:items-baseline sm:justify-between">
                    <Link href={`/concesiones/${item.concesionId}`} className="font-semibold underline decoration-line underline-offset-2 hover:decoration-accent">
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
