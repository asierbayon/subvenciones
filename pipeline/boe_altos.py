#!/usr/bin/env python3
"""Cache BOE section II.A appointments and dismissals of state high office.

The sumario of the open-data API already carries the decree title, so the
person, the post and the ministry can be read without downloading each
disposition. Raw sumarios are kept under ``data/boe/sumarios/`` and the parsed
rows under ``data/boe/altos.sqlite``. Neither is committed. A later run skips
days that are already on disk.

    python3 pipeline/boe_altos.py --self-check
    python3 pipeline/boe_altos.py --from 2018-01-01 --to 2023-12-31

Only ministries (and Presidencia) are kept. Universities, courts and
autonomous communities are not a ministry showering BDNS money. Sundays are
not requested. A holiday answers 404 and is remembered as an empty day.
One request at a time, 0.2 s apart. 429 lengthens the pause.

``puertas_giratorias.py`` reads the cache when it exists. It does not download
anything. A cese without an earlier nombramiento in the cache only matches a
company appointment after that cese.

Not read here, and not crossed: compatibility rulings of the Oficina de
Conflictos de Intereses, and the activity declarations filed at Congress and
the Senate.
"""

from __future__ import annotations

import argparse
import re
import sqlite3
import sys
import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BOE_DIR = ROOT / "data" / "boe"
SUMARIO_DIR = BOE_DIR / "sumarios"
DB_PATH = BOE_DIR / "altos.sqlite"
FIXTURE = Path(__file__).resolve().parent / "fixtures" / "boe-sumario-sample.xml"
SUMARIO = "https://www.boe.es/datosabiertos/api/boe/sumario/{ymd}"
USER_AGENT = "FaroBDNS/1.0 (reutilizacion BOE seccion II.A; +https://www.boe.es)"
DEFAULT_FROM = "2018-01-01"
DEFAULT_TO = "2023-12-31"
SECTION = "2A"

