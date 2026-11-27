import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  Building2,
  CalendarClock,
  DoorOpen,
  FileSignature,
  Landmark,
  Network,
  PieChart,
  Scissors,
  Users,
} from "lucide-react";
import { AlertBanner } from "@/components/alert-banner";
import { Kpi } from "@/components/facts";
import { PageIntro, SetupNeeded } from "@/components/setup-needed";
import { Badge } from "@/components/ui/badge";
import { DatabaseMissingError, getDb, guard } from "@/lib/db";
import { formatNumber } from "@/lib/format";
import { countBormeAlerts } from "@/lib/registro";

type SignalKey =
  | "fraccion"
  | "concentracion"
  | "calendario"
  | "estadistica"
  | "directa"
  | "contratos"
  | "vinculo"
  | "puertas"
  | "sociedad"
  | "registro";

type SignalCounts = {
  fraccion: number | null;
  concentracion: number | null;
  recurrentes: number | null;
  calendario: number | null;
  benford: number | null;
  outliers: number | null;
  directa: number | null;
  contratos: number | null;
  vinculo: number | null;
  puertas: number | null;
  sociedad: number | null;
  registro: number | null;
};

type SignalDef = {
  key: SignalKey;
  href: string;
  title: string;
  summary: string;
  source: string;
  icon: React.ComponentType<{ className?: string; size?: number }>;
};

type SignalGroup = {
  title: string;
  description: string;
  items: SignalDef[];
};

const GROUPS: SignalGroup[] = [
  {
    title: "Patrones en subvenciones",
    description: "Calculados directamente sobre las concesiones de la BDNS.",
    items: [
      {
        key: "fraccion",
        href: "/alertas/fraccionamiento",
        title: "Fraccionamiento",
        summary: "Varias ayudas seguidas de la misma convocatoria justo por debajo del límite de minimis.",
        source: "BDNS",
        icon: Scissors,
      },
      {
        key: "concentracion",
        href: "/alertas/concentracion",
        title: "Concentración y repetición",
        summary: "Organismos donde pocos perceptores acaparan el importe y empresas que cobran cada año.",
        source: "BDNS",
        icon: PieChart,
      },
      {
        key: "calendario",
        href: "/alertas/calendario",
        title: "Calendario",
        summary: "Picos de concesiones antes de elecciones, tras cambios de gobierno o relevos bruscos.",
        source: "BDNS",
        icon: CalendarClock,
      },
      {
        key: "estadistica",
        href: "/alertas/estadistica",
        title: "Señales estadísticas",
        summary: "Importes atípicos dentro de su grupo, exceso de cifras redondas y ley de Benford.",
        source: "BDNS",
        icon: BarChart3,
      },
      {
        key: "directa",
        href: "/alertas/directa",
        title: "Concesión directa",
        summary: "Organismos con mayor cuota de títulos que mencionan concesión directa o nominativa.",
        source: "BDNS",
        icon: FileSignature,
      },
    ],
  },
  {
    title: "Contratación pública",
    description: "Cruce con las adjudicaciones de la Plataforma de Contratación del Sector Público.",
    items: [
      {
        key: "contratos",
        href: "/alertas/contratos",
        title: "Contratos públicos",
        summary: "Ayuda y contrato del mismo organismo en 180 días, o contratos menores repetidos al tope.",
        source: "BDNS + PLACSP",
        icon: Landmark,
      },
    ],
  },
  {
    title: "Empresas y cargos públicos",
    description: "Cruces con el Registro Mercantil (BORME) y listas abiertas de cargos públicos.",
    items: [
      {
        key: "vinculo",
        href: "/alertas/vinculos",
        title: "Vínculos políticos",
        summary: "Sociedades administradas por un cargo electo o alto cargo del organismo concedente.",
        source: "BORME + Cargos",
        icon: Users,
      },
      {
        key: "puertas",
        href: "/alertas/puertas-giratorias",
        title: "Puertas giratorias",
        summary: "Cargos públicos nombrados en empresas que cobraron ayudas o contratos de su antiguo órgano.",
        source: "BORME + BOE + Cargos",
        icon: DoorOpen,
      },
      {
        key: "sociedad",
        href: "/alertas/sociedades",
        title: "Sociedades recientes",
        summary: "Empresas recién creadas, con capital mínimo o cerradas poco después de recibir la ayuda.",
        source: "BORME",
        icon: Building2,
      },
      {
        key: "registro",
        href: "/alertas/registro",
        title: "Administradores compartidos",
        summary: "Varias sociedades del mismo organismo con igual administrador, socio único o domicilio.",
        source: "BORME",
        icon: Network,
      },
    ],
  },
];

