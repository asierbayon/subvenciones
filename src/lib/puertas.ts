import type { SQLInputValue, SQLOutputValue } from "node:sqlite";
import { ALERT_PAGE_SIZE, type AlertFilters } from "@/lib/alerts";
import { asNumber, asNumberOrNull, asString, getDb } from "@/lib/db";
import { fold } from "@/lib/utils";

export type PuertaItem = {
  clase: string;
  ref: string;
  fecha: string;
  importe: number;
  titulo: string;
  url: string;
};

export type PuertaAlert = {
  id: number;
  tipo: string;
  puntuacion: number;
  confianzaNombre: number;
  lugares: number;
  modo: string;
  motivo: string;
  nif: string;
  beneficiarioId: number | null;
  empresa: string;
  confianzaEmpresa: string;
  capital: number | null;
  importeTotalEmpresa: number;
  politicoNombre: string;
  rol: string;
  cuerpo: string;
  partido: string;
  municipio: string;
  provincia: string;
  ccaa: string;
  mandatoDesde: string;
  mandatoHasta: string;
  precisionFechas: string;
  supuesto: string;
  cese: string;
  nombramiento: string;
  dias: number;
  adminCargo: string;
  adminNombre: string;
  organismo: string;
  coherencia: string;
  importeMandato: number;
  importePrevio: number;
  nAyudas: number;
  nContratos: number;
  anio: number;
  fuenteBorme: string;
  fuenteUrl: string;
  fuentePolitico: string;
  fuentePoliticoUrl: string;
  items: PuertaItem[];
};

export type PuertaMeta = {
  parcial: boolean;
  builtAt: string;
  supuesto: string;
  nDespues: number | null;
  nDurante: number | null;
};

const whereOf = (filters: AlertFilters) => {
  const clauses: string[] = [];
  const params: SQLInputValue[] = [];
  if (filters.ccaa) {
    clauses.push("ccaa = ?");
    params.push(filters.ccaa);
  }
  if (filters.anio) {
    clauses.push("anio = ?");
    params.push(Number(filters.anio));
  }
  if (filters.organismo) {
    clauses.push("organismo_norm LIKE ?");
    params.push(`${fold(filters.organismo)}%`);
  }
  if (filters.tipo) {
    clauses.push("tipo = ?");
    params.push(filters.tipo);
  }
  if (clauses.length === 0) {
    return { where: "", params };
  }
  return { where: `WHERE ${clauses.join(" AND ")}`, params };
};

const mapItem = (row: Record<string, SQLOutputValue>): PuertaItem => ({
  clase: asString(row.clase),
  ref: asString(row.ref),
  fecha: asString(row.fecha),
  importe: asNumber(row.importe),
  titulo: asString(row.titulo),
  url: asString(row.url),
});

const itemsFor = (rows: Record<string, SQLOutputValue>[]) => {
  const grouped = new Map<number, PuertaItem[]>();
  for (const row of rows) {
    const alertId = asNumber(row.alert_id);
    const list = grouped.get(alertId) ?? [];
    list.push(mapItem(row));
    grouped.set(alertId, list);
  }
  return grouped;
};

