#!/usr/bin/env python3
"""Build a local SQLite index from the JaimeObregon/subvenciones CSV dump.

The upstream files are gzipped CSVs without headers (about 175 MB compressed).
Concessions to natural persons are not in the repository. This script streams
the files into SQLite with FTS5 and pre-aggregated dashboard tables so the web
app never ships the dump to the browser.

Stdlib only. Python 3.10+.
"""

from __future__ import annotations

import csv
import gzip
import re
import sqlite3
import sys
import time
import unicodedata
import urllib.request
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW_DIR = ROOT / "data" / "raw"
DB_PATH = ROOT / "data" / "bdns.sqlite"
VENDOR_MUNICIPIOS = Path(__file__).resolve().parent / "vendor" / "municipios.csv"
SOURCE_REPO = "https://github.com/JaimeObregon/subvenciones"
RAW_BASE = "https://raw.githubusercontent.com/JaimeObregon/subvenciones/main/files"

FILES = (
    "convocatorias.csv.gz",
    "juridicas_1.csv.gz",
    "juridicas_2.csv.gz",
)

AMBIGUOUS = "\0"
AGE = "Administración General del Estado"
UNMAPPED = "No determinada"
BATCH = 20000

TIPOS = {
    "A": "Sociedad anónima",
    "B": "Sociedad limitada",
    "C": "Sociedad colectiva",
    "D": "Sociedad comanditaria",
    "E": "Comunidad de bienes",
    "F": "Cooperativa",
    "G": "Asociación",
    "H": "Comunidad de propietarios",
    "J": "Sociedad civil",
    "N": "Entidad extranjera",
    "P": "Corporación local",
    "Q": "Organismo público",
    "R": "Entidad religiosa",
    "S": "Órgano de la Administración",
    "U": "Unión temporal de empresas",
    "V": "Otros tipos sin clasificar",
    "W": "Establecimiento permanente de no residente",
}

# Official-style names. Province aliases are accent-folded at runtime.
PROVINCES: tuple[tuple[str, str], ...] = (
    ("ALAVA", "País Vasco"),
    ("ARABA", "País Vasco"),
    ("ALBACETE", "Castilla-La Mancha"),
    ("ALICANTE", "Comunitat Valenciana"),
    ("ALACANT", "Comunitat Valenciana"),
    ("ALMERIA", "Andalucía"),
    ("AVILA", "Castilla y León"),
    ("BADAJOZ", "Extremadura"),
    ("BALEARS", "Illes Balears"),
    ("BALEARES", "Illes Balears"),
    ("ILLES BALEARS", "Illes Balears"),
    ("BARCELONA", "Cataluña"),
    ("BURGOS", "Castilla y León"),
    ("CACERES", "Extremadura"),
    ("CADIZ", "Andalucía"),
    ("CASTELLON", "Comunitat Valenciana"),
    ("CASTELLO", "Comunitat Valenciana"),
    ("CIUDAD REAL", "Castilla-La Mancha"),
    ("CORDOBA", "Andalucía"),
    ("CORUNA", "Galicia"),
    ("A CORUNA", "Galicia"),
    ("CUENCA", "Castilla-La Mancha"),
    ("GIRONA", "Cataluña"),
    ("GERONA", "Cataluña"),
    ("GRANADA", "Andalucía"),
    ("GUADALAJARA", "Castilla-La Mancha"),
    ("GIPUZKOA", "País Vasco"),
    ("GUIPUZCOA", "País Vasco"),
    ("HUELVA", "Andalucía"),
    ("HUESCA", "Aragón"),
    ("JAEN", "Andalucía"),
    ("LEON", "Castilla y León"),
    ("LLEIDA", "Cataluña"),
    ("LERIDA", "Cataluña"),
    ("LA RIOJA", "La Rioja"),
    ("LUGO", "Galicia"),
    ("MADRID", "Comunidad de Madrid"),
    ("MALAGA", "Andalucía"),
    ("MURCIA", "Región de Murcia"),
    ("NAVARRA", "Navarra"),
    ("NAFARROA", "Navarra"),
    ("OURENSE", "Galicia"),
    ("ORENSE", "Galicia"),
    ("ASTURIAS", "Asturias"),
    ("PALENCIA", "Castilla y León"),
    ("LAS PALMAS", "Canarias"),
    ("PONTEVEDRA", "Galicia"),
    ("SALAMANCA", "Castilla y León"),
    ("SANTA CRUZ DE TENERIFE", "Canarias"),
    ("CANTABRIA", "Cantabria"),
    ("SEGOVIA", "Castilla y León"),
    ("SEVILLA", "Andalucía"),
    ("SORIA", "Castilla y León"),
    ("TARRAGONA", "Cataluña"),
    ("TERUEL", "Aragón"),
    ("TOLEDO", "Castilla-La Mancha"),
    ("VALENCIA", "Comunitat Valenciana"),
    ("VALLADOLID", "Castilla y León"),
    ("BIZKAIA", "País Vasco"),
    ("VIZCAYA", "País Vasco"),
    ("ZAMORA", "Castilla y León"),
    ("ZARAGOZA", "Aragón"),
    ("CEUTA", "Ceuta"),
    ("MELILLA", "Melilla"),
)

ISLANDS = {
    "GRAN CANARIA": "Canarias",
    "TENERIFE": "Canarias",
    "LANZAROTE": "Canarias",
    "FUERTEVENTURA": "Canarias",
    "LA PALMA": "Canarias",
    "LA GOMERA": "Canarias",
    "EL HIERRO": "Canarias",
    "MALLORCA": "Illes Balears",
    "MENORCA": "Illes Balears",
    "EIVISSA": "Illes Balears",
    "IBIZA": "Illes Balears",
    "FORMENTERA": "Illes Balears",
}

CCAA_ALIASES = {
    "ANDALUCIA": "Andalucía",
    "JUNTA DE ANDALUCIA": "Andalucía",
    "ARAGON": "Aragón",
    "ASTURIAS": "Asturias",
    "PRINCIPADO DE ASTURIAS": "Asturias",
    "ILLES BALEARS": "Illes Balears",
    "ISLAS BALEARES": "Illes Balears",
    "BALEARES": "Illes Balears",
    "CANARIAS": "Canarias",
    "CANTABRIA": "Cantabria",
    "CASTILLA Y LEON": "Castilla y León",
    "CASTILLA LA MANCHA": "Castilla-La Mancha",
    "CATALUNA": "Cataluña",
    "CATALUNYA": "Cataluña",
    "COMUNITAT VALENCIANA": "Comunitat Valenciana",
    "COMUNIDAD VALENCIANA": "Comunitat Valenciana",
    "GENERALITAT VALENCIANA": "Comunitat Valenciana",
    "GENERALITAT DE CATALUNYA": "Cataluña",
    "XUNTA DE GALICIA": "Galicia",
    "EXTREMADURA": "Extremadura",
    "GALICIA": "Galicia",
    "COMUNIDAD DE MADRID": "Comunidad de Madrid",
    "REGION DE MURCIA": "Región de Murcia",
    "COMUNIDAD FORAL DE NAVARRA": "Navarra",
    "NAVARRA": "Navarra",
    "PAIS VASCO": "País Vasco",
    "EUSKADI": "País Vasco",
    "LA RIOJA": "La Rioja",
    "CEUTA": "Ceuta",
    "CIUDAD DE CEUTA": "Ceuta",
    "MELILLA": "Melilla",
    "CIUDAD DE MELILLA": "Melilla",
    "ESTADO": AGE,
    "ADMINISTRACION GENERAL DEL ESTADO": AGE,
    "ADMINISTRACION DEL ESTADO": AGE,
}

SECTOR_RULES: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("Vivienda", (r"\bVIVIENDA", r"\bALQUILER", r"\bREHABILITACION", r"\bHIPOTEC")),
    (
        "Educación",
        (
            r"\bEDUCACION",
            r"\bBECA\b",
            r"\bBECAS\b",
            r"\bESCOLAR",
            r"\bUNIVERSIDAD",
            r"\bALUMN",
            r"\bENSENANZA",
            r"\bERASMUS",
            r"\bESCUELA",
        ),
    ),
    (
        "Empleo y formación",
        (
            r"\bEMPLEO",
            r"\bDESEMPLEO",
            r"\bCONTRATACION",
            r"\bFORMACION\b",
            r"\bINSERCION LABORAL",
            r"\bAUTONOMO",
        ),
    ),
    (
        "Sanidad y servicios sociales",
        (
            r"\bSANIDAD",
            r"\bSANITARI",
            r"\bSALUD\b",
            r"\bDEPENDENCIA",
            r"\bDISCAPACIDAD",
            r"\bSERVICIOS SOCIALES",
            r"\bATENCION TEMPRANA",
            r"\bMAYORES\b",
        ),
    ),
    (
        "Cultura",
        (
            r"\bCULTURA",
            r"\bCULTURAL",
            r"\bPATRIMONIO",
            r"\bMUSEO",
            r"\bTEATRO",
            r"\bLIBRO\b",
            r"\bARTISTIC",
        ),
    ),
    ("Deporte", (r"\bDEPORTE", r"\bDEPORTIV")),
    (
        "Agricultura, ganadería y pesca",
        (
            r"\bAGRIC",
            r"\bGANADER",
            r"\bPESCA\b",
            r"\bPESQUER",
            r"\bREGADIO",
            r"\bAGROALIMENT",
        ),
    ),
    (
        "Industria, comercio y energía",
        (r"\bENERGIA", r"\bINDUSTRI", r"\bPYME", r"\bRENOVABLE", r"\bCOMERCIO\b"),
    ),
    (
        "Medio ambiente",
        (
            r"\bMEDIO AMBIENTE",
            r"\bAMBIENTAL",
            r"\bRESIDUO",
            r"\bBIODIVERSIDAD",
            r"\bFORESTAL",
            r"\bCLIMA",
        ),
    ),
    (
        "Transporte e infraestructuras",
        (
            r"\bTRANSPORTE",
            r"\bCARRETERA",
            r"\bINFRAESTRUCTURA",
            r"\bMOVILIDAD",
            r"\bFERROCARRIL",
        ),
    ),
    (
        "Investigación e innovación",
        (r"\bINVESTIGACION", r"\bINNOVACION", r"\bCIENTIFIC"),
    ),
    ("Turismo", (r"\bTURISMO", r"\bTURISTIC", r"\bHOSTEL")),
    ("Igualdad", (r"\bIGUALDAD", r"\bVIOLENCIA DE GENERO", r"\bMUJER")),
    (
        "Seguridad y emergencias",
        (r"\bEMERGENCIA", r"\bPROTECCION CIVIL", r"\bBOMBERO"),
    ),
)

