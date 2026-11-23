#!/usr/bin/env python3
"""Build the table of elected officials and mayors used by vínculos políticos.

Sources, in order:

1. Ministerio del Interior, ficheros de candidatos (``04``) y de municipios
   pequeños (``12``) de las elecciones municipales del 24 de mayo de 2015 y
   del 26 de mayo de 2019, más las elecciones a cabildos insulares de esas
   mismas fechas. Solo se guardan las personas electas. No se guardan el DNI
   ni la fecha de nacimiento, aunque el fichero los traiga.
2. Ministerio de Política Territorial, listados de alcaldes de los mandatos
   2015-2019 y 2019-2023, con posesión y baja.

El Interior no publica un fichero nacional de elecciones autonómicas: son
competencia de cada comunidad. Este script no inventa esa lista.

El área de descargas del Interior responde a menudo con un reto anti-bots.
Si el zip oficial falla, se usa la copia íntegra que Jaime Gómez-Obregón
publica en ``JaimeObregon/infoelectoral`` (los ``.DAT`` no están retocados).
La ficha de cada persona cita siempre la página oficial, no el espejo.

    python3 pipeline/politicos.py
    python3 pipeline/politicos.py --self-check

Es opcional: ``pnpm data`` no lo llama. Escribe ``data/politicos.sqlite``.
"""

from __future__ import annotations

import json
import re
import sqlite3
import sys
import time
import urllib.error
import urllib.request
import zipfile
from datetime import datetime, timedelta
from pathlib import Path
from xml.etree import ElementTree as ET

from nombres import fold_name, interpretations, persona_from_parts
from territorio import CCAA_BY_PROVINCE, PROVINCE_NAMES, MunicipioIndex

ROOT = Path(__file__).resolve().parents[1]
RAW_DIR = ROOT / "data" / "raw" / "politicos"
DB_PATH = ROOT / "data" / "politicos.sqlite"

INTERIOR_PAGE = "https://infoelectoral.interior.gob.es/es/elecciones-celebradas/area-de-descargas/"
INTERIOR_ZIP = "https://infoelectoral.interior.gob.es/estaticos/docxl/apliextr/{name}"
MIRROR = "https://raw.githubusercontent.com/JaimeObregon/infoelectoral/main/files"
ALCALDES_PAGE = (
    "https://mptmd.gob.es/portal/politica-territorial/local/sistema_de_informacion_local_-sil-/alcaldes_y_concejales"
)
ALCALDES_XLSX = (
    "https://mptmd.gob.es/content/dam/mpt/politica-territorial/local/"
    "sistema_de_informacion_local_-SIL-/alcaldes_y_concejales/{name}"
)
USER_AGENT = "faro-bdns-pipeline"
NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"

MUNICIPAL = (
    {
        "label": "24 de mayo de 2015",
        "desde": "2015-06-13",
        "hasta": "2019-06-14",
        "zip_name": "04201505_MUNI.zip",
        "mirror_dir": "municipales/04201505_MUNI",
        "f03": "03041505.DAT",
        "f04": "04041505.DAT",
        "f05": "05041505.DAT",
        "f12": "12041505.DAT",
    },
    {
        "label": "26 de mayo de 2019",
        "desde": "2019-06-15",
        "hasta": "2023-06-16",
        "zip_name": "04201905_MUNI.zip",
        "mirror_dir": "municipales/04201905_MUNI",
        "f03": "03041905.DAT",
        "f04": "04041905.DAT",
        "f05": "05041905.DAT",
        "f12": "12041905.DAT",
    },
)

CABILDOS = (
    {
        "label": "24 de mayo de 2015",
        "desde": "2015-06-13",
        "hasta": "2019-06-14",
        "zip_name": "06201505_TOTA.zip",
        "mirror_dir": "cabildos/06201505_TOTA",
        "f03": "03061505.DAT",
        "f04": "04061505.DAT",
        "f07": "07061505.DAT",
    },
    {
        "label": "26 de mayo de 2019",
        "desde": "2019-06-15",
        "hasta": "2023-06-16",
        "zip_name": "06201905_TOTA.zip",
        "mirror_dir": "cabildos/06201905_TOTA",
        "f03": "03061905.DAT",
        "f04": "04061905.DAT",
        "f07": "07061905.DAT",
    },
)

