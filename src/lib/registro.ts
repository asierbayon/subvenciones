import type { SQLInputValue, SQLOutputValue } from "node:sqlite";
import { asNumber, asNumberOrNull, asString, getDb } from "@/lib/db";
import { ALERT_PAGE_SIZE, parseAlertFilters, type AlertFilters, type AlertSearch } from "@/lib/alerts";
import { fold } from "@/lib/utils";

export { parseAlertFilters };
export type { AlertFilters, AlertSearch };

export const SOCIEDAD_REGLAS = [
  { value: "nueva_capital", label: "Constituida hace poco y capital mínimo" },
  { value: "nueva_disuelta", label: "Constituida y cerrada en poco tiempo" },
  { value: "importe_capital", label: "Ayuda grande frente al capital" },
  { value: "disuelta_pronto", label: "Cierre poco después de la ayuda" },
];

export const VINCULO_TIPOS = [
  { value: "administrador", label: "Mismo administrador" },
  { value: "socio", label: "Mismo socio único" },
  { value: "domicilio", label: "Mismo domicilio social" },
];

const REGLA_LABEL: Record<string, string> = Object.fromEntries(SOCIEDAD_REGLAS.map((item) => [item.value, item.label]));
const TIPO_LABEL: Record<string, string> = Object.fromEntries(VINCULO_TIPOS.map((item) => [item.value, item.label]));

export const reglaLabel = (regla: string) => REGLA_LABEL[regla] ?? regla;
export const vinculoLabel = (tipo: string) => TIPO_LABEL[tipo] ?? tipo;

export const confianzaLabel = (value: string) => {
  if (value === "alta") {
    return "Confianza alta";
  }
  if (value === "media") {
    return "Confianza media";
  }
  if (value === "debil") {
    return "Confianza débil";
  }
  if (value === "ambigua") {
    return "Nombre ambiguo";
  }
  return value;
};

const isCompanyNif = (nif: string) => /^[ABCD]\d{7}[0-9A-J]$/i.test(nif);

const whereOf = (filters: AlertFilters, tipoColumn: string) => {
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
    clauses.push(`${tipoColumn} = ?`);
    params.push(filters.tipo);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return { where, params };
};

const distinct = async (table: string, column: string) => {
  const db = await getDb();
  const rows = db.prepare(`SELECT DISTINCT ${column} AS value FROM ${table} ORDER BY value`).all() as {
    value: SQLOutputValue;
  }[];
  return rows.map((row) => (column === "anio" ? asNumber(row.value) : asString(row.value)));
};

export type SociedadItem = {
  concesionId: number;
  fecha: string;
  importe: number;
  codigoBdns: string;
  titulo: string;
};

export type SociedadAlert = {
  id: number;
  regla: string;
  motivo: string;
  confianza: string;
  nif: string;
  beneficiarioId: number | null;
  nombre: string;
  organismo: string;
  ccaa: string;
  anio: number;
  fechaConstitucion: string;
  capital: number | null;
  fechaDisolucion: string;
  importe: number;
  ratio: number | null;
  dias: number | null;
  fuenteUrl: string;
  fuenteCve: string;
  items: SociedadItem[];
};