TAIL_RE = re.compile(
    r"^(?:DIPUTACION(?: PROV| PROVINCIAL| FORAL)?"
    r"|CABILDO(?: INSULAR)?"
    r"|CONSELL(?: INSULAR)?"
    r"|CONSEJO(?: INSULAR)?)"
    r" DE (.+)$"
)
NIF_RE = re.compile(r"^([A-Za-z]\d{7}[0-9A-Za-z])(?:\s+(.+))?$")
COMPILED_SECTORS = tuple(
    (name, tuple(re.compile(pattern) for pattern in patterns))
    for name, patterns in SECTOR_RULES
)


def log(message: str) -> None:
    stamp = time.strftime("%H:%M:%S")
    print(f"[{stamp}] {message}", flush=True)


def fold(value: str) -> str:
    text = unicodedata.normalize("NFD", value or "")
    text = "".join(char for char in text if unicodedata.category(char) != "Mn")
    text = text.upper().replace("·", " ").replace("-", " ").replace("/", " ")
    text = text.replace(".", " ")
    text = re.sub(r"[^A-Z0-9 ]+", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def clip(value: str, limit: int = 2000) -> str:
    text = " ".join((value or "").split())
    if len(text) <= limit:
        return text
    return text[: limit - 1].rstrip() + "…"


def parse_date(value: str) -> str | None:
    text = (value or "").strip()
    try:
        parsed = datetime.strptime(text, "%d/%m/%Y")
    except ValueError:
        return None
    if parsed.year < 1990 or parsed.year > 2100:
        return None
    return parsed.strftime("%Y-%m-%d")


def parse_amount(value: str) -> float | None:
    text = (value or "").strip().replace("€", "").replace(" ", "")
    if text == "" or text == "-":
        return None
    if "," in text and "." in text:
        if text.rfind(",") > text.rfind("."):
            text = text.replace(".", "").replace(",", ".")
        else:
            text = text.replace(",", "")
    elif "," in text:
        text = text.replace(",", ".")
    try:
        return float(text)
    except ValueError:
        return None


def clean_instrumento(value: str) -> str:
    text = clip(value, 300)
    if text == "":
        return "Sin instrumento"
    if text.isupper():
        return text.capitalize()
    return text


def instrumento_slug(value: str) -> str:
    token = fold(value)
    if token.startswith("SUBVENCION"):
        return "subvencion"
    if token.startswith("GARANTIA"):
        return "garantia"
    if token.startswith("PRESTAMO"):
        return "prestamo"
    if "FISCAL" in token:
        return "ventaja"
    return "otros"


def classify_sector(folded_title: str) -> str:
    best_name = "Otros"
    best_score = 0
    for name, patterns in COMPILED_SECTORS:
        score = 0
        for pattern in patterns:
            if pattern.search(folded_title):
                score += 1
        if score > best_score:
            best_score = score
            best_name = name
    return best_name


def split_beneficiario(raw: str) -> tuple[str, str, str, str, str]:
    cleaned = clip(raw, 500)
    match = NIF_RE.fullmatch(cleaned) or NIF_RE.match(cleaned)
    if match is None:
        nombre = cleaned or "Beneficiario sin nombre"
        nombre_norm = fold(nombre)
        return "", nombre_norm, nombre, "Sin identificador fiscal", f"X:{nombre_norm}"
    nif = match.group(1).upper()
    display = (match.group(2) or nif).strip()
    nombre_norm = fold(display)
    tipo = TIPOS.get(nif[0], "Persona jurídica")
    return nif, nombre_norm, display, tipo, f"N:{nif}"


def muni_keys(nombre: str) -> list[str]:
    keys = [fold(nombre)]
    if "/" in nombre:
        for part in nombre.split("/"):
            keys.append(fold(part))
    if "," in nombre:
        left, right = nombre.split(",", 1)
        keys.append(fold(f"{right} {left}"))
        keys.append(fold(left))
    return [key for key in keys if key]


class Geo:
    def __init__(self, municipios_path: Path) -> None:
        self.direct: dict[str, str] = {}
        self.phrases: list[tuple[str, str]] = []
        self._load(municipios_path)

    def _put(self, table: dict[str, str], key: str, ccaa: str) -> None:
        if not key:
            return
        current = table.get(key)
        if current is None:
            table[key] = ccaa
            return
        if current != ccaa:
            table[key] = AMBIGUOUS

    def _load(self, municipios_path: Path) -> None:
        with municipios_path.open(encoding="utf-8", newline="") as handle:
            for row in csv.DictReader(handle):
                provincia_id = (row.get("provincia_id") or "").zfill(2)
                ccaa = CCAA_BY_PROVINCE.get(provincia_id)
                if ccaa is None:
                    continue
                for key in muni_keys(row.get("nombre") or ""):
                    self._put(self.direct, key, ccaa)

        for alias, ccaa in PROVINCES:
            self._put(self.direct, alias, ccaa)
            for prefix in (
                f"DIPUTACION PROV DE {alias}",
                f"DIPUTACION PROVINCIAL DE {alias}",
                f"DIPUTACION DE {alias}",
                f"DIPUTACION FORAL DE {alias}",
            ):
                self.direct[prefix] = ccaa

        for alias, ccaa in ISLANDS.items():
            self.direct[alias] = ccaa
            self.direct[f"CABILDO INSULAR DE {alias}"] = ccaa
            self.direct[f"CABILDO DE {alias}"] = ccaa
            self.direct[f"CONSELL INSULAR DE {alias}"] = ccaa
            self.direct[f"CONSELL DE {alias}"] = ccaa

        for alias, ccaa in CCAA_ALIASES.items():
            self.direct[alias] = ccaa

        phrases: dict[str, str] = {}
        for alias, ccaa in list(CCAA_ALIASES.items()) + list(PROVINCES) + list(ISLANDS.items()):
            if len(alias) < 5:
                continue
            phrases[alias] = ccaa
        self.phrases = sorted(phrases.items(), key=lambda item: len(item[0]), reverse=True)

    def _known(self, key: str) -> str | None:
        hit = self.direct.get(key)
        if hit and hit != AMBIGUOUS:
            return hit
        return None

    def _scan(self, text: str) -> str | None:
        padded = f" {text} "
        for phrase, ccaa in self.phrases:
            if f" {phrase} " in padded:
                return ccaa
        return None

    def _from_slash(self, raw: str) -> str | None:
        if "/" not in (raw or ""):
            return None
        found: set[str] = set()
        for part in raw.split("/"):
            hit = self._known(fold(part))
            if hit:
                found.add(hit)
        if len(found) == 1:
            return next(iter(found))
        return None

    def _suffix(self, text: str) -> str | None:
        parts = text.split()
        if len(parts) < 2:
            return None
        index = 1
        while index < len(parts):
            phrase = " ".join(parts[index:])
            if len(phrase) >= 5:
                hit = self._known(phrase)
                if hit:
                    return hit
            index += 1
        return None

    def locate(self, administracion: str, departamento: str) -> str:
        adm = fold(administracion)
        hit = self._known(adm)
        if hit:
            return hit
        slash = self._from_slash(administracion)
        if slash:
            return slash
        match = TAIL_RE.match(adm)
        if match:
            tail_hit = self._known(match.group(1).strip())
            if tail_hit:
                return tail_hit
        blob = fold(f"{administracion} {departamento}")
        scanned = self._scan(blob)
        if scanned:
            return scanned
        suffix = self._suffix(adm) or self._suffix(blob)
        if suffix:
            return suffix
        return UNMAPPED


CCAA_BY_PROVINCE = {
    "01": "País Vasco",
    "02": "Castilla-La Mancha",
    "03": "Comunitat Valenciana",
    "04": "Andalucía",
    "05": "Castilla y León",
    "06": "Extremadura",
    "07": "Illes Balears",
    "08": "Cataluña",
    "09": "Castilla y León",
    "10": "Extremadura",
    "11": "Andalucía",
    "12": "Comunitat Valenciana",
    "13": "Castilla-La Mancha",
    "14": "Andalucía",
    "15": "Galicia",
    "16": "Castilla-La Mancha",
    "17": "Cataluña",
    "18": "Andalucía",
    "19": "Castilla-La Mancha",
    "20": "País Vasco",
    "21": "Andalucía",
    "22": "Aragón",
    "23": "Andalucía",
    "24": "Castilla y León",
    "25": "Cataluña",
    "26": "La Rioja",
    "27": "Galicia",
    "28": "Comunidad de Madrid",
    "29": "Andalucía",
    "30": "Región de Murcia",
    "31": "Navarra",
    "32": "Galicia",
    "33": "Asturias",
    "34": "Castilla y León",
    "35": "Canarias",
    "36": "Galicia",
    "37": "Castilla y León",
    "38": "Canarias",
    "39": "Cantabria",
    "40": "Castilla y León",
    "41": "Andalucía",
    "42": "Castilla y León",
    "43": "Cataluña",
    "44": "Aragón",
    "45": "Castilla-La Mancha",
    "46": "Comunitat Valenciana",
    "47": "Castilla y León",
    "48": "País Vasco",
    "49": "Castilla y León",
    "50": "Aragón",
    "51": "Ceuta",
    "52": "Melilla",
}


def organismo_de(administracion: str, departamento: str, organo: str) -> str:
    if departamento:
        return departamento
    if organo:
        return organo
    return administracion or "Organismo no indicado"


def self_check(geo: Geo) -> None:
    assert parse_date("25/03/2022") == "2022-03-25"
    assert parse_date("31/02/2020") is None
    assert parse_amount("10000") == 10000
    assert parse_amount("1.234,50") == 1234.5
    assert parse_amount("1,5") == 1.5
    nif, norm, display, tipo, key = split_beneficiario("P4407400C AYUNTAMIENTO DE CEDRILLAS")
    assert nif == "P4407400C"
    assert display == "AYUNTAMIENTO DE CEDRILLAS"
    assert tipo == "Corporación local"
    assert key == "N:P4407400C"
    assert norm == "AYUNTAMIENTO DE CEDRILLAS"
    assert geo.locate("CANARIAS", "") == "Canarias"
    assert geo.locate("ESTADO", "MINISTERIO DE HACIENDA Y FUNCIÓN PÚBLICA") == AGE
    assert geo.locate("DIPUTACIÓN PROV. DE JAÉN", "") == "Andalucía"
    assert geo.locate("BILBAO", "AYUNTAMIENTO DE BILBAO") == "País Vasco"
    assert geo.locate("CABILDO INSULAR DE TENERIFE", "") == "Canarias"
    assert geo.locate("OTROS", "UNIVERSIDAD DE CASTILLA-LA MANCHA") == "Castilla-La Mancha"
    assert geo.locate("COMARCA COMUNIDAD DE TERUEL", "") == "Aragón"
    assert geo.locate("ALCOY/ALCOI", "AJUNTAMENT D'ALCOI") == "Comunitat Valenciana"
    assert geo.locate("ELCHE/ELX", "") == "Comunitat Valenciana"
    assert geo.locate("COMARCA DE COMUNIDAD DE CALATAYUD", "") == "Aragón"
    assert geo.locate("TORRENT", "AYUNTAMIENTO DE TORRENT") == UNMAPPED
    assert classify_sector(fold("AYUNTAMIENTO YECLA MANTENIMIENTO CENTRO ATENCIÓN TEMPRANA")) == (
        "Sanidad y servicios sociales"
    )
    assert instrumento_slug("SUBVENCIÓN Y ENTREGA DINERARIA SIN CONTRAPRESTACIÓN") == "subvencion"
    fts_self_check()
    log("Autocomprobación del pipeline correcta.")


def fts_self_check() -> None:
    """External-content FTS matches the old stored index and keeps no document copy."""
    connection = sqlite3.connect(":memory:")
    create_schema(connection)
    titulo = "Concesión directa nº12 en A Coruæa"
    organismo = "MINISTERIO DE HACIENDA Y FUNCIÓN PÚBLICA"
    catalog = Catalog()
    organismo_id = catalog.organismo_id(connection, "ESTADO", organismo, "", organismo, fold(organismo))
    ccaa_id = catalog.ccaa_id(connection, UNMAPPED)
    sector_id = catalog.sector_id(connection, "Otros")
    connection.execute(
        """
        INSERT INTO convocatoria (
          id, codigo_bdns, mrr, organismo_id, fecha, anio, titulo, titulo_cooficial,
          url_bases, ccaa_id, sector_id
        ) VALUES (1, '100', 0, ?, '2020-01-02', 2020, ?, '', '', ?, ?)
        """,
        (organismo_id, titulo, ccaa_id, sector_id),
    )
    connection.execute(
        "INSERT INTO conv_fts(rowid, titulo, organismo, codigo_bdns) VALUES (?,?,?,?)",
        (1, fold(titulo), fold(organismo), "100"),
    )
    nombre = "Baia Edicions A Coruæa SL"
    persona_id = catalog.persona_id(
        connection, "B00000019", nombre, fold(nombre), "Sociedad limitada", "N:B00000019"
    )
    tipo_id = catalog.tipo_id(connection, "Sociedad limitada")
    connection.execute(
        """
        INSERT INTO beneficiario (id, persona_id, tipo_id, n_concesiones, importe_total)
        VALUES (3, ?, ?, 1, 10)
        """,
        (persona_id, tipo_id),
    )
    connection.execute(
        "INSERT INTO ben_fts(rowid, nombre, nif) VALUES (3, ?, 'B00000019')",
        (fold(nombre),),
    )
    connection.execute(
        """
        CREATE VIRTUAL TABLE conv_fts_full USING fts5(
          titulo, organismo, codigo_bdns,
          tokenize = "unicode61 remove_diacritics 2"
        )
        """
    )
    connection.execute(
        "INSERT INTO conv_fts_full(rowid, titulo, organismo, codigo_bdns) VALUES (?,?,?,?)",
        (1, fold(titulo), fold(organismo), "100"),
    )
    for query in ('"hacienda"* AND "12"*', '"coru"*', "100"):
        external = connection.execute(
            "SELECT rowid FROM conv_fts WHERE conv_fts MATCH ?",
            (query,),
        ).fetchall()
        stored = connection.execute(
            "SELECT rowid FROM conv_fts_full WHERE conv_fts_full MATCH ?",
            (query,),
        ).fetchall()
        assert external == stored, (query, external, stored)
    found = connection.execute(
        """
        SELECT c.id, c.titulo FROM convocatorias c
        JOIN conv_fts ON conv_fts.rowid = c.id
        WHERE conv_fts MATCH ?
        """,
        ('"hacienda"* AND "12"*',),
    ).fetchone()
    assert found == (1, titulo)
    beneficiary = connection.execute(
        """
        SELECT b.id FROM beneficiarios b
        JOIN ben_fts ON ben_fts.rowid = b.id
        WHERE ben_fts MATCH ?
        """,
        ('"coru"* AND "b00000019"*',),
    ).fetchone()
    assert beneficiary == (3,)
    names = {row[0] for row in connection.execute("SELECT name FROM sqlite_master")}
    assert "conv_fts_content" not in names
    assert "ben_fts_content" not in names
    connection.close()


def download(url: str, destination: Path) -> None:
    log(f"Descargando {url}")
    request = urllib.request.Request(url, headers={"User-Agent": "faro-bdns-pipeline"})
    with urllib.request.urlopen(request, timeout=120) as response, destination.open("wb") as handle:
        while True:
            chunk = response.read(1024 * 256)
            if not chunk:
                break
            handle.write(chunk)


def ensure_sources() -> None:
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    for name in FILES:
        path = RAW_DIR / name
        if path.exists() and path.stat().st_size > 1_000_000:
            log(f"Reutilizo {path.name} ({path.stat().st_size // 1_000_000} MB)")
            continue
        download(f"{RAW_BASE}/{name}", path)


def open_csv(path: Path):
    handle = gzip.open(path, "rt", encoding="utf-8", errors="replace", newline="")
    return handle, csv.reader(handle)


class Catalog:
    """Intern repeated strings once. The fact tables store the integer id."""

    def __init__(self) -> None:
        self.organismo: dict[tuple[str, str, str], int] = {}
        self.ccaa: dict[str, int] = {}
        self.sector: dict[str, int] = {}
        self.tipo: dict[str, int] = {}
        self.instrumento: dict[str, int] = {}
        self.persona: dict[str, int] = {}
        self.persona_rank: dict[str, tuple[str, str, str]] = {}

    def organismo_id(
        self,
        connection: sqlite3.Connection,
        administracion: str,
        departamento: str,
        organo: str,
        organismo: str,
        organismo_norm: str,
    ) -> int:
        key = (administracion, departamento, organo)
        found = self.organismo.get(key)
        if found is not None:
            return found
        cursor = connection.execute(
            """
            INSERT INTO lut_organismo (
              administracion, departamento, organo, organismo, organismo_norm
            ) VALUES (?,?,?,?,?)
            """,
            (administracion, departamento, organo, organismo, organismo_norm),
        )
        found = int(cursor.lastrowid)
        self.organismo[key] = found
        return found

    def ccaa_id(self, connection: sqlite3.Connection, nombre: str) -> int:
        return self._label(connection, self.ccaa, "lut_ccaa", nombre)

    def sector_id(self, connection: sqlite3.Connection, nombre: str) -> int:
        return self._label(connection, self.sector, "lut_sector", nombre)

    def tipo_id(self, connection: sqlite3.Connection, nombre: str) -> int:
        return self._label(connection, self.tipo, "lut_tipo", nombre)

    def instrumento_id(self, connection: sqlite3.Connection, nombre: str, slug: str) -> int:
        found = self.instrumento.get(slug)
        if found is not None:
            return found
        cursor = connection.execute(
            "INSERT INTO lut_instrumento (nombre, slug) VALUES (?, ?)",
            (nombre, slug),
        )
        found = int(cursor.lastrowid)
        self.instrumento[slug] = found
        return found

    def persona_id(
        self,
        connection: sqlite3.Connection,
        nif: str,
        nombre: str,
        nombre_norm: str,
        tipo: str,
        ben_key: str,
    ) -> int:
        found = self.persona.get(ben_key)
        if found is None:
            cursor = connection.execute(
                """
                INSERT INTO lut_persona (ben_key, nif, nombre, nombre_norm, tipo)
                VALUES (?,?,?,?,?)
                """,
                (ben_key, nif, nombre, nombre_norm, tipo),
            )
            found = int(cursor.lastrowid)
            self.persona[ben_key] = found
            self.persona_rank[ben_key] = (nombre, nombre_norm, tipo)
            return found
        previous = self.persona_rank[ben_key]
        ranked = (min(previous[0], nombre), min(previous[1], nombre_norm), min(previous[2], tipo))
        if ranked == previous:
            return found
        connection.execute(
            "UPDATE lut_persona SET nombre = ?, nombre_norm = ?, tipo = ? WHERE id = ?",
            (ranked[0], ranked[1], ranked[2], found),
        )
        self.persona_rank[ben_key] = ranked
        return found

    def _label(
        self,
        connection: sqlite3.Connection,
        cache: dict[str, int],
        table: str,
        nombre: str,
    ) -> int:
        found = cache.get(nombre)
        if found is not None:
            return found
        cursor = connection.execute(f"INSERT INTO {table} (nombre) VALUES (?)", (nombre,))
        found = int(cursor.lastrowid)
        cache[nombre] = found
        return found


def create_schema(connection: sqlite3.Connection) -> None:
    connection.executescript(
        """
        DROP TABLE IF EXISTS conv_fts;
        DROP TABLE IF EXISTS ben_fts;
        DROP VIEW IF EXISTS convocatorias;
        DROP VIEW IF EXISTS concesiones;
        DROP VIEW IF EXISTS concesiones_brutas;
        DROP VIEW IF EXISTS beneficiarios;
        DROP TABLE IF EXISTS concesion_dup;
        DROP TABLE IF EXISTS meta;
        DROP TABLE IF EXISTS convocatoria;
        DROP TABLE IF EXISTS concesion;
        DROP TABLE IF EXISTS beneficiario;
        DROP TABLE IF EXISTS lut_organismo;
        DROP TABLE IF EXISTS lut_ccaa;
        DROP TABLE IF EXISTS lut_sector;
        DROP TABLE IF EXISTS lut_tipo;
        DROP TABLE IF EXISTS lut_instrumento;
        DROP TABLE IF EXISTS lut_persona;
        DROP TABLE IF EXISTS stats_anio;
        DROP TABLE IF EXISTS stats_ccaa;
        DROP TABLE IF EXISTS stats_organismo;
        DROP TABLE IF EXISTS stats_sector;
        DROP TABLE IF EXISTS stats_instrumento;
        DROP TABLE IF EXISTS stats_tipo;
        DROP TABLE IF EXISTS stats_top_beneficiario;
        DROP TABLE IF EXISTS facet_organismo;

        CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);

        CREATE TABLE lut_organismo (
          id INTEGER PRIMARY KEY,
          administracion TEXT NOT NULL,
          departamento TEXT NOT NULL,
          organo TEXT NOT NULL,
          organismo TEXT NOT NULL,
          organismo_norm TEXT NOT NULL,
          UNIQUE (administracion, departamento, organo)
        );
        CREATE INDEX idx_lut_org_norm ON lut_organismo(organismo_norm);

        CREATE TABLE lut_ccaa (
          id INTEGER PRIMARY KEY,
          nombre TEXT NOT NULL UNIQUE
        );
        CREATE TABLE lut_sector (
          id INTEGER PRIMARY KEY,
          nombre TEXT NOT NULL UNIQUE
        );
        CREATE TABLE lut_tipo (
          id INTEGER PRIMARY KEY,
          nombre TEXT NOT NULL UNIQUE
        );
        CREATE TABLE lut_instrumento (
          id INTEGER PRIMARY KEY,
          nombre TEXT NOT NULL,
          slug TEXT NOT NULL UNIQUE
        );
        CREATE TABLE lut_persona (
          id INTEGER PRIMARY KEY,
          ben_key TEXT NOT NULL UNIQUE,
          nif TEXT NOT NULL,
          nombre TEXT NOT NULL,
          nombre_norm TEXT NOT NULL,
          tipo TEXT NOT NULL
        );
        CREATE INDEX idx_lut_persona_nif ON lut_persona(nif);

        CREATE TABLE convocatoria (
          id INTEGER PRIMARY KEY,
          codigo_bdns TEXT,
          mrr INTEGER NOT NULL,
          organismo_id INTEGER NOT NULL,
          fecha TEXT,
          anio INTEGER,
          titulo TEXT,
          titulo_cooficial TEXT,
          url_bases TEXT,
          ccaa_id INTEGER NOT NULL,
          sector_id INTEGER NOT NULL,
          n_concesiones INTEGER NOT NULL DEFAULT 0,
          importe_total REAL NOT NULL DEFAULT 0,
          n_garantia INTEGER NOT NULL DEFAULT 0,
          importe_garantia REAL NOT NULL DEFAULT 0,
          importe_subvencion REAL NOT NULL DEFAULT 0
        );

        CREATE TABLE concesion (
          id INTEGER PRIMARY KEY,
          id_convocatoria INTEGER,
          organismo_id INTEGER NOT NULL,
          aplicacion TEXT,
          fecha TEXT,
          anio INTEGER,
          persona_id INTEGER NOT NULL,
          tipo_id INTEGER NOT NULL,
          importe REAL,
          instrumento_id INTEGER NOT NULL,
          ayuda_equivalente REAL,
          ccaa_id INTEGER NOT NULL,
          sector_id INTEGER NOT NULL,
          beneficiario_id INTEGER
        );

        CREATE TABLE beneficiario (
          id INTEGER PRIMARY KEY,
          persona_id INTEGER NOT NULL UNIQUE,
          tipo_id INTEGER NOT NULL,
          n_concesiones INTEGER,
          importe_total REAL,
          n_subvencion INTEGER NOT NULL DEFAULT 0,
          importe_subvencion REAL NOT NULL DEFAULT 0,
          n_garantia INTEGER NOT NULL DEFAULT 0,
          importe_garantia REAL NOT NULL DEFAULT 0
        );

        CREATE TABLE stats_anio (ambito TEXT, anio INTEGER, n INTEGER, importe REAL);
        CREATE TABLE stats_ccaa (ambito TEXT, ccaa TEXT, n INTEGER, importe REAL);
        CREATE TABLE stats_organismo (ambito TEXT, organismo TEXT, n INTEGER, importe REAL);
        CREATE TABLE stats_sector (ambito TEXT, sector TEXT, n INTEGER, importe REAL);
        CREATE TABLE stats_instrumento (instrumento TEXT, slug TEXT, n INTEGER, importe REAL);
        CREATE TABLE stats_tipo (ambito TEXT, tipo TEXT, n INTEGER, importe REAL);
        CREATE TABLE stats_top_beneficiario (
          ambito TEXT,
          beneficiario_id INTEGER,
          nombre TEXT,
          nif TEXT,
          tipo TEXT,
          n INTEGER,
          importe REAL
        );
        CREATE TABLE facet_organismo (
          nombre TEXT PRIMARY KEY,
          nombre_norm TEXT,
          n INTEGER,
          importe REAL
        );

        CREATE VIEW convocatorias AS
        SELECT
          c.id,
          c.codigo_bdns,
          c.mrr,
          o.administracion,
          o.departamento,
          o.organo,
          o.organismo,
          o.organismo_norm,
          c.fecha,
          c.anio,
          c.titulo,
          c.titulo_cooficial,
          c.url_bases,
          ca.nombre AS ccaa,
          s.nombre AS sector,
          c.n_concesiones,
          c.importe_total,
          c.n_garantia,
          c.importe_garantia,
          c.importe_subvencion
        FROM convocatoria c
        JOIN lut_organismo o ON o.id = c.organismo_id
        JOIN lut_ccaa ca ON ca.id = c.ccaa_id
        JOIN lut_sector s ON s.id = c.sector_id;

        CREATE TABLE concesion_dup (
          concesion_id INTEGER PRIMARY KEY,
          canon_id INTEGER NOT NULL
        );

        -- Every physical row, including copies. Sums use `concesiones`, which
        -- keeps one row per (persona, convocatoria, fecha, importe, instrumento).
        CREATE VIEW concesiones_brutas AS
        SELECT
          c.id,
          c.id_convocatoria,
          COALESCE(cv.codigo_bdns, '') AS codigo_bdns,
          o.administracion,
          o.departamento,
          o.organo,
          o.organismo,
          o.organismo_norm,
          COALESCE(cv.titulo, '') AS titulo,
          COALESCE(cv.url_bases, '') AS url_bases,
          c.aplicacion,
          c.fecha,
          c.anio,
          p.nif,
          p.nombre AS beneficiario_nombre,
          p.nombre_norm,
          t.nombre AS tipo_beneficiario,
          c.importe,
          i.nombre AS instrumento,
          i.slug AS instrumento_slug,
          c.ayuda_equivalente,
          ca.nombre AS ccaa,
          s.nombre AS sector,
          p.ben_key,
          c.beneficiario_id,
          CASE WHEN d.concesion_id IS NULL THEN 0 ELSE 1 END AS es_duplicado,
          COALESCE(d.canon_id, c.id) AS canon_id
        FROM concesion c
        JOIN lut_organismo o ON o.id = c.organismo_id
        JOIN lut_persona p ON p.id = c.persona_id
        JOIN lut_tipo t ON t.id = c.tipo_id
        JOIN lut_instrumento i ON i.id = c.instrumento_id
        JOIN lut_ccaa ca ON ca.id = c.ccaa_id
        JOIN lut_sector s ON s.id = c.sector_id
        LEFT JOIN convocatoria cv ON cv.id = c.id_convocatoria
        LEFT JOIN concesion_dup d ON d.concesion_id = c.id;

        CREATE VIEW concesiones AS
        SELECT * FROM concesiones_brutas WHERE es_duplicado = 0;

        CREATE VIEW beneficiarios AS
        SELECT
          b.id,
          p.ben_key,
          p.nif,
          p.nombre,
          p.nombre_norm,
          p.tipo,
          b.n_concesiones,
          b.importe_total,
          b.n_subvencion,
          b.importe_subvencion,
          b.n_garantia,
          b.importe_garantia
        FROM beneficiario b
        JOIN lut_persona p ON p.id = b.persona_id;

        -- External content: the inverted index stays, the document text does not.
        -- The loader writes the folded strings the search box already queries.
        -- 'rebuild' would retokenize the display columns (nº12, 100ª, CORUÆA) and
        -- change matches, so it is not used. content_rowid is convocatorias.id.
        CREATE VIRTUAL TABLE conv_fts USING fts5(
          titulo,
          organismo,
          codigo_bdns,
          content='convocatorias',
          content_rowid='id',
          tokenize = "unicode61 remove_diacritics 2"
        );

        -- Same external-content pattern as conv_fts. Rowid is beneficiarios.id.
        -- Indexed text is the folded name plus the NIF, not a stored duplicate.
        CREATE VIRTUAL TABLE ben_fts USING fts5(
          nombre,
          nif,
          content='beneficiarios',
          content_rowid='id',
          tokenize = "unicode61 remove_diacritics 2"
        );
        """
    )


def load_convocatorias(connection: sqlite3.Connection, geo: Geo, catalog: Catalog) -> int:
    sql = """
        INSERT INTO convocatoria (
          id, codigo_bdns, mrr, organismo_id, fecha, anio, titulo, titulo_cooficial,
          url_bases, ccaa_id, sector_id
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?)
    """
    fts_sql = "INSERT INTO conv_fts(rowid, titulo, organismo, codigo_bdns) VALUES (?,?,?,?)"
    path = RAW_DIR / "convocatorias.csv.gz"
    inserted = 0
    skipped = 0
    batch: list[tuple] = []
    fts_batch: list[tuple] = []
    handle, reader = open_csv(path)
    try:
        for row in reader:
            if len(row) < 9:
                skipped += 1
                continue
            try:
                row_id = int(row[0])
            except ValueError:
                skipped += 1
                continue
            administracion = clip(row[3], 300)
            departamento = clip(row[4], 300)
            organo = clip(row[5], 300)
            organismo = organismo_de(administracion, departamento, organo)
            organismo_norm = fold(organismo)
            fecha = parse_date(row[6])
            anio = int(fecha[:4]) if fecha else None
            titulo = clip(row[7])
            titulo_norm = fold(titulo)
            url = clip(row[8], 1000)
            cooficial = clip(row[9], 2000) if len(row) > 9 else ""
            mrr = 1 if fold(row[2]) == "SI" else 0
            ccaa = geo.locate(administracion, departamento)
            sector = classify_sector(titulo_norm)
            codigo = clip(row[1], 40)
            batch.append(
                (
                    row_id,
                    codigo,
                    mrr,
                    catalog.organismo_id(
                        connection, administracion, departamento, organo, organismo, organismo_norm
                    ),
                    fecha,
                    anio,
                    titulo,
                    cooficial,
                    url,
                    catalog.ccaa_id(connection, ccaa),
                    catalog.sector_id(connection, sector),
                )
            )
            fts_batch.append((row_id, titulo_norm, organismo_norm, codigo))
            if len(batch) >= BATCH:
                connection.executemany(sql, batch)
                connection.executemany(fts_sql, fts_batch)
                inserted += len(batch)
                batch.clear()
                fts_batch.clear()
                if inserted % 100000 == 0:
                    log(f"Convocatorias: {inserted}")
        if batch:
            connection.executemany(sql, batch)
            connection.executemany(fts_sql, fts_batch)
            inserted += len(batch)
    finally:
        handle.close()
    log(f"Convocatorias cargadas: {inserted} (filas omitidas: {skipped})")
    return inserted


def load_concesiones(connection: sqlite3.Connection, geo: Geo, catalog: Catalog) -> int:
    sql = """
        INSERT OR REPLACE INTO concesion (
          id, id_convocatoria, organismo_id, aplicacion, fecha, anio,
          persona_id, tipo_id, importe, instrumento_id, ayuda_equivalente,
          ccaa_id, sector_id
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
    """
    inserted = 0
    skipped = 0
    batch: list[tuple] = []
    for name in ("juridicas_1.csv.gz", "juridicas_2.csv.gz"):
        handle, reader = open_csv(RAW_DIR / name)
        log(f"Leyendo {name}")
        try:
            for row in reader:
                if len(row) < 13:
                    skipped += 1
                    continue
                try:
                    row_id = int(row[0])
                    id_convocatoria = int(row[1]) if row[1].strip() else None
                except ValueError:
                    skipped += 1
                    continue
                administracion = clip(row[2], 300)
                departamento = clip(row[3], 300)
                organo = clip(row[4], 300)
                organismo = organismo_de(administracion, departamento, organo)
                titulo = clip(row[5])
                fecha = parse_date(row[8])
                anio = int(fecha[:4]) if fecha else None
                nif, nombre_norm, display, tipo, ben_key = split_beneficiario(row[9])
                instrumento = clean_instrumento(row[11])
                slug = instrumento_slug(row[11])
                batch.append(
                    (
                        row_id,
                        id_convocatoria,
                        catalog.organismo_id(
                            connection,
                            administracion,
                            departamento,
                            organo,
                            organismo,
                            fold(organismo),
                        ),
                        clip(row[7], 200),
                        fecha,
                        anio,
                        catalog.persona_id(connection, nif, display, nombre_norm, tipo, ben_key),
                        catalog.tipo_id(connection, tipo),
                        parse_amount(row[10]),
                        catalog.instrumento_id(connection, instrumento, slug),
                        parse_amount(row[12]) if len(row) > 12 else None,
                        catalog.ccaa_id(connection, geo.locate(administracion, departamento)),
                        catalog.sector_id(connection, classify_sector(fold(titulo))),
                    )
                )
                if len(batch) >= BATCH:
                    connection.executemany(sql, batch)
                    inserted += len(batch)
                    batch.clear()
                    if inserted % 200000 == 0:
                        connection.commit()
                        log(f"Concesiones: {inserted}")
        finally:
            handle.close()
        connection.commit()
    if batch:
        connection.executemany(sql, batch)
        inserted += len(batch)
        connection.commit()
    log(f"Concesiones cargadas: {inserted} (filas omitidas: {skipped})")
    return inserted


def create_indexes(connection: sqlite3.Connection) -> None:
    log("Creando índices")
    connection.executescript(
        """
        CREATE INDEX idx_conv_fecha ON convocatoria(fecha DESC, id);
        CREATE INDEX idx_conv_codigo ON convocatoria(codigo_bdns);
        CREATE INDEX idx_conv_ccaa_fecha ON convocatoria(ccaa_id, fecha DESC);
        CREATE INDEX idx_conv_sector_fecha ON convocatoria(sector_id, fecha DESC);
        CREATE INDEX idx_conv_org ON convocatoria(organismo_id, fecha DESC);
        CREATE INDEX idx_conv_anio ON convocatoria(anio, fecha DESC);
        CREATE INDEX idx_conv_importe ON convocatoria(importe_total DESC);

        CREATE INDEX idx_con_fecha ON concesion(fecha DESC, id);
        CREATE INDEX idx_con_ccaa_fecha ON concesion(ccaa_id, fecha DESC);
        CREATE INDEX idx_con_sector_fecha ON concesion(sector_id, fecha DESC);
        CREATE INDEX idx_con_tipo_fecha ON concesion(tipo_id, fecha DESC);
        CREATE INDEX idx_con_inst_fecha ON concesion(instrumento_id, fecha DESC);
        CREATE INDEX idx_con_org_fecha ON concesion(organismo_id, fecha DESC);
        CREATE INDEX idx_con_anio ON concesion(anio, fecha DESC);
        CREATE INDEX idx_con_importe ON concesion(importe DESC);
        CREATE INDEX idx_con_conv ON concesion(id_convocatoria, fecha DESC);
        CREATE INDEX idx_con_persona ON concesion(persona_id, fecha DESC);
        """
    )


def mark_duplicates(connection: sqlite3.Connection) -> int:
    """Keep one row per identical grant in the sum view. Raw rows stay.

    The key is beneficiario (persona_id), convocatoria, fecha, importe and
    instrumento. The lowest id is the one that remains in `concesiones`.
    The grouping index is dropped afterwards so the file does not keep it.
    """
    log("Marcando concesiones idénticas")
    connection.execute("PRAGMA temp_store = FILE")
    connection.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_con_dupkey
        ON concesion(persona_id, id_convocatoria, instrumento_id, fecha, importe, id)
        """
    )
    connection.execute("DELETE FROM concesion_dup")
    connection.execute(
        """
        INSERT INTO concesion_dup (concesion_id, canon_id)
        SELECT c.id, g.keep_id
        FROM concesion c
        JOIN (
          SELECT persona_id, id_convocatoria, instrumento_id, fecha, importe, MIN(id) AS keep_id
          FROM concesion
          GROUP BY persona_id, id_convocatoria, instrumento_id, fecha, importe
          HAVING COUNT(*) > 1
        ) AS g
          ON c.persona_id = g.persona_id
         AND c.id_convocatoria IS g.id_convocatoria
         AND c.instrumento_id = g.instrumento_id
         AND c.fecha IS g.fecha
         AND c.importe = g.importe
         AND c.id != g.keep_id
        """
    )
    connection.execute("DROP INDEX IF EXISTS idx_con_dupkey")
    count = connection.execute("SELECT COUNT(*) FROM concesion_dup").fetchone()[0]
    groups = connection.execute("SELECT COUNT(DISTINCT canon_id) FROM concesion_dup").fetchone()[0]
    log(f"Filas repetidas apartadas de los totales: {count} (en {groups} grupos)")
    return int(count)


def reinstall_sum_views(connection: sqlite3.Connection) -> None:
    """Replace the sum view on an index that was built before duplicates were marked."""
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS concesion_dup (
          concesion_id INTEGER PRIMARY KEY,
          canon_id INTEGER NOT NULL
        )
        """
    )
    connection.executescript(
        """
        DROP VIEW IF EXISTS concesiones;
        DROP VIEW IF EXISTS concesiones_brutas;
        CREATE VIEW concesiones_brutas AS
        SELECT
          c.id,
          c.id_convocatoria,
          COALESCE(cv.codigo_bdns, '') AS codigo_bdns,
          o.administracion,
          o.departamento,
          o.organo,
          o.organismo,
          o.organismo_norm,
          COALESCE(cv.titulo, '') AS titulo,
          COALESCE(cv.url_bases, '') AS url_bases,
          c.aplicacion,
          c.fecha,
          c.anio,
          p.nif,
          p.nombre AS beneficiario_nombre,
          p.nombre_norm,
          t.nombre AS tipo_beneficiario,
          c.importe,
          i.nombre AS instrumento,
          i.slug AS instrumento_slug,
          c.ayuda_equivalente,
          ca.nombre AS ccaa,
          s.nombre AS sector,
          p.ben_key,
          c.beneficiario_id,
          CASE WHEN d.concesion_id IS NULL THEN 0 ELSE 1 END AS es_duplicado,
          COALESCE(d.canon_id, c.id) AS canon_id
        FROM concesion c
        JOIN lut_organismo o ON o.id = c.organismo_id
        JOIN lut_persona p ON p.id = c.persona_id
        JOIN lut_tipo t ON t.id = c.tipo_id
        JOIN lut_instrumento i ON i.id = c.instrumento_id
        JOIN lut_ccaa ca ON ca.id = c.ccaa_id
        JOIN lut_sector s ON s.id = c.sector_id
        LEFT JOIN convocatoria cv ON cv.id = c.id_convocatoria
        LEFT JOIN concesion_dup d ON d.concesion_id = c.id;

        CREATE VIEW concesiones AS
        SELECT * FROM concesiones_brutas WHERE es_duplicado = 0;
        """
    )