const plural = (count: number, singular: string, pluralWord: string) => (count === 1 ? singular : pluralWord);

const signalMetric = (key: SignalKey, counts: SignalCounts): { primary: string; secondary?: string; active: boolean } => {
  if (key === "fraccion") {
    if (counts.fraccion === null) {
      return { primary: "Sin calcular", active: false };
    }
    return {
      primary: formatNumber(counts.fraccion),
      secondary: plural(counts.fraccion, "indicador", "indicadores"),
      active: true,
    };
  }
  if (key === "concentracion") {
    if (counts.concentracion === null) {
      return { primary: "Sin calcular", active: false };
    }
    const base = plural(counts.concentracion, "organismo", "organismos");
    const extra =
      counts.recurrentes !== null
        ? ` · ${formatNumber(counts.recurrentes)} ${plural(counts.recurrentes, "recurrente", "recurrentes")}`
        : "";
    return { primary: formatNumber(counts.concentracion), secondary: `${base}${extra}`, active: true };
  }
  if (key === "calendario") {
    if (counts.calendario === null) {
      return { primary: "Sin calcular", active: false };
    }
    return {
      primary: formatNumber(counts.calendario),
      secondary: plural(counts.calendario, "episodio", "episodios"),
      active: true,
    };
  }
  if (key === "estadistica") {
    if (counts.outliers === null && counts.benford === null) {
      return { primary: "Sin calcular", active: false };
    }
    if (counts.outliers !== null) {
      return {
        primary: formatNumber(counts.outliers),
        secondary: plural(counts.outliers, "importe atípico", "importes atípicos"),
        active: true,
      };
    }
    return { primary: formatNumber(counts.benford), secondary: "Benford", active: true };
  }
  if (key === "directa") {
    if (counts.directa === null) {
      return { primary: "Sin calcular", active: false };
    }
    return {
      primary: formatNumber(counts.directa),
      secondary: plural(counts.directa, "organismo", "organismos"),
      active: true,
    };
  }
  if (key === "contratos") {
    if (counts.contratos === null) {
      return { primary: "Sin calcular", active: false };
    }
    return {
      primary: formatNumber(counts.contratos),
      secondary: plural(counts.contratos, "cruce o bloque", "cruces y menores"),
      active: true,
    };
  }
  if (key === "vinculo") {
    if (counts.vinculo === null) {
      return { primary: "Sin calcular", active: false };
    }
    return {
      primary: formatNumber(counts.vinculo),
      secondary: plural(counts.vinculo, "coincidencia", "coincidencias"),
      active: true,
    };
  }
  if (key === "puertas") {
    if (counts.puertas === null) {
      return { primary: "Sin calcular", active: false };
    }
    return {
      primary: formatNumber(counts.puertas),
      secondary: plural(counts.puertas, "caso", "casos"),
      active: true,
    };
  }
  if (key === "sociedad") {
    if (counts.sociedad === null) {
      return { primary: "Sin calcular", active: false };
    }
    return {
      primary: formatNumber(counts.sociedad),
      secondary: plural(counts.sociedad, "sociedad", "sociedades"),
      active: true,
    };
  }
  if (counts.registro === null) {
    return { primary: "Sin calcular", active: false };
  }
  return {
    primary: formatNumber(counts.registro),
    secondary: plural(counts.registro, "grupo", "grupos"),
    active: true,
  };
};

