import type { SQLInputValue, SQLOutputValue } from "node:sqlite";
import { ALERT_PAGE_SIZE, type AlertFilters } from "@/lib/alerts";
import { asNumber, asNumberOrNull, asString, getDb } from "@/lib/db";
import { fold } from "@/lib/utils";

export type ContratoItem = {
  concesionId: number;
  fecha: string;
  importe: number;
  codigoBdns: string;
  titulo: string;
  instrumento: string;
};

export type ContratoAlert = {
  id: number;
  nivel: string;
  via: string;
  motivo: string;
  nif: string;
  beneficiarioId: number | null;
  nombre: string;
  organismo: string;
  ccaa: string;
  anio: number;
  dias: number;
  menor: boolean;
  sinConcurrencia: boolean;
  emergencia: boolean;
  procedimientoNombre: string;
  expediente: string;
  lote: string;
  fechaContrato: string;
  importeContrato: number | null;
  organoContrato: string;
  dir3: string;
  tituloContrato: string;
  url: string;
  fuente: string;
  nConcesiones: number;
  importeConcesiones: number;
  fechaConcesionMin: string;
  fechaConcesionMax: string;
  items: ContratoItem[];
};

export type ContratoRow = {
  expediente: string;
  lote: string;
  fecha: string;
  importe: number | null;
  organo: string;
  titulo: string;
  url: string;
  procedimientoNombre: string;
  menor: boolean;
  sinConcurrencia: boolean;
  emergencia: boolean;
  fuente: string;
  adjudicatario: string;
  alerta: ContratoAlert | null;
};

const missingTable = (error: unknown) => {
  const message = error instanceof Error ? error.message : "";
  return message.includes("no such table");
};

const mapItem = (row: Record<string, SQLOutputValue>): ContratoItem => ({
  concesionId: asNumber(row.concesion_id),
  fecha: asString(row.fecha),
  importe: asNumber(row.importe),
  codigoBdns: asString(row.codigo_bdns),
  titulo: asString(row.titulo),
  instrumento: asString(row.instrumento),
});

const mapAlert = (row: Record<string, SQLOutputValue>): ContratoAlert => ({
  id: asNumber(row.id),
  nivel: asString(row.nivel),
  via: asString(row.via),
  motivo: asString(row.motivo),
  nif: asString(row.nif),
  beneficiarioId: asNumberOrNull(row.beneficiario_id),
  nombre: asString(row.nombre),
  organismo: asString(row.organismo),
  ccaa: asString(row.ccaa),
  anio: asNumber(row.anio),
  dias: asNumber(row.dias),
  menor: asNumber(row.menor) === 1,
  sinConcurrencia: asNumber(row.sin_concurrencia) === 1,
  emergencia: asNumber(row.emergencia) === 1,
  procedimientoNombre: asString(row.procedimiento_nombre),
  expediente: asString(row.expediente),
  lote: asString(row.lote),
  fechaContrato: asString(row.fecha_contrato),
  importeContrato: asNumberOrNull(row.importe_contrato),
  organoContrato: asString(row.organo_contrato),
  dir3: asString(row.dir3),
  tituloContrato: asString(row.titulo_contrato),
  url: asString(row.url),
  fuente: asString(row.fuente),
  nConcesiones: asNumber(row.n_concesiones),
  importeConcesiones: asNumber(row.importe_concesiones),
  fechaConcesionMin: asString(row.fecha_concesion_min),
  fechaConcesionMax: asString(row.fecha_concesion_max),
  items: [],
});

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
  if (filters.tipo === "menor") {
    clauses.push("menor = 1");
  }
  if (filters.tipo === "sin_concurrencia") {
    clauses.push("sin_concurrencia = 1");
  }
  if (filters.tipo === "mismo_organo" || filters.tipo === "organo_superior" || filters.tipo === "misma_administracion") {
    clauses.push("nivel = ?");
    params.push(filters.tipo);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return { where, params };
};