ALCALDES = (
    {"file": "Alcaldes_Mandato_2015_2019.xlsx", "label": "2015-2019", "hasta": "2019-06-14"},
    {"file": "Alcaldes_Mandato_2019_2023.xlsx", "label": "2019-2023", "hasta": "2023-06-16"},
)

LOWER_PARTICLES = {"de", "del", "la", "las", "los", "y", "i", "e", "da", "do", "das", "dos"}


def log(message: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {message}", flush=True)


def prettify_word(word: str, index: int) -> str:
    pieces = re.split(r"([/-])", word)
    rendered: list[str] = []
    word_index = 0
    for part in pieces:
        if part in {"/", "-"}:
            rendered.append(part)
            continue
        lower = part.lower()
        if index > 0 and word_index == 0 and lower in LOWER_PARTICLES:
            rendered.append(lower)
        elif lower:
            rendered.append(lower[:1].upper() + lower[1:])
        word_index += 1
    return "".join(rendered)


def sin_alias(nombre: str) -> str:
    """Drop a parenthetical nickname: ``Núñez (Chiqui)`` is the surname Núñez."""
    return re.sub(r"\([^)]*\)", " ", nombre or "")


def prettify(value: str) -> str:
    words = [prettify_word(word, index) for index, word in enumerate((value or "").split())]
    return " ".join(word for word in words if word)


def natural_place(name: str) -> str:
    cleaned = " ".join((name or "").split())
    if "," not in cleaned:
        return cleaned
    left, right = [part.strip() for part in cleaned.split(",", 1)]
    if right.lower() in {"el", "la", "los", "las"}:
        return f"{right} {left}"
    return cleaned


def download(url: str, destination: Path) -> None:
    log(f"Descargando {url}")
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=90) as response, destination.open("wb") as handle:
        while True:
            chunk = response.read(1024 * 256)
            if not chunk:
                break
            handle.write(chunk)


def ensure_file(destination: Path, urls: tuple[str, ...], minimum: int) -> None:
    if destination.exists() and destination.stat().st_size >= minimum:
        log(f"Reutilizo {destination.name} ({destination.stat().st_size // 1024} KB)")
        return
    errors: list[str] = []
    for url in urls:
        try:
            download(url, destination)
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            errors.append(f"{url} ({exc})")
            if destination.exists():
                destination.unlink()
            continue
        if destination.stat().st_size >= minimum:
            return
        errors.append(f"{url} (tamaño {destination.stat().st_size})")
        destination.unlink()
    detail = "; ".join(errors) if errors else "sin respuesta"
    raise SystemExit(f"No se pudo obtener {destination.name}: {detail}")


def extract_zip(zip_path: Path, names: tuple[str, ...], directory: Path) -> bool:
    try:
        with zipfile.ZipFile(zip_path) as archive:
            members = {Path(info.filename).name: info for info in archive.infolist()}
            for name in names:
                info = members.get(name)
                if info is None:
                    return False
                target = directory / name
                with archive.open(info) as source, target.open("wb") as handle:
                    handle.write(source.read())
        return True
    except zipfile.BadZipFile:
        return False


def ensure_pack(spec: dict, names: tuple[str, ...], minimums: dict[str, int]) -> None:
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    pending = [name for name in names if not (RAW_DIR / name).exists() or (RAW_DIR / name).stat().st_size < minimums[name]]
    if not pending:
        for name in names:
            log(f"Reutilizo {name}")
        return
    zip_path = RAW_DIR / spec["zip_name"]
    official = INTERIOR_ZIP.format(name=spec["zip_name"])
    try:
        if not zip_path.exists() or zip_path.stat().st_size < 10_000:
            download(official, zip_path)
        if extract_zip(zip_path, names, RAW_DIR):
            pending = [
                name for name in names if not (RAW_DIR / name).exists() or (RAW_DIR / name).stat().st_size < minimums[name]
            ]
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        log(f"El zip oficial no se pudo bajar ({exc}). Uso el espejo de los mismos DAT.")
    for name in pending:
        mirror = f"{MIRROR}/{spec['mirror_dir']}/{name}"
        ensure_file(RAW_DIR / name, (mirror,), minimums[name])