export const listSociedades = async (filters: AlertFilters) => {
  const db = await getDb();
  const { where, params } = whereOf(filters, "regla");
  const total = asNumber(
    (db.prepare(`SELECT COUNT(*) AS n FROM alert_borme_sociedad ${where}`).get(...params) as { n: number }).n,
  );
  const rows = db
    .prepare(
      `SELECT * FROM alert_borme_sociedad ${where} ORDER BY importe DESC, id DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, ALERT_PAGE_SIZE, (filters.page - 1) * ALERT_PAGE_SIZE) as Record<string, SQLOutputValue>[];
  const ids = rows.map((row) => asNumber(row.id));
  const itemsByAlert = new Map<number, SociedadItem[]>();
  if (ids.length > 0) {
    const marks = ids.map(() => "?").join(",");
    const items = db
      .prepare(
        `SELECT alert_id, concesion_id, fecha, importe, codigo_bdns, titulo
         FROM alert_borme_sociedad_item WHERE alert_id IN (${marks}) ORDER BY fecha, concesion_id`,
      )
      .all(...ids) as Record<string, SQLOutputValue>[];
    for (const item of items) {
      const alertId = asNumber(item.alert_id);
      const list = itemsByAlert.get(alertId) ?? [];
      list.push({
        concesionId: asNumber(item.concesion_id),
        fecha: asString(item.fecha),
        importe: asNumber(item.importe),
        codigoBdns: asString(item.codigo_bdns),
        titulo: asString(item.titulo),
      });
      itemsByAlert.set(alertId, list);
    }
  }
  const alerts: SociedadAlert[] = rows.map((row) => ({
    id: asNumber(row.id),
    regla: asString(row.regla),
    motivo: asString(row.motivo),
    confianza: asString(row.confianza),
    nif: asString(row.nif),
    beneficiarioId: asNumberOrNull(row.beneficiario_id),
    nombre: asString(row.nombre),
    organismo: asString(row.organismo),
    ccaa: asString(row.ccaa),
    anio: asNumber(row.anio),
    fechaConstitucion: asString(row.fecha_constitucion),
    capital: asNumberOrNull(row.capital),
    fechaDisolucion: asString(row.fecha_disolucion),
    importe: asNumber(row.importe),
    ratio: asNumberOrNull(row.ratio),
    dias: asNumberOrNull(row.dias),
    fuenteUrl: asString(row.fuente_url),
    fuenteCve: asString(row.fuente_cve),
    items: itemsByAlert.get(asNumber(row.id)) ?? [],
  }));
  const ccaa = (await distinct("alert_borme_sociedad", "ccaa")) as string[];
  const anios = (await distinct("alert_borme_sociedad", "anio")) as number[];
  const organismos = (
    db
      .prepare(
        "SELECT organismo FROM alert_borme_sociedad GROUP BY organismo ORDER BY COUNT(*) DESC LIMIT 300",
      )
      .all() as { organismo: string }[]
  ).map((row) => row.organismo);
  return { alerts, total, ccaa, anios, organismos, pageSize: ALERT_PAGE_SIZE };
};

export type VinculoMiembro = {
  beneficiarioId: number | null;
  nif: string;
  nombre: string;
  confianza: string;
  importe: number;
  n: number;
  fuenteUrl: string;
  items: SociedadItem[];
};

export type VinculoAlert = {
  id: number;
  tipo: string;
  motivo: string;
  etiqueta: string;
  organismo: string;
  ccaa: string;
  anio: number;
  nBeneficiarios: number;
  importe: number;
  miembros: VinculoMiembro[];
};

export const listVinculos = async (filters: AlertFilters) => {
  const db = await getDb();
  const { where, params } = whereOf(filters, "tipo");
  const total = asNumber(
    (db.prepare(`SELECT COUNT(*) AS n FROM alert_borme_vinculo ${where}`).get(...params) as { n: number }).n,
  );
  const rows = db
    .prepare(
      `SELECT * FROM alert_borme_vinculo ${where} ORDER BY n_beneficiarios DESC, importe DESC, id DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, ALERT_PAGE_SIZE, (filters.page - 1) * ALERT_PAGE_SIZE) as Record<string, SQLOutputValue>[];
  const ids = rows.map((row) => asNumber(row.id));
  const miembros = new Map<number, VinculoMiembro[]>();
  if (ids.length > 0) {
    const marks = ids.map(() => "?").join(",");
    const memberRows = db
      .prepare(
        `SELECT alert_id, beneficiario_id, nif, nombre, confianza, importe, n, fuente_url
         FROM alert_borme_vinculo_miembro WHERE alert_id IN (${marks}) ORDER BY importe DESC`,
      )
      .all(...ids) as Record<string, SQLOutputValue>[];
    const itemRows = db
      .prepare(
        `SELECT alert_id, beneficiario_id, concesion_id, fecha, importe, titulo, codigo_bdns
         FROM alert_borme_vinculo_item WHERE alert_id IN (${marks}) ORDER BY importe DESC`,
      )
      .all(...ids) as Record<string, SQLOutputValue>[];
    const itemsByMember = new Map<string, SociedadItem[]>();
    for (const item of itemRows) {
      const key = `${asNumber(item.alert_id)}:${asNumber(item.beneficiario_id)}`;
      const list = itemsByMember.get(key) ?? [];
      list.push({
        concesionId: asNumber(item.concesion_id),
        fecha: asString(item.fecha),
        importe: asNumber(item.importe),
        codigoBdns: asString(item.codigo_bdns),
        titulo: asString(item.titulo),
      });
      itemsByMember.set(key, list);
    }
    for (const row of memberRows) {
      const alertId = asNumber(row.alert_id);
      const beneficiarioId = asNumberOrNull(row.beneficiario_id);
      const list = miembros.get(alertId) ?? [];
      list.push({
        beneficiarioId,
        nif: asString(row.nif),
        nombre: asString(row.nombre),
        confianza: asString(row.confianza),
        importe: asNumber(row.importe),
        n: asNumber(row.n),
        fuenteUrl: asString(row.fuente_url),
        items: itemsByMember.get(`${alertId}:${beneficiarioId ?? ""}`) ?? [],
      });
      miembros.set(alertId, list);
    }
  }
  const alerts: VinculoAlert[] = rows.map((row) => ({
    id: asNumber(row.id),
    tipo: asString(row.tipo),
    motivo: asString(row.motivo),
    etiqueta: asString(row.etiqueta),
    organismo: asString(row.organismo),
    ccaa: asString(row.ccaa),
    anio: asNumber(row.anio),
    nBeneficiarios: asNumber(row.n_beneficiarios),
    importe: asNumber(row.importe),
    miembros: miembros.get(asNumber(row.id)) ?? [],
  }));
  const ccaa = (await distinct("alert_borme_vinculo", "ccaa")) as string[];
  const anios = (await distinct("alert_borme_vinculo", "anio")) as number[];
  const organismos = (
    db
      .prepare("SELECT organismo FROM alert_borme_vinculo GROUP BY organismo ORDER BY COUNT(*) DESC LIMIT 300")
      .all() as { organismo: string }[]
  ).map((row) => row.organismo);
  return { alerts, total, ccaa, anios, organismos, pageSize: ALERT_PAGE_SIZE };
};