def _table_columns(connection: sqlite3.Connection, table: str) -> set[str]:
    return {row[1] for row in connection.execute(f"PRAGMA table_info({table})")}


def ensure_split_columns(connection: sqlite3.Connection) -> None:
    additions = (
        ("beneficiario", "n_subvencion", "INTEGER NOT NULL DEFAULT 0"),
        ("beneficiario", "importe_subvencion", "REAL NOT NULL DEFAULT 0"),
        ("beneficiario", "n_garantia", "INTEGER NOT NULL DEFAULT 0"),
        ("beneficiario", "importe_garantia", "REAL NOT NULL DEFAULT 0"),
        ("convocatoria", "n_garantia", "INTEGER NOT NULL DEFAULT 0"),
        ("convocatoria", "importe_garantia", "REAL NOT NULL DEFAULT 0"),
        ("convocatoria", "importe_subvencion", "REAL NOT NULL DEFAULT 0"),
    )
    for table, name, ddl in additions:
        if name not in _table_columns(connection, table):
            connection.execute(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}")


def reinstall_lookup_views(connection: sqlite3.Connection) -> None:
    connection.executescript(
        """
        DROP VIEW IF EXISTS convocatorias;
        DROP VIEW IF EXISTS beneficiarios;
        CREATE VIEW convocatorias AS
        SELECT
          c.id,
          c.codigo_bdns,
          c.mrr,
          o.administracion,
          o.departamento,
          o.organo,
          o.organismo,
          o.organismo_norm,
          c.fecha,
          c.anio,
          c.titulo,
          c.titulo_cooficial,
          c.url_bases,
          ca.nombre AS ccaa,
          s.nombre AS sector,
          c.n_concesiones,
          c.importe_total,
          c.n_garantia,
          c.importe_garantia,
          c.importe_subvencion
        FROM convocatoria c
        JOIN lut_organismo o ON o.id = c.organismo_id
        JOIN lut_ccaa ca ON ca.id = c.ccaa_id
        JOIN lut_sector s ON s.id = c.sector_id;

        CREATE VIEW beneficiarios AS
        SELECT
          b.id,
          p.ben_key,
          p.nif,
          p.nombre,
          p.nombre_norm,
          p.tipo,
          b.n_concesiones,
          b.importe_total,
          b.n_subvencion,
          b.importe_subvencion,
          b.n_garantia,
          b.importe_garantia
        FROM beneficiario b
        JOIN lut_persona p ON p.id = b.persona_id;
        """
    )


