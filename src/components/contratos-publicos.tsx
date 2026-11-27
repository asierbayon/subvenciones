import Link from "next/link";
import {
  AlertCard,
  AlertDisclosure,
  AlertEvidenceList,
  AlertFactStrip,
  AlertFlow,
  AlertMetaRow,
  alertLinkClass,
} from "@/components/alert-ui";
import { ExternalLink } from "@/components/facts";
import { Badge } from "@/components/ui/badge";
import { formatDate, formatEuro, formatNumber } from "@/lib/format";
import {
  alertasDeOrganismo,
  alertasDePar,
  contratosDeNif,
  type ContratoAlert,
  type ContratoRow,
} from "@/lib/contratos";

const nivelLabel = (nivel: string) => {
  if (nivel === "menor_umbral") {
    return "Menores bajo el umbral";
  }
  if (nivel === "mismo_organo") {
    return "Mismo órgano";
  }
  if (nivel === "organo_superior") {
    return "Misma jerarquía";
  }
  if (nivel === "misma_administracion") {
    return "Misma administración";
  }
  return "Cruce";
};

const bandaLabel = (codigo: string) => {
  if (codigo === "obra") {
    return "Obras · tope 40.000 € sin IVA";
  }
  if (codigo === "servicios") {
    return "Servicios y suministros · tope 15.000 € sin IVA";
  }
  return "Contrato menor";
};

const fuenteLabel = (fuente: string) => {
  if (fuente === "menores") {
    return "Contratos menores";
  }
  if (fuente === "agregadas") {
    return "Plataformas agregadas";
  }
  if (fuente === "perfiles") {
    return "Perfiles en la PLACSP";
  }
  return "PLACSP";
};

const gapLabel = (dias: number) => {
  if (dias === 0) {
    return "Mismo día";
  }
  if (dias === 1) {
    return "A 1 día";
  }
  return `A ${formatNumber(dias)} días`;
};

const MenorUmbralCard = ({ alert }: { alert: ContratoAlert }) => {
  const avgContract =
    alert.importeContrato !== null && alert.nContratos > 0 ? alert.importeContrato / alert.nContratos : null;

  return (
    <AlertCard
      tone="terra"
      badges={
        <>
          <Badge tone="terra">{nivelLabel(alert.nivel)}</Badge>
          <Badge tone="accent">{bandaLabel(alert.umbralCodigo || alert.via)}</Badge>
          <Badge>{Math.round(alert.puntuacion)}/100 pts</Badge>
        </>
      }
      title={
        alert.beneficiarioId ? (
          <Link href={`/beneficiarios/${alert.beneficiarioId}`} className={alertLinkClass}>
            {alert.nombre}
          </Link>
        ) : (
          alert.nombre
        )
      }
      subtitle={
        <AlertMetaRow items={[alert.organismo, alert.ccaa, <span key="nif" className="font-mono">{alert.nif}</span>]} />
      }
      metric={formatEuro(alert.importeContrato)}
      metricLabel={`${formatNumber(alert.nContratos)} contratos menores`}
      footer={
        <>
          {alert.piezas.length > 0 ? (
            <AlertDisclosure label="Ver muestra de contratos menores" count={alert.piezas.length}>
              <AlertEvidenceList
                items={alert.piezas.map((pieza) => ({
                  key: `${pieza.expediente}-${pieza.lote}-${pieza.fecha}-${pieza.importe}`,
                  amount: pieza.importe,
                  date: pieza.fecha,
                  title: pieza.titulo,
                  href: pieza.url || undefined,
                  external: Boolean(pieza.url),
                  meta: pieza.expediente || undefined,
                }))}
              />
            </AlertDisclosure>
          ) : null}
          <AlertDisclosure label="Explicación detallada">
            <p className="text-xs leading-relaxed text-muted">{alert.motivo}</p>
          </AlertDisclosure>
        </>
      }
    >
      <AlertFactStrip
        columns={4}
        items={[
          { label: "Contratos en banda", value: formatNumber(alert.nContratos), highlight: true },
          { label: "Importe acumulado", value: formatEuro(alert.importeContrato) },
          { label: "Media por contrato", value: formatEuro(avgContract) },
          {
            label: "Periodo",
            value: `${formatDate(alert.fechaConcesionMin)} – ${formatDate(alert.fechaContrato)}`,
          },
        ]}
      />
    </AlertCard>
  );
};

const AlertMarks = ({
  alert,
}: {
  alert: Pick<ContratoAlert, "nivel" | "menor" | "sinConcurrencia" | "emergencia">;
}) => (
  <>
    <Badge tone="accent">{nivelLabel(alert.nivel)}</Badge>
    {alert.menor ? <Badge tone="terra">Contrato menor</Badge> : null}
    {alert.emergencia ? <Badge tone="terra">Emergencia</Badge> : null}
    {alert.sinConcurrencia && !alert.menor ? <Badge tone="terra">Sin convocatoria abierta</Badge> : null}
  </>
);

