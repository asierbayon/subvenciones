import Link from "next/link";
import { AlertBanner, type MethodologyItem } from "@/components/alert-banner";
import { AlertFilterForm, AlertPager } from "@/components/alert-filters";
import {
  AlertCard,
  AlertFactStrip,
  AlertMetaRow,
  AlertResultsBar,
  AlertTabs,
  InlinePercentBar,
  alertLinkClass,
} from "@/components/alert-ui";
import { EmptyState, PageIntro, SetupNeeded } from "@/components/setup-needed";
import { Badge } from "@/components/ui/badge";
import {
  alertQuery,
  listBenford,
  listOutliers,
  listRedondo,
  parseAlertFilters,
  type AlertFilters,
  type AlertSearch,
} from "@/lib/alerts";
import { DatabaseMissingError, guard } from "@/lib/db";
import { formatEuro, formatNumber } from "@/lib/format";

const TABS = [
  { value: "atipico", label: "Importes atípicos" },
  { value: "redondo", label: "Importes redondos" },
  { value: "benford", label: "Ley de Benford" },
] as const;

const METHODOLOGY: MethodologyItem[] = [
  {
    label: "Importes atípicos",
    text: "Superan en 3,5 desviaciones el logaritmo del importe dentro de su organismo y tipo de beneficiario (grupos de al menos 40 ayudas).",
  },
  {
    label: "Importes redondos",
    text: "Organismos cuya cuota de múltiplos de 1.000 € supera en más de 20 puntos la media global del volcado.",
  },
  {
    label: "Ley de Benford",
    text: "Solo se publican organismos con desviación MAD > 0,030, al menos 500 subvenciones y un rango de 100× entre mínimo y máximo. Excluye NIF P, Q, S, R y G.",
  },
];

const multipleLabel = (importe: number, mediana: number) => {
  if (mediana <= 0) {
    return "—";
  }
  const ratio = importe / mediana;
  return `${ratio.toLocaleString("es-ES", { maximumFractionDigits: ratio >= 10 ? 0 : 1 })}× la mediana`;
};

const EstadisticaShell = ({
  filters,
  kind,
  ccaa,
  organismos,
  total,
  shown,
  pageSize,
  noun,
  children,
}: {
  filters: AlertFilters;
  kind: string;
  ccaa: string[];
  organismos: string[];
  total: number;
  shown: number;
  pageSize: number;
  noun: { singular: string; plural: string };
  children: React.ReactNode;
}) => (
  <>
    <PageIntro eyebrow="Estadística" title="Cifras que no se parecen al resto">
      <p>Detecta ayudas anormalmente altas para su grupo, exceso de cifras redondas y desvíos en el primer dígito.</p>
    </PageIntro>
    <AlertBanner methodology={METHODOLOGY}>
      Presupuestar en miles de euros es habitual y un convenio singular puede aparecer como atípico sin ser irregular.
    </AlertBanner>
    <AlertTabs
      label="Tipo de señal estadística"
      items={TABS.map((tab) => ({
        href: `/alertas/estadistica${alertQuery(filters, { tipo: tab.value, page: 1 })}`,
        label: tab.label,
        active: kind === tab.value,
      }))}
    />
    <AlertFilterForm
      action="/alertas/estadistica"
      filters={filters}
      ccaa={ccaa}
      anios={[]}
      organismos={organismos}
      hiddenFields={{ tipo: kind }}
      clearHref={`/alertas/estadistica?tipo=${encodeURIComponent(kind)}`}
    />
    <AlertResultsBar
      total={total}
      shown={shown}
      page={filters.page}
      pageSize={pageSize}
      singular={noun.singular}
      plural={noun.plural}
    />
    {children}
    <AlertPager path="/alertas/estadistica" filters={filters} total={total} pageSize={pageSize} />
  </>
);