export const countBormeAlerts = async () => {
  const db = await getDb();
  const sociedad = asNumber(
    (db.prepare("SELECT COUNT(*) AS n FROM alert_borme_sociedad").get() as { n: number }).n,
  );
  const vinculo = asNumber((db.prepare("SELECT COUNT(*) AS n FROM alert_borme_vinculo").get() as { n: number }).n);
  return { sociedad, vinculo };
};

export type RegistroPersona = {
  rol: string;
  nombre: string;
  kind: string;
};

export type RegistroFuente = {
  cve: string;
  fecha: string;
  url: string;
  tipo: string;
};

export type RegistroRelacionada = {
  id: number;
  nombre: string;
  nif: string;
  detalle: string;
};

export type RegistroFicha = {
  empty: boolean;
  confianza: string;
  nCandidatas: number;
  provincia: string;
  hoja: string;
  fechaConstitucion: string;
  capitalConst: number | null;
  capital: number | null;
  capitalFecha: string;
  domicilio: string;
  disuelta: boolean;
  fechaDisolucion: string;
  nAnuncios: number;
  nifBorme: string;
  personas: RegistroPersona[];
  fuentes: RegistroFuente[];
  relacionadas: RegistroRelacionada[];
  senales: string[];
};

const fuenteLabel = (tipo: string) => {
  if (tipo === "constitucion") {
    return "Constitución";
  }
  if (tipo === "disolucion") {
    return "Disolución o extinción";
  }
  if (tipo === "domicilio") {
    return "Domicilio";
  }
  if (tipo === "capital") {
    return "Capital";
  }
  return tipo;
};

export const fuenteTipoLabel = fuenteLabel;