def fill_instrument_splits(connection: sqlite3.Connection) -> None:
    """Separate cash subsidies from guarantees on the published totals."""
    log("Separando subvenciones y garantías")
    ensure_split_columns(connection)
    connection.execute(
        "UPDATE beneficiario SET n_subvencion = 0, importe_subvencion = 0, n_garantia = 0, importe_garantia = 0"
    )
    connection.execute(
        """
        UPDATE beneficiario
        SET n_subvencion = agg.n, importe_subvencion = agg.importe
        FROM (
          SELECT beneficiario_id AS id, COUNT(*) AS n, COALESCE(SUM(importe), 0) AS importe
          FROM concesiones
          WHERE instrumento_slug = 'subvencion' AND beneficiario_id IS NOT NULL
          GROUP BY beneficiario_id
        ) AS agg
        WHERE beneficiario.id = agg.id
        """
    )
    connection.execute(
        """
        UPDATE beneficiario
        SET n_garantia = agg.n, importe_garantia = agg.importe
        FROM (
          SELECT beneficiario_id AS id, COUNT(*) AS n, COALESCE(SUM(importe), 0) AS importe
          FROM concesiones
          WHERE instrumento_slug = 'garantia' AND beneficiario_id IS NOT NULL
          GROUP BY beneficiario_id
        ) AS agg
        WHERE beneficiario.id = agg.id
        """
    )
    connection.execute(
        "UPDATE convocatoria SET n_garantia = 0, importe_garantia = 0, importe_subvencion = 0"
    )
    connection.execute(
        """
        UPDATE convocatoria
        SET importe_subvencion = agg.importe
        FROM (
          SELECT id_convocatoria AS id, COALESCE(SUM(importe), 0) AS importe
          FROM concesiones
          WHERE instrumento_slug = 'subvencion' AND id_convocatoria IS NOT NULL
          GROUP BY id_convocatoria
        ) AS agg
        WHERE convocatoria.id = agg.id
        """
    )
    connection.execute(
        """
        UPDATE convocatoria
        SET n_garantia = agg.n, importe_garantia = agg.importe
        FROM (
          SELECT id_convocatoria AS id, COUNT(*) AS n, COALESCE(SUM(importe), 0) AS importe
          FROM concesiones
          WHERE instrumento_slug = 'garantia' AND id_convocatoria IS NOT NULL
          GROUP BY id_convocatoria
        ) AS agg
        WHERE convocatoria.id = agg.id
        """
    )
    if "importe_garantia" not in _table_columns(connection, "beneficiarios"):
        reinstall_lookup_views(connection)


