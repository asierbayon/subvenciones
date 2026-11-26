import Link from "next/link";
import { AlertBanner } from "@/components/alert-banner";
import { AlertFilterForm, AlertPager } from "@/components/alert-filters";
import { EmptyState, PageIntro, SetupNeeded } from "@/components/setup-needed";
import { listDirecta, parseAlertFilters, type AlertSearch } from "@/lib/alerts";
import { DatabaseMissingError, guard } from "@/lib/db";
import { formatNumber } from "@/lib/format";

const linkClass =
  "font-medium text-accent underline decoration-accent/30 underline-offset-4 transition-colors hover:text-accent-strong hover:decoration-accent";

const DirectaPage = async ({ searchParams }: { searchParams: Promise<AlertSearch> }) => {
  const filters = parseAlertFilters(await searchParams);
  const loaded = await guard(async () => {
    try {
      return await listDirecta(filters);
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
      <PageIntro eyebrow="Concesión directa" title="Falta calcular este indicador">
        <p>
          Ejecuta{" "}
          <code className="rounded bg-subtle px-1.5 py-0.5 font-mono text-xs text-ink">
            python3 pipeline/alerts.py directa
          </code>
          .
        </p>
      </PageIntro>
    );
  }

  return (
    <>
      <PageIntro eyebrow="Concesión directa" title="Un proxy leído del título, no un campo de la BDNS">
        <p>
          El volcado no dice si la ayuda fue de concurrencia competitiva o de concesión directa. Aquí se cuenta, entre
          las subvenciones dinerarias de cada organismo, cuántos títulos contienen «concesión directa» (también en
          catalán, «concessió directa») o «nominativ». Es una lectura del texto, y se le escapan las que no lo escriben
          en el título.
        </p>
      </PageIntro>
      <AlertBanner>
        Una subvención nominativa está prevista en la ley. Que el título lo diga no es una irregularidad: es la pista
        más explícita que este fichero deja sobre el procedimiento.
      </AlertBanner>
      <AlertFilterForm
        action="/alertas/directa"
        filters={filters}
        ccaa={loaded.ccaa}
        anios={[]}
        organismos={loaded.organismos}
      />
      {loaded.rows.length === 0 ? (
        <EmptyState>Ningún organismo con estos filtros.</EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-elev shadow-2xs">
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">
              Organismos ordenados por la cuota de títulos que mencionan concesión directa o nominativa
            </caption>
            <thead>
              <tr className="border-b border-line bg-subtle/70 text-left text-xs font-semibold tracking-wider text-muted uppercase">
                <th scope="col" className="px-4 py-3">Organismo</th>
                <th scope="col" className="px-4 py-3">Territorio</th>
                <th scope="col" className="px-4 py-3 text-right">Cuota del título</th>
                <th scope="col" className="px-4 py-3 text-right">Directa</th>
                <th scope="col" className="px-4 py-3 text-right">Nominativa</th>
                <th scope="col" className="px-4 py-3 text-right">Concesiones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {loaded.rows.map((row) => (
                <tr key={row.id} className="transition-colors hover:bg-highlight/60">
                  <th scope="row" className="px-4 py-3 text-left font-medium">
                    <Link href={`/concesiones?organismo=${encodeURIComponent(row.organismo)}`} className={linkClass}>
                      {row.organismo}
                    </Link>
                  </th>
                  <td className="px-4 py-3 text-muted">{row.ccaa}</td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums">
                    {(row.cuota * 100).toLocaleString("es-ES", { maximumFractionDigits: 1 })} %
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-muted">{formatNumber(row.nDirecta)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-muted">{formatNumber(row.nNominativa)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-muted">{formatNumber(row.n)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <AlertPager path="/alertas/directa" filters={filters} total={loaded.total} pageSize={loaded.pageSize} />
    </>
  );
};

export default DirectaPage;
