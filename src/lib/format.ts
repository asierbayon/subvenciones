const euro = new Intl.NumberFormat("es-ES", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});

const euroExact = new Intl.NumberFormat("es-ES", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const integer = new Intl.NumberFormat("es-ES");

const decimal = new Intl.NumberFormat("es-ES", {
  maximumFractionDigits: 1,
});

export const formatEuro = (value: number | null | undefined) => {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "—";
  }
  return euro.format(value);
};

export const formatEuroExact = (value: number | null | undefined) => {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "—";
  }
  return euroExact.format(value);
};

export const formatNumber = (value: number | null | undefined) => {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "—";
  }
  return integer.format(value);
};

export const formatCompactEuro = (value: number) => {
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000_000) {
    return `${decimal.format(value / 1_000_000_000)} mil M€`;
  }
  if (absolute >= 1_000_000) {
    return `${decimal.format(value / 1_000_000)} M€`;
  }
  if (absolute >= 10_000) {
    return `${decimal.format(value / 1_000)} mil €`;
  }
  return formatEuro(value);
};

export const formatDate = (iso: string | null | undefined) => {
  if (!iso) {
    return "—";
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) {
    return iso;
  }
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return new Intl.DateTimeFormat("es-ES", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
};

export const shorten = (value: string, limit = 42) => {
  if (value.length <= limit) {
    return value;
  }
  return `${value.slice(0, limit - 1).trimEnd()}…`;
};