def refresh_published_totals(connection: sqlite3.Connection) -> None:
    log("Actualizando totales de beneficiario y convocatoria")
    connection.execute(
        """
        UPDATE beneficiario
        SET n_concesiones = agg.n,
            importe_total = agg.importe
        FROM (
          SELECT beneficiario_id AS id, COUNT(*) AS n, COALESCE(SUM(importe), 0) AS importe
          FROM concesiones
          WHERE beneficiario_id IS NOT NULL
          GROUP BY beneficiario_id
        ) AS agg
        WHERE beneficiario.id = agg.id
        """
    )
    connection.execute(
        """
        UPDATE convocatoria
        SET n_concesiones = agg.n,
            importe_total = agg.importe
        FROM (
          SELECT id_convocatoria AS id, COUNT(*) AS n, COALESCE(SUM(importe), 0) AS importe
          FROM concesiones
          WHERE id_convocatoria IS NOT NULL
          GROUP BY id_convocatoria
        ) AS agg
        WHERE convocatoria.id = agg.id
        """
    )
    fill_instrument_splits(connection)
    build_stats(connection)
    refresh_meta_counts(connection)


def refresh_meta_counts(connection: sqlite3.Connection) -> None:
    updates = {
        "n_concesiones": "SELECT COUNT(*) FROM concesiones",
        "importe_total": "SELECT COALESCE(SUM(importe), 0) FROM concesiones",
        "importe_subvencion": "SELECT COALESCE(SUM(importe), 0) FROM concesiones WHERE instrumento_slug = 'subvencion'",
        "n_subvencion": "SELECT COUNT(*) FROM concesiones WHERE instrumento_slug = 'subvencion'",
        "n_garantia": "SELECT COUNT(*) FROM concesiones WHERE instrumento_slug = 'garantia'",
        "importe_garantia": "SELECT COALESCE(SUM(importe), 0) FROM concesiones WHERE instrumento_slug = 'garantia'",
        "ccaa_sin_asignar_conc": "SELECT COUNT(*) FROM concesiones WHERE ccaa = 'No determinada'",
    }
    for key, sql in updates.items():
        value = connection.execute(sql).fetchone()[0]
        connection.execute(
            """
            INSERT INTO meta(key, value) VALUES (?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
            """,
            (key, str(value)),
        )
    kept = connection.execute(updates["n_concesiones"]).fetchone()[0]
    log(f"Concesiones en los totales: {kept}")


