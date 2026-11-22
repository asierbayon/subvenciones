export type Direction = "asc" | "desc";
export type Vista = "subvencion" | "todos";

export type Filters = {
  q: string;
  ccaa: string;
  sector: string;
  tipo: string;
  instrumento: string;
  organismo: string;
  desde: string;
  hasta: string;
  importeMin: string;
  importeMax: string;
  mrr: boolean;
  vista: Vista;
  page: number;
  sort: string;
  dir: Direction;
};

export type SearchParams = Record<string, string | string[] | undefined>;

const first = (params: SearchParams, key: string) => {
  const value = params[key];
  if (Array.isArray(value)) {
    return value[0] ?? "";
  }
  return value ?? "";
};

export const parseFilters = (params: SearchParams, fallbackSort = "fecha"): Filters => {
  const pageRaw = Number.parseInt(first(params, "page") || "1", 10);
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? Math.min(pageRaw, 400) : 1;
  const dir: Direction = first(params, "dir") === "asc" ? "asc" : "desc";
  const vista: Vista = first(params, "vista") === "todos" ? "todos" : "subvencion";
  const sort = first(params, "sort").trim() || fallbackSort;
  return {
    q: first(params, "q").trim(),
    ccaa: first(params, "ccaa").trim(),
    sector: first(params, "sector").trim(),
    tipo: first(params, "tipo").trim(),
    instrumento: first(params, "instrumento").trim(),
    organismo: first(params, "organismo").trim(),
    desde: first(params, "desde").trim(),
    hasta: first(params, "hasta").trim(),
    importeMin: first(params, "min").trim(),
    importeMax: first(params, "max").trim(),
    mrr: first(params, "mrr") === "1",
    vista,
    page,
    sort,
    dir,
  };
};

export const toQuery = (filters: Filters, patch: Partial<Filters> = {}) => {
  const next = { ...filters, ...patch };
  const params = new URLSearchParams();
  const write = (key: string, value: string) => {
    if (value) {
      params.set(key, value);
    }
  };
  write("q", next.q);
  write("ccaa", next.ccaa);
  write("sector", next.sector);
  write("tipo", next.tipo);
  write("instrumento", next.instrumento);
  write("organismo", next.organismo);
  write("desde", next.desde);
  write("hasta", next.hasta);
  write("min", next.importeMin);
  write("max", next.importeMax);
  if (next.mrr) {
    params.set("mrr", "1");
  }
  if (next.vista === "todos") {
    params.set("vista", "todos");
  }
  if (next.page > 1) {
    params.set("page", String(next.page));
  }
  if (next.sort) {
    params.set("sort", next.sort);
  }
  if (next.dir) {
    params.set("dir", next.dir);
  }
  const query = params.toString();
  if (!query) {
    return "";
  }
  return `?${query}`;
};

export const isoDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }
  return value;
};

export const amountParam = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  let normalized = trimmed.replace(/\s/g, "");
  if (normalized.includes(",")) {
    normalized = normalized.replace(/\./g, "").replace(",", ".");
  } else if (/^\d{1,3}(\.\d{3})+$/.test(normalized)) {
    normalized = normalized.replace(/\./g, "");
  }
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return parsed;
};