export const ContratoAlertCard = ({ alert }: { alert: ContratoAlert }) => {
  if (alert.nivel === "menor_umbral") {
    return <MenorUmbralCard alert={alert} />;
  }

  return (
    <AlertCard
      tone={alert.menor || alert.emergencia || alert.sinConcurrencia ? "terra" : "accent"}
      badges={<AlertMarks alert={alert} />}
      title={
        alert.beneficiarioId ? (
          <Link href={`/beneficiarios/${alert.beneficiarioId}`} className={alertLinkClass}>
            {alert.nombre}
          </Link>
        ) : (
          alert.nombre
        )
      }
      subtitle={
        <AlertMetaRow items={[alert.organismo, alert.ccaa, <span key="nif" className="font-mono">{alert.nif}</span>]} />
      }
      metric={formatEuro(alert.importeContrato)}
      metricLabel={`Adjudicado ${formatDate(alert.fechaContrato)}`}
      footer={
        <>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            {alert.url ? (
              <ExternalLink href={alert.url}>Anuncio en la PLACSP ({fuenteLabel(alert.fuente)})</ExternalLink>
            ) : (
              <span className="text-muted">Sin enlace en la PLACSP</span>
            )}
            <span className="font-mono text-muted">Exp. {alert.expediente}</span>
            {alert.lote ? <span className="text-muted">Lote {alert.lote}</span> : null}
            {alert.dir3 ? <span className="font-mono text-muted">DIR3 {alert.dir3}</span> : null}
          </div>
          {alert.items.length > 0 ? (
            <AlertDisclosure label="Ver subvenciones en la ventana" count={alert.items.length}>
              <AlertEvidenceList
                items={alert.items.map((item) => ({
                  key: String(item.concesionId),
                  amount: item.importe,
                  date: item.fecha,
                  title: item.titulo,
                  href: `/concesiones/${item.concesionId}`,
                }))}
              />
            </AlertDisclosure>
          ) : null}
          <AlertDisclosure label="Explicación detallada">
            <p className="text-xs leading-relaxed text-muted">{alert.motivo}</p>
          </AlertDisclosure>
        </>
      }
    >
      <AlertFlow
        connector={gapLabel(alert.dias)}
        connectorTone={alert.dias <= 30 ? "terra" : "accent"}
        left={{
          eyebrow: "Contrato adjudicado",
          title: formatEuro(alert.importeContrato),
          detail: `${alert.procedimientoNombre} · ${alert.organoContrato}`,
          dates: `Adjudicación: ${formatDate(alert.fechaContrato)}`,
        }}
        right={{
          eyebrow: "Subvenciones del organismo",
          title: `${formatEuro(alert.importeConcesiones)} (${formatNumber(alert.nConcesiones)} ${
            alert.nConcesiones === 1 ? "ayuda" : "ayudas"
          })`,
          detail: alert.organismo,
          dates:
            alert.fechaConcesionMin && alert.fechaConcesionMax && alert.fechaConcesionMin !== alert.fechaConcesionMax
              ? `${formatDate(alert.fechaConcesionMin)} – ${formatDate(alert.fechaConcesionMax)}`
              : formatDate(alert.fechaConcesionMin),
        }}
      />
    </AlertCard>
  );
};

const ContractLine = ({ row }: { row: ContratoRow }) => (
  <li className="rounded-xl border border-line bg-elev p-4 text-sm shadow-2xs transition-colors hover:border-line-strong">
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <p className="font-semibold text-ink">{row.titulo}</p>
      <p className="font-bold text-ink tabular-nums">{formatEuro(row.importe)}</p>
    </div>
    <div className="mt-1">
      <AlertMetaRow
        items={[formatDate(row.fecha), row.organo || "Órgano no indicado", row.procedimientoNombre, fuenteLabel(row.fuente)]}
      />
    </div>
    {row.alerta ? (
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <Badge tone="terra">Cruce con ayuda</Badge>
        <AlertMarks alert={row.alerta} />
      </div>
    ) : null}
    <div className="mt-3 flex flex-col gap-2 border-t border-line pt-2.5">
      {row.url ? (
        <div className="text-xs">
          <ExternalLink href={row.url}>Anuncio en la PLACSP</ExternalLink>
        </div>
      ) : null}
      {row.alerta && row.alerta.items.length > 0 ? (
        <AlertDisclosure label="Ver concesiones vinculadas" count={row.alerta.items.length}>
          <AlertEvidenceList
            items={row.alerta.items.map((item) => ({
              key: String(item.concesionId),
              amount: item.importe,
              date: item.fecha,
              title: item.titulo || "Concesión",
              href: `/concesiones/${item.concesionId}`,
            }))}
          />
        </AlertDisclosure>
      ) : null}
      {row.alerta ? (
        <AlertDisclosure label="Explicación del cruce">
          <p className="text-xs leading-relaxed text-muted">{row.alerta.motivo}</p>
        </AlertDisclosure>
      ) : null}
    </div>
  </li>
);

