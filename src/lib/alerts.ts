import type { SQLInputValue, SQLOutputValue } from "node:sqlite";
import { asNumber, asNumberOrNull, asString, getDb } from "@/lib/db";
import { fold } from "@/lib/utils";

export const ALERT_PAGE_SIZE = 15;

export type AlertSearch = Record<string, string | string[] | undefined>;

export type AlertFilters = {
  ccaa: string;
  organismo: string;
  anio: string;
  page: number;
};

export type FraccionItem = {
  concesionId: number;
  fecha: string;
  importe: number;
  idConvocatoria: number | null;
  codigoBdns: string;
  titulo: string;
};

export type FraccionAlert = {
  id: number;
  regla: string;
  umbral: number;
  umbralCodigo: string;
  motivo: string;
  nif: string;
  beneficiarioId: number | null;
  nombre: string;
  organismo: string;
  ccaa: string;
  fechaInicio: string;
  fechaFin: string;
  anio: number;
  n: number;
  nConvocatorias: number;
  importeSuma: number;
  items: FraccionItem[];
};

const first = (params: AlertSearch, key: string) => {
  const value = params[key];
  if (Array.isArray(value)) {
    return value[0] ?? "";
  }
  return value ?? "";
};

export const parseAlertFilters = (params: AlertSearch): AlertFilters => {
  const pageRaw = Number.parseInt(first(params, "page") || "1", 10);
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? Math.min(pageRaw, 400) : 1;
  return {
    ccaa: first(params, "ccaa").trim(),
    organismo: first(params, "organismo").trim(),
    anio: first(params, "anio").trim(),
    page,
  };
};

export const alertQuery = (filters: AlertFilters, patch: Partial<AlertFilters> = {}) => {
  const next = { ...filters, ...patch };
  const params = new URLSearchParams();
  if (next.ccaa) {
    params.set("ccaa", next.ccaa);
  }
  if (next.organismo) {
    params.set("organismo", next.organismo);
  }
  if (next.anio) {
    params.set("anio", next.anio);
  }
  if (next.page > 1) {
    params.set("page", String(next.page));
  }
  const query = params.toString();
  if (!query) {
    return "";
  }
  return `?${query}`;
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
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return { where, params };
};

export const listFraccionamiento = async (filters: AlertFilters) => {
  const db = await getDb();
  const { where, params } = whereOf(filters);
  const total = asNumber((db.prepare(`SELECT COUNT(*) AS n FROM alert_fraccion ${where}`).get(...params) as { n: number }).n);
  const rows = db
    .prepare(
      `SELECT * FROM alert_fraccion ${where} ORDER BY importe_suma DESC, id DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, ALERT_PAGE_SIZE, (filters.page - 1) * ALERT_PAGE_SIZE) as Record<string, SQLOutputValue>[];
  const ids = rows.map((row) => asNumber(row.id));
  const itemsByAlert = new Map<number, FraccionItem[]>();
  if (ids.length > 0) {
    const marks = ids.map(() => "?").join(",");
    const items = db
      .prepare(
        `SELECT alert_id, concesion_id, fecha, importe, id_convocatoria, codigo_bdns, titulo
         FROM alert_fraccion_item WHERE alert_id IN (${marks}) ORDER BY fecha, concesion_id`,
      )
      .all(...ids) as Record<string, SQLOutputValue>[];
    for (const item of items) {
      const alertId = asNumber(item.alert_id);
      const list = itemsByAlert.get(alertId) ?? [];
      list.push({
        concesionId: asNumber(item.concesion_id),
        fecha: asString(item.fecha),
        importe: asNumber(item.importe),
        idConvocatoria: asNumberOrNull(item.id_convocatoria),
        codigoBdns: asString(item.codigo_bdns),
        titulo: asString(item.titulo),
      });
      itemsByAlert.set(alertId, list);
    }
  }
  const alerts: FraccionAlert[] = rows.map((row) => ({
    id: asNumber(row.id),
    regla: asString(row.regla),
    umbral: asNumber(row.umbral),
    umbralCodigo: asString(row.umbral_codigo),
    motivo: asString(row.motivo),
    nif: asString(row.nif),
    beneficiarioId: asNumberOrNull(row.beneficiario_id),
    nombre: asString(row.nombre),
    organismo: asString(row.organismo),
    ccaa: asString(row.ccaa),
    fechaInicio: asString(row.fecha_inicio),
    fechaFin: asString(row.fecha_fin),
    anio: asNumber(row.anio),
    n: asNumber(row.n),
    nConvocatorias: asNumber(row.n_convocatorias),
    importeSuma: asNumber(row.importe_suma),
    items: itemsByAlert.get(asNumber(row.id)) ?? [],
  }));
  const ccaa = (db.prepare("SELECT DISTINCT ccaa FROM alert_fraccion ORDER BY ccaa").all() as { ccaa: string }[]).map(
    (row) => row.ccaa,
  );
  const anios = (db.prepare("SELECT DISTINCT anio FROM alert_fraccion ORDER BY anio").all() as { anio: number }[]).map(
    (row) => asNumber(row.anio),
  );
  const organismos = (
    db
      .prepare(
        "SELECT organismo, COUNT(*) AS n FROM alert_fraccion GROUP BY organismo ORDER BY n DESC LIMIT 300",
      )
      .all() as { organismo: string }[]
  ).map((row) => row.organismo);
  return { alerts, total, ccaa, anios, organismos, pageSize: ALERT_PAGE_SIZE };
};
