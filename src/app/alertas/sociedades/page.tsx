import Link from "next/link";
import { AlertBanner } from "@/components/alert-banner";
import { AlertFilterForm, AlertPager } from "@/components/alert-filters";
import { ExternalLink } from "@/components/facts";
import { EmptyState, PageIntro, SetupNeeded } from "@/components/setup-needed";
import { Badge } from "@/components/ui/badge";
import { DatabaseMissingError, guard } from "@/lib/db";
import { formatDate, formatEuro } from "@/lib/format";
import {
  confianzaLabel,
  listSociedades,
  parseAlertFilters,
  reglaLabel,
  SOCIEDAD_REGLAS,
  type AlertSearch,
} from "@/lib/registro";

const SociedadesPage = async ({ searchParams }: { searchParams: Promise<AlertSearch> }) => {
  const filters = parseAlertFilters(await searchParams);
  const loaded = await guard(async () => {
    try {
      return await listSociedades(filters);
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

  return (
    <>
      <PageIntro eyebrow="Registro mercantil" title="Sociedades recién creadas o de poco capital">
        <p>
          Cruza las sociedades del volcado con los anuncios del BORME de 2016 a 2023. Marca una subvención dineraria
          de al menos 10.000 € cuando la sociedad se constituye poco antes, con un capital de hasta 3.100 €, cuando se
          disuelve o se extingue poco después, o cuando la ayuda es al menos diez veces ese capital.
        </p>
      </PageIntro>
      <AlertBanner>
        El capital social no es el patrimonio ni la facturación. Una sociedad limitada nueva con 3.100 € o menos puede ser una
        empresa pequeña perfectamente regular. El BORME no publica el NIF de forma sistemática: el cruce es por el
        nombre normalizado y se muestra la confianza.
      </AlertBanner>
      <AlertFilterForm
        action="/alertas/sociedades"
        filters={filters}
        ccaa={loaded.ccaa}
        anios={loaded.anios}
        organismos={loaded.organismos}
        tipos={SOCIEDAD_REGLAS}
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
                    <Link
                      href={`/beneficiarios/${alert.beneficiarioId}`}
                      className="underline decoration-line underline-offset-2 hover:decoration-accent"
                    >
                      {alert.nombre}
                    </Link>
                  ) : (
                    alert.nombre
                  )}
                </h2>
                <p className="text-sm font-semibold tabular-nums">{formatEuro(alert.importe)}</p>
              </div>
              <p className="mt-1 text-sm text-muted">
                {alert.nif} · {alert.organismo} · {alert.ccaa} · {alert.anio || "sin año"}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Badge tone="terra">{reglaLabel(alert.regla)}</Badge>
                <Badge tone={alert.confianza === "alta" ? "accent" : "neutral"}>{confianzaLabel(alert.confianza)}</Badge>
              </div>
              <p className="mt-3 text-sm leading-relaxed">{alert.motivo}</p>
              <p className="mt-2 text-sm text-muted">
                {alert.fechaConstitucion ? `Constitución ${formatDate(alert.fechaConstitucion)}. ` : ""}
                {alert.capital !== null ? `Capital de referencia ${formatEuro(alert.capital)}. ` : ""}
                {alert.fechaDisolucion ? `Cierre publicado ${formatDate(alert.fechaDisolucion)}. ` : ""}
                {alert.fuenteUrl ? (
                  <ExternalLink href={alert.fuenteUrl}>{alert.fuenteCve || "Anuncio en el BORME"}</ExternalLink>
                ) : null}
              </p>
              <ul className="mt-3 divide-y divide-line rounded-2xl border border-line">
                {alert.items.map((item) => (
                  <li key={item.concesionId} className="flex flex-col gap-1 px-3 py-2 text-sm sm:flex-row sm:items-baseline sm:justify-between">
                    <Link
                      href={`/concesiones/${item.concesionId}`}
                      className="font-semibold underline decoration-line underline-offset-2 hover:decoration-accent"
                    >
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
      <AlertPager path="/alertas/sociedades" filters={filters} total={loaded.total} pageSize={loaded.pageSize} />
    </>
  );
};

export default SociedadesPage;
