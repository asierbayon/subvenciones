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

# The 15,000 € and 40,000 € minor-contract ceilings do not apply to grants.
# The band that remains is the de minimis ceiling, and only inside one call.
THRESHOLDS: tuple[tuple[float, str, str], ...] = (
    (
        200_000,
        "de_minimis",
        "Cada importe está entre 180.000 € y 200.000 €, justo bajo el de minimis general de 200.000 € (Reglamento UE 1407/2013, vigente en 2018-2022). Los 15.000 € y 40.000 € del contrato menor no son un tope de subvenciones y no se usan.",
    ),
)

BAND_LOW = 0.90
WINDOW_DAYS = 90
SUM_WINDOW_DAYS = 180
SUM_FLOOR = 190_000
SUM_MIN_PIECE = 50_000
SUM_MIN_COUNT = 2
MAX_COUNT = 4
PUBLIC_NIF = frozenset("PQSRG")


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
          importe_suma REAL NOT NULL,
          puntuacion REAL NOT NULL,
          mediana_organismo REAL NOT NULL
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


def private_beneficiary(nif: str, nombre: str) -> bool:
    if not nif or nif[0] in PUBLIC_NIF:
        return False
    upper = nombre.upper()
    if "UNIVERSIDAD" in upper or "UNIVERSITAT" in upper:
        return False
    return True


def is_flat(rows: list[dict]) -> bool:
    amounts = [row["importe"] for row in rows]
    return max(amounts) <= min(amounts) * 1.02