MONTHS = {
    "enero": 1,
    "febrero": 2,
    "marzo": 3,
    "abril": 4,
    "mayo": 5,
    "junio": 6,
    "julio": 7,
    "agosto": 8,
    "septiembre": 9,
    "octubre": 10,
    "noviembre": 11,
    "diciembre": 12,
}
DATE_RE = re.compile(
    r"\bde\s+(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|"
    r"septiembre|octubre|noviembre|diciembre)(?:\s+de\s+(\d{4}))?",
    re.IGNORECASE,
)
YEAR_RE = re.compile(r"/(\d{4})\b")
CESA_RE = re.compile(
    r"\b(?:don|doña)\s+(.+?)\s+como\s+(.+?)(?:\.|$)",
    re.IGNORECASE,
)
NOMBRA_RE = re.compile(
    r"\bnombra(?:n)?\s+(.+?)\s+a(?:l)?\s+.*?\b(?:don|doña)\s+(.+?)\.?\s*$",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class Evento:
    cve: str
    tipo: str
    fecha: str
    fecha_publicacion: str
    nombre: str
    cargo: str
    departamento: str
    titulo: str
    url: str


@dataclass(frozen=True)
class Mandato:
    nombre: str
    departamento: str
    cargo: str
    desde: str
    hasta: str
    url: str
    cve: str


def log(message: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {message}", flush=True)


def iso_from_compact(value: str) -> str:
    text = (value or "").strip()
    if re.fullmatch(r"\d{8}", text):
        return f"{text[0:4]}-{text[4:6]}-{text[6:8]}"
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", text):
        return text
    return ""


def decree_date(title: str, published: str) -> str:
    match = DATE_RE.search(title or "")
    if match is None:
        return published
    year_text = match.group(3) or ""
    if not year_text:
        numbered = YEAR_RE.search(title or "")
        if numbered is not None:
            year_text = numbered.group(1)
        elif published:
            year_text = published[:4]
    if not year_text:
        return published
    try:
        found = datetime(int(year_text), MONTHS[match.group(2).lower()], int(match.group(1)))
    except ValueError:
        return published
    return found.strftime("%Y-%m-%d")


def clean_piece(value: str) -> str:
    return " ".join((value or "").replace("\xa0", " ").split()).strip(" .;")


def departamento_util(nombre: str) -> bool:
    folded = (nombre or "").upper()
    if "MINISTERIO" in folded:
        return True
    if folded.startswith("PRESIDENCIA"):
        return True
    return False


def tipo_de(epigrafe: str, titulo: str) -> str:
    label = (epigrafe or "").lower()
    body = (titulo or "").lower()
    if "cese" in label and "nombr" not in label:
        return "cese"
    if "nombr" in label and "cese" not in label:
        return "nombramiento"
    if "se dispone el cese" in body or "se declara la jubilación" in body or "se declara la jubilacion" in body:
        return "cese"
    if "se nombra" in body or "nombramiento de" in body:
        return "nombramiento"
    return ""


def personas_de(titulo: str, tipo: str) -> list[tuple[str, str]]:
    found: list[tuple[str, str]] = []
    if tipo == "cese":
        for match in CESA_RE.finditer(titulo or ""):
            found.append((clean_piece(match.group(1)), clean_piece(match.group(2))))
        return [(nombre, cargo) for nombre, cargo in found if len(nombre.split()) >= 2]
    match = NOMBRA_RE.search(titulo or "")
    if match is None:
        for item in CESA_RE.finditer(titulo or ""):
            found.append((clean_piece(item.group(1)), clean_piece(item.group(2))))
        return [(nombre, cargo) for nombre, cargo in found if len(nombre.split()) >= 2]
    cargo = clean_piece(match.group(1))
    nombre = clean_piece(match.group(2))
    if len(nombre.split()) < 2 or len(cargo) < 3:
        return []
    return [(nombre, cargo[:180])]


def parse_sumario(payload: bytes) -> list[Evento]:
    try:
        root = ET.fromstring(payload)
    except ET.ParseError:
        return []
    published = ""
    meta = root.find("./data/sumario/metadatos")
    if meta is not None:
        published = iso_from_compact(meta.findtext("fecha_publicacion") or "")
    events: list[Evento] = []
    for seccion in root.iter("seccion"):
        if (seccion.attrib.get("codigo") or "") != SECTION:
            continue
        for departamento in seccion.findall("departamento"):
            organo = clean_piece(departamento.attrib.get("nombre") or "")
            if not departamento_util(organo):
                continue
            for epigrafe in departamento.findall("epigrafe"):
                etiqueta = epigrafe.attrib.get("nombre") or ""
                for item in epigrafe.findall("item"):
                    titulo = clean_piece(item.findtext("titulo") or "")
                    kind = tipo_de(etiqueta, titulo)
                    if not kind or not titulo:
                        continue
                    cve = clean_piece(item.findtext("identificador") or "")
                    url = clean_piece(item.findtext("url_html") or "")
                    fecha = decree_date(titulo, published)
                    if not fecha:
                        continue
                    for nombre, cargo in personas_de(titulo, kind):
                        events.append(
                            Evento(
                                cve=cve,
                                tipo=kind,
                                fecha=fecha,
                                fecha_publicacion=published,
                                nombre=nombre,
                                cargo=cargo,
                                departamento=organo,
                                titulo=titulo[:400],
                                url=url,
                            )
                        )
    return events


def mandatos_de(eventos: list[Evento]) -> list[Mandato]:
    """Pair each cese with the latest nombramiento of that name at that ministry.

    A cese with no nombramiento in the cache still counts: the term is the cese
    day only, so a company appointment has to fall after it.
    An open nombramiento with no cese is still in office and is not returned.
    """
    grouped: dict[tuple[str, str], list[Evento]] = {}
    for evento in eventos:
        key = (evento.nombre.casefold(), evento.departamento.casefold())
        grouped.setdefault(key, []).append(evento)
    found: list[Mandato] = []
    for bucket in grouped.values():
        ordered = sorted(bucket, key=lambda item: (item.fecha, 0 if item.tipo == "nombramiento" else 1, item.cve))
        abierto: Evento | None = None
        for evento in ordered:
            if evento.tipo == "nombramiento":
                if abierto is None:
                    abierto = evento
                continue
            desde = evento.fecha
            cargo = evento.cargo
            url = evento.url
            cve = evento.cve
            if abierto is not None and abierto.fecha <= evento.fecha:
                desde = abierto.fecha
                if not cargo:
                    cargo = abierto.cargo
            found.append(
                Mandato(
                    nombre=evento.nombre,
                    departamento=evento.departamento,
                    cargo=cargo,
                    desde=desde,
                    hasta=evento.fecha,
                    url=url or (abierto.url if abierto is not None else ""),
                    cve=cve,
                )
            )
            abierto = None
    found.sort(key=lambda item: (item.hasta, item.departamento, item.nombre))
    return found


def connect(path: Path) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(path)
    connection.execute("PRAGMA busy_timeout = 8000")
    connection.execute("PRAGMA journal_mode = WAL")
    connection.execute("PRAGMA synchronous = OFF")
    connection.execute("PRAGMA temp_store = FILE")
    connection.execute("PRAGMA cache_size = -8000")
    connection.executescript(
        """
        CREATE TABLE IF NOT EXISTS evento (
          cve TEXT NOT NULL,
          tipo TEXT NOT NULL,
          fecha TEXT NOT NULL,
          fecha_publicacion TEXT NOT NULL,
          nombre TEXT NOT NULL,
          cargo TEXT NOT NULL,
          departamento TEXT NOT NULL,
          titulo TEXT NOT NULL,
          url TEXT NOT NULL,
          PRIMARY KEY (cve, tipo, nombre)
        );
        CREATE TABLE IF NOT EXISTS boe_dia (
          fecha TEXT PRIMARY KEY,
          estado TEXT NOT NULL,
          n INTEGER NOT NULL
        );
        """
    )
    return connection


def write_events(connection: sqlite3.Connection, day: str, events: list[Evento], estado: str) -> None:
    connection.execute("DELETE FROM evento WHERE fecha_publicacion = ?", (day,))
    connection.executemany(
        """
        INSERT OR REPLACE INTO evento (
          cve, tipo, fecha, fecha_publicacion, nombre, cargo, departamento, titulo, url
        ) VALUES (?,?,?,?,?,?,?,?,?)
        """,
        [
            (
                evento.cve,
                evento.tipo,
                evento.fecha,
                evento.fecha_publicacion or day,
                evento.nombre,
                evento.cargo,
                evento.departamento,
                evento.titulo,
                evento.url,
            )
            for evento in events
        ],
    )
    connection.execute(
        "INSERT OR REPLACE INTO boe_dia (fecha, estado, n) VALUES (?,?,?)",
        (day, estado, len(events)),
    )


def load_eventos(path: Path) -> list[Evento]:
    connection = sqlite3.connect(f"{path.resolve().as_uri()}?mode=ro", uri=True)
    try:
        rows = connection.execute(
            """
            SELECT cve, tipo, fecha, fecha_publicacion, nombre, cargo, departamento, titulo, url
            FROM evento
            """
        )
        return [
            Evento(
                cve=str(row[0] or ""),
                tipo=str(row[1] or ""),
                fecha=str(row[2] or ""),
                fecha_publicacion=str(row[3] or ""),
                nombre=str(row[4] or ""),
                cargo=str(row[5] or ""),
                departamento=str(row[6] or ""),
                titulo=str(row[7] or ""),
                url=str(row[8] or ""),
            )
            for row in rows
        ]
    finally:
        connection.close()


def iter_days(start: str, end: str) -> list[str]:
    cursor = datetime.strptime(start, "%Y-%m-%d")
    last = datetime.strptime(end, "%Y-%m-%d")
    days: list[str] = []
    while cursor <= last:
        if cursor.weekday() != 6:
            days.append(cursor.strftime("%Y-%m-%d"))
        cursor += timedelta(days=1)
    return days


def fetch_sumario(ymd: str, pause: float) -> bytes | None:
    """Return the body, b'' when the day was not published, None on a hard error."""
    url = SUMARIO.format(ymd=ymd)
    delay = pause
    for _attempt in range(4):
        request = urllib.request.Request(
            url,
            headers={
                "User-Agent": USER_AGENT,
                "Accept": "application/xml, text/xml, */*",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=40) as response:
                return response.read()
        except urllib.error.HTTPError as exc:
            if exc.code == 404:
                return b""
            if exc.code == 429:
                delay = min(delay * 2, 20.0)
                log(f"{ymd} respondió 429; espera {delay:.1f} s")
                time.sleep(delay)
                continue
            log(f"{ymd} HTTP {exc.code}")
            return None
        except urllib.error.URLError as exc:
            log(f"{ymd} no se pudo leer ({exc.reason}); reintento")
            time.sleep(delay)
            delay = min(delay * 2, 20.0)
    return None


def rebuild_from_cache(connection: sqlite3.Connection, days: list[str]) -> int:
    total = 0
    for day in days:
        ymd = day.replace("-", "")
        cache = SUMARIO_DIR / f"{ymd}.xml"
        empty = SUMARIO_DIR / f"{ymd}.empty"
        if empty.exists() and not cache.exists():
            write_events(connection, day, [], "vacio")
            continue
        if not cache.exists():
            continue
        events = parse_sumario(cache.read_bytes())
        write_events(connection, day, events, "ok")
        total += len(events)
    connection.commit()
    return total


def fetch_range(start: str, end: str, pause: float) -> None:
    SUMARIO_DIR.mkdir(parents=True, exist_ok=True)
    days = iter_days(start, end)
    connection = connect(DB_PATH)
    try:
        downloaded = 0
        for index, day in enumerate(days, start=1):
            ymd = day.replace("-", "")
            cache = SUMARIO_DIR / f"{ymd}.xml"
            empty = SUMARIO_DIR / f"{ymd}.empty"
            if not cache.exists() and not empty.exists():
                payload = fetch_sumario(ymd, pause)
                time.sleep(pause)
                downloaded += 1
                if payload is None:
                    continue
                if payload == b"":
                    empty.write_text("404\n", encoding="utf-8")
                else:
                    cache.write_bytes(payload)
                if downloaded % 25 == 0:
                    log(f"Descargados {downloaded} sumarios (último {day})")
            if index % 200 == 0:
                log(f"Días revisados {index}/{len(days)}")
        total = rebuild_from_cache(connection, days)
        people = connection.execute("SELECT COUNT(DISTINCT nombre) FROM evento WHERE tipo = 'cese'").fetchone()[0]
        log(f"Eventos en caché dentro del rango: {total}. Ceses de personas distintas: {people}. Fichero {DB_PATH}")
    finally:
        connection.close()


def self_check() -> None:
    payload = FIXTURE.read_bytes()
    events = parse_sumario(payload)
    by_cve = {evento.cve: evento for evento in events}
    teodoro = by_cve["BOE-A-2020-3083"]
    assert teodoro.tipo == "cese"
    assert teodoro.fecha == "2020-03-03"
    assert teodoro.nombre == "Teodoro Baños Alonso"
    assert teodoro.cargo.startswith("Jefe del Mando")
    assert teodoro.departamento == "MINISTERIO DE DEFENSA"
    guillermo = by_cve["BOE-A-2020-3085"]
    assert guillermo.tipo == "nombramiento"
    assert guillermo.nombre == "Guillermo Manuel Fernández Sáez"
    assert guillermo.cargo.startswith("Jefe del Mando")
    cristina = by_cve["BOE-A-2020-3086"]
    assert cristina.tipo == "nombramiento"
    assert cristina.nombre == "Cristina Herrero Sánchez"
    assert "Presidenta" in cristina.cargo
    assert "BOE-A-2020-9999" not in by_cve
    assert "BOE-A-2020-0001" not in by_cve

    paired = mandatos_de(
        [
            Evento("N1", "nombramiento", "2018-06-08", "2018-06-09", "Ana Quiroga Belmonte", "Directora", "MINISTERIO DE HACIENDA", "", "https://example.test/n"),
            Evento("C1", "cese", "2020-01-13", "2020-01-14", "Ana Quiroga Belmonte", "Directora", "MINISTERIO DE HACIENDA", "", "https://example.test/c"),
            Evento("N2", "nombramiento", "2021-02-01", "2021-02-02", "Bruno Salmerón Delgado", "Subsecretario", "MINISTERIO DE CULTURA", "", ""),
        ]
    )
    assert len(paired) == 1
    assert paired[0].desde == "2018-06-08"
    assert paired[0].hasta == "2020-01-13"
    solo = mandatos_de(
        [Evento("C2", "cese", "2019-05-01", "2019-05-02", "Carla Hongos Yunque", "Secretaria", "MINISTERIO DE JUSTICIA", "", "")]
    )
    assert solo[0].desde == "2019-05-01" and solo[0].hasta == "2019-05-01"
    print("Autocomprobación de altos cargos del BOE correcta.")


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Descarga y guarda ceses y nombramientos de la sección II.A del BOE.")
    parser.add_argument("--self-check", action="store_true")
    parser.add_argument("--from", dest="start", default=DEFAULT_FROM)
    parser.add_argument("--to", dest="end", default=DEFAULT_TO)
    parser.add_argument("--pause", type=float, default=0.2, help="Segundos entre el inicio de cada petición.")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> None:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    if args.self_check:
        self_check()
        return
    if args.pause < 0:
        raise SystemExit("--pause no puede ser negativo.")
    fetch_range(args.start, args.end, args.pause)


if __name__ == "__main__":
    main()