const countTable = async (sql: string) => {
  const db = await getDb();
  try {
    const row = db.prepare(sql).get() as { n: number } | undefined;
    return Number(row?.n ?? 0);
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
};

const AlertasPage = async () => {
  const counts = await guard(async () => {
    const fraccion = await countTable("SELECT COUNT(*) AS n FROM alert_fraccion");
    const concentracion = await countTable(
      "SELECT COUNT(*) AS n FROM alert_concentracion WHERE anio = 0 AND alerta = 1",
    );
    const recurrentes = await countTable(
      "SELECT COUNT(*) AS n FROM alert_recurrente WHERE n_anios >= 4 AND importe >= 1000000 AND substr(nif, 1, 1) NOT IN ('P', 'Q', 'S') AND upper(nombre) NOT LIKE '%UNIVERSIDAD%' AND upper(nombre) NOT LIKE '%UNIVERSITAT%'",
    );
    const calendario = await countTable("SELECT COUNT(*) AS n FROM alert_calendario WHERE tipo != 'diciembre'");
    const benford = await countTable("SELECT COUNT(*) AS n FROM alert_benford WHERE alerta = 1");
    const outliers = await countTable("SELECT COUNT(*) AS n FROM alert_outlier");
    const directa = await countTable("SELECT COUNT(*) AS n FROM alert_directa");
    const contratos = await countTable("SELECT COUNT(*) AS n FROM alert_contrato");
    const vinculo = await countTable("SELECT COUNT(*) AS n FROM alert_vinculo");
    const puertas = await countTable("SELECT COUNT(*) AS n FROM alert_puerta");
    let sociedad: number | null = null;
    let registro: number | null = null;
    try {
      const borme = await countBormeAlerts();
      sociedad = borme.sociedad;
      registro = borme.vinculo;
    } catch (error) {
      if (error instanceof DatabaseMissingError) {
        throw error;
      }
      const message = error instanceof Error ? error.message : "";
      if (!message.includes("no such table")) {
        throw error;
      }
    }
    return {
      fraccion,
      concentracion,
      recurrentes,
      calendario,
      benford,
      outliers,
      directa,
      contratos,
      vinculo,
      puertas,
      sociedad,
      registro,
    };
  });
  if (counts === "missing") {
    return <SetupNeeded />;
  }

  const allSignals = GROUPS.flatMap((group) => group.items);
  const calculatedCount = allSignals.filter((signal) => signalMetric(signal.key, counts).active).length;
  const totalSignals = [
    counts.fraccion,
    counts.concentracion,
    counts.calendario,
    counts.outliers ?? counts.benford,
    counts.directa,
    counts.contratos,
    counts.vinculo,
    counts.puertas,
    counts.sociedad,
    counts.registro,
  ].reduce<number>((sum, value) => sum + (value ?? 0), 0);

  return (
    <>
      <PageIntro eyebrow="Alertas" title="Señales para mirar de cerca">
        <p>Diez indicadores automáticos sobre la BDNS y registros públicos para priorizar expedientes.</p>
      </PageIntro>
      <AlertBanner>
        Cada señal marca un patrón estadístico o un cruce entre registros. Sirve para abrir expedientes, nunca para
        afirmar una irregularidad.
      </AlertBanner>
      <section className="mb-8 grid gap-4 sm:grid-cols-3" aria-label="Resumen de alertas">
        <Kpi label="Módulos activos" value={`${calculatedCount} / ${allSignals.length}`} hint="Tablas calculadas en este índice" />
        <Kpi label="Indicadores listados" value={formatNumber(totalSignals)} hint="Suma de los módulos disponibles" />
        <Kpi label="Fuentes cruzadas" value="4 registros" hint="BDNS · PLACSP · BORME · Cargos" />
      </section>
      <div className="grid gap-8">
        {GROUPS.map((group) => (
          <section key={group.title} aria-labelledby={`grupo-${group.title}`}>
            <div className="mb-3.5 flex flex-wrap items-baseline justify-between gap-2 border-b border-line pb-2">
              <h2 id={`grupo-${group.title}`} className="font-display text-lg font-bold tracking-tight text-ink">
                {group.title}
              </h2>
              <p className="text-xs text-muted">{group.description}</p>
            </div>
            <ul className="grid gap-4 md:grid-cols-2">
              {group.items.map((signal) => {
                const Icon = signal.icon;
                const metric = signalMetric(signal.key, counts);
                return (
                  <li key={signal.href}>
                    <Link
                      href={signal.href}
                      className="group flex h-full flex-col justify-between gap-4 rounded-xl border border-line bg-elev p-4 shadow-2xs transition-all hover:border-accent/50 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 sm:p-5"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 items-start gap-3">
                          <span
                            className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent ring-1 ring-inset ring-accent-border/70"
                            aria-hidden="true"
                          >
                            <Icon size={18} />
                          </span>
                          <div className="min-w-0">
                            <h3 className="font-display text-base font-bold tracking-tight text-ink transition-colors group-hover:text-accent">
                              {signal.title}
                            </h3>
                            <p className="mt-1 text-xs leading-relaxed text-muted sm:text-sm">{signal.summary}</p>
                          </div>
                        </div>
                        <Badge tone={metric.active ? "accent" : "neutral"} className="shrink-0 font-semibold tabular-nums">
                          {metric.primary}
                        </Badge>
                      </div>
                      <div className="flex items-center justify-between gap-2 border-t border-line pt-3 text-xs">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge>{signal.source}</Badge>
                          {metric.secondary ? <span className="text-muted">{metric.secondary}</span> : null}
                        </div>
                        <span className="inline-flex items-center gap-1 font-semibold text-accent">
                          Explorar
                          <ArrowRight
                            aria-hidden="true"
                            size={14}
                            className="transition-transform group-hover:translate-x-0.5"
                          />
                        </span>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
};

export default AlertasPage;
