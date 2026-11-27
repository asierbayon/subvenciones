import Link from "next/link";
import { AlertBanner, type MethodologyItem } from "@/components/alert-banner";
import { AlertFilterForm, AlertPager } from "@/components/alert-filters";
import { AlertResultsBar, InlinePercentBar, alertLinkClass } from "@/components/alert-ui";
import { EmptyState, PageIntro, SetupNeeded } from "@/components/setup-needed";
import { listDirecta, parseAlertFilters, type AlertSearch } from "@/lib/alerts";
import { DatabaseMissingError, guard } from "@/lib/db";
import { formatNumber } from "@/lib/format";

const METHODOLOGY: MethodologyItem[] = [
  {
    label: "Proxy de texto",
    text: "El volcado de la BDNS no incluye el campo de procedimiento. Se buscan «concesión directa», «concessió directa» y «nominativ» en el título.",
  },
  {
    label: "Qué cubre",
    text: "Solo subvenciones dinerarias. Ordena organismos por volumen y cuota de concesiones con esa mención en el título.",
  },
  {
    label: "Limitación",
    text: "Las ayudas directas que no mencionan el procedimiento en el título no entran en este recuento.",
  },
];

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
        <p>Organismos cuyas convocatorias mencionan concesión directa o subvención nominativa en el título.</p>
      </PageIntro>
      <AlertBanner methodology={METHODOLOGY}>
        La concesión directa o nominativa está prevista en la ley. Es solo la pista textual disponible en este volcado.
      </AlertBanner>
      <AlertFilterForm
        action="/alertas/directa"
        filters={filters}
        ccaa={loaded.ccaa}
        anios={[]}
        organismos={loaded.organismos}
      />
      <AlertResultsBar
        total={loaded.total}
        shown={loaded.rows.length}
        page={filters.page}
        pageSize={loaded.pageSize}
        singular="organismo"
        plural="organismos"
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
                    <Link
                      href={`/concesiones?organismo=${encodeURIComponent(row.organismo)}`}
                      className={alertLinkClass}
                    >
                      {row.organismo}
                    </Link>
                  </th>
                  <td className="px-4 py-3 text-muted">{row.ccaa}</td>
                  <td className="px-4 py-3 text-right">
                    <InlinePercentBar
                      ratio={row.cuota}
                      label={`${(row.cuota * 100).toLocaleString("es-ES", { maximumFractionDigits: 1 })} %`}
                      tone={row.cuota >= 0.5 ? "terra" : "accent"}
                    />
                  </td>
                  <td className="px-4 py-3 text-right text-muted tabular-nums">{formatNumber(row.nDirecta)}</td>
                  <td className="px-4 py-3 text-right text-muted tabular-nums">{formatNumber(row.nNominativa)}</td>
                  <td className="px-4 py-3 text-right font-semibold text-ink tabular-nums">{formatNumber(row.n)}</td>
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
