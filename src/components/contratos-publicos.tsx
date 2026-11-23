import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { ExternalLink } from "@/components/facts";
import { formatDate, formatEuro } from "@/lib/format";
import {
  alertasDeOrganismo,
  alertasDePar,
  contratosDeNif,
  type ContratoAlert,
  type ContratoRow,
} from "@/lib/contratos";

const nivelLabel = (nivel: string) => {
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

const AlertMarks = ({ alert }: { alert: Pick<ContratoAlert, "nivel" | "menor" | "sinConcurrencia" | "emergencia"> }) => (
  <div className="mt-2 flex flex-wrap gap-2">
    <Badge tone="terra">Indicador</Badge>
    <Badge tone="accent">{nivelLabel(alert.nivel)}</Badge>
    {alert.menor ? <Badge>Contrato menor</Badge> : null}
    {alert.emergencia ? <Badge>Emergencia</Badge> : null}
    {alert.sinConcurrencia && !alert.menor ? <Badge>Sin convocatoria abierta</Badge> : null}
  </div>
);

export const ContratoAlertCard = ({ alert }: { alert: ContratoAlert }) => (
  <article className="xp-card">
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h3 className="xp-heading">
        {alert.beneficiarioId ? (
          <Link
            href={`/beneficiarios/${alert.beneficiarioId}`}
            className="xp-link font-normal"
          >
            {alert.nombre}
          </Link>
        ) : (
          alert.nombre
        )}
      </h3>
      <p className="text-sm font-semibold tabular-nums">{formatEuro(alert.importeContrato)}</p>
    </div>
    <p className="mt-1 text-sm text-muted">
      {alert.nif} · {alert.organismo} · {alert.ccaa} · adjudicación {formatDate(alert.fechaContrato)} · a {alert.dias}{" "}
      días de una concesión
    </p>
    <AlertMarks alert={alert} />
    <p className="mt-3 text-sm leading-relaxed">{alert.motivo}</p>
    <p className="mt-3 text-sm">
      {alert.url ? (
        <ExternalLink href={alert.url}>Anuncio en la PLACSP ({fuenteLabel(alert.fuente)})</ExternalLink>
      ) : (
        <span className="text-muted">El anuncio no trae enlace.</span>
      )}
      <span className="text-muted">
        {" "}
        · {alert.procedimientoNombre} · expediente {alert.expediente}
        {alert.lote ? ` · lote ${alert.lote}` : ""} · órgano del contrato: {alert.organoContrato}
        {alert.dir3 ? ` · DIR3 ${alert.dir3}` : ""}
      </span>
    </p>
    <ul className="mt-3 xp-inset-list">
      {alert.items.map((item) => (
        <li key={item.concesionId} className="flex flex-col gap-1 px-3 py-2 text-sm sm:flex-row sm:items-baseline sm:justify-between">
          <Link
            href={`/concesiones/${item.concesionId}`}
            className="xp-link"
          >
            {formatEuro(item.importe)} el {formatDate(item.fecha)}
          </Link>
          <span className="text-muted sm:max-w-[60%] sm:text-right">{item.titulo}</span>
        </li>
      ))}
    </ul>
  </article>
);

const ContractLine = ({ row }: { row: ContratoRow }) => (
  <li className="xp-card text-sm">
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <p className="font-semibold">{row.titulo}</p>
      <p className="tabular-nums">{formatEuro(row.importe)}</p>
    </div>
    <p className="mt-1 text-muted">
      {formatDate(row.fecha)} · {row.organo || "Órgano no indicado"} · {row.procedimientoNombre} · {fuenteLabel(row.fuente)}
    </p>
    {row.url ? (
      <p className="mt-2">
        <ExternalLink href={row.url}>Anuncio en la PLACSP</ExternalLink>
      </p>
    ) : null}
    {row.alerta ? (
      <div className="mt-2">
        <AlertMarks alert={row.alerta} />
        <p className="mt-2 leading-relaxed">{row.alerta.motivo}</p>
        <ul className="mt-2 xp-inset-list">
          {row.alerta.items.map((item) => (
            <li key={item.concesionId} className="px-3 py-2">
              <Link
                href={`/concesiones/${item.concesionId}`}
                className="xp-link"
              >
                Concesión de {formatEuro(item.importe)} el {formatDate(item.fecha)}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    ) : null}
  </li>
);

const Missing = () => (
  <section className="mt-8 xp-empty">
    <h2 className="xp-heading">Contratos públicos</h2>
    <p className="mt-2 text-sm leading-relaxed text-muted">
      El cruce con la Plataforma de Contratación del Sector Público no está calculado. Es un paso opcional:{" "}
      <code>python3 pipeline/contratos.py</code>.
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
      <section className="mt-8">
        <h2 className="xp-heading xp-heading-lg">Contratos públicos</h2>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted">
          Indicador, no prueba. Contratos de este NIF adjudicados por el mismo organismo, o por la misma administración
          cuando el contrato es menor o no salió a convocatoria abierta, a menos de 180 días de una concesión.
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
            <Link
              href={`/alertas/contratos?organismo=${encodeURIComponent(organismo)}`}
              className="font-semibold text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent"
            >
              Ver los {loaded.total.toLocaleString("es-ES")} indicadores de este organismo
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
      <section className="mt-8">
        <h2 className="xp-heading xp-heading-lg">Contratos públicos</h2>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted">
          Adjudicaciones de la PLACSP entre 2018 y 2022 a este NIF. Si una fila lleva la marca «Indicador», el contrato
          queda cerca en el tiempo de una concesión del mismo organismo o, si es menor o sin convocatoria abierta, de la
          misma administración. No es una prueba.
        </p>
        {loaded.total === 0 ? (
          <p className="mt-4 text-sm text-muted">Este NIF no aparece como adjudicatario en el extracto guardado.</p>
        ) : (
          <>
            <p className="mt-3 text-sm text-muted">
              {loaded.total.toLocaleString("es-ES")} adjudicaciones guardadas
              {loaded.alertas > 0 ? ` · ${loaded.alertas.toLocaleString("es-ES")} indicadores` : ""}. Se muestran las más
              recientes, con el indicador delante.
            </p>
            <ul className="mt-4 grid gap-3">
              {loaded.rows.map((row) => (
                <ContractLine key={`${row.expediente}|${row.lote}|${row.fecha}`} row={row} />
              ))}
            </ul>
          </>
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
    <section className="mt-8">
      <h2 className="xp-heading xp-heading-lg">Contratos públicos</h2>
      <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted">
        Indicador, no prueba. Beneficiarios de este organismo que también se adjudican un contrato suyo, o de la misma
        administración si el contrato es menor o no salió a convocatoria abierta, en una ventana de 180 días.
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
          <Link
            href={`/alertas/contratos?organismo=${encodeURIComponent(organismo)}`}
            className="font-semibold text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent"
          >
            Ver los {loaded.total.toLocaleString("es-ES")} indicadores
          </Link>
        </p>
      ) : null}
    </section>
  );
};