def median_amount(values) -> float:
    ordered = sorted(values)
    return ordered[len(ordered) // 2]


def load_body_p75(connection: sqlite3.Connection) -> dict[str, float]:
    """75th percentile of cash grants to private beneficiaries, per body.

    Bodies with fewer than 15 such grants are omitted: their usual level is too thin to compare.
    """
    log("Percentil 75 de cada organismo (solo beneficiarios privados)")
    cursor = connection.execute(
        """
        SELECT organismo_norm, importe
        FROM concesiones
        WHERE instrumento_slug = 'subvencion' AND importe > 0 AND nif != ''
          AND substr(nif, 1, 1) NOT IN ('P', 'Q', 'S', 'R', 'G')
          AND upper(beneficiario_nombre) NOT LIKE '%UNIVERSIDAD%'
          AND upper(beneficiario_nombre) NOT LIKE '%UNIVERSITAT%'
          AND organismo_norm != ''
        ORDER BY organismo_norm, importe
        """
    )
    percentiles: dict[str, float] = {}
    current: str | None = None
    values: list[float] = []

    def flush() -> None:
        if current is None or len(values) < 15:
            return
        percentiles[current] = values[int(len(values) * 0.75)]

    for organismo_norm, importe in cursor:
        if organismo_norm != current:
            flush()
            current = organismo_norm
            values = []
        values.append(float(importe))
    flush()
    log(f"Organismos con distribución usable: {len(percentiles)}")
    return percentiles


def build_fraccionamiento(connection: sqlite3.Connection) -> int:
    body_p75 = load_body_p75(connection)
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
              n_convocatorias, importe_suma, puntuacion, mediana_organismo
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
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

    def eligible(rows: list[dict]) -> tuple[int, float] | None:
        if not rows or not private_beneficiary(rows[0]["nif"], rows[0]["nombre"]):
            return None
        if len(set(row["day"] for row in rows)) < 2 or is_flat(rows):
            return None
        calls = {row["id_convocatoria"] for row in rows if row["id_convocatoria"]}
        if len(calls) != 1:
            return None
        usual = body_p75.get(rows[0]["organismo_norm"])
        if usual is None:
            return None
        cluster_median = median_amount(row["importe"] for row in rows)
        if cluster_median < usual:
            return None
        return len(calls), usual

    def emit(regla: str, threshold: float, code: str, reason: str, rows: list[dict]) -> None:
        nonlocal next_id
        gate = eligible(rows)
        if gate is None:
            return
        calls, usual = gate
        dates = [row["day"] for row in rows]
        amount = sum(row["importe"] for row in rows)
        cluster_median = median_amount(row["importe"] for row in rows)
        span = (max(dates) - min(dates)).days
        proximity = sum(min(row["importe"] / threshold, 1.0) for row in rows) / len(rows)
        proximity_points = max(0.0, (proximity - BAND_LOW) / (1 - BAND_LOW)) * 40
        piece_points = min(len(rows), 4) * 8
        elevation = min(max(cluster_median / usual - 1, 0), 2) * 15
        tightness = 15 if span <= 30 else 8 if span <= 60 else 0
        puntuacion = round(proximity_points + piece_points + elevation + tightness, 1)
        def euros(value: float) -> str:
            return f"{value:,.0f}".replace(",", ".")

        motivo = (
            f"{reason} Son {len(rows)} subvenciones de la misma convocatoria, en {span} días. "
            f"La mediana de este grupo ({euros(cluster_median)} €) supera el percentil 75 de lo que "
            f"este organismo concede a entidades privadas ({euros(usual)} €). "
            f"Puntuación {puntuacion:.0f} de 100: cercanía al de minimis, número de piezas y rareza para ese organismo."
        )
        alert_id = next_id
        next_id += 1
        first = rows[0]
        alerts.append(
            (
                alert_id,
                regla,
                threshold,
                code,
                motivo,
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
                puntuacion,
                usual,
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
            if SUM_MIN_PIECE <= row["importe"] < de_minimis
        ]
        for cluster in clusters(pieces, SUM_WINDOW_DAYS, SUM_MIN_COUNT):
            rows = [item[1] for item in cluster]
            total = sum(row["importe"] for row in rows)
            if SUM_FLOOR <= total < de_minimis:
                emit(
                    "suma",
                    de_minimis,
                    "de_minimis",
                    "Varias subvenciones de al menos 50.000 €, de la misma convocatoria, suman entre 190.000 € y 200.000 € en menos de 180 días.",
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
    connection.execute(
        """
        DELETE FROM alert_fraccion_item
        WHERE alert_id IN (
          SELECT id FROM alert_fraccion
          WHERE regla = 'suma' AND importe_suma < ?
        )
        """,
        (SUM_FLOOR,),
    )
    connection.execute(
        "DELETE FROM alert_fraccion WHERE regla = 'suma' AND importe_suma < ?",
        (SUM_FLOOR,),
    )
    connection.execute(
        """
        DELETE FROM alert_fraccion_item
        WHERE alert_id IN (
          SELECT a.id FROM alert_fraccion a
          WHERE (
            SELECT COUNT(DISTINCT b.nif) FROM alert_fraccion b
            WHERE b.organismo_norm = a.organismo_norm
              AND b.umbral_codigo = a.umbral_codigo
              AND substr(b.fecha_inicio, 1, 7) = substr(a.fecha_inicio, 1, 7)
          ) > 3
        )
        """
    )
    connection.execute(
        """
        DELETE FROM alert_fraccion
        WHERE id IN (
          SELECT a.id FROM alert_fraccion a
          WHERE (
            SELECT COUNT(DISTINCT b.nif) FROM alert_fraccion b
            WHERE b.organismo_norm = a.organismo_norm
              AND b.umbral_codigo = a.umbral_codigo
              AND substr(b.fecha_inicio, 1, 7) = substr(a.fecha_inicio, 1, 7)
          ) > 3
        )
        """
    )
    connection.executescript(
        """
        CREATE INDEX idx_fraccion_filter ON alert_fraccion(ccaa, anio, puntuacion DESC);
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


ELECTIONS: tuple[tuple[str, str, str], ...] = (
    ("2018-12-02", "Andalucía", "elecciones autonómicas de Andalucía"),
    ("2019-04-28", "", "elecciones generales del 28 de abril de 2019"),
    ("2019-05-26", "", "elecciones municipales y autonómicas del 26 de mayo de 2019"),
    ("2019-11-10", "", "elecciones generales del 10 de noviembre de 2019"),
    ("2020-07-12", "País Vasco", "elecciones autonómicas del País Vasco"),
    ("2020-07-12", "Galicia", "elecciones autonómicas de Galicia"),
    ("2021-02-14", "Cataluña", "elecciones autonómicas de Cataluña"),
    ("2021-05-04", "Comunidad de Madrid", "elecciones autonómicas de Madrid"),
    ("2022-02-13", "Castilla y León", "elecciones autonómicas de Castilla y León"),
)

GOVERNMENTS: tuple[tuple[str, str], ...] = (
    ("2018-06-02", "toma de posesión de Pedro Sánchez tras la moción de censura del 1 de junio de 2018"),
    ("2020-01-08", "formación del gobierno de coalición, 8 de enero de 2020"),
)


def window_total(days: list[tuple[datetime, int, float]], start: datetime, end: datetime) -> tuple[int, float]:
    count = 0
    amount = 0.0
    for day, n, importe in days:
        if day < start:
            continue
        if day >= end:
            break
        count += n
        amount += importe
    return count, amount


def build_calendario(connection: sqlite3.Connection) -> None:
    log("Calendario: agregando concesiones por organismo y día")
    connection.executescript(
        """
        DROP TABLE IF EXISTS alert_calendario;
        CREATE TABLE alert_calendario (
          id INTEGER PRIMARY KEY,
          tipo TEXT NOT NULL,
          organismo TEXT NOT NULL,
          organismo_norm TEXT NOT NULL,
          ccaa TEXT NOT NULL,
          anio INTEGER NOT NULL,
          etiqueta TEXT NOT NULL,
          motivo TEXT NOT NULL,
          fecha_inicio TEXT NOT NULL,
          fecha_fin TEXT NOT NULL,
          n INTEGER NOT NULL,
          importe REAL NOT NULL,
          referencia REAL NOT NULL
        );
        """
    )
    rows = connection.execute(
        """
        SELECT organismo_norm, MAX(organismo), COALESCE(MAX(ccaa), 'No determinada'), fecha,
               COUNT(*), SUM(importe)
        FROM concesiones
        WHERE instrumento_slug = 'subvencion' AND importe > 0 AND fecha IS NOT NULL
          AND organismo_norm != ''
        GROUP BY organismo_norm, fecha
        ORDER BY organismo_norm, fecha
        """
    )
    bodies: dict[str, dict] = {}
    for organismo_norm, organismo, ccaa, fecha, n, importe in rows:
        body = bodies.get(organismo_norm)
        if body is None:
            body = {"organismo": organismo, "ccaa": ccaa, "days": []}
            bodies[organismo_norm] = body
        body["days"].append((parse_day(fecha), int(n), float(importe)))
    log(f"Organismos con calendario: {len(bodies)}")

    alerts: list[tuple] = []

    def add(tipo: str, body_key: str, anio: int, etiqueta: str, motivo: str, start: datetime, end: datetime, n: int, importe: float, referencia: float) -> None:
        body = bodies[body_key]
        alerts.append(
            (
                tipo,
                body["organismo"],
                body_key,
                body["ccaa"],
                anio,
                etiqueta,
                motivo,
                start.strftime("%Y-%m-%d"),
                (end - timedelta(days=1)).strftime("%Y-%m-%d"),
                n,
                importe,
                referencia,
            )
        )

    for key, body in bodies.items():
        by_month: dict[tuple[int, int], list[float]] = {}
        for day, n, importe in body["days"]:
            bucket = by_month.setdefault((day.year, day.month), [0, 0.0])
            bucket[0] += n
            bucket[1] += importe
        years = {year for year, _month in by_month}
        for year in years:
            december = by_month.get((year, 12))
            if december is None or december[0] < 8:
                continue
            others = [by_month[(year, month)][0] for month in range(1, 12) if (year, month) in by_month]
            if not others:
                continue
            baseline = sum(others) / len(others)
            if baseline <= 0 or december[0] < 2 * baseline:
                continue
            add(
                "diciembre",
                key,
                year,
                f"Diciembre de {year}",
                f"En diciembre de {year} este organismo concedió {december[0]} subvenciones, más del doble de la media del resto de meses de ese año ({baseline:.1f}). Puede ser el cierre presupuestario habitual.",
                datetime(year, 12, 1),
                datetime(year + 1, 1, 1),
                int(december[0]),
                december[1],
                baseline,
            )

        for iso, ccaa, label in ELECTIONS:
            if ccaa and body["ccaa"] != ccaa:
                continue
            election = parse_day(iso)
            before_start = election - timedelta(days=45)
            before_end = election
            control_start = election - timedelta(days=90)
            control_end = before_start
            window_n, window_amount = window_total(body["days"], before_start, before_end)
            control_n, _control_amount = window_total(body["days"], control_start, control_end)
            if window_n < 8:
                continue
            if control_n > 0 and window_n < 2 * control_n:
                continue
            if control_n == 0 and window_n < 12:
                continue
            add(
                "elecciones",
                key,
                election.year,
                label,
                f"En los 45 días anteriores a las {label} concedió {window_n} subvenciones, frente a {control_n} en los 45 días previos. Es un indicador de calendario, no de uso electoral del presupuesto.",
                before_start,
                before_end,
                window_n,
                window_amount,
                float(control_n),
            )

        for iso, label in GOVERNMENTS:
            change = parse_day(iso)
            after_n, after_amount = window_total(body["days"], change, change + timedelta(days=45))
            before_n, _before_amount = window_total(body["days"], change - timedelta(days=45), change)
            if after_n < 8:
                continue
            if before_n > 0 and after_n < 2 * before_n:
                continue
            if before_n == 0 and after_n < 12:
                continue
            add(
                "gobierno",
                key,
                change.year,
                label,
                f"En los 45 días posteriores a la {label} concedió {after_n} subvenciones, frente a {before_n} en los 45 días anteriores. Un cambio de ritmo puede obedecer al calendario administrativo.",
                change,
                change + timedelta(days=45),
                after_n,
                after_amount,
                float(before_n),
            )

    log("Relevo del conjunto de beneficiarios")
    year_sets: dict[tuple[str, int], set[int]] = {}
    meta: dict[str, tuple[str, str]] = {}
    for organismo_norm, anio, beneficiario_id, organismo, ccaa in connection.execute(
        """
        SELECT organismo_norm, anio, beneficiario_id, MAX(organismo), COALESCE(MAX(ccaa), 'No determinada')
        FROM concesiones
        WHERE instrumento_slug = 'subvencion' AND importe > 0 AND anio IS NOT NULL
          AND beneficiario_id IS NOT NULL AND organismo_norm != ''
        GROUP BY organismo_norm, anio, beneficiario_id
        """
    ):
        year_sets.setdefault((organismo_norm, int(anio)), set()).add(int(beneficiario_id))
        meta[organismo_norm] = (organismo, ccaa)
    by_org: dict[str, list[int]] = {}
    for organismo_norm, anio in year_sets:
        if len(year_sets[(organismo_norm, anio)]) < 15:
            continue
        by_org.setdefault(organismo_norm, []).append(anio)
    for organismo_norm, years in by_org.items():
        years.sort()
        for left, right in zip(years, years[1:]):
            if right != left + 1:
                continue
            previous = year_sets[(organismo_norm, left)]
            current = year_sets[(organismo_norm, right)]
            if len(previous) < 15 or len(current) < 15:
                continue
            union = len(previous | current)
            if union == 0:
                continue
            jaccard = len(previous & current) / union
            if jaccard >= 0.30:
                continue
            organismo, ccaa = meta[organismo_norm]
            alerts.append(
                (
                    "reemplazo",
                    organismo,
                    organismo_norm,
                    ccaa,
                    right,
                    f"Relevo entre {left} y {right}",
                    f"De {len(previous)} beneficiarios en {left} a {len(current)} en {right}, solo coinciden el {jaccard:.0%}. Un índice de Jaccard bajo indica que cambió quién cobraba, no que el cambio sea irregular.",
                    f"{right}-01-01",
                    f"{right}-12-31",
                    len(current),
                    0,
                    jaccard,
                )
            )

    connection.executemany(
        """
        INSERT INTO alert_calendario (
          tipo, organismo, organismo_norm, ccaa, anio, etiqueta, motivo,
          fecha_inicio, fecha_fin, n, importe, referencia
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
        """,
        alerts,
    )
    connection.executescript(
        """
        CREATE INDEX idx_cal_filter ON alert_calendario(tipo, anio, ccaa);
        CREATE INDEX idx_cal_org ON alert_calendario(organismo_norm);
        """
    )
    connection.commit()
    log(f"Calendario: {len(alerts)} indicadores")


BENFORD = tuple(__import__("math").log10(1 + 1 / digit) for digit in range(1, 10))


def build_estadistica(connection: sqlite3.Connection) -> None:
    import math

    log("Señales estadísticas por organismo")
    connection.executescript(
        """
        DROP TABLE IF EXISTS alert_outlier;
        DROP TABLE IF EXISTS alert_benford;
        DROP TABLE IF EXISTS alert_redondo;
        CREATE TABLE alert_benford (
          id INTEGER PRIMARY KEY,
          organismo TEXT NOT NULL,
          organismo_norm TEXT NOT NULL,
          ccaa TEXT NOT NULL,
          n INTEGER NOT NULL,
          mad REAL NOT NULL,
          alerta INTEGER NOT NULL
        );
        CREATE TABLE alert_redondo (
          id INTEGER PRIMARY KEY,
          organismo TEXT NOT NULL,
          organismo_norm TEXT NOT NULL,
          ccaa TEXT NOT NULL,
          n INTEGER NOT NULL,
          cuota REAL NOT NULL,
          cuota_global REAL NOT NULL,
          alerta INTEGER NOT NULL
        );
        CREATE TABLE alert_outlier (
          id INTEGER PRIMARY KEY,
          concesion_id INTEGER NOT NULL,
          organismo TEXT NOT NULL,
          organismo_norm TEXT NOT NULL,
          ccaa TEXT NOT NULL,
          beneficiario_id INTEGER,
          nombre TEXT NOT NULL,
          nif TEXT,
          tipo TEXT NOT NULL,
          importe REAL NOT NULL,
          mediana REAL NOT NULL,
          zeta REAL NOT NULL,
          n_grupo INTEGER NOT NULL
        );
        """
    )
    global_round = 0
    global_base = 0
    benford_rows: list[tuple] = []
    round_rows: list[tuple] = []
    current = None
    digits = [0] * 10
    n = 0
    n_round = 0
    n_base = 0
    low = None
    high = None
    organismo = ""
    ccaa = ""

    def flush_body() -> None:
        nonlocal global_round, global_base
        if current is None or n < 30:
            return
        global_round += n_round
        global_base += n_base
        if n >= 200 and low and high and high / low >= 100:
            observed = [digits[digit] / n for digit in range(1, 10)]
            mad = sum(abs(observed[index] - BENFORD[index]) for index in range(9)) / 9
            benford_rows.append((organismo, current, ccaa, n, mad, 1 if mad > 0.015 else 0))
        if n_base >= 80:
            round_rows.append((organismo, current, ccaa, n_base, n_round / n_base))

    cursor = connection.execute(
        """
        SELECT organismo_norm, importe, organismo, COALESCE(ccaa, 'No determinada')
        FROM concesiones
        WHERE instrumento_slug = 'subvencion' AND importe >= 1 AND organismo_norm != ''
          AND (nif = '' OR substr(nif, 1, 1) NOT IN ('P', 'Q', 'S', 'R', 'G'))
        ORDER BY organismo_norm
        """
    )
    for organismo_norm, importe, nombre, territorio in cursor:
        if organismo_norm != current:
            flush_body()
            current = organismo_norm
            digits = [0] * 10
            n = 0
            n_round = 0
            n_base = 0
            low = None
            high = None
            organismo = nombre
            ccaa = territorio
        amount = float(importe)
        n += 1
        if low is None or amount < low:
            low = amount
        if high is None or amount > high:
            high = amount
        digit = int(f"{amount:.12g}"[0])
        if 1 <= digit <= 9:
            digits[digit] += 1
        if amount >= 1000:
            n_base += 1
            nearest = round(amount / 1000) * 1000
            if abs(amount - nearest) < 0.05:
                n_round += 1
    flush_body()
    baseline = (global_round / global_base) if global_base else 0
    connection.executemany(
        "INSERT INTO alert_benford (organismo, organismo_norm, ccaa, n, mad, alerta) VALUES (?,?,?,?,?,?)",
        benford_rows,
    )
    connection.executemany(
        """
        INSERT INTO alert_redondo (organismo, organismo_norm, ccaa, n, cuota, cuota_global, alerta)
        VALUES (?,?,?,?,?,?,?)
        """,
        [
            (*row, baseline, 1 if row[3] >= 80 and row[4] >= baseline + 0.20 else 0)
            for row in round_rows
        ],
    )
    log(f"Benford {len(benford_rows)}; redondos {sum(1 for row in round_rows if row[4] >= baseline + 0.20)}; base redondeo {baseline:.1%}")

    log("Atípicos frente a beneficiarios parecidos")
    cursor = connection.execute(
        """
        SELECT organismo_norm, tipo_beneficiario, id, importe, organismo,
               COALESCE(ccaa, 'No determinada'), beneficiario_id, beneficiario_nombre, COALESCE(nif, '')
        FROM concesiones
        WHERE instrumento_slug = 'subvencion' AND importe > 0
          AND organismo_norm != '' AND tipo_beneficiario != ''
          AND (nif = '' OR substr(nif, 1, 1) NOT IN ('P', 'Q', 'S', 'R', 'G'))
        ORDER BY organismo_norm, tipo_beneficiario, id
        """
    )
    outliers: list[tuple] = []
    group_key = None
    group: list[tuple] = []

    def flush_group() -> None:
        if len(group) < 40:
            return
        logs = [math.log(item[3]) for item in group]
        mean = sum(logs) / len(logs)
        var = sum((value - mean) ** 2 for value in logs) / len(logs)
        if var <= 0.02:
            return
        std = math.sqrt(var)
        ordered = sorted(item[3] for item in group)
        median = ordered[len(ordered) // 2]
        for item in group:
            zeta = (math.log(item[3]) - mean) / std
            if zeta < 3.5:
                continue
            outliers.append(
                (
                    item[2],
                    item[4],
                    item[0],
                    item[5],
                    item[6],
                    item[7],
                    item[8],
                    item[1],
                    item[3],
                    median,
                    zeta,
                    len(group),
                )
            )

    for row in cursor:
        key = (row[0], row[1])
        if group_key is None:
            group_key = key
        if key != group_key:
            flush_group()
            group = []
            group_key = key
        group.append(row)
    flush_group()
    outliers.sort(key=lambda item: item[10], reverse=True)
    outliers = outliers[:4000]
    connection.executemany(
        """
        INSERT INTO alert_outlier (
          concesion_id, organismo, organismo_norm, ccaa, beneficiario_id, nombre, nif,
          tipo, importe, mediana, zeta, n_grupo
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
        """,
        outliers,
    )
    connection.executescript(
        """
        CREATE INDEX idx_benford ON alert_benford(alerta DESC, mad DESC);
        CREATE INDEX idx_redondo ON alert_redondo(alerta DESC, cuota DESC);
        CREATE INDEX idx_outlier ON alert_outlier(zeta DESC);
        CREATE INDEX idx_benford_f ON alert_benford(ccaa, organismo_norm);
        CREATE INDEX idx_redondo_f ON alert_redondo(ccaa, organismo_norm);
        CREATE INDEX idx_outlier_f ON alert_outlier(ccaa, organismo_norm);
        """
    )
    connection.commit()
    log(f"Atípicos guardados: {len(outliers)}")


def build_directa(connection: sqlite3.Connection) -> None:
    log("Proxy de concesión directa a partir del título")
    connection.executescript(
        """
        DROP TABLE IF EXISTS alert_directa;
        CREATE TABLE alert_directa (
          id INTEGER PRIMARY KEY,
          organismo TEXT NOT NULL,
          organismo_norm TEXT NOT NULL,
          ccaa TEXT NOT NULL,
          n INTEGER NOT NULL,
          n_directa INTEGER NOT NULL,
          n_nominativa INTEGER NOT NULL,
          cuota REAL NOT NULL
        );
        INSERT INTO alert_directa (
          organismo, organismo_norm, ccaa, n, n_directa, n_nominativa, cuota
        )
        SELECT MAX(organismo), organismo_norm, COALESCE(MAX(ccaa), 'No determinada'),
               COUNT(*),
               SUM(CASE
                 WHEN UPPER(titulo) LIKE '%CONCESION DIRECTA%'
                   OR UPPER(titulo) LIKE '%CONCESIÓN DIRECTA%'
                   OR UPPER(titulo) LIKE '%CONCESSIO DIRECTA%'
                   OR UPPER(titulo) LIKE '%CONCESSIÓ DIRECTA%'
                 THEN 1 ELSE 0 END),
               SUM(CASE WHEN UPPER(titulo) LIKE '%NOMINATIV%' THEN 1 ELSE 0 END),
               0
        FROM concesiones
        WHERE instrumento_slug = 'subvencion' AND organismo_norm != ''
        GROUP BY organismo_norm
        HAVING COUNT(*) >= 20;
        UPDATE alert_directa
        SET cuota = (n_directa + n_nominativa) * 1.0 / n
        WHERE n > 0;
        DELETE FROM alert_directa WHERE n_directa + n_nominativa = 0;
        CREATE INDEX idx_directa ON alert_directa(cuota DESC);
        CREATE INDEX idx_directa_f ON alert_directa(ccaa, organismo_norm);
        """
    )
    connection.commit()
    count = connection.execute("SELECT COUNT(*) FROM alert_directa").fetchone()[0]
    log(f"Concesión directa (proxy de título): {count} organismos")


def main() -> None:
    step = sys.argv[1] if len(sys.argv) > 1 else "fraccionamiento"
    if step == "--self-check":
        self_check()
        return
    steps = {
        "fraccionamiento": build_fraccionamiento,
        "concentracion": build_concentracion,
        "calendario": build_calendario,
        "estadistica": build_estadistica,
        "directa": build_directa,
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
