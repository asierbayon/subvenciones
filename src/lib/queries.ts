import type { SQLInputValue, SQLOutputValue } from "node:sqlite";
import { asNumber, asNumberOrNull, asOptionalString, asString, getDb } from "@/lib/db";
import { amountParam, isoDate, type Direction, type Filters, type Vista } from "@/lib/params";
import { fold } from "@/lib/utils";

export const PAGE_SIZE = 20;

const STOP = new Set([
  "de",
  "la",
  "el",
  "los",
  "las",
  "en",
  "y",
  "o",
  "del",
  "al",
  "por",
  "con",
  "una",
  "uno",
  "un",
  "para",
  "que",
  "se",
  "su",
  "sus",
  "the",
]);

type Row = Record<string, SQLOutputValue>;

export type Meta = {
  builtAt: string;
  fechaMin: string | null;
  fechaMax: string | null;
  convFechaMin: string | null;
  convFechaMax: string | null;
  nConvocatorias: number;
  nConcesiones: number;
  nBeneficiarios: number;
  importeTotal: number;
  importeSubvencion: number;
  nSubvencion: number;
  ccaaSinAsignarConv: number;
  ccaaSinAsignarConc: number;
  notaPlazo: string;
};

export type Convocatoria = {
  id: number;
  codigoBdns: string;
  mrr: boolean;
  administracion: string;
  departamento: string;
  organo: string;
  organismo: string;
  fecha: string | null;
  anio: number | null;
  titulo: string;
  tituloCooficial: string;
  urlBases: string;
  ccaa: string;
  sector: string;
  nConcesiones: number;
  importeTotal: number;
};

export type Concesion = {
  id: number;
  idConvocatoria: number | null;
  codigoBdns: string;
  administracion: string;
  departamento: string;
  organo: string;
  organismo: string;
  titulo: string;
  urlBases: string;
  aplicacion: string;
  fecha: string | null;
  anio: number | null;
  nif: string;
  beneficiarioNombre: string;
  tipoBeneficiario: string;
  importe: number | null;
  instrumento: string;
  instrumentoSlug: string;
  ayudaEquivalente: number | null;
  ccaa: string;
  sector: string;
  beneficiarioId: number | null;
};

export type Beneficiario = {
  id: number;
  nif: string;
  nombre: string;
  tipo: string;
  nConcesiones: number;
  importeTotal: number;
};

export type Page<T> = {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
};

export type Facets = {
  ccaa: string[];
  sectores: string[];
  tipos: string[];
  instrumentos: { slug: string; label: string }[];
  organismos: string[];
};

export type StatPoint = { label: string; n: number; importe: number };
export type YearPoint = { anio: number; n: number; importe: number };

const queryAll = async (sql: string, params: SQLInputValue[] = []) => {
  const db = await getDb();
  return db.prepare(sql).all(...params) as Row[];
};

const queryGet = async (sql: string, params: SQLInputValue[] = []) => {
  const db = await getDb();
  return (db.prepare(sql).get(...params) as Row | undefined) ?? null;
};

const toFts = (value: string) => {
  const tokens = fold(value)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 2 && !STOP.has(token))
    .slice(0, 6);
  if (tokens.length === 0) {
    return null;
  }
  return tokens.map((token) => `"${token}"*`).join(" AND ");
};

export const hasSearchTerms = (value: string) => toFts(value) !== null;

const directionSql = (dir: Direction) => {
  if (dir === "asc") {
    return "ASC";
  }
  return "DESC";
};

const mapConvocatoria = (row: Row): Convocatoria => ({
  id: asNumber(row.id),
  codigoBdns: asString(row.codigo_bdns),
  mrr: asNumber(row.mrr) === 1,
  administracion: asString(row.administracion),
  departamento: asString(row.departamento),
  organo: asString(row.organo),
  organismo: asString(row.organismo),
  fecha: asOptionalString(row.fecha),
  anio: asNumberOrNull(row.anio),
  titulo: asString(row.titulo),
  tituloCooficial: asString(row.titulo_cooficial),
  urlBases: asString(row.url_bases),
  ccaa: asString(row.ccaa),
  sector: asString(row.sector),
  nConcesiones: asNumber(row.n_concesiones),
  importeTotal: asNumber(row.importe_total),
});