def encoding_of(path: Path) -> str:
    with path.open("rb") as handle:
        sample = handle.read(65_536)
    try:
        sample.decode("utf-8")
    except UnicodeDecodeError:
        return "latin-1"
    return "utf-8"


def iter_lines(path: Path):
    encoding = encoding_of(path)
    with path.open("r", encoding=encoding, newline="") as handle:
        for line in handle:
            yield line.rstrip("\r\n")


def parse_candidato_04(line: str) -> dict[str, str] | None:
    """Elected candidate in file 04. The DNI (positions 110-119) is not read."""
    if len(line) < 120 or line[119:120] != "S":
        return None
    return {
        "ine": line[9:11] + line[12:15],
        "candidatura": line[15:21].strip(),
        "nombre": line[25:50].strip(),
        "apellido1": line[50:75].strip(),
        "apellido2": line[75:100].strip(),
    }


def parse_candidato_12(line: str) -> dict[str, str] | None:
    """Elected candidate in open-list file 12. The DNI is not read."""
    if len(line) < 123 or line[122:123] != "S":
        return None
    return {
        "ine": line[9:11] + line[11:14],
        "candidatura": line[14:20].strip(),
        "nombre": line[25:50].strip(),
        "apellido1": line[50:75].strip(),
        "apellido2": line[75:100].strip(),
    }


def load_parties(path: Path) -> dict[str, str]:
    parties: dict[str, str] = {}
    for line in iter_lines(path):
        if len(line) < 64:
            continue
        code = line[8:14].strip()
        siglas = " ".join(line[14:64].split())
        denom = " ".join(line[64:214].split()) if len(line) >= 214 else ""
        label = siglas or denom[:80]
        if code and label:
            parties[code] = label
    return parties


def load_muni_names(path: Path) -> dict[str, str]:
    names: dict[str, str] = {}
    for line in iter_lines(path):
        if len(line) < 40 or line[16:18] != "99":
            continue
        ine = line[11:13] + line[13:16]
        name = " ".join(line[18:118].split())
        if name:
            names[ine] = name
    return names


def load_islands(path: Path) -> dict[str, str]:
    islands: dict[str, str] = {}
    for line in iter_lines(path):
        if len(line) < 20:
            continue
        prov = line[11:13]
        dist = line[13:14]
        if dist == "9" or prov in {"", "99"}:
            continue
        name = natural_place(" ".join(line[14:64].split()))
        if name:
            islands[prov + dist] = name
    return islands


