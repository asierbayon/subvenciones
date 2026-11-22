import type { SQLInputValue, SQLOutputValue } from "node:sqlite";
import { asNumber, asNumberOrNull, asString, getDb } from "@/lib/db";
import { fold } from "@/lib/utils";

export const ALERT_PAGE_SIZE = 15;

export type AlertSearch = Record<string, string | string[] | undefined>;

export type AlertFilters = {
  ccaa: string;
  organismo: string;
  anio: string;
  tipo: string;
  page: number;
  pagina: number;
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
  puntuacion: number;
  medianaOrganismo: number;
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
  const paginaRaw = Number.parseInt(first(params, "pagina") || "1", 10);
  const pagina = Number.isFinite(paginaRaw) && paginaRaw > 0 ? Math.min(paginaRaw, 400) : 1;
  return {
    ccaa: first(params, "ccaa").trim(),
    organismo: first(params, "organismo").trim(),
    anio: first(params, "anio").trim(),
    tipo: first(params, "tipo").trim(),
    page,
    pagina,
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
  if (next.tipo) {
    params.set("tipo", next.tipo);
  }
  if (next.page > 1) {
    params.set("page", String(next.page));
  }
  if (next.pagina > 1) {
    params.set("pagina", String(next.pagina));
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

export type ConcentracionRow = {
  id: number;
  organismo: string;
  ccaa: string;
  anio: number;
  n: number;
  nBeneficiarios: number;
  importe: number;
  hhi: number;
  top1: number;
  top5: number;
  alerta: boolean;
};

export type RecurrenteRow = {
  id: number;
  organismo: string;
  ccaa: string;
  beneficiarioId: number | null;
  nif: string;
  nombre: string;
  nAnios: number;
  anioMin: number;
  anioMax: number;
  n: number;
  importe: number;
  anios: number[];
};

const mapConcentracion = (row: Record<string, SQLOutputValue>): ConcentracionRow => ({
  id: asNumber(row.id),
  organismo: asString(row.organismo),
  ccaa: asString(row.ccaa),
  anio: asNumber(row.anio),
  n: asNumber(row.n),
  nBeneficiarios: asNumber(row.n_beneficiarios),
  importe: asNumber(row.importe),
  hhi: asNumber(row.hhi),
  top1: asNumber(row.top1),
  top5: asNumber(row.top5),
  alerta: asNumber(row.alerta) === 1,
});

export const listConcentracion = async (filters: AlertFilters) => {
  const db = await getDb();
  const year = filters.anio ? Number(filters.anio) : 0;
  const clauses = ["anio = ?"];
  const params: SQLInputValue[] = [year];
  if (filters.ccaa) {
    clauses.push("ccaa = ?");
    params.push(filters.ccaa);
  }
  if (filters.organismo) {
    clauses.push("organismo_norm LIKE ?");
    params.push(`${fold(filters.organismo)}%`);
  }
  const where = `WHERE ${clauses.join(" AND ")}`;
  const total = asNumber(
    (db.prepare(`SELECT COUNT(*) AS n FROM alert_concentracion ${where}`).get(...params) as { n: number }).n,
  );
  const rows = db
    .prepare(
      `SELECT * FROM alert_concentracion ${where} ORDER BY alerta DESC, hhi DESC, importe DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, ALERT_PAGE_SIZE, (filters.page - 1) * ALERT_PAGE_SIZE) as Record<string, SQLOutputValue>[];
  const ccaa = (
    db.prepare("SELECT DISTINCT ccaa FROM alert_concentracion WHERE anio = 0 ORDER BY ccaa").all() as {
      ccaa: string;
    }[]
  ).map((row) => row.ccaa);
  const anios = (
    db.prepare("SELECT DISTINCT anio FROM alert_concentracion WHERE anio != 0 ORDER BY anio").all() as {
      anio: number;
    }[]
  ).map((row) => asNumber(row.anio));
  const organismos = (
    db
      .prepare(
        "SELECT organismo FROM alert_concentracion WHERE anio = 0 GROUP BY organismo ORDER BY SUM(n) DESC LIMIT 300",
      )
      .all() as { organismo: string }[]
  ).map((row) => row.organismo);
  return {
    rows: rows.map(mapConcentracion),
    total,
    ccaa,
    anios,
    organismos,
    pageSize: ALERT_PAGE_SIZE,
    flagged: asNumber(
      (
        db.prepare("SELECT COUNT(*) AS n FROM alert_concentracion WHERE anio = 0 AND alerta = 1").get() as {
          n: number;
        }
      ).n,
    ),
  };
};

export const listRecurrentes = async (filters: AlertFilters) => {
  const db = await getDb();
  const clauses: string[] = [];
  const params: SQLInputValue[] = [];
  let from = "FROM alert_recurrente r";
  if (filters.anio) {
    from += " JOIN alert_recurrente_anio y ON y.recurrente_id = r.id AND y.anio = ?";
    params.push(Number(filters.anio));
  }
  if (filters.ccaa) {
    clauses.push("r.ccaa = ?");
    params.push(filters.ccaa);
  }
  if (filters.organismo) {
    clauses.push("r.organismo_norm LIKE ?");
    params.push(`${fold(filters.organismo)}%`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const total = asNumber(
    (db.prepare(`SELECT COUNT(*) AS n ${from} ${where}`).get(...params) as { n: number }).n,
  );
  const rows = db
    .prepare(
      `SELECT r.* ${from} ${where} ORDER BY r.n_anios DESC, r.importe DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, ALERT_PAGE_SIZE, (filters.pagina - 1) * ALERT_PAGE_SIZE) as Record<string, SQLOutputValue>[];
  const ids = rows.map((row) => asNumber(row.id));
  const years = new Map<number, number[]>();
  if (ids.length > 0) {
    const marks = ids.map(() => "?").join(",");
    const yearRows = db
      .prepare(
        `SELECT recurrente_id, anio FROM alert_recurrente_anio WHERE recurrente_id IN (${marks}) ORDER BY anio`,
      )
      .all(...ids) as Record<string, SQLOutputValue>[];
    for (const yearRow of yearRows) {
      const id = asNumber(yearRow.recurrente_id);
      const list = years.get(id) ?? [];
      list.push(asNumber(yearRow.anio));
      years.set(id, list);
    }
  }
  const mapped: RecurrenteRow[] = rows.map((row) => ({
    id: asNumber(row.id),
    organismo: asString(row.organismo),
    ccaa: asString(row.ccaa),
    beneficiarioId: asNumberOrNull(row.beneficiario_id),
    nif: asString(row.nif),
    nombre: asString(row.nombre),
    nAnios: asNumber(row.n_anios),
    anioMin: asNumber(row.anio_min),
    anioMax: asNumber(row.anio_max),
    n: asNumber(row.n),
    importe: asNumber(row.importe),
    anios: years.get(asNumber(row.id)) ?? [],
  }));
  return { rows: mapped, total, pageSize: ALERT_PAGE_SIZE };
};

export type CalendarioRow = {
  id: number;
  tipo: string;
  organismo: string;
  ccaa: string;
  anio: number;
  etiqueta: string;
  motivo: string;
  fechaInicio: string;
  fechaFin: string;
  n: number;
  importe: number;
  referencia: number;
};

export const listCalendario = async (filters: AlertFilters) => {
  const db = await getDb();
  const clauses: string[] = [];
  const params: SQLInputValue[] = [];
  if (filters.tipo) {
    clauses.push("tipo = ?");
    params.push(filters.tipo);
  }
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
  const total = asNumber(
    (db.prepare(`SELECT COUNT(*) AS n FROM alert_calendario ${where}`).get(...params) as { n: number }).n,
  );
  const rows = db
    .prepare(
      `SELECT * FROM alert_calendario ${where} ORDER BY n DESC, importe DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, ALERT_PAGE_SIZE, (filters.page - 1) * ALERT_PAGE_SIZE) as Record<string, SQLOutputValue>[];
  const mapped: CalendarioRow[] = rows.map((row) => ({
    id: asNumber(row.id),
    tipo: asString(row.tipo),
    organismo: asString(row.organismo),
    ccaa: asString(row.ccaa),
    anio: asNumber(row.anio),
    etiqueta: asString(row.etiqueta),
    motivo: asString(row.motivo),
    fechaInicio: asString(row.fecha_inicio),
    fechaFin: asString(row.fecha_fin),
    n: asNumber(row.n),
    importe: asNumber(row.importe),
    referencia: asNumber(row.referencia),
  }));
  const ccaa = (db.prepare("SELECT DISTINCT ccaa FROM alert_calendario ORDER BY ccaa").all() as { ccaa: string }[]).map(
    (row) => row.ccaa,
  );
  const anios = (db.prepare("SELECT DISTINCT anio FROM alert_calendario ORDER BY anio").all() as { anio: number }[]).map(
    (row) => asNumber(row.anio),
  );
  const organismos = (
    db
      .prepare("SELECT organismo FROM alert_calendario GROUP BY organismo ORDER BY COUNT(*) DESC LIMIT 300")
      .all() as { organismo: string }[]
  ).map((row) => row.organismo);
  return { rows: mapped, total, ccaa, anios, organismos, pageSize: ALERT_PAGE_SIZE };
};

export const listBenford = async (filters: AlertFilters) => {
  const db = await getDb();
  return listSimpleAlert(db, "alert_benford", filters, "mad");
};

export const listRedondo = async (filters: AlertFilters) => {
  const db = await getDb();
  return listSimpleAlert(db, "alert_redondo", filters, "cuota");
};

export const listOutliers = async (filters: AlertFilters) => {
  const db = await getDb();
  const clauses: string[] = [];
  const params: SQLInputValue[] = [];
  if (filters.ccaa) {
    clauses.push("ccaa = ?");
    params.push(filters.ccaa);
  }
  if (filters.organismo) {
    clauses.push("organismo_norm LIKE ?");
    params.push(`${fold(filters.organismo)}%`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const total = asNumber((db.prepare(`SELECT COUNT(*) AS n FROM alert_outlier ${where}`).get(...params) as { n: number }).n);
  const rows = db
    .prepare(`SELECT * FROM alert_outlier ${where} ORDER BY zeta DESC LIMIT ? OFFSET ?`)
    .all(...params, ALERT_PAGE_SIZE, (filters.page - 1) * ALERT_PAGE_SIZE) as Record<string, SQLOutputValue>[];
  return {
    total,
    pageSize: ALERT_PAGE_SIZE,
    rows: rows.map((row) => ({
      id: asNumber(row.id),
      concesionId: asNumber(row.concesion_id),
      organismo: asString(row.organismo),
      ccaa: asString(row.ccaa),
      beneficiarioId: asNumberOrNull(row.beneficiario_id),
      nombre: asString(row.nombre),
      nif: asString(row.nif),
      tipo: asString(row.tipo),
      importe: asNumber(row.importe),
      mediana: asNumber(row.mediana),
      zeta: asNumber(row.zeta),
      nGrupo: asNumber(row.n_grupo),
    })),
  };
};

const listSimpleAlert = (
  db: Awaited<ReturnType<typeof getDb>>,
  table: "alert_benford" | "alert_redondo",
  filters: AlertFilters,
  metric: "mad" | "cuota",
) => {
  const clauses = ["alerta = 1"];
  const params: SQLInputValue[] = [];
  if (filters.ccaa) {
    clauses.push("ccaa = ?");
    params.push(filters.ccaa);
  }
  if (filters.organismo) {
    clauses.push("organismo_norm LIKE ?");
    params.push(`${fold(filters.organismo)}%`);
  }
  const where = `WHERE ${clauses.join(" AND ")}`;
  const total = asNumber((db.prepare(`SELECT COUNT(*) AS n FROM ${table} ${where}`).get(...params) as { n: number }).n);
  const rows = db
    .prepare(`SELECT * FROM ${table} ${where} ORDER BY ${metric} DESC LIMIT ? OFFSET ?`)
    .all(...params, ALERT_PAGE_SIZE, (filters.page - 1) * ALERT_PAGE_SIZE) as Record<string, SQLOutputValue>[];
  const ccaa = (db.prepare(`SELECT DISTINCT ccaa FROM ${table} ORDER BY ccaa`).all() as { ccaa: string }[]).map(
    (row) => row.ccaa,
  );
  const organismos = (
    db.prepare(`SELECT organismo FROM ${table} WHERE alerta = 1 GROUP BY organismo ORDER BY COUNT(*) DESC LIMIT 300`).all() as {
      organismo: string;
    }[]
  ).map((row) => row.organismo);
  return {
    total,
    pageSize: ALERT_PAGE_SIZE,
    ccaa,
    organismos,
    rows: rows.map((row) => ({
      id: asNumber(row.id),
      organismo: asString(row.organismo),
      ccaa: asString(row.ccaa),
      n: asNumber(row.n),
      mad: asNumber(row.mad),
      cuota: asNumber(row.cuota),
      cuotaGlobal: asNumber(row.cuota_global),
    })),
  };
};

export const listDirecta = async (filters: AlertFilters) => {
  const db = await getDb();
  const clauses: string[] = [];
  const params: SQLInputValue[] = [];
  if (filters.ccaa) {
    clauses.push("ccaa = ?");
    params.push(filters.ccaa);
  }
  if (filters.organismo) {
    clauses.push("organismo_norm LIKE ?");
    params.push(`${fold(filters.organismo)}%`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const total = asNumber((db.prepare(`SELECT COUNT(*) AS n FROM alert_directa ${where}`).get(...params) as { n: number }).n);
  const rows = db
    .prepare(`SELECT * FROM alert_directa ${where} ORDER BY cuota DESC, n_directa DESC LIMIT ? OFFSET ?`)
    .all(...params, ALERT_PAGE_SIZE, (filters.page - 1) * ALERT_PAGE_SIZE) as Record<string, SQLOutputValue>[];
  const ccaa = (db.prepare("SELECT DISTINCT ccaa FROM alert_directa ORDER BY ccaa").all() as { ccaa: string }[]).map(
    (row) => row.ccaa,
  );
  const organismos = (
    db.prepare("SELECT organismo FROM alert_directa GROUP BY organismo ORDER BY MAX(cuota) DESC LIMIT 300").all() as {
      organismo: string;
    }[]
  ).map((row) => row.organismo);
  return {
    total,
    pageSize: ALERT_PAGE_SIZE,
    ccaa,
    organismos,
    rows: rows.map((row) => ({
      id: asNumber(row.id),
      organismo: asString(row.organismo),
      ccaa: asString(row.ccaa),
      n: asNumber(row.n),
      nDirecta: asNumber(row.n_directa),
      nNominativa: asNumber(row.n_nominativa),
      cuota: asNumber(row.cuota),
    })),
  };
};

export const listFraccionamiento = async (filters: AlertFilters) => {
  const db = await getDb();
  const { where, params } = whereOf(filters);
  const total = asNumber((db.prepare(`SELECT COUNT(*) AS n FROM alert_fraccion ${where}`).get(...params) as { n: number }).n);
  const rows = db
    .prepare(
      `SELECT * FROM alert_fraccion ${where} ORDER BY puntuacion DESC, importe_suma DESC, id DESC LIMIT ? OFFSET ?`,
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
    puntuacion: asNumber(row.puntuacion),
    medianaOrganismo: asNumber(row.mediana_organismo),
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