const mapConcesion = (row: Row): Concesion => ({
  id: asNumber(row.id),
  idConvocatoria: asNumberOrNull(row.id_convocatoria),
  codigoBdns: asString(row.codigo_bdns),
  administracion: asString(row.administracion),
  departamento: asString(row.departamento),
  organo: asString(row.organo),
  organismo: asString(row.organismo),
  titulo: asString(row.titulo),
  urlBases: asString(row.url_bases),
  aplicacion: asString(row.aplicacion),
  fecha: asOptionalString(row.fecha),
  anio: asNumberOrNull(row.anio),
  nif: asString(row.nif),
  beneficiarioNombre: asString(row.beneficiario_nombre),
  tipoBeneficiario: asString(row.tipo_beneficiario),
  importe: asNumberOrNull(row.importe),
  instrumento: asString(row.instrumento),
  instrumentoSlug: asString(row.instrumento_slug),
  ayudaEquivalente: asNumberOrNull(row.ayuda_equivalente),
  ccaa: asString(row.ccaa),
  sector: asString(row.sector),
  beneficiarioId: asNumberOrNull(row.beneficiario_id),
});

const mapBeneficiario = (row: Row): Beneficiario => ({
  id: asNumber(row.id),
  nif: asString(row.nif),
  nombre: asString(row.nombre),
  tipo: asString(row.tipo),
  nConcesiones: asNumber(row.n_concesiones),
  importeTotal: asNumber(row.importe_total),
});

export const getMeta = async (): Promise<Meta> => {
  const rows = await queryAll("SELECT key, value FROM meta");
  const map = new Map(rows.map((row) => [asString(row.key), asString(row.value)]));
  const num = (key: string) => Number(map.get(key) ?? 0);
  return {
    builtAt: map.get("built_at") ?? "",
    fechaMin: map.get("fecha_min") || null,
    fechaMax: map.get("fecha_max") || null,
    convFechaMin: map.get("conv_fecha_min") || null,
    convFechaMax: map.get("conv_fecha_max") || null,
    nConvocatorias: num("n_convocatorias"),
    nConcesiones: num("n_concesiones"),
    nBeneficiarios: num("n_beneficiarios"),
    importeTotal: num("importe_total"),
    importeSubvencion: num("importe_subvencion"),
    nSubvencion: num("n_subvencion"),
    ccaaSinAsignarConv: num("ccaa_sin_asignar_conv"),
    ccaaSinAsignarConc: num("ccaa_sin_asignar_conc"),
    notaPlazo: map.get("nota_plazo") ?? "",
  };
};

export const getFacets = async (): Promise<Facets> => {
  const [ccaa, sectores, tipos, instrumentos, organismos] = await Promise.all([
    queryAll("SELECT ccaa AS label FROM stats_ccaa WHERE ambito = 'todos' GROUP BY ccaa"),
    queryAll(
      "SELECT sector AS label, SUM(n) AS n FROM stats_sector WHERE ambito = 'todos' GROUP BY sector ORDER BY n DESC",
    ),
    queryAll(
      "SELECT tipo AS label, SUM(n) AS n FROM stats_tipo WHERE ambito = 'todos' GROUP BY tipo ORDER BY n DESC",
    ),
    queryAll("SELECT slug, instrumento AS label, n FROM stats_instrumento ORDER BY n DESC"),
    queryAll("SELECT nombre FROM facet_organismo ORDER BY n DESC, nombre LIMIT 400"),
  ]);
  return {
    ccaa: ccaa.map((row) => asString(row.label)).filter(Boolean),
    sectores: sectores.map((row) => asString(row.label)).filter(Boolean),
    tipos: tipos.map((row) => asString(row.label)).filter(Boolean),
    instrumentos: instrumentos.map((row) => ({
      slug: asString(row.slug),
      label: asString(row.label),
    })),
    organismos: organismos.map((row) => asString(row.nombre)).filter(Boolean),
  };
};

