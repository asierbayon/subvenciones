import Link from "next/link";
import { AlertBanner } from "@/components/alert-banner";
import { AlertFilterForm, AlertPager } from "@/components/alert-filters";
import { EmptyState, PageIntro, SetupNeeded } from "@/components/setup-needed";
import { listBenford, listOutliers, listRedondo, parseAlertFilters, type AlertFilters, type AlertSearch } from "@/lib/alerts";
import { DatabaseMissingError, guard } from "@/lib/db";
import { formatEuro, formatNumber } from "@/lib/format";

const TIPOS = [
  { value: "benford", label: "Ley de Benford" },
  { value: "redondo", label: "Importes redondos" },
  { value: "atipico", label: "Importes atípicos" },
];

const shell = (filters: AlertFilters, ccaa: string[], organismos: string[], total: number, pageSize: number, body: React.ReactNode) => (
  <>
    <PageIntro eyebrow="Estadística" title="Cifras que no se parecen al resto">
      <p>
        Benford mira el primer dígito del importe. La desviación media absoluta (MAD) por encima de 0,015 es el corte
        de Nigrini para una serie que no se ajusta; hace falta al menos 200 concesiones y que el mayor importe sea cien
        veces el menor. Un importe redondo es múltiplo de 1.000 €, y solo se marca si esa cuota supera en 20 puntos la
        del conjunto del volcado. Un atípico está a 3,5 desviaciones del logaritmo del importe, dentro de su organismo
        y de su tipo de beneficiario, en grupos de al menos 40 concesiones. No entran los NIF de administraciones,
        congregaciones ni fundaciones (P, Q, S, R, G).
      </p>
    </PageIntro>
    <AlertBanner>
      Las subvenciones se presupuestan a menudo en miles de euros, así que muchos importes redondos son normales. Un
      atípico puede ser un convenio singular perfectamente publicado.
    </AlertBanner>
    <AlertFilterForm
      action="/alertas/estadistica"
      filters={filters}
      ccaa={ccaa}
      anios={[]}
      organismos={organismos}
      tipos={TIPOS}
    />
    {body}
    <AlertPager path="/alertas/estadistica" filters={filters} total={total} pageSize={pageSize} />
  </>
);

const EstadisticaPage = async ({ searchParams }: { searchParams: Promise<AlertSearch> }) => {
  const filters = parseAlertFilters(await searchParams);
  const kind = filters.tipo || "benford";
  const active = { ...filters, tipo: kind };
  const loaded = await guard(async () => {
    try {
      if (kind === "redondo") {
        return await listRedondo(filters);
      }
      if (kind === "atipico") {
        return await listOutliers(filters);
      }
      return await listBenford(filters);
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

  if (kind === "atipico") {
    const data = await listOutliers(filters);
    return shell(
      active,
      [],
      [],
      data.total,
      data.pageSize,
      data.rows.length === 0 ? (
        <EmptyState>Ningún importe atípico con estos filtros.</EmptyState>
      ) : (
        <ol className="grid gap-3">
          {data.rows.map((row) => (
            <li key={row.id} className="xp-card">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="xp-heading">
                  <Link href={`/concesiones/${row.concesionId}`} className="xp-link font-normal">
                    {formatEuro(row.importe)}
                  </Link>
                </h2>
                <p className="text-sm text-muted">z = {row.zeta.toLocaleString("es-ES", { maximumFractionDigits: 1 })}</p>
              </div>
              <p className="mt-1 text-sm text-muted">
                {row.beneficiarioId ? (
                  <Link href={`/beneficiarios/${row.beneficiarioId}`} className="xp-link font-normal">
                    {row.nombre}
                  </Link>
                ) : (
                  row.nombre
                )}{" "}
                · {row.tipo} · {row.organismo} · {row.ccaa}
              </p>
              <p className="mt-2 text-sm leading-relaxed">
                La mediana de las {formatNumber(row.nGrupo)} subvenciones de este tipo en este organismo es{" "}
                {formatEuro(row.mediana)}. Este importe queda muy por encima de esa nube. Es un indicador de rareza, no
                de una concesión indebida.
              </p>
            </li>
          ))}
        </ol>
      ),
    );
  }

  if (kind === "redondo") {
    const data = await listRedondo(filters);
    return shell(
      active,
      data.ccaa,
      data.organismos,
      data.total,
      data.pageSize,
      <div className="xp-table-frame">
        <table className="xp-table">
          <caption className="sr-only">Cuota de importes múltiplos de mil euros</caption>
          <thead>
            <tr>
              <th scope="col" className="px-3 py-2">Organismo</th>
              <th scope="col" className="px-3 py-2">Territorio</th>
              <th scope="col" className="px-3 py-2 text-right">Concesiones</th>
              <th scope="col" className="px-3 py-2 text-right">Múltiplos de 1.000 €</th>
              <th scope="col" className="px-3 py-2 text-right">En todo el volcado</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row) => (
              <tr key={row.id} className="border-t border-line">
                <th scope="row" className="px-3 py-2 text-left font-semibold">
                  <Link href={`/concesiones?organismo=${encodeURIComponent(row.organismo)}`} className="xp-link font-normal">
                    {row.organismo}
                  </Link>
                </th>
                <td className="px-3 py-2">{row.ccaa}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatNumber(row.n)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{(row.cuota * 100).toLocaleString("es-ES", { maximumFractionDigits: 1 })} %</td>
                <td className="px-3 py-2 text-right tabular-nums">{(row.cuotaGlobal * 100).toLocaleString("es-ES", { maximumFractionDigits: 1 })} %</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>,
    );
  }

  const data = await listBenford(filters);
  return shell(
    active,
    data.ccaa,
    data.organismos,
    data.total,
    data.pageSize,
    <div className="xp-table-frame">
      <table className="xp-table">
        <caption className="sr-only">Desviación de Benford por organismo</caption>
        <thead>
          <tr>
            <th scope="col" className="px-3 py-2">Organismo</th>
            <th scope="col" className="px-3 py-2">Territorio</th>
            <th scope="col" className="px-3 py-2 text-right">Concesiones</th>
            <th scope="col" className="px-3 py-2 text-right">MAD</th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row) => (
            <tr key={row.id} className="border-t border-line">
              <th scope="row" className="px-3 py-2 text-left font-semibold">
                <Link href={`/concesiones?organismo=${encodeURIComponent(row.organismo)}`} className="xp-link font-normal">
                  {row.organismo}
                </Link>
              </th>
              <td className="px-3 py-2">{row.ccaa}</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatNumber(row.n)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{row.mad.toLocaleString("es-ES", { maximumFractionDigits: 4 })}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>,
  );
};

export default EstadisticaPage;
