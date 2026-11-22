#!/usr/bin/env python3
"""Precompute red-flag indicators on the existing BDNS SQLite index.

These tables are indicators for the UI. They are not findings of wrongdoing.
The script only reads concesiones and writes alert_* tables. It does not reload
the CSV dump.

    python3 pipeline/alerts.py fraccionamiento
"""

from __future__ import annotations

import sqlite3
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DB_PATH = ROOT / "data" / "bdns.sqlite"

# Bands are [80% of the threshold, the threshold). Amounts on the threshold
# itself are excluded: the pattern of interest is sitting just underneath.
THRESHOLDS: tuple[tuple[float, str, str], ...] = (
    (
        15_000,
        "contrato_menor_servicios",
        "Cada importe está entre 12.000 € y 15.000 €, justo bajo la referencia del contrato menor de servicios de la LCSP. No es un tope legal de las subvenciones.",
    ),
    (
        40_000,
        "contrato_menor_obras",
        "Cada importe está entre 32.000 € y 40.000 €, justo bajo la referencia del contrato menor de obras de la LCSP. Tampoco es un tope de subvenciones.",
    ),
    (
        200_000,
        "de_minimis",
        "Cada importe está entre 160.000 € y 200.000 €, justo bajo el de minimis general de 200.000 € (Reglamento UE 1407/2013, vigente en 2018-2022).",
    ),
)

BAND_LOW = 0.80
WINDOW_DAYS = 90
SUM_WINDOW_DAYS = 180
SUM_MIN_PIECE = 0.15
SUM_MIN_COUNT = 2
MAX_COUNT = 6


