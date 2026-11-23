import Link from "next/link";
import { AlertBanner } from "@/components/alert-banner";
import { AlertFilterForm, AlertPager } from "@/components/alert-filters";
import { EmptyState, PageIntro, SetupNeeded } from "@/components/setup-needed";
import { listDirecta, parseAlertFilters, type AlertSearch } from "@/lib/alerts";
import { DatabaseMissingError, guard } from "@/lib/db";
import { formatNumber } from "@/lib/format";

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
          Ejecuta <code>python3 pipeline/alerts.py directa</code>.
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
        <div className="xp-table-frame">
          <table className="xp-table">
            <caption className="sr-only">Organismos ordenados por la cuota de títulos que mencionan concesión directa o nominativa</caption>
            <thead>
              <tr>
                <th scope="col" className="px-3 py-2">Organismo</th>
                <th scope="col" className="px-3 py-2">Territorio</th>
                <th scope="col" className="px-3 py-2 text-right">Cuota del título</th>
                <th scope="col" className="px-3 py-2 text-right">Directa</th>
                <th scope="col" className="px-3 py-2 text-right">Nominativa</th>
                <th scope="col" className="px-3 py-2 text-right">Concesiones</th>
              </tr>
            </thead>
            <tbody>
              {loaded.rows.map((row) => (
                <tr key={row.id} className="border-t border-line">
                  <th scope="row" className="px-3 py-2 text-left font-semibold">
                    <Link href={`/concesiones?organismo=${encodeURIComponent(row.organismo)}`} className="xp-link font-normal">
                      {row.organismo}
                    </Link>
                  </th>
                  <td className="px-3 py-2">{row.ccaa}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{(row.cuota * 100).toLocaleString("es-ES", { maximumFractionDigits: 1 })} %</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatNumber(row.nDirecta)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatNumber(row.nNominativa)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatNumber(row.n)}</td>
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
