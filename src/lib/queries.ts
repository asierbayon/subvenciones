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
  importeGarantia: number;
  nGarantia: number;
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
  importeSubvencion: number;
  importeGarantia: number;
  nGarantia: number;
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
  esDuplicado: boolean;
  canonId: number | null;
};

export type Beneficiario = {
  id: number;
  nif: string;
  nombre: string;
  tipo: string;
  nConcesiones: number;
  importeTotal: number;
  nSubvencion: number;
  importeSubvencion: number;
  nGarantia: number;
  importeGarantia: number;
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
  importeSubvencion: asNumber(row.importe_subvencion ?? row.importe_total),
  importeGarantia: asNumber(row.importe_garantia ?? 0),
  nGarantia: asNumber(row.n_garantia ?? 0),
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
  esDuplicado: asNumber(row.es_duplicado ?? 0) === 1,
  canonId: asNumberOrNull(row.canon_id ?? null),
});

const mapBeneficiario = (row: Row): Beneficiario => ({
  id: asNumber(row.id),
  nif: asString(row.nif),
  nombre: asString(row.nombre),
  tipo: asString(row.tipo),
  nConcesiones: asNumber(row.n_concesiones),
  importeTotal: asNumber(row.importe_total),
  nSubvencion: asNumber(row.n_subvencion ?? row.n_concesiones),
  importeSubvencion: asNumber(row.importe_subvencion ?? row.importe_total),
  nGarantia: asNumber(row.n_garantia ?? 0),
  importeGarantia: asNumber(row.importe_garantia ?? 0),
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
    importeGarantia: num("importe_garantia"),
    nGarantia: num("n_garantia"),
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

const orderBy = (expr: string, dir: Direction, idExpr: string) =>
  `${expr} ${directionSql(dir)}, ${idExpr} DESC`;

const emptyPage = <T,>(filters: Filters, pageSize: number): Page<T> => ({
  rows: [],
  total: 0,
  page: filters.page,
  pageSize,
});

const labelId = async (table: string, nombre: string) => {
  const row = await queryGet(`SELECT id FROM ${table} WHERE nombre = ?`, [nombre]);
  if (!row) {
    return null;
  }
  return asNumber(row.id);
};

const slugId = async (slug: string) => {
  const row = await queryGet("SELECT id FROM lut_instrumento WHERE slug = ?", [slug]);
  if (!row) {
    return null;
  }
  return asNumber(row.id);
};

const hydrate = async (view: string, ids: number[]) => {
  if (ids.length === 0) {
    return [];
  }
  const marks = ids.map(() => "?").join(", ");
  const rows = await queryAll(`SELECT * FROM ${view} WHERE id IN (${marks})`, ids);
  const byId = new Map(rows.map((row) => [asNumber(row.id), row]));
  const ordered: Row[] = [];
  for (const id of ids) {
    const row = byId.get(id);
    if (row) {
      ordered.push(row);
    }
  }
  return ordered;
};

const hasDuplicateTable = async () => {
  const row = await queryGet(
    "SELECT 1 AS n FROM sqlite_master WHERE type = 'table' AND name = 'concesion_dup'",
  );
  return row !== null;
};

const whereSql = (clauses: string[]) => {
  if (clauses.length === 0) {
    return "";
  }
  return `WHERE ${clauses.join(" AND ")}`;
};

export const searchConvocatorias = async (
  filters: Filters,
  pageSize = PAGE_SIZE,
): Promise<Page<Convocatoria>> => {
  const fts = toFts(filters.q);
  const clauses: string[] = [];
  const params: SQLInputValue[] = [];
  if (filters.ccaa) {
    const id = await labelId("lut_ccaa", filters.ccaa);
    if (id === null) {
      return emptyPage(filters, pageSize);
    }
    clauses.push("c.ccaa_id = ?");
    params.push(id);
  }
  if (filters.sector) {
    const id = await labelId("lut_sector", filters.sector);
    if (id === null) {
      return emptyPage(filters, pageSize);
    }
    clauses.push("c.sector_id = ?");
    params.push(id);
  }
  if (filters.organismo) {
    clauses.push("c.organismo_id IN (SELECT id FROM lut_organismo WHERE organismo_norm LIKE ?)");
    params.push(`${fold(filters.organismo)}%`);
  }
  pushFilter(clauses, params, "c.fecha >= ?", isoDate(filters.desde));
  pushFilter(clauses, params, "c.fecha <= ?", isoDate(filters.hasta));
  pushFilter(clauses, params, "c.importe_total >= ?", amountParam(filters.importeMin));
  pushFilter(clauses, params, "c.importe_total <= ?", amountParam(filters.importeMax));
  if (filters.mrr) {
    clauses.push("c.mrr = 1");
  }
  let from = "FROM convocatoria c";
  if (fts) {
    from = "FROM convocatoria c JOIN conv_fts ON conv_fts.rowid = c.id";
    clauses.unshift("conv_fts MATCH ?");
    params.unshift(fts);
  }
  let sortFrom = from;
  let sortExpr = "c.fecha";
  if (filters.sort === "titulo") {
    sortExpr = "c.titulo";
  } else if (filters.sort === "importe") {
    sortExpr = "c.importe_total";
  } else if (filters.sort === "concesiones") {
    sortExpr = "c.n_concesiones";
  } else if (filters.sort === "organismo") {
    sortExpr = "o.organismo";
    sortFrom = `${from} JOIN lut_organismo o ON o.id = c.organismo_id`;
  }
  const where = whereSql(clauses);
  const unfiltered = !fts && clauses.length === 0;
  const total = unfiltered
    ? (await getMeta()).nConvocatorias
    : asNumber((await queryGet(`SELECT COUNT(*) AS n ${from} ${where}`, params))?.n ?? 0);
  const idRows = await queryAll(
    `SELECT c.id ${sortFrom} ${where} ORDER BY ${orderBy(sortExpr, filters.dir, "c.id")} LIMIT ? OFFSET ?`,
    [...params, pageSize, (filters.page - 1) * pageSize],
  );
  const ids = idRows.map((row) => asNumber(row.id));
  const rows = await hydrate("convocatorias", ids);
  return { rows: rows.map(mapConvocatoria), total, page: filters.page, pageSize };
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
  if (filters.ccaa) {
    const id = await labelId("lut_ccaa", filters.ccaa);
    if (id === null) {
      return emptyPage(filters, pageSize);
    }
    clauses.push("c.ccaa_id = ?");
    params.push(id);
  }
  if (filters.sector) {
    const id = await labelId("lut_sector", filters.sector);
    if (id === null) {
      return emptyPage(filters, pageSize);
    }
    clauses.push("c.sector_id = ?");
    params.push(id);
  }
  if (filters.tipo) {
    const id = await labelId("lut_tipo", filters.tipo);
    if (id === null) {
      return emptyPage(filters, pageSize);
    }
    clauses.push("c.tipo_id = ?");
    params.push(id);
  }
  if (filters.instrumento) {
    const id = await slugId(filters.instrumento);
    if (id === null) {
      return emptyPage(filters, pageSize);
    }
    clauses.push("c.instrumento_id = ?");
    params.push(id);
  }
  if (filters.organismo) {
    clauses.push("c.organismo_id IN (SELECT id FROM lut_organismo WHERE organismo_norm LIKE ?)");
    params.push(`${fold(filters.organismo)}%`);
  }
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
  const unfiltered = !fts && clauses.length === 0;
  if (await hasDuplicateTable()) {
    clauses.push("NOT EXISTS (SELECT 1 FROM concesion_dup d WHERE d.concesion_id = c.id)");
  }
  const from = "FROM concesion c";
  if (fts) {
    clauses.unshift(
      `(c.beneficiario_id IN (SELECT rowid FROM ben_fts WHERE ben_fts MATCH ?)
        OR c.id_convocatoria IN (SELECT rowid FROM conv_fts WHERE conv_fts MATCH ?))`,
    );
    params.unshift(fts, fts);
  }
  let sortFrom = from;
  let sortExpr = "c.fecha";
  if (filters.sort === "importe") {
    sortExpr = "c.importe";
  } else if (filters.sort === "beneficiario") {
    sortExpr = "p.nombre";
    sortFrom = `${from} JOIN lut_persona p ON p.id = c.persona_id`;
  } else if (filters.sort === "titulo") {
    sortExpr = "cv.titulo";
    sortFrom = `${from} JOIN convocatoria cv ON cv.id = c.id_convocatoria`;
  } else if (filters.sort === "organismo") {
    sortExpr = "o.organismo";
    sortFrom = `${from} JOIN lut_organismo o ON o.id = c.organismo_id`;
  }
  const where = whereSql(clauses);
  const total = unfiltered
    ? (await getMeta()).nConcesiones
    : asNumber((await queryGet(`SELECT COUNT(*) AS n ${from} ${where}`, params))?.n ?? 0);
  const idRows = await queryAll(
    `SELECT c.id ${sortFrom} ${where} ORDER BY ${orderBy(sortExpr, filters.dir, "c.id")} LIMIT ? OFFSET ?`,
    [...params, pageSize, (filters.page - 1) * pageSize],
  );
  const ids = idRows.map((row) => asNumber(row.id));
  const rows = await hydrate("concesiones", ids);
  return { rows: rows.map(mapConcesion), total, page: filters.page, pageSize };
};

export const searchBeneficiarios = async (
  filters: Filters,
  pageSize = PAGE_SIZE,
): Promise<Page<Beneficiario>> => {
  const fts = toFts(filters.q);
  const clauses: string[] = [];
  const params: SQLInputValue[] = [];
  if (filters.tipo) {
    const id = await labelId("lut_tipo", filters.tipo);
    if (id === null) {
      return emptyPage(filters, pageSize);
    }
    clauses.push("b.tipo_id = ?");
    params.push(id);
  }
  let from = "FROM beneficiario b";
  if (fts) {
    from = "FROM beneficiario b JOIN ben_fts ON ben_fts.rowid = b.id";
    clauses.unshift("ben_fts MATCH ?");
    params.unshift(fts);
  }
  if (filters.ccaa) {
    const id = await labelId("lut_ccaa", filters.ccaa);
    if (id === null) {
      return emptyPage(filters, pageSize);
    }
    clauses.push(
      "b.id IN (SELECT beneficiario_id FROM concesion WHERE ccaa_id = ? AND beneficiario_id IS NOT NULL)",
    );
    params.push(id);
  }
  let sortFrom = from;
  let sortExpr = "b.importe_total";
  if (filters.sort === "concesiones") {
    sortExpr = "b.n_concesiones";
  } else if (filters.sort === "nombre") {
    sortExpr = "p.nombre";
    sortFrom = `${from} JOIN lut_persona p ON p.id = b.persona_id`;
  }
  const where = whereSql(clauses);
  const unfiltered = !fts && !filters.tipo && !filters.ccaa;
  const total = unfiltered
    ? (await getMeta()).nBeneficiarios
    : asNumber((await queryGet(`SELECT COUNT(*) AS n ${from} ${where}`, params))?.n ?? 0);
  const idRows = await queryAll(
    `SELECT b.id ${sortFrom} ${where} ORDER BY ${orderBy(sortExpr, filters.dir, "b.id")} LIMIT ? OFFSET ?`,
    [...params, pageSize, (filters.page - 1) * pageSize],
  );
  const ids = idRows.map((row) => asNumber(row.id));
  const rows = await hydrate("beneficiarios", ids);
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
  if (row) {
    return mapConcesion(row);
  }
  try {
    const raw = await queryGet("SELECT * FROM concesiones_brutas WHERE id = ?", [id]);
    if (!raw) {
      return null;
    }
    return mapConcesion(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("no such table") || message.includes("no such view")) {
      return null;
    }
    throw error;
  }
};

export const getBeneficiario = async (id: number) => {
  const row = await queryGet("SELECT * FROM beneficiarios WHERE id = ?", [id]);
  if (!row) {
    return null;
  }
  const skipDup = (await hasDuplicateTable())
    ? "AND NOT EXISTS (SELECT 1 FROM concesion_dup d WHERE d.concesion_id = concesion.id)"
    : "";
  const years = await queryAll(
    `SELECT anio, COUNT(*) AS n, COALESCE(SUM(importe), 0) AS importe
     FROM concesion
     WHERE beneficiario_id = ? AND anio IS NOT NULL
     ${skipDup}
     GROUP BY anio
     ORDER BY anio`,
    [id],
  );
  const skipDupAlias = (await hasDuplicateTable())
    ? "AND NOT EXISTS (SELECT 1 FROM concesion_dup d WHERE d.concesion_id = c.id)"
    : "";
  const territorios = await queryAll(
    `SELECT ca.nombre AS label, COUNT(*) AS n, COALESCE(SUM(c.importe), 0) AS importe
     FROM concesion c
     JOIN lut_ccaa ca ON ca.id = c.ccaa_id
     WHERE c.beneficiario_id = ?
     ${skipDupAlias}
     GROUP BY ca.nombre
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