def dedupe_existing() -> None:
    """Mark duplicate grants on an index that is already built. Does not reload CSVs."""
    if not DB_PATH.exists():
        raise SystemExit(f"No hay índice en {DB_PATH}.")
    connection = sqlite3.connect(DB_PATH)
    connection.execute("PRAGMA busy_timeout = 8000")
    connection.execute("PRAGMA temp_store = FILE")
    connection.execute("PRAGMA cache_size = -20000")
    connection.execute("PRAGMA mmap_size = 0")
    try:
        reinstall_sum_views(connection)
        mark_duplicates(connection)
        refresh_published_totals(connection)
        connection.commit()
        log(f"Índice actualizado: {DB_PATH} ({DB_PATH.stat().st_size // 1_000_000} MB)")
    finally:
        connection.close()


def self_check_duplicates() -> None:
    connection = sqlite3.connect(":memory:")
    connection.execute(
        """
        CREATE TABLE concesion (
          id INTEGER PRIMARY KEY,
          persona_id INTEGER,
          id_convocatoria INTEGER,
          instrumento_id INTEGER,
          fecha TEXT,
          importe REAL
        )
        """
    )
    connection.execute(
        "CREATE TABLE concesion_dup (concesion_id INTEGER PRIMARY KEY, canon_id INTEGER NOT NULL)"
    )
    connection.executemany(
        "INSERT INTO concesion (id, persona_id, id_convocatoria, instrumento_id, fecha, importe) VALUES (?,?,?,?,?,?)",
        [
            (1, 10, 7, 1, "2020-01-02", 13259729.0),
            (2, 10, 7, 1, "2020-01-02", 13259729.0),
            (3, 10, 7, 1, "2020-01-03", 100.0),
            (4, 11, 7, 1, "2020-01-02", 13259729.0),
        ],
    )
    found = mark_duplicates(connection)
    rows = connection.execute(
        "SELECT concesion_id, canon_id FROM concesion_dup ORDER BY concesion_id"
    ).fetchall()
    assert found == 1
    assert rows == [(2, 1)]
    connection.close()
    log("Autocomprobación de duplicados correcta.")


