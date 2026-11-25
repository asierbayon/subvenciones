#!/usr/bin/env python3
"""Cruce opcional de beneficiarios BDNS con la contratación pública de la PLACSP.

No forma parte de `build_index.py`. Si no se ejecuta, el índice de subvenciones
sigue construyéndose igual y las pantallas avisan de que falta este paso.

    python3 pipeline/contratos.py
    python3 pipeline/contratos.py --self-check

Lee los ZIP anuales de sindicación ATOM/CODICE (2018-2022 por defecto), se queda
solo con adjudicaciones cuyo NIF ya está en el índice y escribe tablas
`placsp_*` y `alert_contrato*` dentro de `data/bdns.sqlite`. Los ZIP no se
versionan. Por defecto se borran al procesarlos (`--keep-raw` los conserva).

Emparejar órganos es una aproximación, no una identidad oficial. La BDNS no
trae código DIR3. El DIR3 sale del anuncio de la PLACSP y solo se traslada a un
organismo de la BDNS cuando el nombre normalizado coincide con un único código.
"""

from __future__ import annotations

import argparse
import html
import math
import re
import sqlite3
import sys
import time
import urllib.request
import zipfile
from collections import Counter
from datetime import datetime, timedelta
from pathlib import Path
from xml.etree import ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
DB_PATH = ROOT / "data" / "bdns.sqlite"
RAW_DIR = ROOT / "data" / "raw" / "placsp"

WINDOW_DAYS = 180
YEAR_MIN = 2018
# LCSP: contrato menor de obras por debajo de 40.000 € sin IVA; servicios y
# suministros por debajo de 15.000 € sin IVA. La señal es la banda 90-100 %.
OBRA_UMBRAL = 40_000.0
SERVICIO_UMBRAL = 15_000.0
UMBRAL_RATIO = 0.90
MIN_MENORES_UMBRAL = 5
YEAR_MAX = 2022
USER_AGENT = "faro-bdns-pipeline"
ENTRY_CAP = 2_000_000

FEEDS: tuple[tuple[str, str], ...] = (
    (
        "perfiles",
        "https://contrataciondelsectorpublico.gob.es/sindicacion/sindicacion_643/licitacionesPerfilesContratanteCompleto3_{year}.zip",
    ),
    (
        "menores",
        "https://contrataciondelsectorpublico.gob.es/sindicacion/sindicacion_1143/contratosMenoresPerfilesContratantes_{year}.zip",
    ),
    (
        "agregadas",
        "https://contrataciondelsectorpublico.gob.es/sindicacion/sindicacion_1044/PlataformasAgregadasSinMenores_{year}.zip",
    ),
)

# SyndicationTenderingProcessCode 2.07.
# 3 es «Negociado sin publicidad» y 4 es «Negociado con publicidad».
PROCEDURES = {
    "1": "Abierto",
    "2": "Restringido",
    "3": "Negociado sin publicidad",
    "4": "Negociado con publicidad",
    "5": "Diálogo competitivo",
    "6": "Contrato menor",
    "7": "Derivado de acuerdo marco",
    "8": "Concurso de proyectos",
    "9": "Abierto simplificado",
    "10": "Asociación para la innovación",
    "11": "Derivado de asociación para la innovación",
    "12": "Basado en un sistema dinámico de adquisición",
    "13": "Licitación con negociación",
    "100": "Normas internas",
    "999": "Otros",
}
AWARDED = {"1", "2", "8", "9", "11"}
SIN_PUBLICIDAD = {"3"}
MENOR_CODE = "6"

NIF_RE = re.compile(r"^[A-Z]\d{7}[0-9A-Z]$")
NIF_FIND = re.compile(r"[A-Z]\d{7}[0-9A-Z]")
WINNER_ID_RE = re.compile(br"schemeName=[\"'](NIF|CIF|UTE)[\"'][^>]*>\s*([^<]+?)\s*<", re.I)
DIR3_RE = re.compile(r"schemeName=[\"']DIR3[\"'][^>]*>\s*([^<]+?)\s*<", re.I)
NAME_TAG_RE = re.compile(r"<(?:[\w.-]+:)?Name>([^<]*)")
TOKEN_RE = re.compile(r"[^A-Z0-9 ]+")

STOPWORDS = {"DE", "DEL", "LA", "EL", "LAS", "LOS", "Y", "D", "L", "LES", "ELS", "I", "DA", "DO"}
TOKEN_MAP = {
    "AYTO": "AYUNTAMIENTO",
    "AYUNT": "AYUNTAMIENTO",
    "AJUNTAMENT": "AYUNTAMIENTO",
    "AJUNTAMIENT": "AYUNTAMIENTO",
    "CONCELLO": "AYUNTAMIENTO",
    "UDALA": "AYUNTAMIENTO",
    "PROV": "PROVINCIAL",
    "DIPUTACIO": "DIPUTACION",
    "CONSELLERIA": "CONSEJERIA",
    "DEPARTAMENT": "DEPARTAMENTO",
    "XUNTA": "JUNTA",
    "GRAL": "GENERAL",
    "ADMON": "ADMINISTRACION",
    "VIZCAYA": "BIZKAIA",
    "GUIPUZCOA": "GIPUZKOA",
    "ALAVA": "ARABA",
    "GERONA": "GIRONA",
    "LERIDA": "LLEIDA",
    "OURENSE": "ORENSE",
    "ALACANT": "ALICANTE",
    "CASTELLO": "CASTELLON",
    "DONOSTIA": "SAN SEBASTIAN",
    "BILBO": "BILBAO",
}
PLACE_ALIAS = {
    "DONOSTIA SAN SEBASTIAN": "SAN SEBASTIAN",
    "CASTELLON DE LA PLANA": "CASTELLON",
    "ILLES BALEARS": "BALEARS",
    "ISLAS BALEARES": "BALEARS",
    "A CORUNA": "CORUNA",
}
# Resto del nombre, ya sin stopwords, del más largo al más corto.
MINISTRY_ALIASES: tuple[tuple[str, str], ...] = (
    ("HACIENDA Y FUNCION PUBLICA", "HACIENDA"),
    ("HACIENDA FUNCION PUBLICA", "HACIENDA"),
    ("HACIENDA Y ADMINISTRACIONES PUBLICAS", "HACIENDA"),
    ("HACIENDA ADMINISTRACIONES PUBLICAS", "HACIENDA"),
    ("HACIENDA", "HACIENDA"),
    ("CULTURA Y DEPORTE", "CULTURA"),
    ("CULTURA DEPORTE", "CULTURA"),
    ("SANIDAD CONSUMO Y BIENESTAR SOCIAL", "SANIDAD"),
    ("SANIDAD CONSUMO BIENESTAR SOCIAL", "SANIDAD"),
    ("SANIDAD", "SANIDAD"),
    ("TRABAJO Y ECONOMIA SOCIAL", "TRABAJO"),
    ("TRABAJO ECONOMIA SOCIAL", "TRABAJO"),
    ("TRABAJO MIGRACIONES Y SEGURIDAD SOCIAL", "TRABAJO"),
    ("TRABAJO MIGRACIONES SEGURIDAD SOCIAL", "TRABAJO"),
    ("INCLUSION SEGURIDAD SOCIAL Y MIGRACIONES", "TRABAJO"),
    ("INCLUSION SEGURIDAD SOCIAL MIGRACIONES", "TRABAJO"),
    ("EDUCACION Y FORMACION PROFESIONAL", "EDUCACION"),
    ("EDUCACION FORMACION PROFESIONAL", "EDUCACION"),
    ("CIENCIA E INNOVACION", "CIENCIA"),
    ("CIENCIA INNOVACION", "CIENCIA"),
    ("CIENCIA INNOVACION Y UNIVERSIDADES", "CIENCIA"),
    ("CIENCIA INNOVACION UNIVERSIDADES", "CIENCIA"),
    ("INDUSTRIA COMERCIO Y TURISMO", "INDUSTRIA"),
    ("INDUSTRIA COMERCIO TURISMO", "INDUSTRIA"),
    ("INDUSTRIA Y TURISMO", "INDUSTRIA"),
    ("INDUSTRIA TURISMO", "INDUSTRIA"),
    ("AGRICULTURA PESCA Y ALIMENTACION", "AGRICULTURA"),
    ("AGRICULTURA PESCA ALIMENTACION", "AGRICULTURA"),
    ("TRANSICION ECOLOGICA Y EL RETO DEMOGRAFICO", "TRANSICION"),
    ("TRANSICION ECOLOGICA RETO DEMOGRAFICO", "TRANSICION"),
    ("TRANSICION ECOLOGICA", "TRANSICION"),
    ("DERECHOS SOCIALES Y AGENDA 2030", "DERECHOS"),
    ("DERECHOS SOCIALES AGENDA 2030", "DERECHOS"),
    ("POLITICA TERRITORIAL Y FUNCION PUBLICA", "TERRITORIAL"),
    ("POLITICA TERRITORIAL FUNCION PUBLICA", "TERRITORIAL"),
    ("POLITICA TERRITORIAL", "TERRITORIAL"),
    ("ASUNTOS ECONOMICOS Y TRANSFORMACION DIGITAL", "ECONOMIA"),
    ("ASUNTOS ECONOMICOS TRANSFORMACION DIGITAL", "ECONOMIA"),
    ("ECONOMIA Y EMPRESA", "ECONOMIA"),
    ("ECONOMIA EMPRESA", "ECONOMIA"),
    ("UNIVERSIDADES", "UNIVERSIDADES"),
    ("JUSTICIA", "JUSTICIA"),
    ("INTERIOR", "INTERIOR"),
    ("DEFENSA", "DEFENSA"),
    ("EXTERIORES", "EXTERIORES"),
    ("FOMENTO", "FOMENTO"),
    ("TRANSPORTES MOVILIDAD Y AGENDA URBANA", "TRANSPORTES"),
    ("TRANSPORTES MOVILIDAD AGENDA URBANA", "TRANSPORTES"),
)
CCAA_EXACT = {
    "JUNTA ANDALUCIA": "ccaa:andalucia",
    "ANDALUCIA": "ccaa:andalucia",
    "COMUNIDAD AUTONOMA ANDALUCIA": "ccaa:andalucia",
    "GOBIERNO ARAGON": "ccaa:aragon",
    "ARAGON": "ccaa:aragon",
    "PRINCIPADO ASTURIAS": "ccaa:asturias",
    "GOBIERNO PRINCIPADO ASTURIAS": "ccaa:asturias",
    "ASTURIAS": "ccaa:asturias",
    "GOVERN ILLES BALEARS": "ccaa:baleares",
    "COMUNIDAD AUTONOMA ILLES BALEARS": "ccaa:baleares",
    "ILLES BALEARS": "ccaa:baleares",
    "BALEARS": "ccaa:baleares",
    "GOBIERNO CANARIAS": "ccaa:canarias",
    "CANARIAS": "ccaa:canarias",
    "GOBIERNO CANTABRIA": "ccaa:cantabria",
    "CANTABRIA": "ccaa:cantabria",
    "JUNTA CASTILLA LEON": "ccaa:castilla-leon",
    "CASTILLA LEON": "ccaa:castilla-leon",
    "JUNTA COMUNIDADES CASTILLA LA MANCHA": "ccaa:castilla-la-mancha",
    "CASTILLA LA MANCHA": "ccaa:castilla-la-mancha",
    "GENERALITAT CATALUNYA": "ccaa:catalunya",
    "GENERALITAT CATALUNA": "ccaa:catalunya",
    "CATALUNYA": "ccaa:catalunya",
    "CATALUNA": "ccaa:catalunya",
    "GENERALITAT VALENCIANA": "ccaa:valencia",
    "COMUNITAT VALENCIANA": "ccaa:valencia",
    "COMUNIDAD VALENCIANA": "ccaa:valencia",
    "JUNTA EXTREMADURA": "ccaa:extremadura",
    "EXTREMADURA": "ccaa:extremadura",
    "JUNTA GALICIA": "ccaa:galicia",
    "GALICIA": "ccaa:galicia",
    "COMUNIDAD MADRID": "ccaa:madrid",
    "REGION MURCIA": "ccaa:murcia",
    "GOBIERNO NAVARRA": "ccaa:navarra",
    "COMUNIDAD FORAL NAVARRA": "ccaa:navarra",
    "NAVARRA": "ccaa:navarra",
    "GOBIERNO VASCO": "ccaa:euskadi",
    "ADMINISTRACION COMUNIDAD AUTONOMA PAIS VASCO": "ccaa:euskadi",
    "EUSKADI": "ccaa:euskadi",
    "PAIS VASCO": "ccaa:euskadi",
    "GOBIERNO RIOJA": "ccaa:rioja",
    "GOBIERNO LA RIOJA": "ccaa:rioja",
    "RIOJA": "ccaa:rioja",
    "CIUDAD AUTONOMA CEUTA": "ccaa:ceuta",
    "CEUTA": "ccaa:ceuta",
    "CIUDAD AUTONOMA MELILLA": "ccaa:melilla",
    "MELILLA": "ccaa:melilla",
}
BUCKET_EXACT = {
    "SECTOR PUBLICO",
    "OTRAS ENTIDADES DEL SECTOR PUBLICO",
    "ADMINISTRACION PUBLICA",
    "ENTIDADES LOCALES",
    "ADMINISTRACION LOCAL",
    "CORPORACIONES LOCALES",
    "COMUNIDADES AUTONOMAS",
    "ADMINISTRACION GENERAL DEL ESTADO",
    "ADMINISTRACION DEL ESTADO",
    "ESTADO",
    "ESPANA",
    "AGE",
}


