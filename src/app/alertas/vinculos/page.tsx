import Link from "next/link";
import { AlertBanner } from "@/components/alert-banner";
import { AlertFilterForm, AlertPager } from "@/components/alert-filters";
import { ExternalLink } from "@/components/facts";
import { EmptyState, PageIntro, SetupNeeded } from "@/components/setup-needed";
import { Badge } from "@/components/ui/badge";
import { DatabaseMissingError, guard } from "@/lib/db";
import { formatDate, formatEuro, formatNumber } from "@/lib/format";
import {
  listVinculos,
  parseAlertFilters,
  vinculoLabel,
  VINCULO_TIPOS,
  type AlertSearch,
} from "@/lib/registro";

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
      <PageIntro eyebrow="Registro mercantil" title="Falta calcular este indicador">
        <p>
          Ejecuta <code>python3 pipeline/borme.py run</code>. Hace falta el índice de concesiones y el extracto del
          BORME. El paso es opcional.
        </p>
      </PageIntro>
    );
  }

  return (
    <>
      <PageIntro eyebrow="Registro mercantil" title="Quién está detrás de las sociedades">
        <p>
          Agrupa beneficiarios con NIF distinto que cobran del mismo organismo y, en el BORME de 2016 a 2023, publican
          al mismo administrador, al mismo socio único o el mismo domicilio social. Solo entran los cruces de confianza
          alta.
        </p>
      </PageIntro>
      <AlertBanner>
        El BORME escribe el nombre de la persona sin DNI. Dos administradores homónimos pueden parecer el mismo, y una
        gestoría concentra domicilios. El indicador pide mirar los expedientes: no demuestra concertación.
      </AlertBanner>
      <AlertFilterForm
        action="/alertas/vinculos"
        filters={filters}
        ccaa={loaded.ccaa}
        anios={loaded.anios}
        organismos={loaded.organismos}
        tipos={VINCULO_TIPOS}
      />
      {loaded.alerts.length === 0 ? (
        <EmptyState>Ningún indicador con estos filtros.</EmptyState>
      ) : (
        <ol className="grid gap-4">
          {loaded.alerts.map((alert) => (
            <li key={alert.id} className="rounded-3xl border border-line bg-elev p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="font-display text-2xl">{alert.etiqueta}</h2>
                <p className="text-sm font-semibold tabular-nums">{formatEuro(alert.importe)}</p>
              </div>
              <p className="mt-1 text-sm text-muted">
                {alert.organismo} · {alert.ccaa} · {alert.anio || "sin año"} · {formatNumber(alert.nBeneficiarios)} sociedades
              </p>
              <div className="mt-3">
                <Badge tone="terra">{vinculoLabel(alert.tipo)}</Badge>
              </div>
              <p className="mt-3 text-sm leading-relaxed">{alert.motivo}</p>
              <ul className="mt-3 grid gap-3">
                {alert.miembros.map((miembro) => (
                  <li key={`${alert.id}-${miembro.beneficiarioId}`} className="rounded-2xl border border-line px-3 py-2">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      {miembro.beneficiarioId ? (
                        <Link
                          href={`/beneficiarios/${miembro.beneficiarioId}`}
                          className="font-semibold underline decoration-line underline-offset-2 hover:decoration-accent"
                        >
                          {miembro.nombre}
                        </Link>
                      ) : (
                        <span className="font-semibold">{miembro.nombre}</span>
                      )}
                      <span className="text-sm tabular-nums">{formatEuro(miembro.importe)}</span>
                    </div>
                    <p className="text-sm text-muted">
                      {miembro.nif} · {formatNumber(miembro.n)} subvenciones
                      {miembro.fuenteUrl ? (
                        <>
                          {" · "}
                          <ExternalLink href={miembro.fuenteUrl}>Anuncio en el BORME</ExternalLink>
                        </>
                      ) : null}
                    </p>
                    {miembro.items.length > 0 ? (
                      <ul className="mt-2 flex flex-col gap-1">
                        {miembro.items.map((item) => (
                          <li key={item.concesionId}>
                            <Link
                              href={`/concesiones/${item.concesionId}`}
                              className="text-sm underline decoration-line underline-offset-2 hover:decoration-accent"
                            >
                              {formatEuro(item.importe)} el {formatDate(item.fecha)}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    ) : null}
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
