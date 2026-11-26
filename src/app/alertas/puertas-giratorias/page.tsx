import Link from "next/link";
import { AlertBanner } from "@/components/alert-banner";
import { AlertFilterForm, AlertPager } from "@/components/alert-filters";
import { ExternalLink } from "@/components/facts";
import { EmptyState, PageIntro, SetupNeeded } from "@/components/setup-needed";
import { Badge } from "@/components/ui/badge";
import { DatabaseMissingError, guard } from "@/lib/db";
import { parseAlertFilters, type AlertSearch } from "@/lib/alerts";
import { formatDate, formatEuro } from "@/lib/format";
import { listPuertas, type PuertaAlert, type PuertaItem } from "@/lib/puertas";

const linkClass =
  "font-medium text-accent underline decoration-accent/30 underline-offset-4 transition-colors hover:text-accent-strong hover:decoration-accent";

const TIPOS = [
  { value: "despues", label: "Después del cese" },
  { value: "durante", label: "Durante el mandato" },
];

const ROLES: Record<string, string> = {
  alcalde: "Alcaldía",
  concejal: "Concejal electo",
  consejero_insular: "Cabildo",
  diputado: "Diputado autonómico",
  alto_cargo: "Alto cargo",
};

const COHERENCIA: Record<string, string> = {
  municipio: "Mismo municipio",
  mancomunidad: "Mancomunidad",
  isla: "Misma isla",
  provincia: "Misma provincia",
  ministerio: "Mismo ministerio",
  parlamento: "Parlamento",
};

const roleLabel = (rol: string) => ROLES[rol] ?? rol;

const coherenciaLabel = (value: string) => COHERENCIA[value] ?? value;

const scoreLabel = (value: number) => `${Math.round(value * 100).toLocaleString("es-ES")} %`;

const CompanyName = ({ alert }: { alert: PuertaAlert }) => {
  if (!alert.beneficiarioId) {
    return alert.empresa;
  }
  return (
    <Link href={`/beneficiarios/${alert.beneficiarioId}`} className={linkClass}>
      {alert.empresa}
    </Link>
  );
};

const TypeBadge = ({ tipo }: { tipo: string }) => {
  if (tipo === "durante") {
    return <Badge>Durante el mandato</Badge>;
  }
  return <Badge tone="terra">Después del cese</Badge>;
};

const PartyName = ({ partido }: { partido: string }) => {
  if (!partido) {
    return null;
  }
  return <>, {partido}</>;
};

const GapText = ({ alert }: { alert: PuertaAlert }) => {
  if (alert.tipo === "durante") {
    return <>El nombramiento cae dentro del mandato.</>;
  }
  return <>{alert.dias.toLocaleString("es-ES")} días después del cese supuesto.</>;
};

const MoneyLine = ({ item }: { item: PuertaItem }) => {
  const label = `${formatEuro(item.importe)} el ${formatDate(item.fecha)}`;
  if (item.clase === "contrato" && item.url) {
    return <ExternalLink href={item.url}>{label}</ExternalLink>;
  }
  if (item.clase === "ayuda" && item.ref) {
    return (
      <Link href={`/concesiones/${item.ref}`} className={linkClass}>
        {label}
      </Link>
    );
  }
  return <span className="font-medium tabular-nums">{label}</span>;
};

const ItemKind = ({ clase }: { clase: string }) => {
  if (clase === "contrato") {
    return <span className="ml-1.5 text-xs text-muted">Contrato</span>;
  }
  return <span className="ml-1.5 text-xs text-muted">Subvención</span>;
};

const FuenteLinks = ({ alert }: { alert: PuertaAlert }) => {
  if (!alert.fuenteUrl && !alert.fuentePoliticoUrl) {
    return <span className="text-muted">Anuncio del BORME sin identificador</span>;
  }
  if (!alert.fuenteUrl) {
    return <ExternalLink href={alert.fuentePoliticoUrl}>Fuente del cargo</ExternalLink>;
  }
  if (!alert.fuentePoliticoUrl) {
    return <ExternalLink href={alert.fuenteUrl}>Anuncio del BORME {alert.fuenteBorme}</ExternalLink>;
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
      <ExternalLink href={alert.fuenteUrl}>Anuncio del BORME {alert.fuenteBorme}</ExternalLink>
      <span className="text-muted">·</span>
      <ExternalLink href={alert.fuentePoliticoUrl}>Fuente del cargo</ExternalLink>
    </span>
  );
};

