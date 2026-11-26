import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { ExternalLink, Fact } from "@/components/facts";
import { formatDate, formatEuro, formatNumber } from "@/lib/format";
import {
  confianzaLabel,
  fuenteTipoLabel,
  loadRegistro,
  type RegistroFicha,
} from "@/lib/registro";

const linkClass =
  "font-medium text-accent underline decoration-accent/35 underline-offset-4 transition-colors hover:text-accent-strong hover:decoration-accent";

const rolLabel = (rol: string, kind: string) => {
  if (rol === "S") {
    return kind === "E" ? "Socio único (sociedad)" : "Socio único";
  }
  if (kind === "E") {
    return "Administrador (sociedad)";
  }
  return "Administrador";
};

const Ficha = ({ ficha }: { ficha: RegistroFicha }) => {
  if (ficha.empty) {
    return (
      <section className="mt-8 rounded-xl border border-line bg-elev p-5 shadow-2xs" aria-labelledby="registro-mercantil">
        <h2 id="registro-mercantil" className="font-display text-lg font-bold tracking-tight text-ink">
          Registro mercantil
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          No hay un anuncio de sociedad con este nombre en el extracto del BORME 2016-2023, o el nombre es demasiado
          corto para cruzarlo. Muchas sociedades antiguas no publican ningún acto en esa ventana.
        </p>
      </section>
    );
  }
  if (ficha.confianza === "ambigua") {
    return (
      <section className="mt-8 rounded-xl border border-line bg-elev p-5 shadow-2xs" aria-labelledby="registro-mercantil">
        <h2 id="registro-mercantil" className="font-display text-lg font-bold tracking-tight text-ink">
          Registro mercantil
        </h2>
        <div className="mt-3">
          <Badge tone="terra">{confianzaLabel(ficha.confianza)}</Badge>
        </div>
        <p className="mt-3 text-sm leading-relaxed text-ink/90">
          El nombre normalizado coincide con {formatNumber(ficha.nCandidatas)} hojas del registro en el BORME de
          2016-2023. No se asigna una ficha: podría ser otra sociedad homónima. Es un indicador, no una prueba.
        </p>
      </section>
    );
  }
  const capital = ficha.capitalConst ?? ficha.capital;
  return (
    <section className="mt-10" aria-labelledby="registro-mercantil">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="registro-mercantil" className="font-display text-xl font-bold tracking-tight text-ink">
          Registro mercantil
        </h2>
        <Badge tone={ficha.confianza === "alta" ? "accent" : "neutral"}>{confianzaLabel(ficha.confianza)}</Badge>
      </div>
      <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted">
        Datos leídos de los anuncios del BORME entre 2016 y 2023. El boletín identifica a la sociedad por el nombre y
        la hoja registral, no por el NIF. Basado en datos de la Agencia Estatal Boletín Oficial del Estado. Es un
        indicador para leer la concesión junto al registro, no una prueba.
      </p>
      {ficha.senales.length > 0 ? (
        <p className="mt-3 text-sm">
          Aparece en{" "}
          <Link href="/alertas/sociedades" className={linkClass}>
            sociedades recientes o de poco capital
          </Link>
          : {ficha.senales.join(", ")}.
        </p>
      ) : null}
      <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Fact label="Constitución" value={formatDate(ficha.fechaConstitucion)} />
        <Fact
          label={ficha.capitalConst !== null ? "Capital en la constitución" : "Capital publicado"}
          value={capital === null ? "—" : formatEuro(capital)}
        />
        <Fact
          label="Situación en el extracto"
          value={ficha.disuelta ? `Disolución o extinción (${formatDate(ficha.fechaDisolucion)})` : "Sin cierre publicado"}
        />
        <Fact label="Hoja" value={ficha.hoja ? `${ficha.hoja} · ${ficha.provincia}` : "—"} />
      </dl>
      {ficha.domicilio ? (
        <p className="mt-4 text-sm text-ink">
          <span className="font-semibold">Domicilio social. </span>
          {ficha.domicilio}
        </p>
      ) : null}
      {ficha.capital !== null && ficha.capitalConst !== null && ficha.capital !== ficha.capitalConst ? (
        <p className="mt-2 text-sm text-muted">
          El capital publicado más reciente es {formatEuro(ficha.capital)} ({formatDate(ficha.capitalFecha)}).
        </p>
      ) : null}
      {ficha.personas.length > 0 ? (
        <div className="mt-5">
          <h3 className="text-xs font-semibold tracking-wider text-muted uppercase">Administradores y socio único</h3>
          <ul className="mt-2 divide-y divide-line overflow-hidden rounded-xl border border-line bg-elev">
            {ficha.personas.map((persona) => (
              <li key={`${persona.rol}-${persona.nombre}`} className="flex flex-col gap-1 px-4 py-2.5 text-sm sm:flex-row sm:justify-between">
                <span className="font-semibold text-ink">{persona.nombre}</span>
                <span className="text-muted">{rolLabel(persona.rol, persona.kind)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {ficha.relacionadas.length > 0 ? (
        <div className="mt-5">
          <h3 className="text-xs font-semibold tracking-wider text-muted uppercase">Otras sociedades del volcado</h3>
          <ul className="mt-2 divide-y divide-line overflow-hidden rounded-xl border border-line bg-elev">
            {ficha.relacionadas.map((item) => (
              <li key={item.id} className="px-4 py-2.5 text-sm">
                <Link href={`/beneficiarios/${item.id}`} className={linkClass}>
                  {item.nombre}
                </Link>
                <span className="text-muted"> · <span className="font-mono">{item.nif}</span> · {item.detalle}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {ficha.fuentes.length > 0 ? (
        <ul className="mt-4 flex flex-wrap gap-4 text-sm">
          {ficha.fuentes.map((fuente) => (
            <li key={`${fuente.tipo}-${fuente.cve}`}>
              <ExternalLink href={fuente.url}>
                {fuenteTipoLabel(fuente.tipo)} {fuente.cve}
              </ExternalLink>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="mt-3 text-xs text-muted">
        {formatNumber(ficha.nAnuncios)} anuncios agrupados en la hoja.{" "}
        {ficha.confianza === "media"
          ? "La confianza es media: el nombre tiene pocos términos distintivos."
          : "La confianza es alta: en este extracto el nombre normalizado apunta a una sola hoja y a un solo NIF."}
      </p>
    </section>
  );
};

export const RegistroMercantil = async ({ beneficiarioId, nif }: { beneficiarioId: number; nif: string }) => {
  let ficha: RegistroFicha | null = null;
  try {
    ficha = await loadRegistro(beneficiarioId, nif);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("no such table")) {
      return null;
    }
    throw error;
  }
  if (!ficha) {
    return null;
  }
  return <Ficha ficha={ficha} />;
};