export const listContratos = async (filters: AlertFilters) => {
  const db = await getDb();
  try {
    const { where, params } = whereOf(filters);
    const total = asNumber(
      (db.prepare(`SELECT COUNT(*) AS n FROM alert_contrato ${where}`).get(...params) as { n: number }).n,
    );
    const rows = db
      .prepare(
        `SELECT * FROM alert_contrato ${where}
         ORDER BY CASE nivel WHEN 'mismo_organo' THEN 0 WHEN 'organo_superior' THEN 1 ELSE 2 END,
                  menor DESC, sin_concurrencia DESC, dias ASC, importe_contrato DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...params, ALERT_PAGE_SIZE, (filters.page - 1) * ALERT_PAGE_SIZE) as Record<string, SQLOutputValue>[];
    const alerts = rows.map(mapAlert);
    const ids = alerts.map((alert) => alert.id);
    if (ids.length > 0) {
      const marks = ids.map(() => "?").join(", ");
      const itemRows = db
        .prepare(`SELECT * FROM alert_contrato_item WHERE alert_id IN (${marks}) ORDER BY fecha`)
        .all(...ids) as Record<string, SQLOutputValue>[];
      const grouped = new Map<number, ContratoItem[]>();
      for (const item of itemRows) {
        const alertId = asNumber(item.alert_id);
        const list = grouped.get(alertId) ?? [];
        list.push(mapItem(item));
        grouped.set(alertId, list);
      }
      for (const alert of alerts) {
        alert.items = grouped.get(alert.id) ?? [];
      }
    }
    const ccaa = (
      db.prepare("SELECT DISTINCT ccaa FROM alert_contrato ORDER BY ccaa").all() as { ccaa: string }[]
    ).map((row) => row.ccaa);
    const anios = (
      db.prepare("SELECT DISTINCT anio FROM alert_contrato ORDER BY anio").all() as { anio: number }[]
    ).map((row) => asNumber(row.anio));
    const organismos = (
      db
        .prepare("SELECT organismo FROM alert_contrato GROUP BY organismo ORDER BY COUNT(*) DESC LIMIT 300")
        .all() as { organismo: string }[]
    ).map((row) => row.organismo);
    const metaRows = db.prepare("SELECT key, value FROM placsp_meta").all() as { key: string; value: string }[];
    const meta: Record<string, string> = {};
    for (const row of metaRows) {
      meta[row.key] = row.value;
    }
    return { alerts, total, ccaa, anios, organismos, meta, pageSize: ALERT_PAGE_SIZE };
  } catch (error) {
    if (missingTable(error)) {
      return null;
    }
    throw error;
  }
};

export const contratosDeNif = async (nif: string) => {
  if (!nif) {
    return null;
  }
  const db = await getDb();
  try {
    const total = asNumber(
      (db.prepare("SELECT COUNT(*) AS n FROM placsp_contrato WHERE nif = ?").get(nif) as { n: number }).n,
    );
    const contractRows = db
      .prepare(
        `SELECT expediente, lote, fecha, importe, organo, titulo, url, procedimiento_nombre, menor,
                sin_concurrencia, emergencia, fuente, adjudicatario
         FROM placsp_contrato WHERE nif = ? ORDER BY fecha DESC LIMIT 40`,
      )
      .all(nif) as Record<string, SQLOutputValue>[];
    const expedientes = contractRows.map((row) => asString(row.expediente));
    let alertRows: Record<string, SQLOutputValue>[] = [];
    if (expedientes.length > 0) {
      const marks = expedientes.map(() => "?").join(", ");
      alertRows = db
        .prepare(`SELECT * FROM alert_contrato WHERE nif = ? AND expediente IN (${marks})`)
        .all(nif, ...expedientes) as Record<string, SQLOutputValue>[];
    }
    const alertCount = asNumber(
      (db.prepare("SELECT COUNT(*) AS n FROM alert_contrato WHERE nif = ?").get(nif) as { n: number }).n,
    );
    const alerts = alertRows.map(mapAlert);
    const ids = alerts.map((alert) => alert.id);
    if (ids.length > 0) {
      const marks = ids.map(() => "?").join(", ");
      const itemRows = db
        .prepare(`SELECT * FROM alert_contrato_item WHERE alert_id IN (${marks})`)
        .all(...ids) as Record<string, SQLOutputValue>[];
      const grouped = new Map<number, ContratoItem[]>();
      for (const item of itemRows) {
        const alertId = asNumber(item.alert_id);
        const list = grouped.get(alertId) ?? [];
        list.push(mapItem(item));
        grouped.set(alertId, list);
      }
      for (const alert of alerts) {
        alert.items = grouped.get(alert.id) ?? [];
      }
    }
    const byKey = new Map<string, ContratoAlert>();
    for (const alert of alerts) {
      const key = `${alert.expediente}|${alert.lote}`;
      const current = byKey.get(key);
      if (!current || rank(alert) < rank(current)) {
        byKey.set(key, alert);
      }
    }
    const rows: ContratoRow[] = contractRows.map((row) => {
      const expediente = asString(row.expediente);
      const lote = asString(row.lote);
      return {
        expediente,
        lote,
        fecha: asString(row.fecha),
        importe: asNumberOrNull(row.importe),
        organo: asString(row.organo),
        titulo: asString(row.titulo),
        url: asString(row.url),
        procedimientoNombre: asString(row.procedimiento_nombre),
        menor: asNumber(row.menor) === 1,
        sinConcurrencia: asNumber(row.sin_concurrencia) === 1,
        emergencia: asNumber(row.emergencia) === 1,
        fuente: asString(row.fuente),
        adjudicatario: asString(row.adjudicatario),
        alerta: byKey.get(`${expediente}|${lote}`) ?? null,
      };
    });
    rows.sort((left, right) => {
      if (left.alerta && !right.alerta) {
        return -1;
      }
      if (!left.alerta && right.alerta) {
        return 1;
      }
      return right.fecha.localeCompare(left.fecha);
    });
    return { total, rows: rows.slice(0, 12), alertas: alertCount };
  } catch (error) {
    if (missingTable(error)) {
      return null;
    }
    throw error;
  }
};

const rank = (alert: ContratoAlert) => {
  if (alert.nivel === "mismo_organo") {
    return 0;
  }
  if (alert.nivel === "organo_superior") {
    return 1;
  }
  return 2;
};

export const alertasDeOrganismo = async (organismo: string, exact: boolean) => {
  const folded = fold(organismo);
  if (!folded) {
    return null;
  }
  const db = await getDb();
  try {
    const clause = exact ? "organismo_norm = ?" : "organismo_norm LIKE ?";
    const param = exact ? folded : `${folded}%`;
    const total = asNumber(
      (db.prepare(`SELECT COUNT(*) AS n FROM alert_contrato WHERE ${clause}`).get(param) as { n: number }).n,
    );
    const rows = db
      .prepare(
        `SELECT * FROM alert_contrato WHERE ${clause}
         ORDER BY CASE nivel WHEN 'mismo_organo' THEN 0 WHEN 'organo_superior' THEN 1 ELSE 2 END,
                  menor DESC, dias ASC
         LIMIT 8`,
      )
      .all(param) as Record<string, SQLOutputValue>[];
    const alerts = rows.map(mapAlert);
    const ids = alerts.map((alert) => alert.id);
    if (ids.length > 0) {
      const marks = ids.map(() => "?").join(", ");
      const itemRows = db
        .prepare(`SELECT * FROM alert_contrato_item WHERE alert_id IN (${marks}) ORDER BY fecha`)
        .all(...ids) as Record<string, SQLOutputValue>[];
      const grouped = new Map<number, ContratoItem[]>();
      for (const item of itemRows) {
        const alertId = asNumber(item.alert_id);
        const list = grouped.get(alertId) ?? [];
        list.push(mapItem(item));
        grouped.set(alertId, list);
      }
      for (const alert of alerts) {
        alert.items = grouped.get(alert.id) ?? [];
      }
    }
    return { total, alerts, organismo };
  } catch (error) {
    if (missingTable(error)) {
      return null;
    }
    throw error;
  }
};

export const alertasDePar = async (nif: string, organismo: string) => {
  const folded = fold(organismo);
  if (!nif || !folded) {
    return null;
  }
  const db = await getDb();
  try {
    const total = asNumber(
      (
        db.prepare("SELECT COUNT(*) AS n FROM alert_contrato WHERE nif = ? AND organismo_norm = ?").get(nif, folded) as {
          n: number;
        }
      ).n,
    );
    const rows = db
      .prepare(
        `SELECT * FROM alert_contrato WHERE nif = ? AND organismo_norm = ?
         ORDER BY menor DESC, dias ASC LIMIT 8`,
      )
      .all(nif, folded) as Record<string, SQLOutputValue>[];
    const alerts = rows.map(mapAlert);
    const ids = alerts.map((alert) => alert.id);
    if (ids.length > 0) {
      const marks = ids.map(() => "?").join(", ");
      const itemRows = db
        .prepare(`SELECT * FROM alert_contrato_item WHERE alert_id IN (${marks}) ORDER BY fecha`)
        .all(...ids) as Record<string, SQLOutputValue>[];
      const grouped = new Map<number, ContratoItem[]>();
      for (const item of itemRows) {
        const alertId = asNumber(item.alert_id);
        const list = grouped.get(alertId) ?? [];
        list.push(mapItem(item));
        grouped.set(alertId, list);
      }
      for (const alert of alerts) {
        alert.items = grouped.get(alert.id) ?? [];
      }
    }
    return { total, alerts };
  } catch (error) {
    if (missingTable(error)) {
      return null;
    }
    throw error;
  }
};