const AlertList = ({ alerts }: { alerts: PuertaAlert[] }) => {
  if (alerts.length === 0) {
    return <EmptyState>Ningún indicador con estos filtros.</EmptyState>;
  }
  return (
    <ol className="grid gap-4">
      {alerts.map((alert) => (
        <li key={alert.id} className="rounded-xl border border-line bg-elev p-5 shadow-2xs">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-display text-base font-semibold text-ink">{alert.politicoNombre}</h2>
            <p className="text-sm font-semibold text-ink tabular-nums">{formatEuro(alert.importeMandato)}</p>
          </div>
          <p className="mt-1 text-xs text-muted sm:text-sm">
            <CompanyName alert={alert} /> · <span className="font-mono">{alert.nif}</span> · {alert.organismo}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <TypeBadge tipo={alert.tipo} />
            <Badge tone="accent">{roleLabel(alert.rol)}</Badge>
            <Badge>{coherenciaLabel(alert.coherencia)}</Badge>
            <Badge>Puntuación {scoreLabel(alert.puntuacion)}</Badge>
          </div>
          <p className="mt-3 text-sm leading-relaxed text-ink">
            {alert.cuerpo}
            <PartyName partido={alert.partido} />. Mandato {formatDate(alert.mandatoDesde)} –{" "}
            {formatDate(alert.mandatoHasta)}. Cese supuesto {formatDate(alert.cese)}. En la sociedad figura{" "}
            {alert.adminNombre} como {alert.adminCargo.toLowerCase()} desde el {formatDate(alert.nombramiento)}.{" "}
            <GapText alert={alert} />
          </p>
          <p className="mt-2 text-sm leading-relaxed text-ink/90">
            Del órgano, dentro del mandato: {formatEuro(alert.importeMandato)} ({alert.nAyudas.toLocaleString("es-ES")}{" "}
            subvenciones, {alert.nContratos.toLocaleString("es-ES")} contratos). Hasta el anuncio:{" "}
            {formatEuro(alert.importePrevio)}.
          </p>
          <p className="mt-2 text-sm leading-relaxed text-muted">{alert.motivo}</p>
          <p className="mt-3 text-sm">
            <FuenteLinks alert={alert} />
          </p>
          <ul className="mt-4 divide-y divide-line overflow-hidden rounded-lg border border-line bg-subtle/40">
            {alert.items.map((item) => (
              <li
                key={`${item.clase}-${item.ref}-${item.fecha}`}
                className="flex flex-col gap-1 px-3.5 py-2.5 text-sm sm:flex-row sm:items-baseline sm:justify-between"
              >
                <span>
                  <MoneyLine item={item} />
                  <ItemKind clase={item.clase} />
                </span>
                <span className="text-muted sm:max-w-[60%] sm:text-right">{item.titulo}</span>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ol>
  );
};

const PartialNote = ({ parcial }: { parcial: boolean }) => {
  if (!parcial) {
    return null;
  }
  return (
    <AlertBanner>
      Esta tabla se calculó con una muestra de anuncios del BORME (
      <code className="rounded bg-subtle px-1 py-0.5 font-mono text-xs">--limit</code>). No es el pase completo.
    </AlertBanner>
  );
};

const PuertasPage = async ({ searchParams }: { searchParams: Promise<AlertSearch> }) => {
  const filters = parseAlertFilters(await searchParams);
  const loaded = await guard(async () => {
    try {
      return await listPuertas(filters);
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
      <PageIntro eyebrow="Puertas giratorias" title="Falta calcular este indicador">
        <p>
          Hace falta el índice, los cargos y el extracto del BORME con la tabla{" "}
          <code className="rounded bg-subtle px-1.5 py-0.5 font-mono text-xs text-ink">acto</code> (fechas de anuncio).
          En la raíz del proyecto:{" "}
          <code className="rounded bg-subtle px-1.5 py-0.5 font-mono text-xs text-ink">
            python3 pipeline/puertas_giratorias.py
          </code>
          . No reconstruye la base ni vuelve a bajar el BORME.
        </p>
      </PageIntro>
    );
  }

  return (
    <>
      <PageIntro eyebrow="Puertas giratorias" title="Quien deja el cargo y entra en la empresa que cobró">
        <p>
          Un órgano da subvenciones o contratos a una sociedad. Alguien que ocupó ese órgano deja el escaño y, en los
          cuatro años siguientes, el BORME le nombra administrador o consejero de esa sociedad. Si se ha generado la
          caché de la sección II.A del BOE, el mismo cruce incluye altos cargos del Estado cesados en un ministerio.
        </p>
        <p>
          El cese de 2015 es el 14 jun 2019 si esa persona no está en el fichero de 2019. El de 2019 es el 16 jun 2023:
          no hay electos de 2023, así que se supone que no repitió aunque siguiera en el cargo. Una baja de alcalde
          anterior se usa solo si no queda una concejalía posterior. Las fechas de concejal son las del mandato, no la
          dimisión.
        </p>
      </PageIntro>
      <AlertBanner>
        Indicio, no prueba. Un homónimo basta para coincidir el nombre, el extracto no separa un nombramiento de un
        cese, y quien repitió en 2023 puede aparecer como si hubiera salido. No dice que firmara el expediente.
      </AlertBanner>
      <PartialNote parcial={loaded.meta.parcial} />
      <AlertFilterForm
        action="/alertas/puertas-giratorias"
        filters={filters}
        ccaa={loaded.ccaa}
        anios={loaded.anios}
        organismos={loaded.organismos}
        tipos={TIPOS}
      />
      <AlertList alerts={loaded.alerts} />
      <AlertPager
        path="/alertas/puertas-giratorias"
        filters={filters}
        total={loaded.total}
        pageSize={loaded.pageSize}
      />
    </>
  );
};

export default PuertasPage;