const EstadisticaPage = async ({ searchParams }: { searchParams: Promise<AlertSearch> }) => {
  const filters = parseAlertFilters(await searchParams);
  const kind = filters.tipo === "redondo" || filters.tipo === "benford" ? filters.tipo : "atipico";
  const active = { ...filters, tipo: kind };

  const loaded = await guard(async () => {
    try {
      if (kind === "redondo") {
        const data = await listRedondo(filters);
        return { kind: "redondo" as const, data };
      }
      if (kind === "benford") {
        const data = await listBenford(filters);
        return { kind: "benford" as const, data };
      }
      const data = await listOutliers(filters);
      return { kind: "atipico" as const, data };
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
      <PageIntro eyebrow="Estadística" title="Falta calcular este indicador">
        <p>
          Ejecuta <code>python3 pipeline/alerts.py estadistica</code>.
        </p>
      </PageIntro>
    );
  }

  if (loaded.kind === "atipico") {
    const { data } = loaded;
    return (
      <EstadisticaShell
        filters={active}
        kind={kind}
        ccaa={data.ccaa}
        organismos={data.organismos}
        total={data.total}
        shown={data.rows.length}
        pageSize={data.pageSize}
        noun={{ singular: "importe atípico", plural: "importes atípicos" }}
      >
        {data.rows.length === 0 ? (
          <EmptyState>Ningún importe atípico con estos filtros.</EmptyState>
        ) : (
          <ol className="grid gap-4">
            {data.rows.map((row) => (
              <li key={row.id}>
                <AlertCard
                  tone="terra"
                  badges={
                    <>
                      <Badge tone="terra">{multipleLabel(row.importe, row.mediana)}</Badge>
                      <Badge tone="accent">z = {row.zeta.toLocaleString("es-ES", { maximumFractionDigits: 1 })}</Badge>
                      <Badge>{row.tipo}</Badge>
                    </>
                  }
                  title={
                    row.beneficiarioId ? (
                      <Link href={`/beneficiarios/${row.beneficiarioId}`} className={alertLinkClass}>
                        {row.nombre}
                      </Link>
                    ) : (
                      row.nombre
                    )
                  }
                  subtitle={
                    <AlertMetaRow
                      items={[row.organismo, row.ccaa, <span key="nif" className="font-mono">{row.nif}</span>]}
                    />
                  }
                  metric={
                    <Link href={`/concesiones/${row.concesionId}`} className={alertLinkClass}>
                      {formatEuro(row.importe)}
                    </Link>
                  }
                  metricLabel={`Mediana: ${formatEuro(row.mediana)}`}
                  footer={
                    <div className="flex flex-wrap items-center gap-4 text-xs">
                      <Link href={`/concesiones/${row.concesionId}`} className={alertLinkClass}>
                        Abrir concesión
                      </Link>
                      {row.beneficiarioId ? (
                        <Link href={`/beneficiarios/${row.beneficiarioId}`} className={alertLinkClass}>
                          Ver ficha del beneficiario
                        </Link>
                      ) : null}
                    </div>
                  }
                >
                  <AlertFactStrip
                    columns={4}
                    items={[
                      { label: "Este importe", value: formatEuro(row.importe), highlight: true },
                      { label: "Mediana del grupo", value: formatEuro(row.mediana) },
                      { label: "Desviación (z)", value: row.zeta.toLocaleString("es-ES", { maximumFractionDigits: 1 }) },
                      { label: "Grupo comparado", value: `${formatNumber(row.nGrupo)} ayudas`, hint: row.tipo },
                    ]}
                  />
                </AlertCard>
              </li>
            ))}
          </ol>
        )}
      </EstadisticaShell>
    );
  }

  if (loaded.kind === "redondo") {
    const { data } = loaded;
    return (
      <EstadisticaShell
        filters={active}
        kind={kind}
        ccaa={data.ccaa}
        organismos={data.organismos}
        total={data.total}
        shown={data.rows.length}
        pageSize={data.pageSize}
        noun={{ singular: "organismo", plural: "organismos" }}
      >
        {data.rows.length === 0 ? (
          <EmptyState>Ningún organismo con estos filtros.</EmptyState>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-line bg-elev shadow-2xs">
            <table className="w-full border-collapse text-sm">
              <caption className="sr-only">Cuota de importes múltiplos de mil euros</caption>
              <thead>
                <tr className="border-b border-line bg-subtle/70 text-left text-xs font-semibold tracking-wider text-muted uppercase">
                  <th scope="col" className="px-4 py-3">Organismo</th>
                  <th scope="col" className="px-4 py-3">Territorio</th>
                  <th scope="col" className="px-4 py-3 text-right">Concesiones</th>
                  <th scope="col" className="px-4 py-3 text-right">Múltiplos de 1.000 €</th>
                  <th scope="col" className="px-4 py-3 text-right">Media global</th>
                  <th scope="col" className="px-4 py-3 text-right">Diferencia</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.rows.map((row) => {
                  const diffPts = (row.cuota - row.cuotaGlobal) * 100;
                  return (
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
                      <td className="px-4 py-3 text-right text-muted tabular-nums">{formatNumber(row.n)}</td>
                      <td className="px-4 py-3 text-right">
                        <InlinePercentBar
                          ratio={row.cuota}
                          label={`${(row.cuota * 100).toLocaleString("es-ES", { maximumFractionDigits: 1 })} %`}
                          tone="terra"
                        />
                      </td>
                      <td className="px-4 py-3 text-right text-muted tabular-nums">
                        {(row.cuotaGlobal * 100).toLocaleString("es-ES", { maximumFractionDigits: 1 })} %
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-terra tabular-nums">
                        +{diffPts.toLocaleString("es-ES", { maximumFractionDigits: 1 })} pts
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </EstadisticaShell>
    );
  }

  const { data } = loaded;
  return (
    <EstadisticaShell
      filters={active}
      kind={kind}
      ccaa={data.ccaa}
      organismos={data.organismos}
      total={data.total}
      shown={data.rows.length}
      pageSize={data.pageSize}
      noun={{ singular: "organismo", plural: "organismos" }}
    >
      {data.rows.length === 0 ? (
        <EmptyState>Ningún organismo con estos filtros.</EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-elev shadow-2xs">
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">Desviación de Benford por organismo</caption>
            <thead>
              <tr className="border-b border-line bg-subtle/70 text-left text-xs font-semibold tracking-wider text-muted uppercase">
                <th scope="col" className="px-4 py-3">Organismo</th>
                <th scope="col" className="px-4 py-3">Territorio</th>
                <th scope="col" className="px-4 py-3 text-right">Concesiones</th>
                <th scope="col" className="px-4 py-3 text-right">Desviación MAD</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.rows.map((row) => (
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
                  <td className="px-4 py-3 text-right text-muted tabular-nums">{formatNumber(row.n)}</td>
                  <td className="px-4 py-3 text-right">
                    <InlinePercentBar
                      ratio={Math.min(1, row.mad / 0.12)}
                      label={row.mad.toLocaleString("es-ES", { maximumFractionDigits: 4 })}
                      tone="terra"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </EstadisticaShell>
  );
};

export default EstadisticaPage;
