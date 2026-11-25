import Link from "next/link";
import { AlertBanner } from "@/components/alert-banner";
import { AlertFilterForm, AlertPager } from "@/components/alert-filters";
import { EmptyState, PageIntro, SetupNeeded } from "@/components/setup-needed";
import { listConcentracion, listRecurrentes, parseAlertFilters, type AlertSearch } from "@/lib/alerts";
import { DatabaseMissingError, guard } from "@/lib/db";
import { formatEuro, formatNumber } from "@/lib/format";

const percent = (value: number) =>
  new Intl.NumberFormat("es-ES", { style: "percent", maximumFractionDigits: 1 }).format(value);

const ConcentracionPage = async ({ searchParams }: { searchParams: Promise<AlertSearch> }) => {
  const raw = await searchParams;
  const filters = parseAlertFilters(raw);
  const repeticion = raw.repeticion;
  const showRepeticion = repeticion === "1" || (Array.isArray(repeticion) && repeticion[0] === "1");
  const loaded = await guard(async () => {
    try {
      const concentracion = await listConcentracion(filters);
      const recurrentes = showRepeticion ? await listRecurrentes(filters) : null;
      return { concentracion, recurrentes };
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
      <PageIntro eyebrow="Concentración" title="Falta calcular este indicador">
        <p>
          Ejecuta <code>python3 pipeline/alerts.py concentracion</code>.
        </p>
      </PageIntro>
    );
  }

  const yearLabel = filters.anio ? filters.anio : "todo el periodo del volcado";

  return (
    <>
      <PageIntro eyebrow="Concentración" title="Quién se queda el importe de cada organismo">
        <p>
          Solo subvenciones dinerarias. El índice de Herfindahl (HHI) suma el cuadrado de la cuota de cada
          beneficiario: 0 es reparto total y 1 es un único perceptor. Se marca el organismo cuando, con al menos 20
          concesiones y 4 beneficiarios, el HHI llega a 0,25 o el mayor perceptor se lleva la mitad o más. 0,25 es la
          escala que el Departamento de Justicia de EE. UU. llama «muy concentrado» en mercados; aquí es solo una regla
          de lectura.
        </p>
      </PageIntro>
      <AlertBanner>
        Una diputación que financia siempre a la misma residencia, o un ministerio que concentra proyectos en pocas
        universidades, puede estar aplicando una política explícita. El indicador no dice que esa política sea irregular.
      </AlertBanner>
      <AlertFilterForm
        action="/alertas/concentracion"
        filters={filters}
        ccaa={loaded.concentracion.ccaa}
        anios={loaded.concentracion.anios}
        organismos={loaded.concentracion.organismos}
      />
      <p className="mb-3 text-sm text-muted">
        Vista: {yearLabel}. Organismos con al menos 15 concesiones. En el periodo completo hay{" "}
        {formatNumber(loaded.concentracion.flagged)} por encima del umbral.
      </p>
      {loaded.concentracion.rows.length === 0 ? (
        <EmptyState>Ningún organismo con estos filtros.</EmptyState>
      ) : (
        <div className="xp-table-frame">
          <table className="xp-table">
            <caption className="sr-only">Concentración del importe por organismo</caption>
            <thead>
              <tr>
                <th scope="col" className="px-3 py-2">Organismo</th>
                <th scope="col" className="px-3 py-2">Territorio</th>
                <th scope="col" className="px-3 py-2 text-right">HHI</th>
                <th scope="col" className="px-3 py-2 text-right">Mayor</th>
                <th scope="col" className="px-3 py-2 text-right">5 mayores</th>
                <th scope="col" className="px-3 py-2 text-right">Concesiones</th>
                <th scope="col" className="px-3 py-2 text-right">Importe</th>
              </tr>
            </thead>
            <tbody>
              {loaded.concentracion.rows.map((row) => (
                <tr key={row.id} className="border-t border-line align-top">
                  <th scope="row" className="px-3 py-2 text-left font-semibold">
                    <Link
                      href={`/concesiones?organismo=${encodeURIComponent(row.organismo)}`}
                      className="xp-link font-normal"
                    >
                      {row.organismo}
                    </Link>
                    {row.alerta ? <span className="mt-1 block text-xs font-semibold text-terra">Por encima del umbral</span> : null}
                  </th>
                  <td className="px-3 py-2">{row.ccaa}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{row.hhi.toLocaleString("es-ES", { maximumFractionDigits: 3 })}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{percent(row.top1)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{percent(row.top5)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatNumber(row.n)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatEuro(row.importe)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <AlertPager path="/alertas/concentracion" filters={filters} total={loaded.concentracion.total} pageSize={loaded.concentracion.pageSize} />

      <h2 className="mt-12 xp-heading xp-heading-lg">Ganadores que repiten</h2>
      <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted">
        Repetir una ayuda varios años es habitual. La lista no se abre sola. Solo entran entidades privadas que no son
        universidades, con al menos cuatro años y un millón de euros.
      </p>
      {loaded.recurrentes === null ? (
        <p className="mt-4 text-sm">
          <Link href="/alertas/concentracion?repeticion=1" className="xp-link">
            Ver beneficiarios que repiten
          </Link>
        </p>
      ) : loaded.recurrentes.rows.length === 0 ? (
        <EmptyState>Ningún beneficiario recurrente con estos filtros.</EmptyState>
      ) : (
        <ol className="mt-4 grid gap-3">
          {loaded.recurrentes.rows.map((row) => (
            <li key={row.id} className="xp-card">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="xp-heading">
                  {row.beneficiarioId ? (
                    <Link href={`/beneficiarios/${row.beneficiarioId}`} className="xp-link font-normal">
                      {row.nombre}
                    </Link>
                  ) : (
                    row.nombre
                  )}
                </h3>
                <p className="text-sm font-semibold tabular-nums">{formatEuro(row.importe)}</p>
              </div>
              <p className="mt-1 text-sm text-muted">
                {row.nif} · {row.organismo} · {row.ccaa}
              </p>
              <p className="mt-2 text-sm leading-relaxed">
                Cobra de este organismo en {row.nAnios} años ({row.anios.join(", ")}), con {formatNumber(row.n)}{" "}
                concesiones. Es un indicador de repetición, no de un trato irregular.
              </p>
            </li>
          ))}
        </ol>
      )}
      {loaded.recurrentes ? (
        <AlertPager
          path="/alertas/concentracion"
          filters={filters}
          total={loaded.recurrentes.total}
          pageSize={loaded.recurrentes.pageSize}
          field="pagina"
        />
      ) : null}
    </>
  );
};

export default ConcentracionPage;
