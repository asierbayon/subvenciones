import fs from "node:fs";
import path from "node:path";
import { DatabaseSync, type SQLOutputValue } from "node:sqlite";
import { connection } from "next/server";

const databasePath = () => process.env.BDNS_DB ?? path.join(process.cwd(), "data", "bdns.sqlite");

let database: DatabaseSync | null = null;

export class DatabaseMissingError extends Error {
  constructor() {
    super("No existe el índice SQLite de la BDNS.");
    this.name = "DatabaseMissingError";
  }
}

export const getDb = async () => {
  await connection();
  if (database) {
    return database;
  }
  const file = databasePath();
  if (!fs.existsSync(file)) {
    throw new DatabaseMissingError();
  }
  database = new DatabaseSync(file, { readOnly: true });
  return database;
};

export const asNumber = (value: SQLOutputValue) => {
  if (typeof value === "bigint") {
    return Number(value);
  }
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string" && value !== "") {
    return Number(value);
  }
  return 0;
};

export const asNumberOrNull = (value: SQLOutputValue) => {
  if (value === null || value === undefined) {
    return null;
  }
  return asNumber(value);
};

export const asString = (value: SQLOutputValue) => {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value);
};

export const asOptionalString = (value: SQLOutputValue) => {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  return String(value);
};

export const guard = async <T,>(loader: () => Promise<T>): Promise<T | "missing"> => {
  try {
    return await loader();
  } catch (error) {
    if (error instanceof DatabaseMissingError) {
      return "missing";
    }
    throw error;
  }
};