const pushFilter = (
  clauses: string[],
  params: SQLInputValue[],
  sql: string,
  value: SQLInputValue | null,
) => {
  if (value === null || value === "") {
    return;
  }
  clauses.push(sql);
  params.push(value);
};

const sharedPlaceFilters = (filters: Filters, alias: string) => {
  const clauses: string[] = [];
  const params: SQLInputValue[] = [];
  pushFilter(clauses, params, `${alias}.ccaa = ?`, filters.ccaa || null);
  pushFilter(clauses, params, `${alias}.sector = ?`, filters.sector || null);
  pushFilter(clauses, params, `${alias}.organismo_norm LIKE ?`, filters.organismo ? `${fold(filters.organismo)}%` : null);
  pushFilter(clauses, params, `${alias}.fecha >= ?`, isoDate(filters.desde));
  pushFilter(clauses, params, `${alias}.fecha <= ?`, isoDate(filters.hasta));
  pushFilter(clauses, params, `${alias}.importe_total >= ?`, amountParam(filters.importeMin));
  pushFilter(clauses, params, `${alias}.importe_total <= ?`, amountParam(filters.importeMax));
  return { clauses, params };
};

const orderBy = (expr: string, dir: Direction, idExpr: string) =>
  `${expr} ${directionSql(dir)}, ${idExpr} DESC`;

const CONV_SORT: Record<string, string> = {
  fecha: "c.fecha",
  titulo: "c.titulo",
  importe: "c.importe_total",
  concesiones: "c.n_concesiones",
  organismo: "c.organismo",
};