const Missing = () => (
  <section className="mt-10 rounded-xl border border-dashed border-line-strong bg-elev/60 px-6 py-8 text-center">
    <h2 className="font-display text-base font-bold text-ink">Contratos públicos</h2>
    <p className="mt-2 text-sm leading-relaxed text-muted">
      El cruce con la Plataforma de Contratación del Sector Público no está calculado. Es un paso opcional:{" "}
      <code className="rounded bg-subtle px-1.5 py-0.5 font-mono text-xs text-ink">python3 pipeline/contratos.py</code>.
    </p>
  </section>
);

type ContratosPublicosProps = {
  nif?: string;
  organismo?: string;
  exact?: boolean;
};

export const ContratosPublicos = async ({ nif, organismo, exact = false }: ContratosPublicosProps) => {
  if (nif && organismo) {
    const loaded = await alertasDePar(nif, organismo);
    if (!loaded) {
      return <Missing />;
    }
    return (
      <section className="mt-10">
        <h2 className="font-display text-xl font-bold tracking-tight text-ink">Contratos públicos</h2>
        <p className="mt-1 text-xs text-muted sm:text-sm">
          Indicador, no prueba. Contratos de este NIF en el mismo organismo en una ventana de 180 días.
        </p>
        {loaded.alerts.length === 0 ? (
          <p className="mt-4 text-sm text-muted">Ningún contrato de la PLACSP dispara ese cruce con este organismo.</p>
        ) : (
          <ol className="mt-4 grid gap-4">
            {loaded.alerts.map((alert) => (
              <li key={alert.id}>
                <ContratoAlertCard alert={alert} />
              </li>
            ))}
          </ol>
        )}
        {loaded.total > loaded.alerts.length ? (
          <p className="mt-3 text-sm">
            <Link href={`/alertas/contratos?organismo=${encodeURIComponent(organismo)}`} className={alertLinkClass}>
              Ver los {formatNumber(loaded.total)} indicadores de este organismo
            </Link>
          </p>
        ) : null}
      </section>
    );
  }

  if (nif) {
    const loaded = await contratosDeNif(nif);
    if (!loaded) {
      return <Missing />;
    }
    return (
      <section className="mt-10">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-display text-xl font-bold tracking-tight text-ink">Contratos públicos</h2>
          {loaded.total > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              <Badge>{formatNumber(loaded.total)} adjudicaciones</Badge>
              {loaded.alertas > 0 ? <Badge tone="terra">{formatNumber(loaded.alertas)} con cruce</Badge> : null}
            </div>
          ) : null}
        </div>
        <p className="mt-1 text-xs text-muted sm:text-sm">
          Adjudicaciones de la PLACSP (2018–2022) a este NIF. Los casos marcados como cruce quedan a menos de 180 días
          de una concesión.
        </p>
        {loaded.total === 0 ? (
          <p className="mt-4 text-sm text-muted">Este NIF no aparece como adjudicatario en el extracto guardado.</p>
        ) : (
          <ul className="mt-4 grid gap-3">
            {loaded.rows.map((row) => (
              <ContractLine key={`${row.expediente}|${row.lote}|${row.fecha}`} row={row} />
            ))}
          </ul>
        )}
      </section>
    );
  }

  if (!organismo) {
    return null;
  }
  const loaded = await alertasDeOrganismo(organismo, exact);
  if (!loaded) {
    return <Missing />;
  }
  return (
    <section className="mt-10">
      <h2 className="font-display text-xl font-bold tracking-tight text-ink">Contratos públicos</h2>
      <p className="mt-1 text-xs text-muted sm:text-sm">
        Indicador, no prueba. Beneficiarios de este organismo que también se adjudican un contrato en una ventana de
        180 días.
      </p>
      {loaded.alerts.length === 0 ? (
        <p className="mt-4 text-sm text-muted">Ningún indicador con este organismo en el cruce calculado.</p>
      ) : (
        <ol className="mt-4 grid gap-4">
          {loaded.alerts.map((alert) => (
            <li key={alert.id}>
              <ContratoAlertCard alert={alert} />
            </li>
          ))}
        </ol>
      )}
      {loaded.total > loaded.alerts.length ? (
        <p className="mt-3 text-sm">
          <Link href={`/alertas/contratos?organismo=${encodeURIComponent(organismo)}`} className={alertLinkClass}>
            Ver los {formatNumber(loaded.total)} indicadores
          </Link>
        </p>
      ) : null}
    </section>
  );
};
