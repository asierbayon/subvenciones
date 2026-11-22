import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

export const fold = (value: string) =>
  value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toUpperCase()
    .replace(/[·./-]/g, " ")
    .replace(/[^A-Z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export const bdnsConvocatoriaUrl = (codigo: string) =>
  `https://www.infosubvenciones.es/bdnstrans/GE/es/convocatorias/${encodeURIComponent(codigo)}`;

export const CCAA_ORDER = [
  "Andalucía",
  "Aragón",
  "Asturias",
  "Illes Balears",
  "Canarias",
  "Cantabria",
  "Castilla y León",
  "Castilla-La Mancha",
  "Cataluña",
  "Comunitat Valenciana",
  "Extremadura",
  "Galicia",
  "Comunidad de Madrid",
  "Región de Murcia",
  "Navarra",
  "País Vasco",
  "La Rioja",
  "Ceuta",
  "Melilla",
  "Administración General del Estado",
  "No determinada",
];

export const compareCcaa = (left: string, right: string) => {
  const leftIndex = CCAA_ORDER.indexOf(left);
  const rightIndex = CCAA_ORDER.indexOf(right);
  const leftRank = leftIndex === -1 ? 99 : leftIndex;
  const rightRank = rightIndex === -1 ? 99 : rightIndex;
  if (leftRank !== rightRank) {
    return leftRank - rightRank;
  }
  return left.localeCompare(right, "es");
};