export const searchConvocatorias = async (
  filters: Filters,
  pageSize = PAGE_SIZE,
): Promise<Page<Convocatoria>> => {
  const fts = toFts(filters.q);
  const { clauses, params } = sharedPlaceFilters(filters, "c");
  if (filters.mrr) {
    clauses.push("c.mrr = 1");
  }
  let from = "FROM convocatorias c";
  if (fts) {
    from = "FROM convocatorias c JOIN conv_fts ON conv_fts.rowid = c.id";
    clauses.unshift("conv_fts MATCH ?");
    params.unshift(fts);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const sort = CONV_SORT[filters.sort] ?? CONV_SORT.fecha;
  const unfiltered =
    !fts &&
    clauses.length === 0;
  const total = unfiltered
    ? (await getMeta()).nConvocatorias
    : asNumber((await queryGet(`SELECT COUNT(*) AS n ${from} ${where}`, params))?.n ?? 0);
  const rows = await queryAll(
    `SELECT c.* ${from} ${where} ORDER BY ${orderBy(sort, filters.dir, "c.id")} LIMIT ? OFFSET ?`,
    [...params, pageSize, (filters.page - 1) * pageSize],
  );
  return { rows: rows.map(mapConvocatoria), total, page: filters.page, pageSize };
};

const CONC_SORT: Record<string, string> = {
  fecha: "c.fecha",
  importe: "c.importe",
  beneficiario: "c.beneficiario_nombre",
  titulo: "c.titulo",
  organismo: "c.organismo",
};

type ConcessionScope = {
  beneficiarioId?: number;
  convocatoriaId?: number;
};

export const searchConcesiones = async (
  filters: Filters,
  scope: ConcessionScope = {},
  pageSize = PAGE_SIZE,
): Promise<Page<Concesion>> => {
  const fts = toFts(filters.q);
  const clauses: string[] = [];
  const params: SQLInputValue[] = [];
  pushFilter(clauses, params, "c.ccaa = ?", filters.ccaa || null);
  pushFilter(clauses, params, "c.sector = ?", filters.sector || null);
  pushFilter(clauses, params, "c.tipo_beneficiario = ?", filters.tipo || null);
  pushFilter(clauses, params, "c.instrumento_slug = ?", filters.instrumento || null);
  pushFilter(clauses, params, "c.organismo_norm LIKE ?", filters.organismo ? `${fold(filters.organismo)}%` : null);
  pushFilter(clauses, params, "c.fecha >= ?", isoDate(filters.desde));
  pushFilter(clauses, params, "c.fecha <= ?", isoDate(filters.hasta));
  pushFilter(clauses, params, "c.importe >= ?", amountParam(filters.importeMin));
  pushFilter(clauses, params, "c.importe <= ?", amountParam(filters.importeMax));
  if (scope.beneficiarioId) {
    clauses.push("c.beneficiario_id = ?");
    params.push(scope.beneficiarioId);
  }
  if (scope.convocatoriaId) {
    clauses.push("c.id_convocatoria = ?");
    params.push(scope.convocatoriaId);
  }
  let from = "FROM concesiones c";
  if (fts) {
    from = `FROM concesiones c
      WHERE (
        c.beneficiario_id IN (SELECT rowid FROM ben_fts WHERE ben_fts MATCH ?)
        OR c.id_convocatoria IN (SELECT rowid FROM conv_fts WHERE conv_fts MATCH ?)
      )`;
    params.unshift(fts, fts);
  }
  const extra = clauses.length ? `${fts ? "AND" : "WHERE"} ${clauses.join(" AND ")}` : "";
  const sort = CONC_SORT[filters.sort] ?? CONC_SORT.fecha;
  const unfiltered = !fts && clauses.length === 0;
  const total = unfiltered
    ? (await getMeta()).nConcesiones
    : asNumber((await queryGet(`SELECT COUNT(*) AS n ${from} ${extra}`, params))?.n ?? 0);
  const rows = await queryAll(
    `SELECT c.* ${from} ${extra} ORDER BY ${orderBy(sort, filters.dir, "c.id")} LIMIT ? OFFSET ?`,
    [...params, pageSize, (filters.page - 1) * pageSize],
  );
  return { rows: rows.map(mapConcesion), total, page: filters.page, pageSize };
};

const BEN_SORT: Record<string, string> = {
  importe: "b.importe_total",
  concesiones: "b.n_concesiones",
  nombre: "b.nombre",
};

export const searchBeneficiarios = async (
  filters: Filters,
  pageSize = PAGE_SIZE,
): Promise<Page<Beneficiario>> => {
  const fts = toFts(filters.q);
  const clauses: string[] = [];
  const params: SQLInputValue[] = [];
  pushFilter(clauses, params, "b.tipo = ?", filters.tipo || null);
  let from = "FROM beneficiarios b";
  if (fts) {
    from = "FROM beneficiarios b JOIN ben_fts ON ben_fts.rowid = b.id";
    clauses.unshift("ben_fts MATCH ?");
    params.unshift(fts);
  }
  if (filters.ccaa) {
    clauses.push(
      "b.id IN (SELECT beneficiario_id FROM concesiones WHERE ccaa = ? AND beneficiario_id IS NOT NULL)",
    );
    params.push(filters.ccaa);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const sort = BEN_SORT[filters.sort] ?? BEN_SORT.importe;
  const unfiltered = !fts && !filters.tipo && !filters.ccaa;
  const total = unfiltered
    ? (await getMeta()).nBeneficiarios
    : asNumber((await queryGet(`SELECT COUNT(*) AS n ${from} ${where}`, params))?.n ?? 0);
  const rows = await queryAll(
    `SELECT b.* ${from} ${where} ORDER BY ${orderBy(sort, filters.dir, "b.id")} LIMIT ? OFFSET ?`,
    [...params, pageSize, (filters.page - 1) * pageSize],
  );
  return { rows: rows.map(mapBeneficiario), total, page: filters.page, pageSize };
};

export const getConvocatoria = async (codigo: string) => {
  const row = await queryGet(
    `SELECT * FROM convocatorias
     WHERE codigo_bdns = ?
     ORDER BY n_concesiones DESC, id DESC
     LIMIT 1`,
    [codigo],
  );
  if (!row) {
    return null;
  }
  const duplicates = asNumber(
    (await queryGet("SELECT COUNT(*) AS n FROM convocatorias WHERE codigo_bdns = ?", [codigo]))?.n ?? 1,
  );
  return { convocatoria: mapConvocatoria(row), duplicates };
};

export const getConcesion = async (id: number) => {
  const row = await queryGet("SELECT * FROM concesiones WHERE id = ?", [id]);
  if (!row) {
    return null;
  }
  return mapConcesion(row);
};

export const getBeneficiario = async (id: number) => {
  const row = await queryGet("SELECT * FROM beneficiarios WHERE id = ?", [id]);
  if (!row) {
    return null;
  }
  const years = await queryAll(
    `SELECT anio, COUNT(*) AS n, COALESCE(SUM(importe), 0) AS importe
     FROM concesiones
     WHERE beneficiario_id = ? AND anio IS NOT NULL
     GROUP BY anio
     ORDER BY anio`,
    [id],
  );
  const territorios = await queryAll(
    `SELECT ccaa AS label, COUNT(*) AS n, COALESCE(SUM(importe), 0) AS importe
     FROM concesiones
     WHERE beneficiario_id = ?
     GROUP BY ccaa
     ORDER BY importe DESC
     LIMIT 8`,
    [id],
  );
  return {
    beneficiario: mapBeneficiario(row),
    years: years.map((item) => ({
      anio: asNumber(item.anio),
      n: asNumber(item.n),
      importe: asNumber(item.importe),
    })),
    territorios: territorios.map((item) => ({
      label: asString(item.label),
      n: asNumber(item.n),
      importe: asNumber(item.importe),
    })),
  };
};

export const getDashboard = async (vista: Vista) => {
  const meta = await getMeta();
  const [anios, ccaa, organismos, sectores, instrumentos, tipos, top] = await Promise.all([
    queryAll("SELECT anio, n, importe FROM stats_anio WHERE ambito = ? ORDER BY anio", [vista]),
    queryAll("SELECT ccaa AS label, n, importe FROM stats_ccaa WHERE ambito = ? ORDER BY importe DESC", [vista]),
    queryAll(
      "SELECT organismo AS label, n, importe FROM stats_organismo WHERE ambito = ? ORDER BY importe DESC",
      [vista],
    ),
    queryAll("SELECT sector AS label, n, importe FROM stats_sector WHERE ambito = ? ORDER BY importe DESC", [vista]),
    queryAll("SELECT instrumento AS label, n, importe FROM stats_instrumento ORDER BY importe DESC"),
    queryAll("SELECT tipo AS label, n, importe FROM stats_tipo WHERE ambito = ? ORDER BY importe DESC", [vista]),
    queryAll(
      `SELECT beneficiario_id, nombre, nif, tipo, n, importe
       FROM stats_top_beneficiario WHERE ambito = ? ORDER BY importe DESC`,
      [vista],
    ),
  ]);
  const point = (row: Row): StatPoint => ({
    label: asString(row.label),
    n: asNumber(row.n),
    importe: asNumber(row.importe),
  });
  return {
    meta,
    anios: anios.map(
      (row): YearPoint => ({
        anio: asNumber(row.anio),
        n: asNumber(row.n),
        importe: asNumber(row.importe),
      }),
    ),
    ccaa: ccaa.map(point),
    organismos: organismos.map(point),
    sectores: sectores.map(point),
    instrumentos: instrumentos.map(point),
    tipos: tipos.map(point),
    top: top.map((row) => ({
      id: asNumber(row.beneficiario_id),
      nombre: asString(row.nombre),
      nif: asString(row.nif),
      tipo: asString(row.tipo),
      n: asNumber(row.n),
      importe: asNumber(row.importe),
    })),
  };
};

export const windowStart = (fechaMax: string) => {
  const date = new Date(`${fechaMax}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 60);
  return date.toISOString().slice(0, 10);
};