def build_beneficiarios(connection: sqlite3.Connection) -> None:
    log("Agregando beneficiarios")
    connection.execute(
        """
        INSERT INTO beneficiario (persona_id, tipo_id, n_concesiones, importe_total)
        SELECT
          c.persona_id,
          (SELECT id FROM lut_tipo WHERE nombre = p.tipo),
          COUNT(*),
          COALESCE(SUM(c.importe), 0)
        FROM concesion c
        JOIN lut_persona p ON p.id = c.persona_id
        LEFT JOIN concesion_dup d ON d.concesion_id = c.id
        WHERE d.concesion_id IS NULL
        GROUP BY c.persona_id
        """
    )
    connection.execute(
        """
        UPDATE concesion
        SET beneficiario_id = beneficiario.id
        FROM beneficiario
        WHERE concesion.persona_id = beneficiario.persona_id
        """
    )
    connection.execute("CREATE INDEX idx_con_beneficiario ON concesion(beneficiario_id, fecha DESC)")
    connection.execute("CREATE INDEX idx_ben_importe ON beneficiario(importe_total DESC)")
    connection.execute("CREATE INDEX idx_ben_tipo ON beneficiario(tipo_id, importe_total DESC)")
    log("Índice de búsqueda de beneficiarios")
    connection.execute(
        """
        INSERT INTO ben_fts(rowid, nombre, nif)
        SELECT b.id, p.nombre_norm, IFNULL(p.nif, '')
        FROM beneficiario b
        JOIN lut_persona p ON p.id = b.persona_id
        """
    )


def build_stats(connection: sqlite3.Connection) -> None:
    log("Precalculando el panel")
    connection.executescript(
        """
        DELETE FROM stats_anio;
        DELETE FROM stats_ccaa;
        DELETE FROM stats_organismo;
        DELETE FROM stats_sector;
        DELETE FROM stats_instrumento;
        DELETE FROM stats_tipo;
        DELETE FROM stats_top_beneficiario;
        DELETE FROM facet_organismo;
        """
    )
    connection.execute(
        """
        UPDATE convocatoria
        SET n_concesiones = agg.n,
            importe_total = agg.importe
        FROM (
          SELECT id_convocatoria AS id, COUNT(*) AS n, COALESCE(SUM(importe), 0) AS importe
          FROM concesiones
          WHERE id_convocatoria IS NOT NULL
          GROUP BY id_convocatoria
        ) AS agg
        WHERE convocatoria.id = agg.id
        """
    )
    connection.executescript(
        """
        INSERT INTO stats_anio (ambito, anio, n, importe)
        SELECT 'todos', anio, COUNT(*), COALESCE(SUM(importe), 0)
        FROM concesiones WHERE anio IS NOT NULL
        GROUP BY anio;

        INSERT INTO stats_anio (ambito, anio, n, importe)
        SELECT 'subvencion', anio, COUNT(*), COALESCE(SUM(importe), 0)
        FROM concesiones
        WHERE anio IS NOT NULL AND instrumento_slug = 'subvencion'
        GROUP BY anio;

        INSERT INTO stats_ccaa (ambito, ccaa, n, importe)
        SELECT 'todos', ccaa, COUNT(*), COALESCE(SUM(importe), 0)
        FROM concesiones GROUP BY ccaa;

        INSERT INTO stats_ccaa (ambito, ccaa, n, importe)
        SELECT 'subvencion', ccaa, COUNT(*), COALESCE(SUM(importe), 0)
        FROM concesiones WHERE instrumento_slug = 'subvencion'
        GROUP BY ccaa;

        INSERT INTO stats_sector (ambito, sector, n, importe)
        SELECT 'todos', sector, COUNT(*), COALESCE(SUM(importe), 0)
        FROM concesiones GROUP BY sector;

        INSERT INTO stats_sector (ambito, sector, n, importe)
        SELECT 'subvencion', sector, COUNT(*), COALESCE(SUM(importe), 0)
        FROM concesiones WHERE instrumento_slug = 'subvencion'
        GROUP BY sector;

        INSERT INTO stats_tipo (ambito, tipo, n, importe)
        SELECT 'todos', tipo_beneficiario, COUNT(*), COALESCE(SUM(importe), 0)
        FROM concesiones GROUP BY tipo_beneficiario;

        INSERT INTO stats_tipo (ambito, tipo, n, importe)
        SELECT 'subvencion', tipo_beneficiario, COUNT(*), COALESCE(SUM(importe), 0)
        FROM concesiones WHERE instrumento_slug = 'subvencion'
        GROUP BY tipo_beneficiario;

        INSERT INTO stats_instrumento (instrumento, slug, n, importe)
        SELECT instrumento, instrumento_slug, COUNT(*), COALESCE(SUM(importe), 0)
        FROM concesiones GROUP BY instrumento, instrumento_slug;

        INSERT INTO stats_organismo (ambito, organismo, n, importe)
        SELECT ambito, organismo, n, importe FROM (
          SELECT 'todos' AS ambito, organismo, COUNT(*) AS n, COALESCE(SUM(importe), 0) AS importe
          FROM concesiones GROUP BY organismo
          ORDER BY importe DESC LIMIT 12
        ) AS top_todos;

        INSERT INTO stats_organismo (ambito, organismo, n, importe)
        SELECT ambito, organismo, n, importe FROM (
          SELECT 'subvencion' AS ambito, organismo, COUNT(*) AS n, COALESCE(SUM(importe), 0) AS importe
          FROM concesiones WHERE instrumento_slug = 'subvencion'
          GROUP BY organismo
          ORDER BY importe DESC LIMIT 12
        ) AS top_subvencion;

        INSERT INTO stats_top_beneficiario (ambito, beneficiario_id, nombre, nif, tipo, n, importe)
        SELECT 'todos', id, nombre, nif, tipo, n_concesiones, importe_total
        FROM beneficiarios
        ORDER BY importe_total DESC
        LIMIT 12;

        INSERT INTO stats_top_beneficiario (ambito, beneficiario_id, nombre, nif, tipo, n, importe)
        SELECT 'subvencion', b.id, b.nombre, b.nif, b.tipo, agg.n, agg.importe
        FROM (
          SELECT beneficiario_id AS id, COUNT(*) AS n, COALESCE(SUM(importe), 0) AS importe
          FROM concesiones
          WHERE instrumento_slug = 'subvencion' AND beneficiario_id IS NOT NULL
          GROUP BY beneficiario_id
          ORDER BY importe DESC
          LIMIT 12
        ) AS agg
        JOIN beneficiarios b ON b.id = agg.id;

        INSERT INTO stats_anio (ambito, anio, n, importe)
        SELECT 'garantia', anio, COUNT(*), COALESCE(SUM(importe), 0)
        FROM concesiones
        WHERE anio IS NOT NULL AND instrumento_slug = 'garantia'
        GROUP BY anio;

        INSERT INTO stats_ccaa (ambito, ccaa, n, importe)
        SELECT 'garantia', ccaa, COUNT(*), COALESCE(SUM(importe), 0)
        FROM concesiones WHERE instrumento_slug = 'garantia'
        GROUP BY ccaa;

        INSERT INTO stats_sector (ambito, sector, n, importe)
        SELECT 'garantia', sector, COUNT(*), COALESCE(SUM(importe), 0)
        FROM concesiones WHERE instrumento_slug = 'garantia'
        GROUP BY sector;

        INSERT INTO stats_tipo (ambito, tipo, n, importe)
        SELECT 'garantia', tipo_beneficiario, COUNT(*), COALESCE(SUM(importe), 0)
        FROM concesiones WHERE instrumento_slug = 'garantia'
        GROUP BY tipo_beneficiario;

        INSERT INTO stats_organismo (ambito, organismo, n, importe)
        SELECT ambito, organismo, n, importe FROM (
          SELECT 'garantia' AS ambito, organismo, COUNT(*) AS n, COALESCE(SUM(importe), 0) AS importe
          FROM concesiones WHERE instrumento_slug = 'garantia'
          GROUP BY organismo
          ORDER BY importe DESC LIMIT 12
        ) AS top_garantia;

        INSERT INTO stats_top_beneficiario (ambito, beneficiario_id, nombre, nif, tipo, n, importe)
        SELECT 'garantia', b.id, b.nombre, b.nif, b.tipo, agg.n, agg.importe
        FROM (
          SELECT beneficiario_id AS id, COUNT(*) AS n, COALESCE(SUM(importe), 0) AS importe
          FROM concesiones
          WHERE instrumento_slug = 'garantia' AND beneficiario_id IS NOT NULL
          GROUP BY beneficiario_id
          ORDER BY importe DESC
          LIMIT 12
        ) AS agg
        JOIN beneficiarios b ON b.id = agg.id;

        INSERT INTO facet_organismo (nombre, nombre_norm, n, importe)
        SELECT organismo, MIN(organismo_norm), COUNT(*), COALESCE(SUM(importe), 0)
        FROM concesiones
        WHERE organismo <> ''
        GROUP BY organismo;

        INSERT INTO facet_organismo (nombre, nombre_norm, n, importe)
        SELECT organismo, MIN(organismo_norm), 0, 0
        FROM convocatorias
        WHERE organismo <> ''
        GROUP BY organismo
        ON CONFLICT(nombre) DO NOTHING;
        """
    )
    connection.execute("CREATE INDEX IF NOT EXISTS idx_facet_org_norm ON facet_organismo(nombre_norm)")