export const loadRegistro = async (beneficiarioId: number, nif: string): Promise<RegistroFicha | null> => {
  const db = await getDb();
  const row = db.prepare("SELECT * FROM borme_empresa WHERE beneficiario_id = ?").get(beneficiarioId) as
    | Record<string, SQLOutputValue>
    | undefined;
  if (!row) {
    if (!isCompanyNif(nif)) {
      return null;
    }
    return {
      empty: true,
      confianza: "",
      nCandidatas: 0,
      provincia: "",
      hoja: "",
      fechaConstitucion: "",
      capitalConst: null,
      capital: null,
      capitalFecha: "",
      domicilio: "",
      disuelta: false,
      fechaDisolucion: "",
      nAnuncios: 0,
      nifBorme: "",
      personas: [],
      fuentes: [],
      relacionadas: [],
      senales: [],
    };
  }
  const confianza = asString(row.confianza);
  const personas = (
    db
      .prepare(
        "SELECT rol, nombre, kind FROM borme_persona WHERE beneficiario_id = ? ORDER BY rol, nombre LIMIT 12",
      )
      .all(beneficiarioId) as Record<string, SQLOutputValue>[]
  ).map((item) => ({
    rol: asString(item.rol),
    nombre: asString(item.nombre),
    kind: asString(item.kind),
  }));
  const fuentes = (
    db
      .prepare(
        "SELECT cve, fecha, url, tipo FROM borme_fuente WHERE beneficiario_id = ? ORDER BY fecha, tipo",
      )
      .all(beneficiarioId) as Record<string, SQLOutputValue>[]
  ).map((item) => ({
    cve: asString(item.cve),
    fecha: asString(item.fecha),
    url: asString(item.url),
    tipo: asString(item.tipo),
  }));
  const seen = new Set<string>();
  const fuentesUnicas = fuentes.filter((item) => {
    const key = `${item.cve}:${item.tipo}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
  const relacionadas: RegistroRelacionada[] = [];
  if (confianza === "alta") {
    const peers = db
      .prepare(
        `SELECT e.beneficiario_id, e.nombre, e.nif, p.nombre AS detalle, p.rol
         FROM borme_persona mine
         JOIN borme_persona p
           ON p.nombre_key = mine.nombre_key
          AND p.beneficiario_id != mine.beneficiario_id
         JOIN borme_empresa e ON e.beneficiario_id = p.beneficiario_id
         WHERE mine.beneficiario_id = ? AND e.confianza = 'alta'
         LIMIT 16`,
      )
      .all(beneficiarioId) as Record<string, SQLOutputValue>[];
    const used = new Set<number>();
    for (const peer of peers) {
      const id = asNumber(peer.beneficiario_id);
      if (used.has(id)) {
        continue;
      }
      used.add(id);
      const rol = asString(peer.rol) === "S" ? "socio único" : "administrador";
      relacionadas.push({
        id,
        nombre: asString(peer.nombre),
        nif: asString(peer.nif),
        detalle: `${rol}: ${asString(peer.detalle)}`,
      });
      if (relacionadas.length >= 6) {
        break;
      }
    }
    const domicilioKey = asString(row.domicilio_key);
    if (domicilioKey.length >= 12 && relacionadas.length < 6) {
      const sameAddress = db
        .prepare(
          `SELECT beneficiario_id, nombre, nif FROM borme_empresa
           WHERE domicilio_key = ? AND beneficiario_id != ? AND confianza = 'alta'
           LIMIT 6`,
        )
        .all(domicilioKey, beneficiarioId) as Record<string, SQLOutputValue>[];
      for (const peer of sameAddress) {
        const id = asNumber(peer.beneficiario_id);
        if (used.has(id)) {
          continue;
        }
        used.add(id);
        relacionadas.push({
          id,
          nombre: asString(peer.nombre),
          nif: asString(peer.nif),
          detalle: "mismo domicilio social",
        });
        if (relacionadas.length >= 6) {
          break;
        }
      }
    }
  }
  let senales: string[] = [];
  try {
    senales = (
      db
        .prepare(
          "SELECT DISTINCT regla FROM alert_borme_sociedad WHERE beneficiario_id = ? ORDER BY regla",
        )
        .all(beneficiarioId) as { regla: string }[]
    ).map((item) => reglaLabel(item.regla));
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (!message.includes("no such table")) {
      throw error;
    }
  }
  return {
    empty: false,
    confianza,
    nCandidatas: asNumber(row.n_candidatas),
    provincia: asString(row.provincia),
    hoja: asString(row.hoja),
    fechaConstitucion: asString(row.fecha_constitucion),
    capitalConst: asNumberOrNull(row.capital_const),
    capital: asNumberOrNull(row.capital),
    capitalFecha: asString(row.capital_fecha),
    domicilio: asString(row.domicilio),
    disuelta: asNumber(row.disuelta) === 1,
    fechaDisolucion: asString(row.fecha_disolucion),
    nAnuncios: asNumber(row.n_anuncios),
    nifBorme: asString(row.nif_borme),
    personas,
    fuentes: fuentesUnicas,
    relacionadas,
    senales,
  };
};