def log(message: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {message}", flush=True)


def parse_day(value: str) -> datetime:
    return datetime.strptime(value, "%Y-%m-%d")


def clusters(
    grants: list[tuple],
    window_days: int,
    min_count: int,
    max_count: int = MAX_COUNT,
) -> list[list[tuple]]:
    """Non-overlapping groups whose span is within window_days.

    A window with more than max_count grants is skipped whole: that looks like
    a programme paying many projects, not a handful of amounts tucked under a line.
    Each grant tuple starts with a datetime.
    """
    found: list[list[tuple]] = []
    index = 0
    total = len(grants)
    while index < total:
        start = grants[index][0]
        end = index
        while end + 1 < total and (grants[end + 1][0] - start).days <= window_days:
            end += 1
        size = end - index + 1
        if min_count <= size <= max_count:
            found.append(grants[index : end + 1])
            index = end + 1
            continue
        if size > max_count:
            index = end + 1
            continue
        index += 1
    return found


def connect() -> sqlite3.Connection:
    if not DB_PATH.exists():
        raise SystemExit(f"No está el índice {DB_PATH}. Ejecuta antes python3 pipeline/build_index.py.")
    connection = sqlite3.connect(DB_PATH)
    connection.execute("PRAGMA busy_timeout = 5000")
    return connection


def ensure_fraccion_schema(connection: sqlite3.Connection) -> None:
    connection.executescript(
        """
        DROP TABLE IF EXISTS alert_fraccion_item;
        DROP TABLE IF EXISTS alert_fraccion;
        CREATE TABLE alert_fraccion (
          id INTEGER PRIMARY KEY,
          regla TEXT NOT NULL,
          umbral REAL NOT NULL,
          umbral_codigo TEXT NOT NULL,
          motivo TEXT NOT NULL,
          nif TEXT NOT NULL,
          beneficiario_id INTEGER,
          nombre TEXT NOT NULL,
          organismo TEXT NOT NULL,
          organismo_norm TEXT NOT NULL,
          ccaa TEXT NOT NULL,
          fecha_inicio TEXT NOT NULL,
          fecha_fin TEXT NOT NULL,
          anio INTEGER NOT NULL,
          n INTEGER NOT NULL,
          n_convocatorias INTEGER NOT NULL,
          importe_suma REAL NOT NULL
        );
        CREATE TABLE alert_fraccion_item (
          alert_id INTEGER NOT NULL,
          concesion_id INTEGER NOT NULL,
          fecha TEXT NOT NULL,
          importe REAL NOT NULL,
          id_convocatoria INTEGER,
          codigo_bdns TEXT,
          titulo TEXT
        );
        """
    )


def build_fraccionamiento(connection: sqlite3.Connection) -> int:
    log("Preparando subvenciones dinerarias con NIF y fecha")
    connection.execute("DROP TABLE IF EXISTS alert_subv_work")
    connection.execute(
        """
        CREATE TEMP TABLE alert_subv_work AS
        SELECT
          id, nif, beneficiario_id, beneficiario_nombre, organismo, organismo_norm,
          ccaa, fecha, importe, anio, id_convocatoria, codigo_bdns, titulo
        FROM concesiones
        WHERE instrumento_slug = 'subvencion'
          AND nif != ''
          AND importe > 0
          AND fecha IS NOT NULL
        """
    )
    connection.execute(
        "CREATE INDEX idx_alert_subv_work ON alert_subv_work(nif, organismo_norm, fecha, id)"
    )
    ensure_fraccion_schema(connection)
    log("Leyendo grupos NIF + organismo")
    cursor = connection.execute(
        """
        SELECT nif, beneficiario_id, beneficiario_nombre, organismo, organismo_norm,
               ccaa, fecha, importe, anio, id, id_convocatoria, codigo_bdns, titulo
        FROM alert_subv_work
        ORDER BY nif, organismo_norm, fecha, id
        """
    )
    alerts: list[tuple] = []
    items: list[tuple] = []
    next_id = 1
    groups = 0

    def flush() -> None:
        if not alerts:
            return
        connection.executemany(
            """
            INSERT INTO alert_fraccion (
              id, regla, umbral, umbral_codigo, motivo, nif, beneficiario_id, nombre,
              organismo, organismo_norm, ccaa, fecha_inicio, fecha_fin, anio, n,
              n_convocatorias, importe_suma
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """,
            alerts,
        )
        connection.executemany(
            """
            INSERT INTO alert_fraccion_item (
              alert_id, concesion_id, fecha, importe, id_convocatoria, codigo_bdns, titulo
            ) VALUES (?,?,?,?,?,?,?)
            """,
            items,
        )
        alerts.clear()
        items.clear()

    def emit(regla: str, threshold: float, code: str, reason: str, rows: list[dict]) -> None:
        nonlocal next_id
        dates = [row["day"] for row in rows]
        if len(set(dates)) < 2:
            return
        convocatorias = {row["id_convocatoria"] for row in rows if row["id_convocatoria"]}
        calls = len(convocatorias)
        if calls <= 1:
            scope = "Todas salen de la misma convocatoria: puede ser un pago partido previsto en las bases."
        else:
            scope = f"Salen de {calls} convocatorias distintas del mismo organismo."
        amount = sum(row["importe"] for row in rows)
        alert_id = next_id
        next_id += 1
        first = rows[0]
        alerts.append(
            (
                alert_id,
                regla,
                threshold,
                code,
                f"{reason} {scope}",
                first["nif"],
                first["beneficiario_id"],
                first["nombre"],
                first["organismo"],
                first["organismo_norm"],
                first["ccaa"],
                min(dates).strftime("%Y-%m-%d"),
                max(dates).strftime("%Y-%m-%d"),
                max(row["anio"] for row in rows),
                len(rows),
                calls,
                amount,
            )
        )
        for row in rows:
            items.append(
                (
                    alert_id,
                    row["id"],
                    row["day"].strftime("%Y-%m-%d"),
                    row["importe"],
                    row["id_convocatoria"],
                    row["codigo_bdns"],
                    row["titulo"],
                )
            )

    current_key: tuple[str, str] | None = None
    bucket: list[dict] = []

    def consume(group: list[dict]) -> None:
        if len(group) < 2:
            return
        for threshold, code, reason in THRESHOLDS:
            low = threshold * BAND_LOW
            band = [
                (row["day"], row)
                for row in group
                if low <= row["importe"] < threshold
            ]
            for cluster in clusters(band, WINDOW_DAYS, 2):
                emit("banda", threshold, code, reason, [item[1] for item in cluster])
        de_minimis = 200_000
        pieces = [
            (row["day"], row)
            for row in group
            if de_minimis * SUM_MIN_PIECE <= row["importe"] < de_minimis
        ]
        for cluster in clusters(pieces, SUM_WINDOW_DAYS, SUM_MIN_COUNT):
            rows = [item[1] for item in cluster]
            total = sum(row["importe"] for row in rows)
            if de_minimis * BAND_LOW <= total < de_minimis:
                emit(
                    "suma",
                    de_minimis,
                    "de_minimis",
                    "Varias subvenciones del mismo organismo, cada una por debajo del de minimis de 200.000 €, suman una cifra justo inferior a ese techo en menos de 180 días.",
                    rows,
                )

    for raw in cursor:
        row = {
            "nif": raw[0],
            "beneficiario_id": raw[1],
            "nombre": raw[2],
            "organismo": raw[3],
            "organismo_norm": raw[4],
            "ccaa": raw[5] or "No determinada",
            "day": parse_day(raw[6]),
            "importe": float(raw[7]),
            "anio": int(raw[8]),
            "id": raw[9],
            "id_convocatoria": raw[10],
            "codigo_bdns": raw[11] or "",
            "titulo": raw[12] or "",
        }
        key = (row["nif"], row["organismo_norm"])
        if current_key is None:
            current_key = key
        if key != current_key:
            consume(bucket)
            groups += 1
            bucket = []
            current_key = key
            if groups % 200000 == 0:
                flush()
                connection.commit()
                log(f"Grupos {groups}, alertas {next_id - 1}")
        bucket.append(row)
    if bucket:
        consume(bucket)
    flush()
    connection.executescript(
        """
        CREATE INDEX idx_fraccion_filter ON alert_fraccion(ccaa, anio, importe_suma DESC);
        CREATE INDEX idx_fraccion_org ON alert_fraccion(organismo_norm, importe_suma DESC);
        CREATE INDEX idx_fraccion_item ON alert_fraccion_item(alert_id);
        """
    )
    connection.commit()
    count = connection.execute("SELECT COUNT(*) FROM alert_fraccion").fetchone()[0]
    log(f"Fraccionamiento: {count} indicadores")
    return int(count)


def self_check() -> None:
    day = datetime(2020, 1, 1)
    grants = [(day, 1), (day + timedelta(days=10), 2), (day + timedelta(days=100), 3)]
    found = clusters(grants, 90, 2)
    assert len(found) == 1 and len(found[0]) == 2
    assert clusters([(day, 1)], 90, 2) == []
    wide = [(day + timedelta(days=index), index) for index in range(7)]
    assert clusters(wide, 90, 2) == []
    log("Autocomprobación de fraccionamiento correcta.")


def build_concentracion(connection: sqlite3.Connection) -> None:
    log("Concentración por organismo y año")
    connection.executescript(
        """
        DROP TABLE IF EXISTS alert_recurrente_anio;
        DROP TABLE IF EXISTS alert_recurrente;
        DROP TABLE IF EXISTS alert_concentracion;

        CREATE TABLE alert_concentracion (
          id INTEGER PRIMARY KEY,
          organismo TEXT NOT NULL,
          organismo_norm TEXT NOT NULL,
          ccaa TEXT NOT NULL,
          anio INTEGER NOT NULL,
          n INTEGER NOT NULL,
          n_beneficiarios INTEGER NOT NULL,
          importe REAL NOT NULL,
          hhi REAL NOT NULL,
          top1 REAL NOT NULL,
          top5 REAL NOT NULL,
          alerta INTEGER NOT NULL
        );

        CREATE TABLE alert_recurrente (
          id INTEGER PRIMARY KEY,
          organismo TEXT NOT NULL,
          organismo_norm TEXT NOT NULL,
          ccaa TEXT NOT NULL,
          beneficiario_id INTEGER,
          nif TEXT,
          nombre TEXT NOT NULL,
          n_anios INTEGER NOT NULL,
          anio_min INTEGER NOT NULL,
          anio_max INTEGER NOT NULL,
          n INTEGER NOT NULL,
          importe REAL NOT NULL
        );

        CREATE TABLE alert_recurrente_anio (
          recurrente_id INTEGER NOT NULL,
          anio INTEGER NOT NULL
        );
        """
    )
    connection.execute(
        """
        CREATE TEMP TABLE alert_body_year AS
        SELECT organismo_norm, anio, COUNT(*) AS n, SUM(importe) AS importe,
               MAX(organismo) AS organismo, MAX(ccaa) AS ccaa
        FROM concesiones
        WHERE instrumento_slug = 'subvencion' AND importe > 0 AND anio IS NOT NULL
          AND organismo_norm != ''
        GROUP BY organismo_norm, anio
        """
    )
    connection.execute(
        """
        INSERT INTO alert_concentracion (
          organismo, organismo_norm, ccaa, anio, n, n_beneficiarios, importe, hhi, top1, top5, alerta
        )
        SELECT body.organismo, shares.organismo_norm, COALESCE(body.ccaa, 'No determinada'),
               shares.anio, body.n, shares.n_ben, shares.total, shares.hhi, shares.top1, shares.top5,
               CASE
                 WHEN body.n >= 20 AND shares.n_ben >= 4 AND (shares.hhi >= 0.25 OR shares.top1 >= 0.5)
                 THEN 1 ELSE 0
               END
        FROM (
          SELECT organismo_norm, anio,
                 MAX(n_ben) AS n_ben,
                 MAX(total) AS total,
                 MAX(sumsq) / (MAX(total) * MAX(total)) AS hhi,
                 MAX(CASE WHEN rn = 1 THEN importe END) / MAX(total) AS top1,
                 SUM(CASE WHEN rn <= 5 THEN importe ELSE 0 END) / MAX(total) AS top5
          FROM (
            SELECT organismo_norm, anio, importe,
                   ROW_NUMBER() OVER (PARTITION BY organismo_norm, anio ORDER BY importe DESC) AS rn,
                   SUM(importe) OVER (PARTITION BY organismo_norm, anio) AS total,
                   COUNT(*) OVER (PARTITION BY organismo_norm, anio) AS n_ben,
                   SUM(importe * importe) OVER (PARTITION BY organismo_norm, anio) AS sumsq
            FROM (
              SELECT organismo_norm, anio, beneficiario_id, SUM(importe) AS importe
              FROM concesiones
              WHERE instrumento_slug = 'subvencion' AND importe > 0 AND anio IS NOT NULL
                AND beneficiario_id IS NOT NULL AND organismo_norm != ''
              GROUP BY organismo_norm, anio, beneficiario_id
            )
          )
          GROUP BY organismo_norm, anio
        ) AS shares
        JOIN alert_body_year AS body
          ON body.organismo_norm = shares.organismo_norm AND body.anio = shares.anio
        WHERE body.n >= 15 AND shares.total > 0
        """
    )
    log("Concentración de todo el periodo")
    connection.execute(
        """
        INSERT INTO alert_concentracion (
          organismo, organismo_norm, ccaa, anio, n, n_beneficiarios, importe, hhi, top1, top5, alerta
        )
        SELECT body.organismo, shares.organismo_norm, COALESCE(body.ccaa, 'No determinada'),
               0, body.n, shares.n_ben, shares.total, shares.hhi, shares.top1, shares.top5,
               CASE
                 WHEN body.n >= 20 AND shares.n_ben >= 4 AND (shares.hhi >= 0.25 OR shares.top1 >= 0.5)
                 THEN 1 ELSE 0
               END
        FROM (
          SELECT organismo_norm,
                 MAX(n_ben) AS n_ben,
                 MAX(total) AS total,
                 MAX(sumsq) / (MAX(total) * MAX(total)) AS hhi,
                 MAX(CASE WHEN rn = 1 THEN importe END) / MAX(total) AS top1,
                 SUM(CASE WHEN rn <= 5 THEN importe ELSE 0 END) / MAX(total) AS top5
          FROM (
            SELECT organismo_norm, importe,
                   ROW_NUMBER() OVER (PARTITION BY organismo_norm ORDER BY importe DESC) AS rn,
                   SUM(importe) OVER (PARTITION BY organismo_norm) AS total,
                   COUNT(*) OVER (PARTITION BY organismo_norm) AS n_ben,
                   SUM(importe * importe) OVER (PARTITION BY organismo_norm) AS sumsq
            FROM (
              SELECT organismo_norm, beneficiario_id, SUM(importe) AS importe
              FROM concesiones
              WHERE instrumento_slug = 'subvencion' AND importe > 0
                AND beneficiario_id IS NOT NULL AND organismo_norm != ''
              GROUP BY organismo_norm, beneficiario_id
            )
          )
          GROUP BY organismo_norm
        ) AS shares
        JOIN (
          SELECT organismo_norm, COUNT(*) AS n, SUM(importe) AS importe,
                 MAX(organismo) AS organismo, MAX(ccaa) AS ccaa
          FROM concesiones
          WHERE instrumento_slug = 'subvencion' AND importe > 0 AND organismo_norm != ''
          GROUP BY organismo_norm
        ) AS body ON body.organismo_norm = shares.organismo_norm
        WHERE body.n >= 15 AND shares.total > 0
        """
    )
    log("Beneficiarios que repiten año tras año")
    connection.execute(
        """
        INSERT INTO alert_recurrente (
          organismo, organismo_norm, ccaa, beneficiario_id, nif, nombre,
          n_anios, anio_min, anio_max, n, importe
        )
        SELECT MAX(organismo), organismo_norm, COALESCE(MAX(ccaa), 'No determinada'),
               beneficiario_id, MAX(nif), MAX(beneficiario_nombre),
               COUNT(DISTINCT anio), MIN(anio), MAX(anio), COUNT(*), SUM(importe)
        FROM concesiones
        WHERE instrumento_slug = 'subvencion' AND importe > 0 AND anio IS NOT NULL
          AND beneficiario_id IS NOT NULL AND organismo_norm != ''
        GROUP BY organismo_norm, beneficiario_id
        HAVING COUNT(DISTINCT anio) >= 3
        """
    )
    connection.execute(
        """
        INSERT INTO alert_recurrente_anio (recurrente_id, anio)
        SELECT r.id, c.anio
        FROM alert_recurrente r
        JOIN concesiones c
          ON c.organismo_norm = r.organismo_norm
         AND c.beneficiario_id = r.beneficiario_id
        WHERE c.instrumento_slug = 'subvencion' AND c.importe > 0 AND c.anio IS NOT NULL
        GROUP BY r.id, c.anio
        """
    )
    connection.executescript(
        """
        CREATE INDEX idx_conc_filter ON alert_concentracion(anio, ccaa, hhi DESC);
        CREATE INDEX idx_conc_org ON alert_concentracion(organismo_norm, anio);
        CREATE INDEX idx_rec_filter ON alert_recurrente(ccaa, n_anios DESC, importe DESC);
        CREATE INDEX idx_rec_rank ON alert_recurrente(n_anios DESC, importe DESC);
        CREATE INDEX idx_rec_org ON alert_recurrente(organismo_norm);
        CREATE INDEX idx_rec_anio ON alert_recurrente_anio(anio, recurrente_id);
        """
    )
    connection.commit()
    flagged = connection.execute("SELECT COUNT(*) FROM alert_concentracion WHERE alerta = 1 AND anio = 0").fetchone()[0]
    recurrent = connection.execute("SELECT COUNT(*) FROM alert_recurrente").fetchone()[0]
    log(f"Concentración: {flagged} organismos marcados en el periodo completo; {recurrent} ganadores recurrentes")


def main() -> None:
    step = sys.argv[1] if len(sys.argv) > 1 else "fraccionamiento"
    if step == "--self-check":
        self_check()
        return
    steps = {
        "fraccionamiento": build_fraccionamiento,
        "concentracion": build_concentracion,
    }
    if step not in steps:
        known = ", ".join(steps)
        raise SystemExit(f"Paso desconocido: {step}. Pasos: {known}")
    started = time.time()
    connection = connect()
    try:
        steps[step](connection)
    finally:
        connection.close()
    log(f"Hecho en {time.time() - started:.0f} s")


if __name__ == "__main__":
    main()