def log(message: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {message}", flush=True)


def fold(value: str) -> str:
    text = (value or "").upper()
    text = text.replace("Á", "A").replace("É", "E").replace("Í", "I").replace("Ó", "O").replace("Ú", "U")
    text = text.replace("À", "A").replace("È", "E").replace("Ì", "I").replace("Ò", "O").replace("Ù", "U")
    text = text.replace("Ä", "A").replace("Ë", "E").replace("Ï", "I").replace("Ö", "O").replace("Ü", "U")
    text = text.replace("Ñ", "N").replace("Ç", "C")
    text = text.replace("·", " ").replace("’", " ").replace("'", " ")
    text = TOKEN_RE.sub(" ", text)
    return " ".join(text.split())


def canon(value: str) -> str:
    tokens = []
    for token in fold(value).split():
        token = TOKEN_MAP.get(token, token)
        if token in STOPWORDS:
            continue
        tokens.append(token)
    return " ".join(tokens)


def is_bucket(name: str) -> bool:
    if not name or name in BUCKET_EXACT:
        return True
    if name in {"AYUNTAMIENTOS", "DIPUTACIONES", "CABILDOS", "MINISTERIOS", "CONSEJERIAS", "DEPARTAMENTOS"}:
        return True
    if name.startswith("OTRAS ENTIDADES"):
        return True
    if name.startswith("SOCIEDADES FUNDACIONES"):
        return True
    if name.startswith("ENTES "):
        return True
    if name.startswith("COMUNIDADES CIUDADES"):
        return True
    if name.startswith("COMUNIDADES AUTONOMAS"):
        return True
    if "SECTOR PUBLICO" in name and len(name) < 48:
        return True
    return False


def ministry_stem(resto: str) -> str:
    for prefix, stem in MINISTRY_ALIASES:
        if resto == prefix or resto.startswith(prefix + " "):
            return stem
    return resto


def local_key(name: str) -> str | None:
    """Clave de administración local a partir del topónimo que sigue al tipo de ente.

    No exige que el tipo vaya al principio: «Junta de Gobierno del Ayuntamiento de X»
    comparte clave con «Ayuntamiento de X». El resto del nombre es el lugar, así que
    Valencia y Valencia de Don Juan no se mezclan.
    """
    tokens = name.split()
    rules = (
        ("AYUNTAMIENTO", "ayto"),
        ("DIPUTACION", "dip"),
        ("CABILDO", "insular"),
        ("CONSELL", "insular"),
    )
    for word, kind in rules:
        if word not in tokens:
            continue
        place_tokens = tokens[tokens.index(word) + 1 :]
        while place_tokens and place_tokens[0] in {"PROVINCIAL", "FORAL", "INSULAR", "COMARCAL", "GENERAL"}:
            place_tokens = place_tokens[1:]
        place = PLACE_ALIAS.get(" ".join(place_tokens), " ".join(place_tokens))
        if len(place) >= 3:
            return f"{kind}:{place}"
    return None


def admin_keys(texts: list[str]) -> set[str]:
    canons = []
    for text in texts:
        name = text if text == canon(text) else canon(text)
        if name and not is_bucket(name):
            canons.append(name)
    keys: set[str] = set()
    ccaas: set[str] = set()
    councils: list[str] = []
    for name in canons:
        region = CCAA_EXACT.get(name)
        if region:
            keys.add(region)
            ccaas.add(region)
        local = local_key(name)
        if local:
            keys.add(local)
        if name.startswith("MINISTERIO "):
            keys.add("min:" + ministry_stem(name[len("MINISTERIO ") :]))
        if name.startswith("CONSEJERIA ") or name.startswith("DEPARTAMENTO "):
            councils.append(name)
    if len(ccaas) == 1:
        region = next(iter(ccaas))
        for name in councils:
            resto = name.split(" ", 1)[1]
            keys.add(f"cons:{region}:{ministry_stem(resto)}")
    return keys


def clip(value: str, limit: int = 300) -> str:
    text = " ".join((value or "").split())
    if len(text) <= limit:
        return text
    return text[: limit - 1].rstrip() + "…"


def normalize_nif(value: str) -> str:
    text = (value or "").upper().replace(" ", "").replace("-", "").replace(".", "")
    if text.startswith("ES") and len(text) > 9:
        text = text[2:]
    if NIF_RE.fullmatch(text):
        return text
    return ""


def parse_amount(value: str) -> float | None:
    text = (value or "").strip().replace(" ", "").replace("€", "")
    if text == "":
        return None
    if "," in text and "." in text:
        if text.rfind(",") > text.rfind("."):
            text = text.replace(".", "").replace(",", ".")
        else:
            text = text.replace(",", "")
    elif "," in text:
        text = text.replace(",", ".")
    try:
        number = float(text)
    except ValueError:
        return None
    if number < 0:
        return None
    return number


def parse_day(value: str) -> str:
    text = (value or "").strip()
    if len(text) >= 10:
        text = text[:10]
    try:
        parsed = datetime.strptime(text, "%Y-%m-%d")
    except ValueError:
        return ""
    if parsed.year < 1990 or parsed.year > 2100:
        return ""
    return parsed.strftime("%Y-%m-%d")


def shift_day(day: str, delta: int) -> str:
    parsed = datetime.strptime(day, "%Y-%m-%d") + timedelta(days=delta)
    return parsed.strftime("%Y-%m-%d")


def days_between(left: str, right: str) -> int:
    start = datetime.strptime(left, "%Y-%m-%d")
    end = datetime.strptime(right, "%Y-%m-%d")
    return abs((start - end).days)


def fecha_es(day: str) -> str:
    year, month, day_number = day.split("-")
    return f"{day_number}/{month}/{year}"


def euros(value: float | None) -> str:
    if value is None:
        return "importe no publicado"
    rounded = round(float(value), 2)
    if abs(rounded - round(rounded)) < 0.001:
        text = f"{int(round(rounded)):,}"
    else:
        text = f"{rounded:,.2f}"
    text = text.replace(",", "X").replace(".", ",").replace("X", ".")
    return f"{text} €"


def strip_namespaces(blob: bytes) -> str:
    text = blob.decode("utf-8", "replace")
    text = re.sub(r"<\?xml[^?]*\?>", "", text, count=1)
    text = re.sub(r"\sxmlns(?::[\w.-]+)?=\"[^\"]*\"", "", text)
    text = re.sub(r"(</?)[\w.-]+:", r"\1", text)
    return text


def local_tag(element: ET.Element, path: str) -> ET.Element | None:
    return element.find(path)


def text_of(element: ET.Element | None) -> str:
    if element is None or element.text is None:
        return ""
    return " ".join(element.text.split())


def iter_entries(stream) -> list[bytes] | object:
    buffer = bytearray()
    start_tag = b"<entry"
    end_tag = b"</entry>"
    while True:
        chunk = stream.read(256 * 1024)
        if not chunk:
            break
        buffer.extend(chunk)
        while True:
            start = buffer.find(start_tag)
            if start < 0:
                if len(buffer) > 64:
                    del buffer[:-32]
                break
            if start > 0:
                del buffer[:start]
            end = buffer.find(end_tag)
            if end < 0:
                if len(buffer) > ENTRY_CAP:
                    del buffer[:1]
                break
            yield bytes(buffer[: end + len(end_tag)])
            del buffer[: end + len(end_tag)]


def winner_nifs(blob: bytes) -> list[str]:
    start = blob.find(b"WinningParty")
    if start < 0:
        return []
    found: list[str] = []
    for match in WINNER_ID_RE.finditer(blob, start):
        scheme = match.group(1).upper()
        raw = html.unescape(match.group(2).decode("utf-8", "replace"))
        if scheme in (b"NIF", b"CIF"):
            nif = normalize_nif(raw)
            if nif:
                found.append(nif)
            continue
        for nif in NIF_FIND.findall(raw.upper()):
            found.append(nif)
    return found


def index_party(blob: bytes) -> tuple[str, str, list[tuple[str, str]]]:
    """Nombre y DIR3 del órgano, y la cadena de unidades superiores.

    Se corta antes del proyecto para no confundir el título del contrato ni al
    adjudicatario con el órgano. Sirve para el catálogo; la ficha que se guarda
    sale del XML completo.
    """
    cut = blob.find(b"ProcurementProject")
    if cut < 0:
        cut = min(len(blob), 12000)
    text = html.unescape(blob[:cut].decode("utf-8", "replace"))
    parts = re.split(r"<[^>]*ParentLocatedParty[^>]*>", text)
    organ_name, organ_dir3 = _name_and_dir3(parts[0] if parts else "")
    parents: list[tuple[str, str]] = []
    for part in parts[1:]:
        name, code = _name_and_dir3(part)
        if name:
            parents.append((name, code))
        if len(parents) >= 8:
            break
    return organ_name, organ_dir3, parents


def _name_and_dir3(chunk: str) -> tuple[str, str]:
    names = NAME_TAG_RE.findall(chunk)
    codes = DIR3_RE.findall(chunk)
    name = " ".join(html.unescape(names[0]).split()) if names else ""
    code = " ".join(codes[0].upper().split()) if codes else ""
    if code and not re.fullmatch(r"[A-Z0-9]{8,14}", code):
        code = ""
    return name, code


class Catalog:
    def __init__(self) -> None:
        self.dir3: dict[tuple[str, str], list] = {}
        self.nombres: dict[str, list] = {}

    def observe(self, nombre: str, code: str, rol: str) -> None:
        name = clip(nombre, 300)
        folded = canon(name)
        if is_bucket(folded):
            return
        current = self.nombres.get(folded)
        if current is None:
            self.nombres[folded] = [name, 1, rol]
        else:
            current[1] += 1
            if rol == "organo":
                current[2] = "organo"
            if len(name) > len(current[0]):
                current[0] = name
        if not code:
            return
        key = (code, folded)
        stored = self.dir3.get(key)
        if stored is None:
            self.dir3[key] = [name, 1]
            return
        stored[1] += 1
        if len(name) > len(stored[0]):
            stored[0] = name

    def add_entry(self, blob: bytes) -> None:
        try:
            organ, code, parents = index_party(blob)
        except Exception:
            return
        if organ:
            self.observe(organ, code, "organo")
        for name, parent_code in parents:
            self.observe(name, parent_code, "padre")

    def load(self, connection: sqlite3.Connection) -> None:
        tables = {
            row[0]
            for row in connection.execute("SELECT name FROM sqlite_master WHERE type = 'table'")
        }
        if "placsp_dir3" not in tables:
            return
        for code, folded, name, count in connection.execute("SELECT dir3, canon, nombre, n FROM placsp_dir3"):
            self.dir3[(code, folded)] = [name, int(count)]
        for folded, name, count, rol in connection.execute("SELECT canon, nombre, n, rol FROM placsp_nombre"):
            self.nombres[folded] = [name, int(count), rol]

    def flush(self, connection: sqlite3.Connection) -> None:
        connection.execute("DELETE FROM placsp_dir3")
        connection.execute("DELETE FROM placsp_nombre")
        connection.executemany(
            "INSERT INTO placsp_dir3 (dir3, canon, nombre, n) VALUES (?,?,?,?)",
            ((code, folded, values[0], values[1]) for (code, folded), values in self.dir3.items()),
        )
        connection.executemany(
            "INSERT INTO placsp_nombre (canon, nombre, n, rol) VALUES (?,?,?,?)",
            ((folded, values[0], values[1], values[2]) for folded, values in self.nombres.items()),
        )


def notice_day(status: ET.Element, updated: str) -> tuple[str, str]:
    """Fecha de publicación cuando el anuncio no trae AwardDate.

    En las plataformas agregadas la adjudicación suele no llevar fecha. Se usa
    la publicación más reciente del anuncio, no el plazo de presentación.
    """
    published = [day for day in (parse_day(text_of(node)) for node in status.iter("IssueDate")) if day]
    if published:
        return max(published), "publicacion"
    fallback = parse_day((updated or "")[:10])
    if fallback:
        return fallback, "publicacion"
    return "", ""


def procedure_name(code: str, fuente: str) -> str:
    if code in PROCEDURES:
        return PROCEDURES[code]
    if fuente == "menores":
        return "Contrato menor"
    if code:
        return f"Procedimiento {code}"
    return "Procedimiento no indicado"


def parse_entry(blob: bytes, fuente: str) -> list[dict]:
    root = ET.fromstring(strip_namespaces(blob))
    status = root.find("ContractFolderStatus")
    if status is None:
        return []
    expediente = clip(text_of(status.find("ContractFolderID")), 180)
    entrada = clip(text_of(root.find("id")), 240)
    if expediente == "":
        expediente = entrada or clip(text_of(root.find("link")), 180)
    if expediente == "":
        return []
    updated = clip(text_of(root.find("updated")), 40)
    url = ""
    for link in root.findall("link"):
        href = link.attrib.get("href", "")
        if href and ("detalle_licitacion" in href or url == ""):
            url = href
    url = clip(html.unescape(url), 500)
    located = status.find("LocatedContractingParty")
    organo = ""
    dir3 = ""
    tipo = ""
    parents: list[str] = []
    parent_names: list[str] = []
    if located is not None:
        tipo = clip(text_of(located.find("ContractingPartyTypeCode")), 8)
        party = located.find("Party")
        if party is not None:
            organo = clip(text_of(local_tag(party, "PartyName/Name")), 300)
            for ident in party.findall("PartyIdentification/ID"):
                if ident.attrib.get("schemeName") == "DIR3" and dir3 == "":
                    dir3 = text_of(ident).upper()
        parent = located.find("ParentLocatedParty")
        while parent is not None and len(parents) < 8:
            parent_name = clip(text_of(local_tag(parent, "PartyName/Name")), 300)
            folded = canon(parent_name)
            if parent_name and not is_bucket(folded):
                parents.append(folded)
                parent_names.append(parent_name)
            parent = parent.find("ParentLocatedParty")
    project = status.find("ProcurementProject")
    titulo = clip(text_of(project.find("Name")) if project is not None else "", 240)
    if titulo == "":
        titulo = clip(text_of(root.find("title")), 240)
    procedure = ""
    for node in status.iter("ProcedureCode"):
        procedure = text_of(node)
        if procedure:
            break
    urgencies = [text_of(node) for node in status.iter("UrgencyCode")]
    emergencia = 1 if "3" in urgencies else 0
    menor = 1 if procedure == MENOR_CODE or fuente == "menores" else 0
    rows: list[dict] = []
    seen: set[tuple[str, str]] = set()
    for result in status.findall("TenderResult"):
        result_code = text_of(result.find("ResultCode"))
        if result_code not in AWARDED:
            continue
        day = parse_day(text_of(result.find("AwardDate")))
        fecha_tipo = "adjudicacion"
        if day == "":
            day, fecha_tipo = notice_day(status, updated)
        if day == "":
            continue
        lote = ""
        for ident in result.iter("ID"):
            scheme = (ident.attrib.get("schemeName") or "").upper()
            if "LOTE" in scheme:
                lote = clip(text_of(ident), 40)
                break
        amount = None
        for path in (
            "AwardedTenderedProject/LegalMonetaryTotal/TaxExclusiveAmount",
            "AwardedTenderedProject/LegalMonetaryTotal/PayableAmount",
        ):
            amount = parse_amount(text_of(result.find(path)))
            if amount is not None:
                break
        if amount is None and project is not None:
            amount = parse_amount(text_of(project.find("BudgetAmount/TaxExclusiveAmount")))
        sin_concurrencia = 0
        if menor or procedure in SIN_PUBLICIDAD or emergencia or result_code == "11":
            sin_concurrencia = 1
        for party in result.findall("WinningParty"):
            winner = clip(text_of(local_tag(party, "PartyName/Name")), 300)
            nifs: list[str] = []
            for ident in party.iter("ID"):
                scheme = ident.attrib.get("schemeName") or ""
                raw = text_of(ident)
                if scheme in ("NIF", "CIF"):
                    nif = normalize_nif(raw)
                    if nif:
                        nifs.append(nif)
                elif scheme == "UTE":
                    nifs.extend(NIF_FIND.findall(raw.upper()))
            for nif in nifs:
                key = (lote, nif)
                if key in seen:
                    continue
                seen.add(key)
                rows.append(
                    {
                        "expediente": expediente,
                        "lote": lote,
                        "nif": nif,
                        "adjudicatario": winner or nif,
                        "organo": organo,
                        "organo_canon": canon(organo),
                        "dir3": dir3,
                        "padres": "|".join(parents),
                        "tipo_poder": tipo,
                        "fecha": day,
                        "fecha_tipo": fecha_tipo,
                        "anio": int(day[:4]),
                        "importe": amount,
                        "procedimiento": procedure,
                        "procedimiento_nombre": procedure_name(procedure, fuente),
                        "menor": menor,
                        "sin_concurrencia": sin_concurrencia,
                        "emergencia": emergencia,
                        "titulo": titulo or "Contrato sin título",
                        "url": url,
                        "fuente": fuente,
                        "updated": updated,
                        "entrada_id": entrada,
                    }
                )
    return rows


def match_organismo(
    organismo: str,
    administracion: str,
    contract: dict,
    dir3_index: tuple[dict[str, set[str]], dict[str, set[str]]] | None = None,
) -> tuple[str, str, str] | None:
    """Devuelve nivel, vía y detalle, o None si no hay cruce de organismo.

    Niveles, de más fuerte a más débil: mismo_organo, organo_superior,
    misma_administracion. No usa contención libre de cadenas: un ayuntamiento
    no hereda el nombre de otro que solo lo empieza.
    """
    grant = canon(organismo)
    if is_bucket(grant):
        grant = ""
    party = contract.get("organo_canon") or ""
    parents = [item for item in (contract.get("padres") or "").split("|") if item and not is_bucket(item)]
    code = contract.get("dir3") or ""
    canon_codes: dict[str, set[str]] = {}
    code_canons: dict[str, set[str]] = {}
    if dir3_index:
        canon_codes, code_canons = dir3_index
    if grant and code and canon_codes.get(grant) == {code}:
        known = code_canons.get(code) or set()
        same_label = grant == party
        if grant in known and (same_label or shares_distinctive_token(grant, party)):
            return ("mismo_organo", "dir3", code)
    if grant and grant == party:
        return ("mismo_organo", "nombre", grant)
    organ_parents = [item for item in parents if len(item.split()) >= 2]
    if grant and grant in organ_parents:
        return ("organo_superior", "jerarquia", grant)
    grant_keys = admin_keys([organismo, administracion])
    contract_keys = admin_keys([party, *parents])
    shared = grant_keys & contract_keys
    ministries = sorted(key for key in shared if key.startswith("min:"))
    if ministries:
        return ("organo_superior", "ministerio", ministries[0])
    councils = sorted(key for key in shared if key.startswith("cons:"))
    if councils:
        return ("organo_superior", "consejeria", councils[0])
    local_shared = sorted(
        key for key in shared if key.startswith("ayto:") or key.startswith("dip:") or key.startswith("insular:")
    )
    local_words = ("AYUNTAMIENTO", "DIPUTACION", "CABILDO", "CONSELL")
    contract_tokens = set(" ".join([party, *parents]).split())
    if local_shared and any(word in grant.split() for word in local_words) and any(word in contract_tokens for word in local_words):
        return ("mismo_organo", "local", local_shared[0])
    admins = sorted(
        key
        for key in shared
        if key.startswith("ayto:") or key.startswith("dip:") or key.startswith("insular:") or key.startswith("ccaa:") or key.startswith("comarca:")
    )
    if admins:
        return ("misma_administracion", "administracion", admins[0])
    return None


def should_emit(nivel: str, menor: int, sin_concurrencia: int) -> bool:
    if nivel in ("mismo_organo", "organo_superior"):
        return True
    if nivel == "misma_administracion" and (menor or sin_concurrencia):
        return True
    return False


def clasificar_umbral(importe: float | None) -> tuple[str, float] | None:
    """Banda 90-100 % del contrato menor, sin llegar al tope.

    Un importe no puede caer en las dos bandas: la de servicios acaba en
    15.000 € y la de obras empieza en 36.000 €.
    """
    if importe is None:
        return None
    if SERVICIO_UMBRAL * UMBRAL_RATIO <= importe < SERVICIO_UMBRAL:
        return ("servicios", SERVICIO_UMBRAL)
    if OBRA_UMBRAL * UMBRAL_RATIO <= importe < OBRA_UMBRAL:
        return ("obra", OBRA_UMBRAL)
    return None


def puntuacion_umbral(n: int, n_identico: int, proximidad: float) -> float:
    """0-100. Volumen, cuota del importe repetido y cercanía al tope."""
    if n <= 0:
        return 0.0
    volumen = min(45.0, 18.0 * math.log10(n))
    identico = 35.0 * (n_identico / n)
    cerca = max(0.0, (proximidad - UMBRAL_RATIO) / (1.0 - UMBRAL_RATIO)) * 20.0
    return round(min(100.0, volumen + identico + cerca), 1)


def _table_columns(connection: sqlite3.Connection, table: str) -> set[str]:
    return {row[1] for row in connection.execute(f"PRAGMA table_info({table})")}


def ensure_umbral_schema(connection: sqlite3.Connection) -> None:
    if not _table_columns(connection, "alert_contrato"):
        raise SystemExit(
            "No está alert_contrato. Hace falta un cruce previo (python3 pipeline/contratos.py) "
            "o al menos las tablas ya guardadas."
        )
    columns = _table_columns(connection, "alert_contrato")
    if "puntuacion" not in columns:
        connection.execute("ALTER TABLE alert_contrato ADD COLUMN puntuacion REAL NOT NULL DEFAULT 0")
    if "n_contratos" not in columns:
        connection.execute("ALTER TABLE alert_contrato ADD COLUMN n_contratos INTEGER NOT NULL DEFAULT 0")
    if "umbral" not in columns:
        connection.execute("ALTER TABLE alert_contrato ADD COLUMN umbral REAL")
    if "umbral_codigo" not in columns:
        connection.execute("ALTER TABLE alert_contrato ADD COLUMN umbral_codigo TEXT NOT NULL DEFAULT ''")
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS alert_contrato_pieza (
          alert_id INTEGER NOT NULL,
          expediente TEXT NOT NULL,
          lote TEXT NOT NULL,
          fecha TEXT NOT NULL,
          importe REAL,
          titulo TEXT NOT NULL,
          url TEXT NOT NULL,
          organo TEXT NOT NULL
        )
        """
    )
    connection.execute(
        "CREATE INDEX IF NOT EXISTS idx_alert_contrato_pieza ON alert_contrato_pieza(alert_id)"
    )


def motivo_umbral(row: dict) -> str:
    if row["banda"] == "obra":
        banda = "obras"
    else:
        banda = "servicios y suministros"
    return (
        "Indicador, no una prueba de incumplimiento. "
        f"{row['nombre']} ({row['nif']}) acumula {row['n']} contratos menores de {row['organo']} "
        f"con importe sin IVA entre el 90 % y el 100 % del umbral de {banda} ({euros(row['umbral'])}). "
        f"El importe que más se repite es {euros(row['modal'])}, en {row['n_identico']} anuncios. "
        f"La media de estos importes es el {row['proximidad'] * 100:.1f} % del umbral. "
        f"Puntuación {row['puntuacion']:.0f} de 100: volumen, repetición del mismo importe y cercanía al tope. "
        "Un contrato menor por debajo del umbral puede ser legal; la señal es la repetición justo debajo, no un anuncio suelto."
    )


def build_menor_umbral(connection: sqlite3.Connection) -> int:
    """Contratos menores repetidos justo bajo el umbral, mismo órgano y mismo NIF.

    No descarga nada: agrupa placsp_contrato. Una pasada filtra la banda y otra
    recoge una muestra de anuncios. No carga la tabla entera en memoria.
    """
    log("Contratos menores repetidos bajo el umbral")
    ensure_umbral_schema(connection)
    connection.execute("DELETE FROM alert_contrato_pieza WHERE alert_id IN (SELECT id FROM alert_contrato WHERE nivel = 'menor_umbral')")
    connection.execute("DELETE FROM alert_contrato_item WHERE alert_id IN (SELECT id FROM alert_contrato WHERE nivel = 'menor_umbral')")
    connection.execute("DELETE FROM alert_contrato WHERE nivel = 'menor_umbral'")
    low_servicio = SERVICIO_UMBRAL * UMBRAL_RATIO
    low_obra = OBRA_UMBRAL * UMBRAL_RATIO
    connection.execute("DROP TABLE IF EXISTS menor_grupo")
    connection.execute(
        """
        CREATE TEMP TABLE menor_grupo AS
        SELECT
          organo_canon,
          nif,
          CASE
            WHEN importe >= ? AND importe < ? THEN 'obra'
            ELSE 'servicios'
          END AS banda,
          ROUND(importe, 2) AS cents,
          COUNT(*) AS n,
          SUM(importe) AS suma,
          MIN(fecha) AS fecha_min,
          MAX(fecha) AS fecha_max,
          MAX(anio) AS anio,
          MAX(organo) AS organo,
          MAX(adjudicatario) AS adjudicatario
        FROM placsp_contrato
        WHERE menor = 1
          AND importe IS NOT NULL
          AND (
            (importe >= ? AND importe < ?)
            OR (importe >= ? AND importe < ?)
          )
          AND organo_canon != ''
          AND nif != ''
        GROUP BY organo_canon, nif, banda, cents
        """,
        (low_obra, OBRA_UMBRAL, low_servicio, SERVICIO_UMBRAL, low_obra, OBRA_UMBRAL),
    )
    wanted: dict[tuple[str, str, str], dict] = {}
    current_key: tuple[str, str, str] | None = None
    acc: dict | None = None

    def flush_group() -> None:
        if acc is None or current_key is None:
            return
        if acc["n"] < MIN_MENORES_UMBRAL:
            return
        umbral = OBRA_UMBRAL if acc["banda"] == "obra" else SERVICIO_UMBRAL
        proximidad = acc["suma"] / acc["n"] / umbral
        payload = {
            "organo_canon": acc["organo_canon"],
            "nif": acc["nif"],
            "banda": acc["banda"],
            "n": acc["n"],
            "suma": acc["suma"],
            "n_identico": acc["n_identico"],
            "fecha_min": acc["fecha_min"],
            "fecha_max": acc["fecha_max"],
            "anio": acc["anio"],
            "organo": acc["organo"],
            "nombre": acc["nombre"],
            "modal": acc["modal"],
            "umbral": umbral,
            "proximidad": proximidad,
            "puntuacion": puntuacion_umbral(acc["n"], acc["n_identico"], proximidad),
            "beneficiario_id": None,
            "ccaa": "No determinada",
        }
        payload["motivo"] = motivo_umbral(payload)
        wanted[current_key] = payload

    for row in connection.execute(
        """
        SELECT organo_canon, nif, banda, cents, n, suma, fecha_min, fecha_max, anio, organo, adjudicatario
        FROM menor_grupo
        ORDER BY organo_canon, nif, banda
        """
    ):
        organo_canon, nif, banda, cents, n, suma, fecha_min, fecha_max, anio, organo, adjudicatario = row
        key = (organo_canon, nif, banda)
        if key != current_key:
            flush_group()
            current_key = key
            acc = {
                "organo_canon": organo_canon,
                "nif": nif,
                "banda": banda,
                "n": 0,
                "suma": 0.0,
                "n_identico": 0,
                "modal": float(cents),
                "fecha_min": fecha_min or "",
                "fecha_max": fecha_max or "",
                "anio": int(anio or 0),
                "organo": organo or "Órgano no indicado",
                "nombre": adjudicatario or nif,
            }
        assert acc is not None
        count = int(n)
        acc["n"] += count
        acc["suma"] += float(suma)
        if count > acc["n_identico"] or (count == acc["n_identico"] and float(cents) < acc["modal"]):
            acc["n_identico"] = count
            acc["modal"] = float(cents)
        if fecha_min and (not acc["fecha_min"] or fecha_min < acc["fecha_min"]):
            acc["fecha_min"] = fecha_min
        if fecha_max and fecha_max > acc["fecha_max"]:
            acc["fecha_max"] = fecha_max
            acc["anio"] = int(anio or acc["anio"])
        if organo:
            acc["organo"] = organo
        if adjudicatario:
            acc["nombre"] = adjudicatario
    flush_group()
    log(f"Pares órgano + NIF en la banda: {len(wanted)}")
    if not wanted:
        connection.execute("DROP TABLE IF EXISTS menor_grupo")
        connection.commit()
        return 0
    by_nif: dict[str, list[dict]] = {}
    for payload in wanted.values():
        by_nif.setdefault(payload["nif"], []).append(payload)
    connection.execute("CREATE TEMP TABLE umbral_nif (nif TEXT PRIMARY KEY)")
    connection.executemany("INSERT INTO umbral_nif (nif) VALUES (?)", [(nif,) for nif in by_nif])
    if _table_exists(connection, "beneficiarios"):
        for nif, beneficiario_id, nombre in connection.execute(
            """
            SELECT b.nif, b.id, b.nombre
            FROM beneficiarios b
            JOIN umbral_nif u ON u.nif = b.nif
            """
        ):
            for payload in by_nif.get(nif, []):
                payload["beneficiario_id"] = beneficiario_id
                if nombre:
                    payload["nombre"] = nombre
                    payload["motivo"] = motivo_umbral(payload)
    if _table_exists(connection, "lut_organismo"):
        ccaa_por_canon: dict[str, tuple[int, str]] = {}
        for organismo_norm, ccaa, n in connection.execute(
            """
            SELECT o.organismo_norm, ca.nombre, COUNT(*)
            FROM concesion c
            JOIN lut_organismo o ON o.id = c.organismo_id
            JOIN lut_ccaa ca ON ca.id = c.ccaa_id
            GROUP BY o.organismo_norm, ca.nombre
            """
        ):
            key = canon(organismo_norm or "")
            if not key:
                continue
            current = ccaa_por_canon.get(key)
            if current is None or int(n) > current[0]:
                ccaa_por_canon[key] = (int(n), ccaa or "No determinada")
        for payload in wanted.values():
            found = ccaa_por_canon.get(payload["organo_canon"])
            if found:
                payload["ccaa"] = found[1]
    samples: dict[tuple[str, str, str], list[tuple]] = {key: [] for key in wanted}
    cursor = connection.execute(
        """
        SELECT organo_canon, nif, importe, expediente, lote, fecha, titulo, url, organo
        FROM placsp_contrato
        WHERE menor = 1
          AND importe IS NOT NULL
          AND (
            (importe >= ? AND importe < ?)
            OR (importe >= ? AND importe < ?)
          )
        ORDER BY organo_canon, nif, fecha
        """,
        (low_servicio, SERVICIO_UMBRAL, low_obra, OBRA_UMBRAL),
    )
    for organo_canon, nif, importe, expediente, lote, fecha, titulo, url, organo in cursor:
        classified = clasificar_umbral(float(importe))
        if classified is None:
            continue
        key = (organo_canon, nif, classified[0])
        bucket = samples.get(key)
        if bucket is None or len(bucket) >= 12:
            continue
        bucket.append((expediente or "", lote or "", fecha or "", float(importe), titulo or "", url or "", organo or ""))
    next_id = connection.execute("SELECT COALESCE(MAX(id), 0) FROM alert_contrato").fetchone()[0] + 1
    alerts: list[tuple] = []
    piezas: list[tuple] = []
    for key, payload in wanted.items():
        alert_id = next_id
        next_id += 1
        codigo = "obra" if payload["banda"] == "obra" else "servicios"
        alerts.append(
            (
                alert_id,
                "menor_umbral",
                codigo,
                f"{payload['n_identico']}×{payload['modal']:.2f}",
                payload["motivo"],
                payload["nif"],
                payload["beneficiario_id"],
                payload["nombre"],
                payload["organo"],
                fold(payload["organo"]),
                payload["ccaa"],
                payload["anio"],
                0,
                1,
                1,
                0,
                "6",
                "Contrato menor",
                "",
                "",
                payload["fecha_max"],
                payload["modal"],
                payload["organo"],
                "",
                f"{payload['n']} contratos menores entre {payload['fecha_min']} y {payload['fecha_max']}",
                "",
                "menores",
                0,
                payload["suma"],
                payload["fecha_min"],
                payload["fecha_max"],
                payload["puntuacion"],
                payload["n"],
                payload["umbral"],
                codigo,
            )
        )
        for pieza in samples.get(key, []):
            piezas.append((alert_id, *pieza))
    connection.executemany(
        """
        INSERT INTO alert_contrato (
          id, nivel, via, detalle, motivo, nif, beneficiario_id, nombre, organismo, organismo_norm,
          ccaa, anio, dias, menor, sin_concurrencia, emergencia, procedimiento, procedimiento_nombre,
          expediente, lote, fecha_contrato, importe_contrato, organo_contrato, dir3, titulo_contrato,
          url, fuente, n_concesiones, importe_concesiones, fecha_concesion_min, fecha_concesion_max,
          puntuacion, n_contratos, umbral, umbral_codigo
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        """,
        alerts,
    )
    connection.executemany(
        """
        INSERT INTO alert_contrato_pieza (
          alert_id, expediente, lote, fecha, importe, titulo, url, organo
        ) VALUES (?,?,?,?,?,?,?,?)
        """,
        piezas,
    )
    connection.execute("DROP TABLE IF EXISTS menor_grupo")
    connection.commit()
    log(f"Menores bajo el umbral: {len(alerts)} indicadores")
    return len(alerts)


def _table_exists(connection: sqlite3.Connection, name: str) -> bool:
    row = connection.execute(
        "SELECT 1 FROM sqlite_master WHERE type IN ('table', 'view') AND name = ?",
        (name,),
    ).fetchone()
    return row is not None


def via_texto(via: str, detalle: str) -> str:
    if via == "dir3":
        return (
            f"El nombre del organismo en la BDNS apunta a un único código DIR3 ({detalle}), el de este anuncio, "
            "y los dos rótulos comparten una palabra que no es genérica."
        )
    if via == "nombre":
        return "El nombre normalizado del organismo que concede y el del órgano de contratación coinciden."
    if via == "local":
        return (
            "El organismo de la ayuda y el órgano del contrato son el mismo ente local "
            f"({detalle}): el anuncio puede nombrarlo como ayuntamiento, junta de gobierno o diputación."
        )
    if via == "jerarquia":
        return "Ese organismo figura como unidad superior del órgano de contratación en la jerarquía que publica el anuncio."
    if via == "ministerio":
        return "Los dos nombres corresponden al mismo ministerio tras unificar renombres habituales de 2018-2022 (por ejemplo Hacienda y Función Pública con Hacienda)."
    if via == "consejeria":
        return "La consejería o el departamento coinciden dentro de la misma comunidad, tras unificar un renombre habitual del título."
    if via == "administracion":
        return f"No coincide el órgano concreto. Sí coincide la administración ({detalle})."
    return "Hay un cruce de organismo por el método descrito en la documentación."


def build_motivo(alert: dict) -> str:
    pieces = [
        "Indicador, no una prueba de incumplimiento.",
        (
            f"{alert['nombre']} ({alert['nif']}) tiene {alert['n_concesiones']} concesiones de {alert['organismo']} "
            f"entre el {fecha_es(alert['fecha_concesion_min'])} y el {fecha_es(alert['fecha_concesion_max'])} "
            f"({euros(alert['importe_concesiones'])})."
        ),
        (
            f"El {fecha_es(alert['fecha_contrato'])} «{alert['organo_contrato']}» le adjudicó "
            f"«{alert['titulo_contrato']}» ({alert['procedimiento_nombre']}, {euros(alert['importe_contrato'])}, "
            f"expediente {alert['expediente']})."
        ),
        via_texto(alert["via"], alert["detalle"]),
    ]
    if alert.get("fecha_tipo") == "publicacion":
        pieces.append(
            "Esa fecha es la de publicación del anuncio: este canal no trae la fecha de adjudicación."
        )
    if alert["menor"]:
        pieces.append("El anuncio está clasificado como contrato menor.")
    elif alert["emergencia"]:
        pieces.append("La tramitación publicada es de emergencia.")
    elif alert["sin_concurrencia"]:
        pieces.append(f"El procedimiento publicado es «{alert['procedimiento_nombre']}», sin convocatoria abierta.")
    pieces.append(
        f"La adjudicación queda a {alert['dias']} días de una de esas concesiones (la ventana usada es de {WINDOW_DAYS} días)."
    )
    return " ".join(pieces)


def connect() -> sqlite3.Connection:
    if not DB_PATH.exists():
        raise SystemExit(f"No está el índice {DB_PATH}. Ejecuta antes python3 pipeline/build_index.py.")
    connection = sqlite3.connect(DB_PATH)
    connection.execute("PRAGMA busy_timeout = 8000")
    connection.execute("PRAGMA cache_size = -32768")
    connection.execute("PRAGMA mmap_size = 0")
    connection.execute("PRAGMA temp_store = FILE")
    connection.execute("PRAGMA synchronous = OFF")
    return connection


def ensure_schema(connection: sqlite3.Connection) -> None:
    connection.executescript(
        """
        CREATE TABLE IF NOT EXISTS placsp_contrato (
          expediente TEXT NOT NULL,
          lote TEXT NOT NULL,
          nif TEXT NOT NULL,
          adjudicatario TEXT NOT NULL,
          organo TEXT NOT NULL,
          organo_canon TEXT NOT NULL,
          dir3 TEXT NOT NULL,
          padres TEXT NOT NULL,
          tipo_poder TEXT NOT NULL,
          fecha TEXT NOT NULL,
          anio INTEGER NOT NULL,
          importe REAL,
          procedimiento TEXT NOT NULL,
          procedimiento_nombre TEXT NOT NULL,
          menor INTEGER NOT NULL,
          sin_concurrencia INTEGER NOT NULL,
          emergencia INTEGER NOT NULL,
          titulo TEXT NOT NULL,
          url TEXT NOT NULL,
          fuente TEXT NOT NULL,
          updated TEXT NOT NULL,
          entrada_id TEXT NOT NULL,
          fecha_tipo TEXT NOT NULL DEFAULT 'adjudicacion',
          PRIMARY KEY (expediente, lote, nif, fuente)
        );
        CREATE TABLE IF NOT EXISTS placsp_dir3 (
          dir3 TEXT NOT NULL,
          canon TEXT NOT NULL,
          nombre TEXT NOT NULL,
          n INTEGER NOT NULL,
          PRIMARY KEY (dir3, canon)
        );
        CREATE TABLE IF NOT EXISTS placsp_nombre (
          canon TEXT PRIMARY KEY,
          nombre TEXT NOT NULL,
          n INTEGER NOT NULL,
          rol TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS placsp_zip (
          fuente TEXT NOT NULL,
          anio INTEGER NOT NULL,
          entradas INTEGER NOT NULL,
          guardados INTEGER NOT NULL,
          bytes INTEGER NOT NULL,
          PRIMARY KEY (fuente, anio)
        );
        CREATE TABLE IF NOT EXISTS placsp_meta (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
        """
    )


def migrate_contracts(connection: sqlite3.Connection) -> None:
    row = connection.execute(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'placsp_contrato'"
    ).fetchone()
    if row is None:
        return
    ddl = row[0] or ""
    if "fecha_tipo" in ddl and "nif, fuente" in ddl:
        return
    log("Separando los contratos por canal y guardando el tipo de fecha")
    connection.executescript(
        """
        CREATE TABLE placsp_contrato_new (
          expediente TEXT NOT NULL,
          lote TEXT NOT NULL,
          nif TEXT NOT NULL,
          adjudicatario TEXT NOT NULL,
          organo TEXT NOT NULL,
          organo_canon TEXT NOT NULL,
          dir3 TEXT NOT NULL,
          padres TEXT NOT NULL,
          tipo_poder TEXT NOT NULL,
          fecha TEXT NOT NULL,
          anio INTEGER NOT NULL,
          importe REAL,
          procedimiento TEXT NOT NULL,
          procedimiento_nombre TEXT NOT NULL,
          menor INTEGER NOT NULL,
          sin_concurrencia INTEGER NOT NULL,
          emergencia INTEGER NOT NULL,
          titulo TEXT NOT NULL,
          url TEXT NOT NULL,
          fuente TEXT NOT NULL,
          updated TEXT NOT NULL,
          entrada_id TEXT NOT NULL,
          fecha_tipo TEXT NOT NULL DEFAULT 'adjudicacion',
          PRIMARY KEY (expediente, lote, nif, fuente)
        );
        INSERT INTO placsp_contrato_new (
          expediente, lote, nif, adjudicatario, organo, organo_canon, dir3, padres, tipo_poder,
          fecha, anio, importe, procedimiento, procedimiento_nombre, menor, sin_concurrencia,
          emergencia, titulo, url, fuente, updated, entrada_id, fecha_tipo
        )
        SELECT
          expediente, lote, nif, adjudicatario, organo, organo_canon, dir3, padres, tipo_poder,
          fecha, anio, importe, procedimiento, procedimiento_nombre, menor, sin_concurrencia,
          emergencia, titulo, url, fuente, updated, entrada_id, 'adjudicacion'
        FROM placsp_contrato;
        DROP TABLE placsp_contrato;
        ALTER TABLE placsp_contrato_new RENAME TO placsp_contrato;
        """
    )


def drop_placsp(connection: sqlite3.Connection) -> None:
    connection.executescript(
        """
        DROP TABLE IF EXISTS placsp_contrato;
        DROP TABLE IF EXISTS placsp_dir3;
        DROP TABLE IF EXISTS placsp_nombre;
        DROP TABLE IF EXISTS placsp_zip;
        DROP TABLE IF EXISTS alert_contrato_pieza;
        DROP TABLE IF EXISTS alert_contrato_item;
        DROP TABLE IF EXISTS alert_contrato;
        """
    )
    ensure_schema(connection)


def remote_size(url: str) -> int | None:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=60) as response:
        etag = response.headers.get("ETag") or ""
        response.close()
    if not etag.startswith('"'):
        return None
    hex_size = etag.split('"')[1].split("-")[0]
    try:
        return int(hex_size, 16)
    except ValueError:
        return None


def download(url: str, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    expected = None
    try:
        expected = remote_size(url)
    except Exception as error:
        log(f"No pude leer el tamaño de {url}: {error}")
    if destination.exists() and expected and destination.stat().st_size == expected:
        log(f"Reutilizo {destination.name} ({expected // 1_000_000} MB)")
        return
    if destination.exists() and expected and destination.stat().st_size > expected:
        destination.unlink()
    log(f"Descargando {url}")
    tmp = destination.with_suffix(destination.suffix + ".part")
    if tmp.exists() and (expected is None or tmp.stat().st_size < expected):
        pass
    else:
        if tmp.exists():
            tmp.unlink()
    offset = tmp.stat().st_size if tmp.exists() else 0
    headers = {"User-Agent": USER_AGENT}
    if offset:
        headers["Range"] = f"bytes={offset}-"
    request = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(request, timeout=120) as response, tmp.open("ab" if offset else "wb") as handle:
        status = getattr(response, "status", 200)
        if offset and status == 200:
            handle.seek(0)
            handle.truncate()
        while True:
            chunk = response.read(1024 * 256)
            if not chunk:
                break
            handle.write(chunk)
    tmp.replace(destination)
    if expected and destination.stat().st_size != expected:
        log(f"Aviso: {destination.name} pesa {destination.stat().st_size} y el anuncio decía {expected}")


def load_nifs(connection: sqlite3.Connection) -> set[str]:
    log("Cargando NIF de beneficiarios")
    found = {
        row[0]
        for row in connection.execute("SELECT nif FROM beneficiarios WHERE nif != ''")
        if row[0]
    }
    log(f"{len(found)} NIF en el índice")
    return found


def insert_contracts(connection: sqlite3.Connection, rows: list[dict]) -> None:
    connection.executemany(
        """
        INSERT INTO placsp_contrato (
          expediente, lote, nif, adjudicatario, organo, organo_canon, dir3, padres, tipo_poder,
          fecha, anio, importe, procedimiento, procedimiento_nombre, menor, sin_concurrencia,
          emergencia, titulo, url, fuente, updated, entrada_id, fecha_tipo
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(expediente, lote, nif, fuente) DO UPDATE SET
          adjudicatario = excluded.adjudicatario,
          organo = excluded.organo,
          organo_canon = excluded.organo_canon,
          dir3 = excluded.dir3,
          padres = excluded.padres,
          tipo_poder = excluded.tipo_poder,
          fecha = excluded.fecha,
          anio = excluded.anio,
          importe = excluded.importe,
          procedimiento = excluded.procedimiento,
          procedimiento_nombre = excluded.procedimiento_nombre,
          menor = excluded.menor,
          sin_concurrencia = excluded.sin_concurrencia,
          emergencia = excluded.emergencia,
          titulo = excluded.titulo,
          url = excluded.url,
          fuente = excluded.fuente,
          updated = excluded.updated,
          entrada_id = excluded.entrada_id,
          fecha_tipo = excluded.fecha_tipo
        WHERE excluded.updated >= placsp_contrato.updated
          AND NOT (
            placsp_contrato.fecha_tipo = 'adjudicacion' AND excluded.fecha_tipo = 'publicacion'
          )
        """,
        [
            (
                row["expediente"],
                row["lote"],
                row["nif"],
                row["adjudicatario"],
                row["organo"],
                row["organo_canon"],
                row["dir3"],
                row["padres"],
                row["tipo_poder"],
                row["fecha"],
                row["anio"],
                row["importe"],
                row["procedimiento"],
                row["procedimiento_nombre"],
                row["menor"],
                row["sin_concurrencia"],
                row["emergencia"],
                row["titulo"],
                row["url"],
                row["fuente"],
                row["updated"],
                row["entrada_id"],
                row.get("fecha_tipo") or "adjudicacion",
            )
            for row in rows
        ],
    )


def process_zip(
    connection: sqlite3.Connection,
    path: Path,
    fuente: str,
    year: int,
    nifs: set[str],
    catalog: Catalog,
) -> None:
    entries = 0
    kept = 0
    errors = 0
    batch: list[dict] = []
    started = time.time()
    with zipfile.ZipFile(path) as archive:
        names = [name for name in archive.namelist() if name.lower().endswith(".atom") and not name.endswith("/")]
        log(f"{path.name}: {len(names)} ficheros ATOM")
        for name in names:
            with archive.open(name) as handle:
                for blob in iter_entries(handle):
                    entries += 1
                    if b"ContractFolderStatus" not in blob:
                        continue
                    catalog.add_entry(blob)
                    nifs_found = winner_nifs(blob)
                    if not any(nif in nifs for nif in nifs_found):
                        continue
                    try:
                        parsed = parse_entry(blob, fuente)
                    except Exception:
                        errors += 1
                        continue
                    for row in parsed:
                        if row["nif"] not in nifs:
                            continue
                        if row["anio"] < YEAR_MIN or row["anio"] > YEAR_MAX:
                            continue
                        batch.append(row)
                        kept += 1
                    if len(batch) >= 400:
                        insert_contracts(connection, batch)
                        batch.clear()
                    if entries % 200000 == 0:
                        log(f"  {entries} anuncios, {kept} adjudicaciones de beneficiarios")
    if batch:
        insert_contracts(connection, batch)
    connection.execute(
        """
        INSERT INTO placsp_zip (fuente, anio, entradas, guardados, bytes)
        VALUES (?,?,?,?,?)
        ON CONFLICT(fuente, anio) DO UPDATE SET
          entradas = excluded.entradas,
          guardados = excluded.guardados,
          bytes = excluded.bytes
        """,
        (fuente, year, entries, kept, path.stat().st_size),
    )
    catalog.flush(connection)
    connection.commit()
    log(
        f"{fuente} {year}: {entries} anuncios, {kept} filas de beneficiarios, {errors} XML no leídos, "
        f"{time.time() - started:.0f} s"
    )


def ingest(connection: sqlite3.Connection, years: list[int], feeds: list[str], keep_raw: bool) -> None:
    ensure_schema(connection)
    migrate_contracts(connection)
    done = {(row[0], row[1]) for row in connection.execute("SELECT fuente, anio FROM placsp_zip")}
    nifs = load_nifs(connection)
    catalog = Catalog()
    catalog.load(connection)
    for fuente, template in FEEDS:
        if fuente not in feeds:
            continue
        for year in years:
            if (fuente, year) in done:
                log(f"Ya estaba {fuente} {year}")
                continue
            url = template.format(year=year)
            destination = RAW_DIR / Path(url).name
            download(url, destination)
            process_zip(connection, destination, fuente, year, nifs, catalog)
            if not keep_raw:
                destination.unlink(missing_ok=True)
                log(f"Borrado {destination.name}")


GENERIC_TOKENS = {
    "MINISTERIO",
    "DIRECCION",
    "GENERAL",
    "SECRETARIA",
    "SUBSECRETARIA",
    "INSTITUTO",
    "NACIONAL",
    "AYUNTAMIENTO",
    "CONSEJERIA",
    "DEPARTAMENTO",
    "SERVICIO",
    "PUBLICO",
    "PUBLICA",
    "ESTADO",
    "ESPANA",
    "ADMINISTRACION",
    "DELEGACION",
    "PRESIDENCIA",
    "JUNTA",
    "GOBIERNO",
    "CONCEJALIA",
    "ALCALDIA",
    "ORGANISMO",
    "AUTONOMO",
    "AGENCIA",
    "ESTATAL",
}


def distinctive_tokens(name: str) -> set[str]:
    return {token for token in name.split() if len(token) >= 5 and token not in GENERIC_TOKENS}


def shares_distinctive_token(left: str, right: str) -> bool:
    return bool(distinctive_tokens(left) & distinctive_tokens(right))


def load_dir3_index(connection: sqlite3.Connection) -> tuple[dict[str, set[str]], dict[str, set[str]]]:
    """Nombre → códigos, y código → nombres.

    Un código que la PLACSP reutiliza en órganos distintos no sirve para
    identificar. Solo se usa si el nombre de la ayuda apunta a un único código
    y, cuando el rótulo del contrato es otro, ambos comparten una palabra propia.
    """
    canon_codes: dict[str, set[str]] = {}
    code_canons: dict[str, set[str]] = {}
    for code, folded in connection.execute("SELECT dir3, canon FROM placsp_dir3"):
        canon_codes.setdefault(folded, set()).add(code)
        code_canons.setdefault(code, set()).add(folded)
    return canon_codes, code_canons


def rebuild_alerts(connection: sqlite3.Connection) -> None:
    log("Calculando indicadores de cruce")
    ensure_schema(connection)
    migrate_contracts(connection)
    connection.executescript(
        """
        DROP TABLE IF EXISTS alert_contrato_pieza;
        DROP TABLE IF EXISTS alert_contrato_item;
        DROP TABLE IF EXISTS alert_contrato;
        CREATE TABLE alert_contrato (
          id INTEGER PRIMARY KEY,
          nivel TEXT NOT NULL,
          via TEXT NOT NULL,
          detalle TEXT NOT NULL,
          motivo TEXT NOT NULL,
          nif TEXT NOT NULL,
          beneficiario_id INTEGER,
          nombre TEXT NOT NULL,
          organismo TEXT NOT NULL,
          organismo_norm TEXT NOT NULL,
          ccaa TEXT NOT NULL,
          anio INTEGER NOT NULL,
          dias INTEGER NOT NULL,
          menor INTEGER NOT NULL,
          sin_concurrencia INTEGER NOT NULL,
          emergencia INTEGER NOT NULL,
          procedimiento TEXT NOT NULL,
          procedimiento_nombre TEXT NOT NULL,
          expediente TEXT NOT NULL,
          lote TEXT NOT NULL,
          fecha_contrato TEXT NOT NULL,
          importe_contrato REAL,
          organo_contrato TEXT NOT NULL,
          dir3 TEXT NOT NULL,
          titulo_contrato TEXT NOT NULL,
          url TEXT NOT NULL,
          fuente TEXT NOT NULL,
          n_concesiones INTEGER NOT NULL,
          importe_concesiones REAL NOT NULL,
          fecha_concesion_min TEXT NOT NULL,
          fecha_concesion_max TEXT NOT NULL,
          puntuacion REAL NOT NULL DEFAULT 0,
          n_contratos INTEGER NOT NULL DEFAULT 0,
          umbral REAL,
          umbral_codigo TEXT NOT NULL DEFAULT ''
        );
        CREATE TABLE alert_contrato_item (
          alert_id INTEGER NOT NULL,
          concesion_id INTEGER NOT NULL,
          fecha TEXT NOT NULL,
          importe REAL NOT NULL,
          codigo_bdns TEXT,
          titulo TEXT,
          instrumento TEXT
        );
        """
    )
    dir3_index = load_dir3_index(connection)
    clean_codes = sum(1 for codes in dir3_index[0].values() if len(codes) == 1)
    log(f"Nombres con un solo DIR3: {clean_codes}")
    cursor = connection.execute(
        """
        SELECT expediente, lote, nif, adjudicatario, organo, organo_canon, dir3, padres, tipo_poder,
               fecha, anio, importe, procedimiento, procedimiento_nombre, menor, sin_concurrencia,
               emergencia, titulo, url, fuente, fecha_tipo
        FROM placsp_contrato
        ORDER BY nif, fecha
        """
    )
    alerts: list[tuple] = []
    items: list[tuple] = []
    next_id = 1
    current_nif = None
    grants: list[tuple] = []
    guarantees: list[tuple] = []
    contracts = 0

    def flush() -> None:
        if not alerts:
            return
        connection.executemany(
            """
            INSERT INTO alert_contrato (
              id, nivel, via, detalle, motivo, nif, beneficiario_id, nombre, organismo, organismo_norm,
              ccaa, anio, dias, menor, sin_concurrencia, emergencia, procedimiento, procedimiento_nombre,
              expediente, lote, fecha_contrato, importe_contrato, organo_contrato, dir3, titulo_contrato,
              url, fuente, n_concesiones, importe_concesiones, fecha_concesion_min, fecha_concesion_max
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """,
            alerts,
        )
        connection.executemany(
            """
            INSERT INTO alert_contrato_item (
              alert_id, concesion_id, fecha, importe, codigo_bdns, titulo, instrumento
            ) VALUES (?,?,?,?,?,?,?)
            """,
            items,
        )
        alerts.clear()
        items.clear()

    def load_grants(nif: str) -> tuple[list[tuple], list[tuple]]:
        rows = connection.execute(
            """
            SELECT id, fecha, importe, organismo, organismo_norm, administracion, ccaa, titulo,
                   codigo_bdns, beneficiario_id, beneficiario_nombre, instrumento, instrumento_slug
            FROM concesiones
            WHERE ben_key = ? AND fecha IS NOT NULL AND organismo_norm != ''
            """,
            (f"N:{nif}",),
        ).fetchall()
        cash = [row for row in rows if row[12] == "subvencion"]
        guarantees = [row for row in rows if row[12] == "garantia"]
        return cash, guarantees

    def emit(contract: tuple, group: list[tuple], match: tuple[str, str, str], guarantees: list[tuple]) -> None:
        nonlocal next_id
        nivel, via, detalle = match
        dates = [row[1] for row in group]
        distances = [days_between(contract[9], row[1]) for row in group]
        closest = min(distances)
        ordered = sorted(zip(group, distances), key=lambda item: (item[1], item[0][1]))
        shown = ordered[:8]
        ccaa = Counter(row[6] or "No determinada" for row in group).most_common(1)[0][0]
        importe = sum(float(row[2] or 0) for row in group)
        alert = {
            "nombre": group[0][10] or contract[3],
            "nif": contract[2],
            "n_concesiones": len(group),
            "organismo": group[0][3],
            "fecha_concesion_min": min(dates),
            "fecha_concesion_max": max(dates),
            "importe_concesiones": importe,
            "fecha_contrato": contract[9],
            "organo_contrato": contract[4] or "Órgano no indicado",
            "titulo_contrato": contract[17],
            "procedimiento_nombre": contract[13],
            "importe_contrato": contract[11],
            "expediente": contract[0],
            "via": via,
            "detalle": detalle,
            "menor": contract[14],
            "emergencia": contract[16],
            "sin_concurrencia": contract[15],
            "dias": closest,
            "fecha_tipo": contract[20] if len(contract) > 20 else "adjudicacion",
        }
        motivo = build_motivo(alert)
        if guarantees:
            garantia_importe = sum(float(row[2] or 0) for row in guarantees)
            motivo += (
                f" En la misma ventana hay {len(guarantees)} garantías o avales "
                f"({euros(garantia_importe)}) que no entran en esa suma: no son una entrega de dinero."
            )
        alerts.append(
            (
                next_id,
                nivel,
                via,
                detalle,
                motivo,
                contract[2],
                group[0][9],
                alert["nombre"],
                group[0][3],
                group[0][4],
                ccaa,
                contract[10],
                closest,
                contract[14],
                contract[15],
                contract[16],
                contract[12],
                contract[13],
                contract[0],
                contract[1],
                contract[9],
                contract[11],
                alert["organo_contrato"],
                contract[6],
                contract[17],
                contract[18],
                contract[19],
                len(group),
                importe,
                min(dates),
                max(dates),
            )
        )
        for row, _distance in shown:
            items.append((next_id, row[0], row[1], float(row[2] or 0), row[8] or "", clip(row[7] or "", 180), row[11] or ""))
        next_id += 1

    for contract in cursor:
        contracts += 1
        nif = contract[2]
        if nif != current_nif:
            flush()
            current_nif = nif
            grants, guarantees = load_grants(nif)
            if contracts % 50000 == 0:
                log(f"  contratos revisados: {contracts}, indicadores: {next_id - 1}")
        if not grants:
            continue
        start = shift_day(contract[9], -WINDOW_DAYS)
        end = shift_day(contract[9], WINDOW_DAYS)
        grouped: dict[str, list[tuple]] = {}
        for grant in grants:
            if grant[1] < start or grant[1] > end:
                continue
            grouped.setdefault(grant[4], []).append(grant)
        for group in grouped.values():
            match = match_organismo(group[0][3], group[0][5] or "", {
                "organo_canon": contract[5],
                "dir3": contract[6],
                "padres": contract[7],
            }, dir3_index)
            if match is None:
                continue
            if not should_emit(match[0], contract[14], contract[15]):
                continue
            organo = group[0][4]
            in_window = [
                row
                for row in guarantees
                if start <= row[1] <= end and row[4] == organo
            ]
            emit(contract, group, match, in_window)
            if len(alerts) >= 400:
                flush()
    flush()
    connection.executescript(
        """
        CREATE INDEX IF NOT EXISTS idx_placsp_nif ON placsp_contrato(nif, fecha);
        CREATE INDEX IF NOT EXISTS idx_placsp_dir3_code ON placsp_contrato(dir3);
        CREATE INDEX IF NOT EXISTS idx_alert_contrato_filtro ON alert_contrato(ccaa, anio, organismo_norm);
        CREATE INDEX IF NOT EXISTS idx_alert_contrato_nif ON alert_contrato(nif, fecha_contrato);
        CREATE INDEX IF NOT EXISTS idx_alert_contrato_nivel ON alert_contrato(nivel, menor, dias);
        CREATE INDEX IF NOT EXISTS idx_alert_contrato_item ON alert_contrato_item(alert_id);
        """
    )
    build_menor_umbral(connection)
    write_coverage(connection)
    connection.commit()
    total = connection.execute("SELECT COUNT(*) FROM alert_contrato").fetchone()[0]
    log(f"Indicadores: {total} (sobre {contracts} contratos guardados)")


def write_coverage(connection: sqlite3.Connection) -> None:
    log("Midiendo cobertura del emparejamiento")
    canon_codes, _code_canons = load_dir3_index(connection)
    unique = {name: next(iter(codes)) for name, codes in canon_codes.items() if len(codes) == 1}
    ambiguous = {
        row[0]
        for row in connection.execute(
            "SELECT canon FROM placsp_dir3 GROUP BY canon HAVING COUNT(DISTINCT dir3) > 1"
        )
    }
    party_names = {
        row[0]
        for row in connection.execute("SELECT canon FROM placsp_nombre WHERE rol = 'organo'")
    }
    organismos = 0
    con_dir3 = 0
    con_nombre = 0
    ambiguos = 0
    for organismo, _organismo_norm in connection.execute(
        """
        SELECT MIN(organismo), organismo_norm
        FROM concesiones
        WHERE nif != '' AND organismo_norm != ''
        GROUP BY organismo_norm
        """
    ):
        organismos += 1
        folded = canon(organismo or "")
        if folded in unique:
            con_dir3 += 1
        elif folded in ambiguous:
            ambiguos += 1
        if folded in party_names:
            con_nombre += 1
    nif_bdns = connection.execute("SELECT COUNT(*) FROM beneficiarios WHERE nif != ''").fetchone()[0]
    nif_contrato = connection.execute("SELECT COUNT(DISTINCT nif) FROM placsp_contrato").fetchone()[0]
    contratos = connection.execute("SELECT COUNT(*) FROM placsp_contrato").fetchone()[0]
    alertas = connection.execute("SELECT COUNT(*) FROM alert_contrato").fetchone()[0]

    def nivel(name: str) -> int:
        return connection.execute("SELECT COUNT(*) FROM alert_contrato WHERE nivel = ?", (name,)).fetchone()[0]

    def flag(column: str) -> int:
        return connection.execute(f"SELECT COUNT(*) FROM alert_contrato WHERE {column} = 1").fetchone()[0]

    values = {
        "organismos": str(organismos),
        "organismos_dir3": str(con_dir3),
        "organismos_dir3_ambiguo": str(ambiguos),
        "organismos_nombre": str(con_nombre),
        "contratos": str(contratos),
        "nif_bdns": str(nif_bdns),
        "nif_con_contrato": str(nif_contrato),
        "alertas": str(alertas),
        "alertas_mismo_organo": str(nivel("mismo_organo")),
        "alertas_organo_superior": str(nivel("organo_superior")),
        "alertas_administracion": str(nivel("misma_administracion")),
        "alertas_menor": str(flag("menor")),
        "alertas_sin_concurrencia": str(flag("sin_concurrencia")),
        "alertas_menor_umbral": str(nivel("menor_umbral")),
        "generado": datetime.now().strftime("%Y-%m-%d %H:%M"),
    }
    connection.executemany(
        "INSERT INTO placsp_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        values.items(),
    )
    print_coverage(connection, values)


def print_coverage(connection: sqlite3.Connection, values: dict[str, str]) -> None:
    log("Cobertura")
    organismos = int(values["organismos"]) or 1
    log(
        f"  Organismos BDNS con NIF: {values['organismos']}. "
        f"Nombre exacto en un órgano PLACSP: {values['organismos_nombre']} "
        f"({100 * int(values['organismos_nombre']) / organismos:.1f} %). "
        f"DIR3 único: {values['organismos_dir3']} "
        f"({100 * int(values['organismos_dir3']) / organismos:.1f} %). "
        f"Nombre ambiguo (varios DIR3): {values['organismos_dir3_ambiguo']}."
    )
    log(
        f"  Contratos guardados: {values['contratos']}. "
        f"NIF con algún contrato: {values['nif_con_contrato']} de {values['nif_bdns']}."
    )
    log(
        f"  Indicadores: {values['alertas']} "
        f"(mismo órgano {values['alertas_mismo_organo']}, "
        f"jerarquía {values['alertas_organo_superior']}, "
        f"administración {values['alertas_administracion']}; "
        f"menores {values['alertas_menor']}, sin convocatoria abierta {values['alertas_sin_concurrencia']}; "
        f"menores bajo el umbral {values.get('alertas_menor_umbral', '0')})."
    )
    for fuente, anio, entradas, guardados in connection.execute(
        "SELECT fuente, anio, entradas, guardados FROM placsp_zip ORDER BY fuente, anio"
    ):
        log(f"  {fuente} {anio}: {entradas} anuncios leídos, {guardados} adjudicaciones de beneficiarios")


def self_check() -> None:
    assert canon("Ajuntament de València") == canon("AYUNTAMIENTO DE VALENCIA")
    assert canon("DIPUTACIÓN PROV. DE JAÉN") == canon("Diputación Provincial de Jaén")
    assert local_key(canon("Ayuntamiento de Valencia")) == "ayto:VALENCIA"
    assert local_key(canon("Ajuntament de València")) == "ayto:VALENCIA"
    assert local_key(canon("Ayuntamiento de Valencia de Don Juan")) == "ayto:VALENCIA DON JUAN"
    assert local_key(canon("Junta de Gobierno del Ayuntamiento de Quintanar de la Orden")) == "ayto:QUINTANAR ORDEN"
    junta = match_organismo(
        "AYUNTAMIENTO DE QUINTANAR DE LA ORDEN",
        "QUINTANAR DE LA ORDEN",
        {
            "organo_canon": canon("Junta de Gobierno del Ayuntamiento de Quintanar de la Orden"),
            "dir3": "",
            "padres": canon("Toledo"),
        },
        {},
    )
    assert junta == ("mismo_organo", "local", "ayto:QUINTANAR ORDEN")
    province = match_organismo(
        "TOLEDO",
        "TOLEDO",
        {
            "organo_canon": canon("Ayuntamiento de Quintanar de la Orden"),
            "dir3": "",
            "padres": canon("Toledo"),
        },
        {},
    )
    assert province is None
    assert CCAA_EXACT[canon("Junta de Andalucía")] == "ccaa:andalucia"
    assert ministry_stem(canon("Hacienda y Función Pública")) == "HACIENDA"
    assert is_bucket(canon("Sector Público"))
    assert not is_bucket(canon("Ministerio de Hacienda"))

    same = match_organismo(
        "AYUNTAMIENTO DE VALENCIA",
        "VALENCIA",
        {"organo_canon": canon("Ajuntament de València"), "dir3": "", "padres": ""},
        {},
    )
    assert same == ("mismo_organo", "nombre", canon("AYUNTAMIENTO DE VALENCIA"))
    hierarchy = match_organismo(
        "MINISTERIO DE SANIDAD",
        "ESTADO",
        {
            "organo_canon": canon("Instituto Nacional de Gestión Sanitaria"),
            "dir3": "EA0001234",
            "padres": canon("Ministerio de Sanidad"),
        },
        {},
    )
    assert hierarchy is not None and hierarchy[0] == "organo_superior" and hierarchy[1] == "jerarquia"
    renamed = match_organismo(
        "MINISTERIO DE HACIENDA Y FUNCIÓN PÚBLICA",
        "ESTADO",
        {
            "organo_canon": canon("Ministerio de Hacienda y Administraciones Públicas"),
            "dir3": "",
            "padres": "",
        },
        {},
    )
    assert renamed is not None and renamed[0] == "organo_superior" and renamed[1] == "ministerio"
    other_ministry = match_organismo(
        "MINISTERIO DE CULTURA Y DEPORTE",
        "ESTADO",
        {
            "organo_canon": canon("Ministerio de Sanidad"),
            "dir3": "",
            "padres": canon("Administración General del Estado"),
        },
        {},
    )
    assert other_ministry is None
    regional = match_organismo(
        "CONSEJERÍA DE EDUCACIÓN",
        "JUNTA DE ANDALUCÍA",
        {
            "organo_canon": canon("Consejería de Salud"),
            "dir3": "",
            "padres": "|".join([canon("Junta de Andalucía"), canon("Sector Público")]),
        },
        {},
    )
    assert regional is not None and regional[0] == "misma_administracion"
    assert should_emit("misma_administracion", 1, 1)
    assert not should_emit("misma_administracion", 0, 0)
    assert should_emit("mismo_organo", 0, 0)
    patrimonio = canon("Dirección General del Patrimonio del Estado")
    corto = canon("D.G. del Patrimonio del Estado")
    by_dir3 = match_organismo(
        "Dirección General del Patrimonio del Estado",
        "ESTADO",
        {"organo_canon": corto, "dir3": "E00126603", "padres": ""},
        ({patrimonio: {"E00126603"}}, {"E00126603": {patrimonio, corto}}),
    )
    assert by_dir3 is not None and by_dir3[1] == "dir3"
    ciencia = canon("Ministerio de Ciencia e Innovación")
    iac = canon("Dirección del Instituto de Astrofísica de Canarias")
    dirty = match_organismo(
        "Ministerio de Ciencia e Innovación",
        "ESTADO",
        {"organo_canon": iac, "dir3": "E05071301", "padres": ""},
        ({ciencia: {"E05071301"}}, {"E05071301": {ciencia, iac}}),
    )
    assert dirty is None
    ambiguous = match_organismo(
        "INTERVENCIÓN",
        "MADRID",
        {"organo_canon": canon("Intervención municipal"), "dir3": "L00000001", "padres": ""},
        {},
    )
    assert ambiguous is None or ambiguous[1] != "dir3"

    blob = FIXTURE_ENTRY.encode("utf-8")
    indexed = index_party(blob)
    assert indexed[0].startswith("Dirección General")
    assert indexed[1] == "A10018358"
    assert any("Fundación" in name for name, _code in indexed[2])
    parsed = parse_entry(blob, "menores")
    assert len(parsed) == 1
    row = parsed[0]
    assert row["nif"] == "B98932379"
    assert row["dir3"] == "A10018358"
    assert row["menor"] == 1
    assert row["sin_concurrencia"] == 1
    assert row["procedimiento"] == "6"
    assert row["importe"] == 60
    assert row["fecha"] == "2026-03-09"
    assert row["fecha_tipo"] == "adjudicacion"
    aggregated = parse_entry(
        """<entry>
          <id>agg-1</id>
          <updated>2018-06-01T00:00:00+02:00</updated>
          <link href="https://example.test/aviso?a=1&amp;b=2"/>
          <ContractFolderStatus>
            <ContractFolderID>EXP-1</ContractFolderID>
            <LocatedContractingParty><Party><PartyName><Name>Consejería de Hacienda</Name></PartyName></Party></LocatedContractingParty>
            <ProcurementProject><Name>Obra rural</Name></ProcurementProject>
            <TenderingProcess><ProcedureCode>3</ProcedureCode></TenderingProcess>
            <TenderResult>
              <ResultCode>8</ResultCode>
              <WinningParty>
                <PartyIdentification><ID schemeName="NIF">B-86965936</ID></PartyIdentification>
                <PartyName><Name>ACME</Name></PartyName>
              </WinningParty>
            </TenderResult>
            <IssueDate>2018-04-01</IssueDate>
            <IssueDate>2018-05-02</IssueDate>
          </ContractFolderStatus>
        </entry>""".encode(),
        "agregadas",
    )
    assert len(aggregated) == 1
    assert aggregated[0]["nif"] == "B86965936"
    assert aggregated[0]["fecha"] == "2018-05-02"
    assert aggregated[0]["fecha_tipo"] == "publicacion"
    assert aggregated[0]["sin_concurrencia"] == 1
    assert "publicación del anuncio" in build_motivo(
        {
            "nombre": "ACME",
            "nif": "B86965936",
            "n_concesiones": 1,
            "organismo": "Consejería de Hacienda",
            "fecha_concesion_min": "2018-05-01",
            "fecha_concesion_max": "2018-05-01",
            "importe_concesiones": 10,
            "fecha_contrato": "2018-05-02",
            "organo_contrato": "Consejería de Hacienda",
            "titulo_contrato": "Obra rural",
            "procedimiento_nombre": "Negociado sin publicidad",
            "importe_contrato": 10,
            "expediente": "EXP-1",
            "via": "nombre",
            "detalle": "x",
            "menor": 0,
            "emergencia": 0,
            "sin_concurrencia": 1,
            "dias": 1,
            "fecha_tipo": "publicacion",
        }
    )
    assert "detalle_licitacion" in row["url"]
    assert "&" in row["url"]
    assert row["anio"] == 2026
    assert procedure_name("3", "perfiles") == "Negociado sin publicidad"
    assert procedure_name("4", "perfiles") == "Negociado con publicidad"
    motivo = build_motivo(
        {
            "nombre": "INFORMATICA Y SOPORTE TECNICO REYGA",
            "nif": "B98932379",
            "n_concesiones": 2,
            "organismo": "Dirección General de la Fundación Palau de Les Arts Reina Sofía",
            "fecha_concesion_min": "2026-02-01",
            "fecha_concesion_max": "2026-03-01",
            "importe_concesiones": 1000,
            "fecha_contrato": "2026-03-09",
            "organo_contrato": row["organo"],
            "titulo_contrato": row["titulo"],
            "procedimiento_nombre": row["procedimiento_nombre"],
            "importe_contrato": 60,
            "expediente": row["expediente"],
            "via": "nombre",
            "detalle": row["organo_canon"],
            "menor": 1,
            "emergencia": 0,
            "sin_concurrencia": 1,
            "dias": 8,
        }
    )
    assert motivo.startswith("Indicador, no una prueba")
    assert "contrato menor" in motivo.lower()
    assert "nombre normalizado" in motivo.lower()
    assert days_between("2020-01-01", "2020-06-29") == 180
    assert shift_day("2020-01-01", -1) == "2019-12-31"
    assert clasificar_umbral(39669.42) == ("obra", OBRA_UMBRAL)
    assert clasificar_umbral(36000) == ("obra", OBRA_UMBRAL)
    assert clasificar_umbral(40000) is None
    assert clasificar_umbral(14999) == ("servicios", SERVICIO_UMBRAL)
    assert clasificar_umbral(13500) == ("servicios", SERVICIO_UMBRAL)
    assert clasificar_umbral(13499.99) is None
    assert clasificar_umbral(15000) is None
    alto = puntuacion_umbral(295, 295, 39669.42 / OBRA_UMBRAL)
    bajo = puntuacion_umbral(5, 1, 0.91)
    assert alto >= 90
    assert bajo < alto
    probe = sqlite3.connect(":memory:")
    probe.execute(
        """
        CREATE TABLE placsp_contrato (
          expediente TEXT, lote TEXT, nif TEXT, adjudicatario TEXT, organo TEXT, organo_canon TEXT,
          dir3 TEXT, padres TEXT, tipo_poder TEXT, fecha TEXT, anio INTEGER, importe REAL,
          procedimiento TEXT, procedimiento_nombre TEXT, menor INTEGER, sin_concurrencia INTEGER,
          emergencia INTEGER, titulo TEXT, url TEXT, fuente TEXT, updated TEXT, entrada_id TEXT,
          fecha_tipo TEXT
        )
        """
    )
    probe.execute(
        """
        CREATE TABLE alert_contrato (
          id INTEGER PRIMARY KEY,
          nivel TEXT, via TEXT, detalle TEXT, motivo TEXT, nif TEXT, beneficiario_id INTEGER,
          nombre TEXT, organismo TEXT, organismo_norm TEXT, ccaa TEXT, anio INTEGER, dias INTEGER,
          menor INTEGER, sin_concurrencia INTEGER, emergencia INTEGER, procedimiento TEXT,
          procedimiento_nombre TEXT, expediente TEXT, lote TEXT, fecha_contrato TEXT,
          importe_contrato REAL, organo_contrato TEXT, dir3 TEXT, titulo_contrato TEXT, url TEXT,
          fuente TEXT, n_concesiones INTEGER, importe_concesiones REAL, fecha_concesion_min TEXT,
          fecha_concesion_max TEXT
        )
        """
    )
    probe.execute("CREATE TABLE alert_contrato_item (alert_id INTEGER, concesion_id INTEGER, fecha TEXT, importe REAL, codigo_bdns TEXT, titulo TEXT, instrumento TEXT)")
    for index in range(6):
        probe.execute(
            """
            INSERT INTO placsp_contrato (
              expediente, lote, nif, adjudicatario, organo, organo_canon, dir3, padres, tipo_poder,
              fecha, anio, importe, procedimiento, procedimiento_nombre, menor, sin_concurrencia,
              emergencia, titulo, url, fuente, updated, entrada_id, fecha_tipo
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """,
            (
                f"EXP-{index}", "", "B32430316", "CAMINOS DE OURENSE", "Diputación de Ourense",
                canon("Diputación de Ourense"), "", "", "", f"2019-03-{index + 1:02d}", 2019, 39669.42,
                "6", "Contrato menor", 1, 1, 0, "Obra menor", "https://example.test/a", "menores", "", "", "adjudicacion",
            ),
        )
    probe.execute(
        """
        INSERT INTO placsp_contrato (
          expediente, lote, nif, adjudicatario, organo, organo_canon, dir3, padres, tipo_poder,
          fecha, anio, importe, procedimiento, procedimiento_nombre, menor, sin_concurrencia,
          emergencia, titulo, url, fuente, updated, entrada_id, fecha_tipo
        ) VALUES ('PEQUE', '', 'B32430316', 'CAMINOS DE OURENSE', 'Diputación de Ourense', ?, '', '', '',
                  '2019-04-01', 2019, 1000, '6', 'Contrato menor', 1, 1, 0, 'Suministro', '', 'menores', '', '', 'adjudicacion')
        """,
        (canon("Diputación de Ourense"),),
    )
    found = build_menor_umbral(probe)
    assert found == 1
    stored = probe.execute(
        "SELECT nif, n_contratos, umbral_codigo, puntuacion FROM alert_contrato WHERE nivel = 'menor_umbral'"
    ).fetchone()
    assert stored[0] == "B32430316"
    assert stored[1] == 6
    assert stored[2] == "obra"
    assert stored[3] >= 20
    piezas = probe.execute("SELECT COUNT(*) FROM alert_contrato_pieza").fetchone()[0]
    assert piezas == 6
    probe.close()
    log("Autocomprobación del cruce con la PLACSP correcta.")


FIXTURE_ENTRY = """<?xml version="1.0" encoding="UTF-8"?>
<entry>
  <id>https://contrataciondelestado.es/sindicacion/datosAbiertosMenores/20977276</id>
  <link href="https://contrataciondelestado.es/wps/poc?uri=deeplink:detalle_licitacion&amp;idEvl=abc%3D"/>
  <title>Compra de ventiladores</title>
  <updated>2026-11-22T02:11:26.607+01:00</updated>
  <cac-place-ext:ContractFolderStatus xmlns:cbc="urn:dgpe:names:draft:codice:schema:xsd:CommonBasicComponents-2" xmlns:cac="urn:dgpe:names:draft:codice:schema:xsd:CommonAggregateComponents-2" xmlns:cac-place-ext="urn:dgpe:names:draft:codice-place-ext:schema:xsd:CommonAggregateComponents-2">
    <cbc:ContractFolderID>CM ARTS 150/26</cbc:ContractFolderID>
    <cac-place-ext:LocatedContractingParty>
      <cbc:ContractingPartyTypeCode>7</cbc:ContractingPartyTypeCode>
      <cac:Party>
        <cac:PartyIdentification><cbc:ID schemeName="DIR3">A10018358</cbc:ID></cac:PartyIdentification>
        <cac:PartyIdentification><cbc:ID schemeName="NIF">G97544829</cbc:ID></cac:PartyIdentification>
        <cac:PartyName><cbc:Name>Dirección General de la Fundación Palau de Les Arts Reina Sofía</cbc:Name></cac:PartyName>
        <cac:PostalAddress>
          <cac:Country><cbc:Name>España</cbc:Name></cac:Country>
        </cac:PostalAddress>
      </cac:Party>
      <cac-place-ext:ParentLocatedParty>
        <cac:PartyName><cbc:Name>Fundación Palau de Les Arts Reina Sofía</cbc:Name></cac:PartyName>
        <cac-place-ext:ParentLocatedParty>
          <cac:PartyName><cbc:Name>Comunidad Valenciana</cbc:Name></cac:PartyName>
          <cac-place-ext:ParentLocatedParty>
            <cac:PartyName><cbc:Name>Sector Público</cbc:Name></cac:PartyName>
          </cac-place-ext:ParentLocatedParty>
        </cac-place-ext:ParentLocatedParty>
      </cac-place-ext:ParentLocatedParty>
    </cac-place-ext:LocatedContractingParty>
    <cac:ProcurementProject>
      <cbc:Name>Compra de ventiladores</cbc:Name>
      <cac:BudgetAmount><cbc:TaxExclusiveAmount currencyID="EUR">60</cbc:TaxExclusiveAmount></cac:BudgetAmount>
    </cac:ProcurementProject>
    <cac:TenderingProcess>
      <cbc:ProcedureCode>6</cbc:ProcedureCode>
      <cbc:UrgencyCode>1</cbc:UrgencyCode>
    </cac:TenderingProcess>
    <cac:TenderResult>
      <cbc:ResultCode>8</cbc:ResultCode>
      <cbc:AwardDate>2026-03-09</cbc:AwardDate>
      <cac:WinningParty>
        <cac:PartyIdentification><cbc:ID schemeName="NIF">B98932379</cbc:ID></cac:PartyIdentification>
        <cac:PartyName><cbc:Name>INFORMATICA Y SOPORTE TECNICO REYGA</cbc:Name></cac:PartyName>
      </cac:WinningParty>
      <cac:AwardedTenderedProject>
        <cac:LegalMonetaryTotal>
          <cbc:TaxExclusiveAmount currencyID="EUR">60</cbc:TaxExclusiveAmount>
        </cac:LegalMonetaryTotal>
      </cac:AwardedTenderedProject>
    </cac:TenderResult>
  </cac-place-ext:ContractFolderStatus>
</entry>
"""


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Cruce opcional BDNS × PLACSP")
    parser.add_argument("--self-check", action="store_true")
    parser.add_argument("--rebuild", action="store_true", help="Borra las tablas PLACSP y las vuelve a calcular")
    parser.add_argument("--alerts-only", action="store_true", help="Solo rehace los indicadores a partir de los contratos ya guardados")
    parser.add_argument(
        "--menor-umbral",
        action="store_true",
        help="Solo recalcula los contratos menores repetidos bajo el umbral, sin bajar ZIP ni rehacer el resto de cruces",
    )
    parser.add_argument("--keep-raw", action="store_true", help="No borra los ZIP tras leerlos")
    parser.add_argument("--years", default=f"{YEAR_MIN}-{YEAR_MAX}", help="2018-2022 o una lista 2018,2019")
    parser.add_argument("--feeds", default="perfiles,menores,agregadas")
    return parser.parse_args(argv)


def parse_years(text: str) -> list[int]:
    if "-" in text and "," not in text:
        start, end = text.split("-", 1)
        return list(range(int(start), int(end) + 1))
    return [int(piece) for piece in text.split(",") if piece]


def main(argv: list[str]) -> None:
    args = parse_args(argv)
    if args.self_check:
        self_check()
        return
    years = parse_years(args.years)
    feeds = [piece.strip() for piece in args.feeds.split(",") if piece.strip()]
    started = time.time()
    connection = connect()
    try:
        if args.menor_umbral:
            build_menor_umbral(connection)
        else:
            if args.rebuild and not args.alerts_only:
                log("Borrando tablas PLACSP anteriores")
                drop_placsp(connection)
                connection.commit()
            if not args.alerts_only:
                ingest(connection, years, feeds, args.keep_raw)
            rebuild_alerts(connection)
    finally:
        connection.close()
    log(f"Hecho en {time.time() - started:.0f} s")


if __name__ == "__main__":
    try:
        main(sys.argv[1:])
    except KeyboardInterrupt:
        sys.exit(130)
