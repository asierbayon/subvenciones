import { AlertBanner } from "@/components/alert-banner";
import { AlertFilterForm, AlertPager } from "@/components/alert-filters";
import { ContratoAlertCard } from "@/components/contratos-publicos";
import { EmptyState, PageIntro, SetupNeeded } from "@/components/setup-needed";
import { guard } from "@/lib/db";
import { parseAlertFilters, type AlertSearch } from "@/lib/alerts";
import { listContratos } from "@/lib/contratos";
import { formatNumber } from "@/lib/format";

const tipos = [
  { value: "menor_umbral", label: "Menores bajo el umbral" },
  { value: "menor", label: "Contrato menor" },
  { value: "sin_concurrencia", label: "Sin convocatoria abierta" },
  { value: "mismo_organo", label: "Mismo órgano" },
  { value: "organo_superior", label: "Misma jerarquía" },
  { value: "misma_administracion", label: "Misma administración" },
];

const coverageLine = (meta: Record<string, string>) => {
  const organismos = Number(meta.organismos ?? "");
  const conDir3 = Number(meta.organismos_dir3 ?? "");
  const conNombre = Number(meta.organismos_nombre ?? "");
  if (!Number.isFinite(organismos) || organismos <= 0) {
    return "";
  }
  const dir3Pct = Math.round((conDir3 / organismos) * 1000) / 10;
  const nombrePct = Math.round((conNombre / organismos) * 1000) / 10;
  return `Cobertura del emparejamiento: ${formatNumber(conNombre)} de ${formatNumber(organismos)} organismos con NIF (${nombrePct} %) tienen el mismo nombre normalizado que un órgano de la PLACSP, y ${formatNumber(conDir3)} (${dir3Pct} %) coinciden con un único código DIR3.`;
};

const ContratosAlertPage = async ({ searchParams }: { searchParams: Promise<AlertSearch> }) => {
  const filters = parseAlertFilters(await searchParams);
  const loaded = await guard(() => listContratos(filters));
  if (loaded === "missing") {
    return <SetupNeeded />;
  }
  if (!loaded) {
    return (
      <PageIntro eyebrow="Contratos públicos" title="Falta calcular este indicador">
        <p>
          El índice de concesiones está, pero todavía no se ha cruzado con la PLACSP. En la raíz del proyecto:{" "}
          <code className="rounded bg-subtle px-1.5 py-0.5 font-mono text-xs text-ink">
            python3 pipeline/contratos.py
          </code>
          . El paso es opcional y no hace falta para el resto de Faro.
        </p>
      </PageIntro>
    );
  }

  const cobertura = coverageLine(loaded.meta);

  return (
    <>
      <PageIntro eyebrow="Contratos públicos" title="Ayuda y contrato del mismo organismo">
        <p>
          El mismo NIF recibe una concesión y, a menos de 180 días, se adjudica un contrato del mismo órgano o de una
          unidad de su jerarquía. Si el contrato es menor o no salió a convocatoria abierta, también se señala cuando
          solo coincide la administración. Aparte, se agrupan los contratos menores del mismo órgano y del mismo
          adjudicatario que se repiten en la banda del 90 % al 100 % del tope (40.000 € sin IVA en obras, 15.000 € sin
          IVA en servicios y suministros), sobre todo cuando el importe es idéntico.
        </p>
      </PageIntro>
      <AlertBanner>
        Es un indicador para abrir expedientes. Un contrato menor o un negociado sin publicidad pueden ser legales, y el
        nombre del órgano se empareja por aproximación: la BDNS no trae el código DIR3.
      </AlertBanner>
      {cobertura ? <p className="mb-5 text-sm leading-relaxed text-muted">{cobertura}</p> : null}
      <AlertFilterForm
        action="/alertas/contratos"
        filters={filters}
        ccaa={loaded.ccaa}
        anios={loaded.anios}
        organismos={loaded.organismos}
        tipos={tipos}
      />
      {loaded.alerts.length === 0 ? (
        <EmptyState>Ningún indicador con estos filtros.</EmptyState>
      ) : (
        <ol className="grid gap-4">
          {loaded.alerts.map((alert) => (
            <li key={alert.id}>
              <ContratoAlertCard alert={alert} />
            </li>
          ))}
        </ol>
      )}
      <AlertPager path="/alertas/contratos" filters={filters} total={loaded.total} pageSize={loaded.pageSize} />
    </>
  );
};

export default ContratosAlertPage;