def as_iso(value: str) -> str:
    text = (value or "").strip()
    if not text:
        return ""
    if re.fullmatch(r"\d{5}", text):
        day = datetime(1899, 12, 30) + timedelta(days=int(text))
        return day.strftime("%Y-%m-%d")
    for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%d-%m-%Y"):
        try:
            return datetime.strptime(text, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return ""


def ine5(value: str) -> str:
    digits = re.sub(r"\D", "", value or "")
    if len(digits) >= 6:
        return digits[:5]
    if len(digits) == 5:
        return digits
    if not digits:
        return ""
    return digits.zfill(5)


def shared_strings(archive: zipfile.ZipFile) -> list[str]:
    if "xl/sharedStrings.xml" not in archive.namelist():
        return []
    root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
    strings: list[str] = []
    for node in root.findall(f"{NS}si"):
        strings.append("".join(text.text or "" for text in node.iter(f"{NS}t")))
    return strings


def cell_text(cell: ET.Element, strings: list[str]) -> str:
    kind = cell.attrib.get("t")
    if kind == "inlineStr":
        return "".join(text.text or "" for text in cell.iter(f"{NS}t"))
    node = cell.find(f"{NS}v")
    if node is None or node.text is None:
        return ""
    if kind == "s":
        return strings[int(node.text)]
    return node.text


def read_alcaldes(path: Path) -> list[dict[str, str]]:
    with zipfile.ZipFile(path) as archive:
        strings = shared_strings(archive)
        sheet = ET.fromstring(archive.read("xl/worksheets/sheet1.xml"))
    header: dict[str, str] | None = None
    rows: list[dict[str, str]] = []
    for row in sheet.findall(f"{NS}sheetData/{NS}row"):
        values: dict[str, str] = {}
        for cell in row.findall(f"{NS}c"):
            ref = cell.attrib.get("r", "")
            column = "".join(char for char in ref if char.isalpha())
            values[column] = cell_text(cell, strings).strip()
        if header is None:
            folded = {fold_name(value): column for column, value in values.items() if value}
            if "NOMBRE" in folded and "MUNICIPIO" in folded:
                header = folded
            continue
        record = {name: values.get(column, "") for name, column in header.items()}
        if record.get("NOMBRE"):
            rows.append(record)
    return rows


def display_name(nombre: str, apellido1: str, apellido2: str) -> str:
    return prettify(" ".join(part for part in (nombre, apellido1, apellido2) if part and part.strip()))


def add_person(rows: list[tuple], seen: set[tuple], **fields: str) -> bool:
    persona = persona_from_parts(fields["nombre"], fields["apellido1"], fields["apellido2"])
    if persona is None:
        return False
    key = (fields["ambito"], fields["ine"], fields["rol"], fields["desde"], persona.clave, fields["hasta"])
    if key in seen:
        return False
    seen.add(key)
    rows.append(
        (
            display_name(fields["nombre"], fields["apellido1"], fields["apellido2"]),
            " ".join(persona.ap1),
            " ".join(persona.ap2),
            " ".join(persona.pila),
            fields["rol"],
            fields["ambito"],
            fields["cuerpo"],
            fields["municipio"],
            fields["ine"],
            fields["provincia"],
            fields["ccaa"],
            fields["desde"],
            fields["hasta"],
            fields["partido"][:80],
            fields["fuente"],
            fields["fuente_url"],
            fields.get("clave_organo", ""),
            fields.get("precision_fechas", "mandato"),
        )
    )
    return True


def ccaa_de(ine: str, municipios: MunicipioIndex) -> tuple[str, str, str]:
    known = municipios.by_ine.get(ine)
    if known is not None:
        return known.nombre, known.provincia, known.ccaa
    provincia = PROVINCE_NAMES.get(ine[:2], "")
    ccaa = CCAA_BY_PROVINCE.get(ine[:2], "No determinada")
    return "", provincia, ccaa


def ingest_municipal(spec: dict, municipios: MunicipioIndex, rows: list[tuple], seen: set[tuple], coverage: dict) -> None:
    ensure_pack(
        spec,
        (spec["f03"], spec["f04"], spec["f05"], spec["f12"]),
        {spec["f03"]: 100_000, spec["f04"]: 5_000_000, spec["f05"]: 100_000, spec["f12"]: 100_000},
    )
    parties = load_parties(RAW_DIR / spec["f03"])
    names = load_muni_names(RAW_DIR / spec["f05"])
    fuente = f"Ministerio del Interior. Candidaturas electas en las elecciones municipales del {spec['label']}."
    covered: set[str] = set()
    municipalities: set[str] = set()
    elected = 0
    small = 0
    for kind, parser, path in (
        ("04", parse_candidato_04, RAW_DIR / spec["f04"]),
        ("12", parse_candidato_12, RAW_DIR / spec["f12"]),
    ):
        for line in iter_lines(path):
            parsed = parser(line)
            if parsed is None:
                continue
            ine = parsed["ine"]
            if kind == "12" and ine in covered:
                continue
            oficial_nombre, provincia, ccaa = ccaa_de(ine, municipios)
            local = names.get(ine) or oficial_nombre or f"código {ine}"
            pretty = prettify(local)
            if add_person(
                rows,
                seen,
                nombre=parsed["nombre"],
                apellido1=parsed["apellido1"],
                apellido2=parsed["apellido2"],
                rol="concejal",
                ambito="municipal",
                cuerpo=f"Municipio de {pretty}",
                municipio=pretty,
                ine=ine,
                provincia=provincia,
                ccaa=ccaa,
                desde=spec["desde"],
                hasta=spec["hasta"],
                partido=parties.get(parsed["candidatura"], ""),
                fuente=fuente,
                fuente_url=INTERIOR_PAGE,
                precision_fechas="mandato",
            ):
                elected += 1
                municipalities.add(ine)
                if kind == "04":
                    covered.add(ine)
                else:
                    small += 1
    coverage[f"concejales_{spec['label']}"] = elected
    coverage[f"concejales_municipio_pequeno_{spec['label']}"] = small
    coverage[f"municipios_{spec['label']}"] = len(municipalities)
    log(f"Municipales {spec['label']}: {elected} electos, de ellos {small} en municipios de lista abierta")


def ingest_cabildos(spec: dict, rows: list[tuple], seen: set[tuple], coverage: dict) -> None:
    ensure_pack(
        spec,
        (spec["f03"], spec["f04"], spec["f07"]),
        {spec["f03"]: 1_000, spec["f04"]: 50_000, spec["f07"]: 200},
    )
    parties = load_parties(RAW_DIR / spec["f03"])
    islands = load_islands(RAW_DIR / spec["f07"])
    fuente = f"Ministerio del Interior. Candidaturas electas en las elecciones a cabildos insulares del {spec['label']}."
    elected = 0
    for line in iter_lines(RAW_DIR / spec["f04"]):
        parsed = parse_candidato_04(line)
        if parsed is None:
            continue
        key = line[9:11] + line[11:12]
        island = islands.get(key)
        if not island:
            continue
        pretty = prettify(island)
        if add_person(
            rows,
            seen,
            nombre=parsed["nombre"],
            apellido1=parsed["apellido1"],
            apellido2=parsed["apellido2"],
            rol="consejero_insular",
            ambito="insular",
            cuerpo=f"Cabildo Insular de {pretty}",
            municipio=pretty,
            ine="",
            provincia=PROVINCE_NAMES.get(line[9:11], ""),
            ccaa="Canarias",
            desde=spec["desde"],
            hasta=spec["hasta"],
            partido=parties.get(parsed["candidatura"], ""),
            fuente=fuente,
            fuente_url=INTERIOR_PAGE,
            precision_fechas="mandato",
        ):
            elected += 1
    coverage[f"cabildo_{spec['label']}"] = elected
    log(f"Cabildos {spec['label']}: {elected} electos en {len(islands)} islas")


def ingest_alcaldes(
    spec: dict,
    municipios: MunicipioIndex,
    rows: list[tuple],
    seen: set[tuple],
    councillors: dict[tuple[str, str], list[tuple]],
    coverage: dict,
) -> None:
    path = RAW_DIR / spec["file"]
    ensure_file(path, (ALCALDES_XLSX.format(name=spec["file"]),), 100_000)
    linked = 0
    loose = 0
    skipped = 0
    fuente = f"Ministerio de Política Territorial. Alcaldes del mandato {spec['label']}."
    for record in read_alcaldes(path):
        ine = ine5(record.get("CODIGO INE", ""))
        nombre = record.get("NOMBRE", "")
        if not ine or not nombre:
            skipped += 1
            continue
        desde = as_iso(record.get("FECHA POSESION", "")) or ""
        hasta = as_iso(record.get("FECHA BAJA", "")) or spec["hasta"]
        if not desde or (hasta and hasta < desde):
            skipped += 1
            continue
        chosen = None
        for option in interpretations(sin_alias(nombre)):
            hits = councillors.get((ine, option.firma), [])
            claves = {hit[0].clave for hit in hits}
            # The same person is stored once per term. Several rows with one
            # structured name are still that councillor, not an ambiguity.
            if len(claves) == 1:
                chosen = hits[0]
                break
        if chosen is None:
            parsed = interpretations(sin_alias(nombre))
            if not parsed:
                skipped += 1
                continue
            persona = parsed[0]
            display = prettify(nombre)
            loose += 1
        else:
            persona = chosen[0]
            display = chosen[1]
            linked += 1
        known = municipios.by_ine.get(ine)
        municipio = prettify(record.get("MUNICIPIO", "") or (known.nombre if known else ine))
        provincia = known.provincia if known else PROVINCE_NAMES.get(ine[:2], record.get("PROVINCIA", ""))
        ccaa = known.ccaa if known else CCAA_BY_PROVINCE.get(ine[:2], "No determinada")
        key = ("municipal", ine, "alcalde", desde, persona.clave, hasta)
        if key in seen:
            continue
        seen.add(key)
        rows.append(
            (
                display,
                " ".join(persona.ap1),
                " ".join(persona.ap2),
                " ".join(persona.pila),
                "alcalde",
                "municipal",
                f"Municipio de {municipio}",
                municipio,
                ine,
                provincia,
                ccaa,
                desde,
                hasta,
                (record.get("LISTA", "") or "")[:80],
                fuente,
                ALCALDES_PAGE,
                "",
                "posesion",
            )
        )
    coverage[f"alcaldes_{spec['label']}"] = linked + loose
    coverage[f"alcaldes_enlazados_{spec['label']}"] = linked
    coverage[f"alcaldes_sin_concejal_{spec['label']}"] = loose
    coverage[f"alcaldes_omitidos_{spec['label']}"] = skipped
    log(f"Alcaldes {spec['label']}: {linked} casan con un electo, {loose} solo están en el registro, {skipped} omitidos")


def councillor_index(rows: list[tuple]) -> dict[tuple[str, str], list[tuple]]:
    from nombres import Persona

    found: dict[tuple[str, str], list[tuple]] = {}
    for row in rows:
        if row[4] != "concejal":
            continue
        persona = Persona(
            tuple(part for part in row[1].split(" ") if part),
            tuple(part for part in row[2].split(" ") if part),
            tuple(part for part in row[3].split(" ") if part),
        )
        bucket = found.setdefault((row[8], persona.firma), [])
        bucket.append((persona, row[0]))
    return found


def write_db(rows: list[tuple], coverage: dict) -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    if DB_PATH.exists():
        DB_PATH.unlink()
    connection = sqlite3.connect(DB_PATH)
    try:
        connection.executescript(
            """
            CREATE TABLE politico (
              id INTEGER PRIMARY KEY,
              nombre TEXT NOT NULL,
              ap1 TEXT NOT NULL,
              ap2 TEXT NOT NULL,
              pila TEXT NOT NULL,
              rol TEXT NOT NULL,
              ambito TEXT NOT NULL,
              cuerpo TEXT NOT NULL,
              municipio TEXT NOT NULL,
              ine TEXT NOT NULL,
              provincia TEXT NOT NULL,
              ccaa TEXT NOT NULL,
              desde TEXT NOT NULL,
              hasta TEXT NOT NULL,
              partido TEXT NOT NULL,
              fuente TEXT NOT NULL,
              fuente_url TEXT NOT NULL,
              clave_organo TEXT NOT NULL,
              precision_fechas TEXT NOT NULL
            );
            CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
            """
        )
        connection.executemany(
            """
            INSERT INTO politico (
              nombre, ap1, ap2, pila, rol, ambito, cuerpo, municipio, ine, provincia, ccaa,
              desde, hasta, partido, fuente, fuente_url, clave_organo, precision_fechas
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """,
            rows,
        )
        connection.executescript(
            """
            CREATE INDEX idx_politico_ine ON politico(ine, ambito);
            CREATE INDEX idx_politico_rol ON politico(rol, ccaa);
            """
        )
        connection.execute(
            "INSERT INTO meta (key, value) VALUES (?, ?)",
            ("coverage", json.dumps(coverage, ensure_ascii=False)),
        )
        connection.execute(
            "INSERT INTO meta (key, value) VALUES (?, ?)",
            ("built_at", datetime.now().strftime("%Y-%m-%d %H:%M")),
        )
        connection.commit()
    finally:
        connection.close()


def sanity(connection: sqlite3.Connection) -> None:
    municipal_2019 = connection.execute(
        "SELECT COUNT(*) FROM politico WHERE rol = 'concejal' AND desde = '2019-06-15'"
    ).fetchone()[0]
    municipal_2015 = connection.execute(
        "SELECT COUNT(*) FROM politico WHERE rol = 'concejal' AND desde = '2015-06-13'"
    ).fetchone()[0]
    madrid = connection.execute(
        "SELECT COUNT(*) FROM politico WHERE rol = 'concejal' AND ine = '28079' AND desde = '2019-06-15'"
    ).fetchone()[0]
    alcaldes = connection.execute("SELECT COUNT(*) FROM politico WHERE rol = 'alcalde'").fetchone()[0]
    if not 60_000 <= municipal_2019 <= 75_000:
        raise SystemExit(f"Electos municipales de 2019 fuera de rango: {municipal_2019}")
    if not 60_000 <= municipal_2015 <= 75_000:
        raise SystemExit(f"Electos municipales de 2015 fuera de rango: {municipal_2015}")
    if madrid < 20:
        raise SystemExit(f"Madrid 2019 tiene {madrid} concejales electos; el fichero no cuadra.")
    if alcaldes < 7_000:
        raise SystemExit(f"Solo {alcaldes} alcaldes; el xlsx no se ha leído.")
    log(f"Control: municipales 2015={municipal_2015}, 2019={municipal_2019}, Madrid 2019={madrid}, alcaldes={alcaldes}")


def build() -> None:
    municipios = MunicipioIndex()
    rows: list[tuple] = []
    seen: set[tuple] = set()
    coverage: dict[str, int] = {}
    for spec in MUNICIPAL:
        ingest_municipal(spec, municipios, rows, seen, coverage)
    for spec in CABILDOS:
        ingest_cabildos(spec, rows, seen, coverage)
    councillors = councillor_index(rows)
    for spec in ALCALDES:
        ingest_alcaldes(spec, municipios, rows, seen, councillors, coverage)
    write_db(rows, coverage)
    connection = sqlite3.connect(DB_PATH)
    try:
        sanity(connection)
        total = connection.execute("SELECT COUNT(*) FROM politico").fetchone()[0]
    finally:
        connection.close()
    log(f"Tabla politico: {total} filas en {DB_PATH}")
    for key in sorted(coverage):
        log(f"  {key}: {coverage[key]}")


def self_check() -> None:
    assert as_iso("42168") == "2015-06-13"
    assert as_iso("15/06/2019") == "2019-06-15"
    assert ine5("040010") == "04001"
    assert prettify("ELCHE/ELX") == "Elche/Elx"
    assert prettify("MARTINEZ-ALMEIDA") == "Martinez-Almeida"
    assert sin_alias("Núñez (Chiqui)").split() == ["Núñez"]
    assert natural_place("Hierro, El") == "El Hierro"
    line = [" "] * 130
    def put(start: int, text: str) -> None:
        for offset, char in enumerate(text):
            line[start - 1 + offset] = char
    put(1, "04")
    put(3, "2019")
    put(7, "05")
    put(10, "28")
    put(13, "079")
    put(16, "000187")
    put(26, "ANA")
    put(51, "RUIZ")
    put(76, "SANTOS")
    put(110, "12345678Z")
    put(120, "S")
    parsed = parse_candidato_04("".join(line))
    assert parsed is not None
    assert parsed["nombre"] == "ANA"
    assert parsed["apellido1"] == "RUIZ"
    assert parsed["ine"] == "28079"
    assert "12345678Z" not in "".join(parsed.values())
    assert "dni" not in parsed
    line12 = [" "] * 140
    def put12(start: int, text: str) -> None:
        for offset, char in enumerate(text):
            line12[start - 1 + offset] = char
    put12(10, "04")
    put12(12, "001")
    put12(26, "RUBEN")
    put12(51, "MARTINEZ")
    put12(76, "CEREZO")
    put12(110, "99999999R")
    put12(123, "S")
    small = parse_candidato_12("".join(line12))
    assert small is not None
    assert small["ine"] == "04001"
    assert "99999999R" not in "".join(small.values())
    log("Autocomprobación de políticos correcta.")


def main() -> None:
    if "--self-check" in sys.argv:
        self_check()
        return
    started = time.time()
    build()
    log(f"Hecho en {time.time() - started:.0f} s")


if __name__ == "__main__":
    main()