def write_meta(connection: sqlite3.Connection) -> None:
    def one(sql: str):
        row = connection.execute(sql).fetchone()
        return row[0] if row else None

    values = {
        "source_repo": SOURCE_REPO,
        "source_files": ", ".join(FILES),
        "built_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "fecha_min": one("SELECT MIN(fecha) FROM concesiones WHERE fecha IS NOT NULL"),
        "fecha_max": one("SELECT MAX(fecha) FROM concesiones WHERE fecha IS NOT NULL"),
        "conv_fecha_min": one("SELECT MIN(fecha) FROM convocatorias WHERE fecha IS NOT NULL"),
        "conv_fecha_max": one("SELECT MAX(fecha) FROM convocatorias WHERE fecha IS NOT NULL"),
        "n_convocatorias": str(one("SELECT COUNT(*) FROM convocatorias")),
        "n_concesiones": str(one("SELECT COUNT(*) FROM concesiones")),
        "n_beneficiarios": str(one("SELECT COUNT(*) FROM beneficiarios")),
        "importe_total": str(one("SELECT COALESCE(SUM(importe), 0) FROM concesiones")),
        "importe_subvencion": str(
            one("SELECT COALESCE(SUM(importe), 0) FROM concesiones WHERE instrumento_slug = 'subvencion'")
        ),
        "n_subvencion": str(one("SELECT COUNT(*) FROM concesiones WHERE instrumento_slug = 'subvencion'")),
        "n_garantia": str(one("SELECT COUNT(*) FROM concesiones WHERE instrumento_slug = 'garantia'")),
        "importe_garantia": str(
            one("SELECT COALESCE(SUM(importe), 0) FROM concesiones WHERE instrumento_slug = 'garantia'")
        ),
        "ccaa_sin_asignar_conv": str(
            one("SELECT COUNT(*) FROM convocatorias WHERE ccaa = 'No determinada'")
        ),
        "ccaa_sin_asignar_conc": str(
            one("SELECT COUNT(*) FROM concesiones WHERE ccaa = 'No determinada'")
        ),
        "license": "GPL-3.0 (repositorio JaimeObregon/subvenciones); datos públicos de la BDNS",
        "nota_plazo": (
            "El volcado no incluye fecha de inicio ni de fin del plazo de solicitud. "
            "No se puede saber qué convocatorias siguen abiertas."
        ),
    }
    connection.executemany("INSERT INTO meta(key, value) VALUES (?, ?)", values.items())
    log("Cobertura territorial (convocatorias)")
    for ccaa, count in connection.execute(
        "SELECT ccaa, COUNT(*) FROM convocatorias GROUP BY ccaa ORDER BY COUNT(*) DESC"
    ):
        log(f"  {count:7} {ccaa}")
    log("Instrumentos")
    for name, count, importe in connection.execute(
        "SELECT instrumento, n, importe FROM stats_instrumento ORDER BY importe DESC"
    ):
        log(f"  {count:8} {importe:18.0f} {name}")


def build() -> None:
    if not VENDOR_MUNICIPIOS.exists():
        raise SystemExit(f"Falta el padrón municipal de apoyo: {VENDOR_MUNICIPIOS}")
    ensure_sources()
    geo = Geo(VENDOR_MUNICIPIOS)
    self_check(geo)
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    if DB_PATH.exists():
        DB_PATH.unlink()
    for suffix in ("-wal", "-shm"):
        extra = Path(str(DB_PATH) + suffix)
        if extra.exists():
            extra.unlink()
    connection = sqlite3.connect(DB_PATH)
    connection.execute("PRAGMA journal_mode = WAL")
    connection.execute("PRAGMA synchronous = OFF")
    connection.execute("PRAGMA temp_store = MEMORY")
    connection.execute("PRAGMA cache_size = -200000")
    try:
        create_schema(connection)
        catalog = Catalog()
        load_convocatorias(connection, geo, catalog)
        connection.commit()
        load_concesiones(connection, geo, catalog)
        create_indexes(connection)
        connection.commit()
        mark_duplicates(connection)
        connection.commit()
        build_beneficiarios(connection)
        connection.commit()
        fill_instrument_splits(connection)
        connection.commit()
        build_stats(connection)
        write_meta(connection)
        connection.commit()
        log("Optimizando el planificador")
        connection.execute("PRAGMA synchronous = NORMAL")
        connection.execute("PRAGMA optimize")
        connection.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        connection.commit()
    finally:
        connection.close()
    log(f"Índice listo: {DB_PATH} ({DB_PATH.stat().st_size // 1_000_000} MB)")


def relabel_unmapped() -> None:
    """Reclassify rows left as 'No determinada' without reloading the CSVs."""
    if not DB_PATH.exists():
        raise SystemExit(f"No hay índice en {DB_PATH}. Ejecuta el pipeline completo antes.")
    geo = Geo(VENDOR_MUNICIPIOS)
    self_check(geo)
    connection = sqlite3.connect(DB_PATH)
    try:
        changed = 0
        ccaa_ids: dict[str, int] = {
            nombre: row_id
            for row_id, nombre in connection.execute("SELECT id, nombre FROM lut_ccaa")
        }

        def ccaa_key(nombre: str) -> int:
            found = ccaa_ids.get(nombre)
            if found is not None:
                return found
            cursor = connection.execute("INSERT INTO lut_ccaa (nombre) VALUES (?)", (nombre,))
            found = int(cursor.lastrowid)
            ccaa_ids[nombre] = found
            return found

        for table in ("convocatoria", "concesion"):
            rows = connection.execute(
                f"""
                SELECT t.id, o.administracion, o.departamento
                FROM {table} t
                JOIN lut_organismo o ON o.id = t.organismo_id
                JOIN lut_ccaa ca ON ca.id = t.ccaa_id
                WHERE ca.nombre = ?
                """,
                (UNMAPPED,),
            )
            updates: list[tuple[int, int]] = []
            for row_id, administracion, departamento in rows:
                ccaa = geo.locate(administracion or "", departamento or "")
                if ccaa == UNMAPPED:
                    continue
                updates.append((ccaa_key(ccaa), row_id))
                if len(updates) >= 5000:
                    connection.executemany(
                        f"UPDATE {table} SET ccaa_id = ? WHERE id = ?",
                        updates,
                    )
                    changed += len(updates)
                    updates.clear()
            if updates:
                connection.executemany(f"UPDATE {table} SET ccaa_id = ? WHERE id = ?", updates)
                changed += len(updates)
            log(f"{table}: filas reetiquetadas en este pase, acumulado {changed}")
        connection.executescript(
            """
            DELETE FROM stats_ccaa;
            INSERT INTO stats_ccaa (ambito, ccaa, n, importe)
            SELECT 'todos', ccaa, COUNT(*), COALESCE(SUM(importe), 0)
            FROM concesiones GROUP BY ccaa;
            INSERT INTO stats_ccaa (ambito, ccaa, n, importe)
            SELECT 'subvencion', ccaa, COUNT(*), COALESCE(SUM(importe), 0)
            FROM concesiones WHERE instrumento_slug = 'subvencion'
            GROUP BY ccaa;
            """
        )
        connection.execute(
            "UPDATE meta SET value = ? WHERE key = 'ccaa_sin_asignar_conv'",
            (str(connection.execute("SELECT COUNT(*) FROM convocatorias WHERE ccaa = ?", (UNMAPPED,)).fetchone()[0]),),
        )
        connection.execute(
            "UPDATE meta SET value = ? WHERE key = 'ccaa_sin_asignar_conc'",
            (str(connection.execute("SELECT COUNT(*) FROM concesiones WHERE ccaa = ?", (UNMAPPED,)).fetchone()[0]),),
        )
        connection.commit()
        log(
            "Sin territorio: convocatorias "
            + connection.execute("SELECT value FROM meta WHERE key = 'ccaa_sin_asignar_conv'").fetchone()[0]
            + ", concesiones "
            + connection.execute("SELECT value FROM meta WHERE key = 'ccaa_sin_asignar_conc'").fetchone()[0]
        )
    finally:
        connection.close()


def main() -> None:
    csv.field_size_limit(10_000_000)
    if "--self-check" in sys.argv:
        self_check(Geo(VENDOR_MUNICIPIOS))
        self_check_duplicates()
        return
    if "--dedupe" in sys.argv:
        dedupe_existing()
        return
    if "--totals" in sys.argv:
        if not DB_PATH.exists():
            raise SystemExit(f"No hay índice en {DB_PATH}.")
        connection = sqlite3.connect(DB_PATH)
        connection.execute("PRAGMA temp_store = FILE")
        connection.execute("PRAGMA cache_size = -20000")
        connection.execute("PRAGMA mmap_size = 0")
        try:
            reinstall_sum_views(connection)
            fill_instrument_splits(connection)
            build_stats(connection)
            refresh_meta_counts(connection)
            connection.commit()
        finally:
            connection.close()
        return
    if "--relabel" in sys.argv:
        relabel_unmapped()
        return
    started = time.time()
    build()
    log(f"Hecho en {time.time() - started:.0f} s")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(130)