const mapAlert = (row: Record<string, SQLOutputValue>, items: PuertaItem[]): PuertaAlert => ({
  id: asNumber(row.id),
  tipo: asString(row.tipo),
  puntuacion: asNumber(row.puntuacion),
  confianzaNombre: asNumber(row.confianza_nombre),
  lugares: asNumber(row.lugares),
  modo: asString(row.modo),
  motivo: asString(row.motivo),
  nif: asString(row.nif),
  beneficiarioId: asNumberOrNull(row.beneficiario_id),
  empresa: asString(row.empresa),
  confianzaEmpresa: asString(row.confianza_empresa),
  capital: asNumberOrNull(row.capital),
  importeTotalEmpresa: asNumber(row.importe_total_empresa),
  politicoNombre: asString(row.politico_nombre),
  rol: asString(row.rol),
  cuerpo: asString(row.cuerpo),
  partido: asString(row.partido),
  municipio: asString(row.municipio),
  provincia: asString(row.provincia),
  ccaa: asString(row.ccaa),
  mandatoDesde: asString(row.mandato_desde),
  mandatoHasta: asString(row.mandato_hasta),
  precisionFechas: asString(row.precision_fechas),
  supuesto: asString(row.supuesto),
  cese: asString(row.cese),
  nombramiento: asString(row.nombramiento),
  dias: asNumber(row.dias),
  adminCargo: asString(row.admin_cargo),
  adminNombre: asString(row.admin_nombre),
  organismo: asString(row.organismo),
  coherencia: asString(row.coherencia),
  importeMandato: asNumber(row.importe_mandato),
  importePrevio: asNumber(row.importe_previo),
  nAyudas: asNumber(row.n_ayudas),
  nContratos: asNumber(row.n_contratos),
  anio: asNumber(row.anio),
  fuenteBorme: asString(row.fuente_borme),
  fuenteUrl: asString(row.fuente_url),
  fuentePolitico: asString(row.fuente_politico),
  fuentePoliticoUrl: asString(row.fuente_politico_url),
  items,
});

const readMeta = async (): Promise<PuertaMeta> => {
  const empty: PuertaMeta = {
    parcial: false,
    builtAt: "",
    supuesto: "",
    nDespues: null,
    nDurante: null,
  };
  const db = await getDb();
  try {
    const rows = db.prepare("SELECT clave, valor FROM alert_puerta_meta").all() as { clave: string; valor: string }[];
    const values = new Map(rows.map((row) => [row.clave, row.valor]));
    const despues = values.get("n_despues");
    const durante = values.get("n_durante");
    return {
      parcial: values.get("parcial") === "1",
      builtAt: values.get("built_at") ?? "",
      supuesto: values.get("supuesto") ?? "",
      nDespues: despues === undefined ? null : Number(despues),
      nDurante: durante === undefined ? null : Number(durante),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("no such table")) {
      return empty;
    }
    throw error;
  }
};

export const listPuertas = async (filters: AlertFilters) => {
  const db = await getDb();
  const { where, params } = whereOf(filters);
  const total = asNumber(
    (db.prepare(`SELECT COUNT(*) AS n FROM alert_puerta ${where}`).get(...params) as { n: number }).n,
  );
  const rows = db
    .prepare(
      `SELECT * FROM alert_puerta ${where} ORDER BY puntuacion DESC, importe_mandato DESC, id DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, ALERT_PAGE_SIZE, (filters.page - 1) * ALERT_PAGE_SIZE) as Record<string, SQLOutputValue>[];
  const ids = rows.map((row) => asNumber(row.id));
  const grouped = new Map<number, PuertaItem[]>();
  if (ids.length > 0) {
    const marks = ids.map(() => "?").join(",");
    const itemRows = db
      .prepare(
        `SELECT alert_id, clase, ref, fecha, importe, titulo, url
         FROM alert_puerta_item WHERE alert_id IN (${marks}) ORDER BY fecha, ref`,
      )
      .all(...ids) as Record<string, SQLOutputValue>[];
    const loaded = itemsFor(itemRows);
    for (const [id, items] of loaded) {
      grouped.set(id, items);
    }
  }
  const alerts = rows.map((row) => mapAlert(row, grouped.get(asNumber(row.id)) ?? []));
  const ccaa = (db.prepare("SELECT DISTINCT ccaa FROM alert_puerta ORDER BY ccaa").all() as { ccaa: string }[]).map(
    (row) => row.ccaa,
  );
  const anios = (db.prepare("SELECT DISTINCT anio FROM alert_puerta ORDER BY anio").all() as { anio: number }[]).map(
    (row) => asNumber(row.anio),
  );
  const organismos = (
    db
      .prepare("SELECT organismo, COUNT(*) AS n FROM alert_puerta GROUP BY organismo ORDER BY n DESC LIMIT 300")
      .all() as { organismo: string }[]
  ).map((row) => row.organismo);
  const meta = await readMeta();
  return { alerts, total, ccaa, anios, organismos, pageSize: ALERT_PAGE_SIZE, meta };
};
