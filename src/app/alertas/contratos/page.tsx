import { AlertBanner, type MethodologyItem } from "@/components/alert-banner";
import { AlertFilterForm, AlertPager } from "@/components/alert-filters";
import { AlertResultsBar } from "@/components/alert-ui";
import { ContratoAlertCard } from "@/components/contratos-publicos";
import { EmptyState, PageIntro, SetupNeeded } from "@/components/setup-needed";
import { guard } from "@/lib/db";
import { parseAlertFilters, type AlertSearch } from "@/lib/alerts";
import { listContratos } from "@/lib/contratos";
import { formatNumber } from "@/lib/format";

const TIPOS = [
  { value: "menor_umbral", label: "Menores bajo el umbral" },
  { value: "menor", label: "Contrato menor" },
  { value: "sin_concurrencia", label: "Sin convocatoria abierta" },
  { value: "mismo_organo", label: "Mismo órgano" },
  { value: "organo_superior", label: "Misma jerarquía" },
  { value: "misma_administracion", label: "Misma administración" },
];

const BASE_METHODOLOGY: MethodologyItem[] = [
  {
    label: "Cruce ayuda + contrato",
    text: "Mismo NIF con subvención y adjudicación de la PLACSP en menos de 180 días del mismo órgano o su jerarquía (o misma administración si es menor o sin concurrencia).",
  },
  {
    label: "Menores bajo el umbral",
    text: "Al menos 5 contratos menores del mismo órgano y adjudicatario en la banda del 90–100 % del tope (40.000 € obras, 15.000 € servicios/suministros sin IVA).",
  },
];

const coverageItem = (meta: Record<string, string>): MethodologyItem | null => {
  const organismos = Number(meta.organismos ?? "");
  const conDir3 = Number(meta.organismos_dir3 ?? "");
  const conNombre = Number(meta.organismos_nombre ?? "");
  if (!Number.isFinite(organismos) || organismos <= 0) {
    return null;
  }
  const dir3Pct = Math.round((conDir3 / organismos) * 1000) / 10;
  const nombrePct = Math.round((conNombre / organismos) * 1000) / 10;
  return {
    label: "Cobertura del emparejamiento",
    text: `${formatNumber(conNombre)} de ${formatNumber(organismos)} organismos (${nombrePct} %) casan por nombre normalizado y ${formatNumber(conDir3)} (${dir3Pct} %) por código DIR3 único.`,
  };
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
          <code>python3 pipeline/contratos.py</code>. El paso es opcional y no hace falta para el resto de Faro.
        </p>
      </PageIntro>
    );
  }

  const coverage = coverageItem(loaded.meta);
  const methodology = coverage ? [...BASE_METHODOLOGY, coverage] : BASE_METHODOLOGY;

  return (
    <>
      <PageIntro eyebrow="Contratos públicos" title="Ayuda y contrato del mismo organismo">
        <p>Entidades que cobran subvención y adjudicación del mismo órgano en 180 días, o encadenan contratos menores.</p>
      </PageIntro>
      <AlertBanner methodology={methodology}>
        Un contrato menor o un negociado sin publicidad pueden ser legales, y el órgano se empareja por aproximación
        porque la BDNS no incluye código DIR3.
      </AlertBanner>
      <AlertFilterForm
        action="/alertas/contratos"
        filters={filters}
        ccaa={loaded.ccaa}
        anios={loaded.anios}
        organismos={loaded.organismos}
        tipos={TIPOS}
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
