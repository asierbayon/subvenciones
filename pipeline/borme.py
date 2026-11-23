#!/usr/bin/env python3
"""Optional BORME cross-check for BDNS beneficiaries.

The base index (pipeline/build_index.py) does not call this script. It reads the
official BOE open-data API, keeps a compact extract under data/borme/ (not
committed) and, when data/bdns.sqlite exists, writes match and alert tables into
that index.

    python3 pipeline/borme.py --self-check
    python3 pipeline/borme.py fetch
    python3 pipeline/borme.py aggregate
    python3 pipeline/borme.py match

Stdlib only. Python 3.10+.
"""

from __future__ import annotations

import argparse
import gzip
import re
import socket
import sqlite3
import sys
import threading
import time
import unicodedata
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DB_PATH = ROOT / "data" / "bdns.sqlite"
BORME_DIR = ROOT / "data" / "borme"
BORME_PATH = BORME_DIR / "borme.sqlite"
FIXTURE = Path(__file__).resolve().parent / "fixtures" / "borme-sample.xml"

SUMARIO = "https://www.boe.es/datosabiertos/api/borme/sumario/{ymd}"
USER_AGENT = "FaroBDNS/1.0 (reutilizacion BORME; +https://www.boe.es)"
DEFAULT_FROM = "2016-01-01"
DEFAULT_TO = "2023-12-31"

# Shell rules. Amounts are euros. They are reading rules, not legal thresholds.
NEW_DAYS = 365
NEW_DISSOLVE_DAYS = 730
DISSOLVE_SOON_DAYS = 540
# 3.100 covers the 3.000 € minimum of an SL in those years and the figures the
# gazette actually prints (3.006, 3.010, 3.100).
SMALL_CAPITAL = 3_100.0
GRANT_VS_CAPITAL = 10.0
MIN_GRANT = 10_000.0
CONSTITUTION_LAG_DAYS = 45

TRAILING_FORMS: tuple[str, ...] = (
    "SOCIEDAD LIMITADA UNIPERSONAL",
    "SOCIEDAD LIMITADA PROFESIONAL",
    "SOCIEDAD LIMITADA LABORAL",
    "SOCIEDAD LIMITADA NUEVA EMPRESA",
    "SOCIEDAD DE RESPONSABILIDAD LIMITADA",
    "SOCIEDAD ANONIMA UNIPERSONAL",
    "SOCIEDAD ANONIMA LABORAL",
    "SOCIEDAD ANONIMA DEPORTIVA",
    "SOCIEDAD ANONIMA",
    "SOCIEDAD LIMITADA",
    "SOCIEDAD COLECTIVA",
    "SOCIEDAD COMANDITARIA POR ACCIONES",
    "SOCIEDAD COMANDITARIA SIMPLE",
    "SOCIEDAD COMANDITARIA",
    "S L U",
    "S L P",
    "S L L",
    "S L N E",
    "S A U",
    "S A L",
    "S A D",
    "S C P",
    "S L",
    "S A",
    "S C",
    "SLU",
    "SLP",
    "SLL",
    "SLNE",
    "SAU",
    "SL",
    "SA",
    "NUEVA EMPRESA",
    "EN LIQUIDACION",
)

GENERIC = frozenset(
    {
        "INVERSIONES",
        "PROMOCIONES",
        "PROMOCION",
        "GESTION",
        "GESTIONES",
        "SERVICIOS",
        "COMERCIAL",
        "CONSTRUCCIONES",
        "CONSTRUCTORA",
        "INSTALACIONES",
        "PROYECTOS",
        "CONSULTING",
        "CONSULTORIA",
        "CONSULTORES",
        "GRUPO",
        "HOLDING",
        "PATRIMONIAL",
        "PARTICIPACIONES",
        "INMOBILIARIA",
        "INMOBILIARIO",
        "GENERAL",
        "GENERALES",
        "NACIONAL",
        "ESPANOLA",
        "ESPANOL",
        "IBERICA",
        "IBERICO",
        "NUEVA",
        "NUEVO",
        "ACTIVIDADES",
        "SOLUCIONES",
        "DESARROLLOS",
        "EXPLOTACIONES",
        "COMERCIO",
        "INDUSTRIAL",
        "INDUSTRIALES",
    }
)

PLACES = frozenset(
    {
        "ALBACETE",
        "ALICANTE",
        "ALACANT",
        "ALMERIA",
        "ANDALUCIA",
        "ARAGON",
        "ASTURIAS",
        "AVILA",
        "BADAJOZ",
        "BALEARES",
        "BARCELONA",
        "BILBAO",
        "BURGOS",
        "CACERES",
        "CADIZ",
        "CANTABRIA",
        "CASTELLON",
        "CASTELLO",
        "CEUTA",
        "CIUDAD",
        "CORDOBA",
        "CORUNA",
        "CUENCA",
        "EUSKADI",
        "GALICIA",
        "GIJON",
        "GIRONA",
        "GRANADA",
        "GUADALAJARA",
        "HUELVA",
        "HUESCA",
        "JAEN",
        "LEON",
        "LLEIDA",
        "LUGO",
        "MADRID",
        "MALAGA",
        "MELILLA",
        "MURCIA",
        "NAVARRA",
        "OURENSE",
        "OVIEDO",
        "PALENCIA",
        "PALMA",
        "PAMPLONA",
        "PONTEVEDRA",
        "SALAMANCA",
        "SANTANDER",
        "SEGOVIA",
        "SEVILLA",
        "SORIA",
        "TARRAGONA",
        "TERUEL",
        "TOLEDO",
        "VALENCIA",
        "VALLADOLID",
        "VIGO",
        "VITORIA",
        "ZAMORA",
        "ZARAGOZA",
    }
)

COMPANY_HINT = re.compile(
    r"\b(SOCIEDAD|LIMITADA|ANONIMA|COOPERATIVA|S\s+L|S\s+A|SLU|SAU|SLP|SLL|SL|SA)\b"
)
FORM_IN_TITLE = re.compile(
    r"\b(SOCIEDAD|LIMITADA|ANONIMA|COOPERATIVA|S\s+L|S\s+A|SLU|SAU|SLP|SLL|SL|SA)\b"
)
ROLE_RE = re.compile(
    r"(?<![A-ZÁÉÍÓÚÜÑ])("
    r"Adm\.\s*Unico|Adm\.\s*Solid\.|Adm\.\s*Mancom\.|Adm\.\s*Supl\.|"
    r"Cons\.Del\.Sol|Cons\.Del\.Man|Con\.Delegado|Consejero|"
    r"Presidente|Vicepresid\.|Dir\.\s*General|Socio\s+[ÚúUu]nico"
    r")\s*:\s*"
)
MONEY_RE = re.compile(
    r"(Resultante\s+Suscrito|Capital\s+suscrito|Capital)\s*:\s*(\d[\d.]*)(?:\s*,\s*(\d{1,2}))?\s*Euros",
    re.IGNORECASE,
)
INSCRIPTION_RE = re.compile(r"\((\d{1,2}\.\d{1,2}\.\d{2,4})\)\s*\.?\s*$")
HOJA_RE = re.compile(r"\bH\s+([A-Z]{1,3})\s*-?\s*(\d{1,8})\b")
DOM_RE = re.compile(
    r"(?:Domicilio\s*:\s*|Cambio de domicilio social\.\s+)(.+?)(?:\.\s+[A-ZÁÉÍÓÚÜÑ]|$)"
)
CONST_RE = re.compile(r"(?:^|\.\s+)Constitución\b")
DISSOLVE_RE = re.compile(r"(?:^|\.\s+)(?:Disolución|Extinción|Cierre provisional)\b")
NIF_RE = re.compile(
    r"(?:C\.?\s*I\.?\s*F\.?|N\.?\s*I\.?\s*F\.?)\s*[:.]?\s*([ABCDEFGHJNPQRSUVW]\d{7}[0-9A-J])",
    re.IGNORECASE,
)
TITLE_RE = re.compile(r"^\s*(\d+)\s*-\s*(.+?)\s*\.?\s*$")
STREET = {
    "C": "CALLE",
    "CL": "CALLE",
    "AV": "AVENIDA",
    "AVDA": "AVENIDA",
    "AVD": "AVENIDA",
    "PZA": "PLAZA",
    "PZ": "PLAZA",
    "PSO": "PASEO",
    "CTRA": "CARRETERA",
    "CRTA": "CARRETERA",
    "POLIG": "POLIGONO",
    "POL": "POLIGONO",
    "TRAV": "TRAVESIA",
    "RDA": "RONDA",
    "CMNO": "CAMINO",
    "KM": "KILOMETRO",
}
DROP_ADDRESS = {
    "PISO",
    "BAJO",
    "IZQ",
    "IZDA",
    "IZQDA",
    "DCHA",
    "DRCHA",
    "ESC",
    "PUERTA",
    "ATICO",
    "ENTLO",
    "PLANTA",
    "LOCAL",
    "EDF",
    "EDIF",
    "N",
    "NUM",
}


def log(message: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {message}", flush=True)


def fold(value: str) -> str:
    text = unicodedata.normalize("NFD", value or "")
    text = "".join(char for char in text if unicodedata.category(char) != "Mn")
    text = text.upper().replace("·", " ").replace("-", " ").replace("/", " ")
    text = text.replace(".", " ")
    text = re.sub(r"[^A-Z0-9 ]+", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def company_key(value: str) -> str:
    """Fold a company name and drop trailing legal-form words.

    BORME prints «SOCIEDAD LIMITADA» and the BDNS often prints «S.L.». Both
    become the same key. The form is only removed at the end, so a word inside
    the name stays. A key shorter than four characters is discarded.
    """
    text = fold(value)
    changed = True
    while changed and text:
        changed = False
        for suffix in TRAILING_FORMS:
            if text == suffix:
                return ""
            tail = f" {suffix}"
            if text.endswith(tail):
                text = text[: -len(tail)].strip()
                changed = True
                break
    if len(text) < 4:
        return ""
    return text


def confidence(key: str, n_hojas: int, n_beneficiarios: int) -> str:
    """How safe it is to treat this name as one registry sheet.

    alta: one sheet in the extract, one BDNS beneficiary, and at least two
    distinctive tokens (or one long token).
    media: one sheet and one beneficiary, but the name is short or generic.
    debil: one sheet, but the name is too ordinary to trust.
    ambigua: several sheets share the name, or several beneficiaries do.
    """
    if not key or n_hojas != 1 or n_beneficiarios != 1:
        return "ambigua"
    tokens = [token for token in key.split(" ") if token]
    distinctive = [
        token
        for token in tokens
        if len(token) >= 4 and token not in GENERIC and token not in PLACES
    ]
    if len(tokens) >= 2 and len(distinctive) >= 2:
        return "alta"
    if len(tokens) == 1 and distinctive and len(tokens[0]) >= 8:
        return "alta"
    distinctive_length = sum(len(token) for token in distinctive)
    if distinctive and distinctive_length >= 5 and len(tokens) >= 2:
        return "media"
    if len(tokens) == 1 and distinctive and len(tokens[0]) >= 6:
        return "media"
    return "debil"


def domicilio_key(value: str) -> str:
    tokens = fold(value).split()
    if not tokens:
        return ""
    if tokens[0] in STREET:
        tokens[0] = STREET[tokens[0]]
    cleaned: list[str] = []
    for token in tokens:
        if token in DROP_ADDRESS:
            continue
        if token.isdigit() and len(token) == 1 and cleaned and cleaned[-1].isdigit():
            continue
        cleaned.append(token)
    return " ".join(cleaned)


def parse_short_date(token: str) -> str | None:
    match = re.fullmatch(r"(\d{1,2})[./](\d{1,2})[./](\d{2,4})", (token or "").strip())
    if match is None:
        return None
    day = int(match.group(1))
    month = int(match.group(2))
    year = int(match.group(3))
    if year < 100:
        year = 1900 + year if year >= 70 else 2000 + year
    if year < 1970 or year > 2030:
        return None
    try:
        return datetime(year, month, day).strftime("%Y-%m-%d")
    except ValueError:
        return None


def leading_date(fragment: str) -> str | None:
    """First plausible date in a fragment.

    Some announcements glue two dates («18.12.1518/12/2015»). A four-digit year
    outside 1970-2030 is read again using only its first two digits.
    """
    for match in re.finditer(r"(\d{1,2})[./](\d{1,2})[./](\d{2,4})", fragment or ""):
        parsed = parse_short_date(match.group(0))
        if parsed:
            return parsed
        year_token = match.group(3)
        if len(year_token) <= 2:
            continue
        parsed = parse_short_date(f"{match.group(1)}.{match.group(2)}.{year_token[:2]}")
        if parsed:
            return parsed
    return None


def parse_iso_day(value: str) -> str | None:
    text = (value or "").strip()
    if re.fullmatch(r"\d{8}", text):
        return f"{text[0:4]}-{text[4:6]}-{text[6:8]}"
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", text):
        return text
    return None


def day_span(start: str | None, end: str | None) -> int | None:
    if not start or not end:
        return None
    try:
        left = datetime.strptime(start, "%Y-%m-%d")
        right = datetime.strptime(end, "%Y-%m-%d")
    except ValueError:
        return None
    return (right - left).days


def parse_money(text: str) -> float | None:
    best_rank = 99
    best: re.Match[str] | None = None
    for match in MONEY_RE.finditer(text or ""):
        label = match.group(1).lower()
        if "resultante" in label:
            rank = 0
        elif "suscrito" in label:
            rank = 1
        else:
            rank = 2
        if rank < best_rank:
            best_rank = rank
            best = match
    if best is None:
        return None
    whole = best.group(2).replace(".", "")
    fraction = best.group(3) or "0"
    try:
        return float(f"{whole}.{fraction}")
    except ValueError:
        return None


def parse_hoja(text: str) -> str:
    match = HOJA_RE.search(text or "")
    if match is None:
        return ""
    return f"{match.group(1)} {match.group(2)}"


def parse_domicilio(text: str) -> str:
    found = ""
    for match in DOM_RE.finditer(text or ""):
        found = " ".join(match.group(1).strip(" .;").split())
    if len(found) > 180:
        return ""
    return found


def persona_identity(name: str) -> tuple[str, str]:
    folded = fold(name)
    if not folded:
        return "", "P"
    if COMPANY_HINT.search(folded):
        key = company_key(name)
        if key:
            return key, "E"
    if len(folded) < 8:
        return "", "P"
    return folded, "P"


def people_from(text: str) -> list[tuple[str, str, str, str]]:
    """Return (rol A/S, display name, key, kind P/E) for directors and sole shareholders."""
    matches = list(ROLE_RE.finditer(text or ""))
    found: list[tuple[str, str, str, str]] = []
    seen: set[tuple[str, str]] = set()
    for index, match in enumerate(matches):
        start = match.end()
        end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        chunk = text[start:end]
        chunk = re.split(r"\.\s+(?=[A-ZÁÉÍÓÚÜÑ0-9])", chunk, maxsplit=1)[0]
        chunk = chunk.split("Datos registrales")[0]
        rol = "S" if "Socio" in match.group(1) else "A"
        for part in chunk.split(";"):
            display = " ".join(part.strip(" .;,").split())
            if not display or len(display) > 160 or len(display.split()) > 12:
                continue
            key, kind = persona_identity(display)
            if not key:
                continue
            marker = (rol, key)
            if marker in seen:
                continue
            seen.add(marker)
            found.append((rol, display, key, kind))
            if len(found) >= 12:
                return found
    return found


def encode_people(people: list[tuple[str, str, str, str]]) -> str:
    return "\n".join(f"{rol}\t{name}\t{key}\t{kind}" for rol, name, key, kind in people)


def decode_people(blob: str) -> list[tuple[str, str, str, str]]:
    rows: list[tuple[str, str, str, str]] = []
    for line in (blob or "").split("\n"):
        parts = line.split("\t")
        if len(parts) != 4:
            continue
        rows.append((parts[0], parts[1], parts[2], parts[3]))
    return rows


def looks_like_company(title: str) -> bool:
    return FORM_IN_TITLE.search(fold(title)) is not None


@dataclass
class Acto:
    fecha: str
    cve: str
    provincia: str
    anuncio: str
    nombre: str
    nombre_key: str
    hoja: str
    registro_key: str
    constitucion: int
    fecha_constitucion: str | None
    disolucion: int
    fecha_disolucion: str | None
    capital: float | None
    domicilio: str
    domicilio_key: str
    personas: str
    nif: str


def parse_document(payload: bytes, default_fecha: str = "") -> list[Acto]:
    root = ET.fromstring(payload)
    meta = root.find("metadatos")
    cve = ""
    provincia = ""
    fecha = parse_iso_day(default_fecha) or ""
    if meta is not None:
        cve = (meta.findtext("identificador") or "").strip()
        provincia = " ".join((meta.findtext("titulo") or "").split())
        published = parse_iso_day(meta.findtext("fecha_publicacion") or "")
        if published:
            fecha = published
    texto = root.find("texto")
    if texto is None or not fecha or not cve:
        return []
    acts: list[Acto] = []
    title = ""
    paragraphs: list[str] = []

    def flush() -> None:
        if not title:
            return
        match = TITLE_RE.match(title)
        if match is None:
            return
        anuncio = match.group(1)
        nombre = " ".join(match.group(2).strip(" .").split())
        if not looks_like_company(nombre):
            return
        key = company_key(nombre)
        if not key:
            return
        body = " ".join(paragraphs)
        hoja = parse_hoja(body)
        registro = hoja if hoja else f"SIN:{cve}:{anuncio}"
        inscription = None
        inscription_match = INSCRIPTION_RE.search(body)
        if inscription_match:
            inscription = parse_short_date(inscription_match.group(1))
        constituted = 1 if CONST_RE.search(body) else 0
        begin = None
        marker = body.find("Comienzo de operaciones")
        if marker >= 0:
            begin = leading_date(body[marker : marker + 90])
        fecha_const = begin or (inscription if constituted else None) or (fecha if constituted else None)
        dissolved = 1 if DISSOLVE_RE.search(body) else 0
        fecha_dis = (inscription or fecha) if dissolved else None
        domicilio = parse_domicilio(body)
        nif_match = NIF_RE.search(body)
        nif = nif_match.group(1).upper() if nif_match else ""
        acts.append(
            Acto(
                fecha=fecha,
                cve=cve,
                provincia=provincia,
                anuncio=anuncio,
                nombre=nombre[:300],
                nombre_key=key,
                hoja=hoja,
                registro_key=registro,
                constitucion=constituted,
                fecha_constitucion=fecha_const,
                disolucion=dissolved,
                fecha_disolucion=fecha_dis,
                capital=parse_money(body),
                domicilio=domicilio,
                domicilio_key=domicilio_key(domicilio) if domicilio else "",
                personas=encode_people(people_from(body)),
                nif=nif,
            )
        )

    for node in list(texto):
        text = " ".join(" ".join(node.itertext()).split())
        kind = node.get("class") or ""
        if kind == "articulo":
            flush()
            title = text
            paragraphs = []
            continue
        if title:
            paragraphs.append(text)
    flush()
    return acts


def euro(value: float) -> str:
    if abs(value - round(value)) < 0.001:
        amount = f"{value:,.0f}"
    else:
        amount = f"{value:,.2f}"
    amount = amount.replace(",", "X").replace(".", ",").replace("X", ".")
    return f"{amount} €"


def fecha_es(value: str | None) -> str:
    if not value:
        return "sin fecha"
    parts = value.split("-")
    if len(parts) != 3:
        return value
    return f"{parts[2]}/{parts[1]}/{parts[0]}"


def borme_url(cve: str) -> str:
    if not cve:
        return ""
    return f"https://www.boe.es/diario_borme/txt.php?id={cve}"


def self_check() -> None:
    assert company_key("Acme Sociedad Limitada") == "ACME"
    assert company_key("ACME S.L.") == "ACME"
    assert company_key("ACME SL") == "ACME"
    assert company_key("ACME S.L.U.") == "ACME"
    assert company_key("ACME SOCIEDAD LIMITADA NUEVA EMPRESA") == "ACME"
    assert company_key("ACME SOCIEDAD ANONIMA") == "ACME"
    assert company_key("TRANSPORTES JOSE GARCIA E HIJOS SL") == "TRANSPORTES JOSE GARCIA E HIJOS"
    assert company_key("SL TRANSPORTES IBERICOS SA") == "SL TRANSPORTES IBERICOS"
    assert company_key("ANA SAL") == "ANA SAL"
    left = domicilio_key("C/ VELAZQUEZ 94 1º (MADRID)")
    right = domicilio_key("CALLE VELAZQUEZ 94 (MADRID)")
    assert left == right == "CALLE VELAZQUEZ 94 MADRID"
    assert parse_money("Capital: 3.000,00 Euros.") == 3000
    assert parse_money("Capital: 2.436.000,00 Euros. Resultante Suscrito: 2.439.100,00 Euros.") == 2439100
    assert parse_short_date("15.02.18") == "2018-02-15"
    assert parse_short_date("18.12.1518") is None
    assert leading_date("18.12.1518/12/2015") == "2015-12-18"
    assert leading_date("Comienzo de operaciones: 15.02.18. Objeto") == "2018-02-15"
    assert confidence("TRANSPORTES GARCIA LOPEZ", 1, 1) == "alta"
    assert confidence("INVERSIONES NORTE", 1, 1) == "media"
    assert confidence("INVERSIONES", 1, 1) == "debil"
    assert confidence("TRANSPORTES GARCIA LOPEZ", 2, 1) == "ambigua"
    assert confidence("TRANSPORTES GARCIA LOPEZ", 1, 2) == "ambigua"
    people = people_from(
        "Nombramientos. Adm. Unico: GRENERGY RENOVABLES SA. Consejero: BOVEDA DAMBORENEA JAVIER. "
        "Cons.Del.Man: BOVEDA DAMBORENEA JAVIER. Socio único: LOMBARDERO PEREZ DELIO."
    )
    keys = {(rol, key) for rol, _name, key, _kind in people}
    assert ("A", "GRENERGY RENOVABLES") in keys
    assert ("A", "BOVEDA DAMBORENEA JAVIER") in keys
    assert ("S", "LOMBARDERO PEREZ DELIO") in keys
    acts = parse_document(FIXTURE.read_bytes())
    by_name = {act.nombre_key: act for act in acts}
    assert "GARCIA PEREZ JUAN" not in by_name
    eclimab = by_name["ECLIMAB APLICACIONES"]
    assert eclimab.capital == 30000
    assert eclimab.fecha_constitucion == "2018-02-15"
    assert eclimab.hoja == "AB 26626"
    assert eclimab.domicilio_key == "CALLE CID 19 ALBACETE"
    assert "GARCIA OLIVAS CARLOS" in eclimab.personas
    assert "GALVEZ MORALEDA OSCAR" in eclimab.personas
    piscifactoria = by_name["PISCIFACTORIA RIO MUNDO"]
    assert piscifactoria.capital == 12000
    assert "\tS\t" in f"\t{piscifactoria.personas}" or piscifactoria.personas.startswith("S\t")
    assert "LOMBARDERO PEREZ DELIO" in piscifactoria.personas
    assert by_name["MODA Y FLORES ALBACETE"].disolucion == 1
    assert by_name["MODA Y FLORES ALBACETE"].fecha_disolucion == "2018-02-22"
    assert by_name["FINCA MARCHANTE"].capital == 2439100
    assert by_name["FINCA MARCHANTE"].constitucion == 0
    reduced = reduce_acts(
        [
            eclimab,
            Acto(
                fecha="2019-01-10",
                cve="BORME-A-2019-1-02",
                provincia="ALBACETE",
                anuncio="1",
                nombre="ECLIMAB APLICACIONES SL",
                nombre_key="ECLIMAB APLICACIONES",
                hoja="AB 26626",
                registro_key="AB 26626",
                constitucion=0,
                fecha_constitucion=None,
                disolucion=1,
                fecha_disolucion="2019-01-08",
                capital=3000,
                domicilio="C/ MAYOR 2 (ALBACETE)",
                domicilio_key="CALLE MAYOR 2 ALBACETE",
                personas=encode_people([("A", "GARCIA OLIVAS CARLOS", "GARCIA OLIVAS CARLOS", "P")]),
                nif="",
            ),
        ]
    )
    assert reduced["fecha_constitucion"] == "2018-02-15"
    assert reduced["capital_const"] == 30000
    assert reduced["capital"] == 3000
    assert reduced["disuelta"] == 1
    assert reduced["n_anuncios"] == 2
    assert "ECLIMAB APLICACIONES" in reduced["nombres"]
    log("Autocomprobación de BORME correcta.")


def reduce_acts(acts: list[Acto]) -> dict:
    ordered = sorted(acts, key=lambda act: (act.fecha, act.cve, act.anuncio))
    first = ordered[0]
    nombres: dict[str, str] = {}
    people: dict[tuple[str, str], tuple[str, str]] = {}
    capitals: list[str] = []
    fecha_const = None
    capital_const = None
    fuente_const = ""
    fecha_dis = None
    fuente_dis = ""
    domicilio = ""
    domicilio_norm = ""
    fuente_dom = ""
    nifs: list[str] = []
    for act in ordered:
        nombres.setdefault(act.nombre_key, act.nombre)
        if act.nif and act.nif not in nifs:
            nifs.append(act.nif)
        if act.constitucion and fecha_const is None:
            fecha_const = act.fecha_constitucion or act.fecha
            fuente_const = act.cve
            if act.capital is not None:
                capital_const = act.capital
        if act.disolucion and fecha_dis is None:
            fecha_dis = act.fecha_disolucion or act.fecha
            fuente_dis = act.cve
        if act.capital is not None:
            capitals.append(f"{act.fecha}|{act.capital:.2f}|{act.cve}")
        if act.domicilio_key:
            domicilio = act.domicilio
            domicilio_norm = act.domicilio_key
            fuente_dom = act.cve
        for rol, name, key, kind in decode_people(act.personas):
            people.setdefault((rol, key), (name, kind))
    if len(capitals) > 8:
        capitals = capitals[:4] + capitals[-4:]
    latest_capital = None
    latest_capital_fecha = ""
    latest_capital_cve = ""
    if capitals:
        last = capitals[-1].split("|")
        latest_capital_fecha = last[0]
        latest_capital = float(last[1])
        latest_capital_cve = last[2]
    return {
        "registro_key": first.registro_key,
        "hoja": first.hoja,
        "provincia": first.provincia,
        "nombre": ordered[-1].nombre,
        "nombres": nombres,
        "fecha_constitucion": fecha_const,
        "capital_const": capital_const,
        "fuente_const": fuente_const,
        "fecha_disolucion": fecha_dis,
        "fuente_dis": fuente_dis,
        "disuelta": 1 if fecha_dis else 0,
        "domicilio": domicilio,
        "domicilio_key": domicilio_norm,
        "fuente_dom": fuente_dom,
        "capital": latest_capital,
        "capital_fecha": latest_capital_fecha,
        "fuente_capital": latest_capital_cve,
        "capitales": ";".join(capitals),
        "n_anuncios": len(ordered),
        "fecha_ultimo": ordered[-1].fecha,
        "nif": ",".join(nifs),
        "personas": people,
    }


class Pace:
    def __init__(self, gap: float) -> None:
        self.gap = gap
        self.lock = threading.Lock()
        self.next_at = 0.0

    def wait(self) -> None:
        with self.lock:
            now = time.monotonic()
            if now < self.next_at:
                time.sleep(self.next_at - now)
            self.next_at = time.monotonic() + self.gap

    def slow(self) -> None:
        with self.lock:
            self.gap = min(self.gap * 1.5, 1.5)


def fetch_bytes(url: str, pace: Pace) -> bytes | None:
    delay = 1.0
    last_error: Exception | None = None
    for _attempt in range(5):
        pace.wait()
        request = urllib.request.Request(
            url,
            headers={
                "User-Agent": USER_AGENT,
                "Accept": "application/xml, text/xml, */*",
                "Accept-Encoding": "gzip",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                payload = response.read()
                encoding = (response.headers.get("Content-Encoding") or "").lower()
        except urllib.error.HTTPError as exc:
            last_error = exc
            if exc.code == 404:
                return None
            if exc.code in (429, 500, 502, 503, 504):
                pace.slow()
                time.sleep(delay)
                delay = min(delay * 2, 60)
                continue
            raise
        except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as exc:
            last_error = exc
            time.sleep(delay)
            delay = min(delay * 2, 30)
            continue
        if encoding == "gzip" or payload[:2] == b"\x1f\x8b":
            payload = gzip.decompress(payload)
        return payload
    raise RuntimeError(f"No se pudo descargar {url}: {last_error}")


@dataclass
class SumarioItem:
    cve: str
    titulo: str
    url: str


def section_a_items(payload: bytes) -> list[SumarioItem] | None:
    root = ET.fromstring(payload)
    code = (root.findtext("./status/code") or "").strip()
    if code == "404":
        return None
    if code and code != "200":
        raise RuntimeError(f"Sumario con estado {code}")
    items: list[SumarioItem] = []
    for seccion in root.iter("seccion"):
        if seccion.get("codigo") != "A":
            continue
        for item in seccion.iter("item"):
            cve = (item.findtext("identificador") or "").strip()
            url = (item.findtext("url_xml") or "").strip()
            titulo = " ".join((item.findtext("titulo") or "").split())
            if cve and url:
                items.append(SumarioItem(cve, titulo, url))
    return items


def weekdays(start: datetime, end: datetime) -> list[datetime]:
    days: list[datetime] = []
    cursor = start
    while cursor <= end:
        if cursor.weekday() < 5:
            days.append(cursor)
        cursor += timedelta(days=1)
    return days


def connect_borme() -> sqlite3.Connection:
    BORME_DIR.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(BORME_PATH)
    connection.execute("PRAGMA journal_mode = WAL")
    connection.execute("PRAGMA synchronous = OFF")
    connection.execute("PRAGMA temp_store = FILE")
    connection.execute("PRAGMA cache_size = -20000")
    connection.execute("PRAGMA busy_timeout = 5000")
    return connection


def ensure_acto_schema(connection: sqlite3.Connection) -> None:
    connection.executescript(
        """
        CREATE TABLE IF NOT EXISTS acto (
          id INTEGER PRIMARY KEY,
          fecha TEXT NOT NULL,
          cve TEXT NOT NULL,
          provincia TEXT,
          anuncio TEXT,
          nombre TEXT,
          nombre_key TEXT,
          hoja TEXT,
          registro_key TEXT,
          constitucion INTEGER NOT NULL,
          fecha_constitucion TEXT,
          disolucion INTEGER NOT NULL,
          fecha_disolucion TEXT,
          capital REAL,
          domicilio TEXT,
          domicilio_key TEXT,
          personas TEXT,
          nif TEXT
        );
        CREATE TABLE IF NOT EXISTS borme_doc (
          cve TEXT PRIMARY KEY,
          fecha TEXT,
          n INTEGER,
          estado TEXT
        );
        CREATE TABLE IF NOT EXISTS borme_dia (
          fecha TEXT PRIMARY KEY,
          estado TEXT,
          n_docs INTEGER
        );
        CREATE TABLE IF NOT EXISTS borme_meta (
          clave TEXT PRIMARY KEY,
          valor TEXT
        );
        """
    )


def meta_set(connection: sqlite3.Connection, key: str, value: str) -> None:
    connection.execute(
        "INSERT INTO borme_meta(clave, valor) VALUES(?, ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor",
        (key, value),
    )


def doc_ok(connection: sqlite3.Connection, cve: str) -> bool:
    row = connection.execute("SELECT estado FROM borme_doc WHERE cve = ?", (cve,)).fetchone()
    return bool(row and row[0] == "ok")


def insert_acts(connection: sqlite3.Connection, acts: list[Acto]) -> None:
    connection.executemany(
        """
        INSERT INTO acto (
          fecha, cve, provincia, anuncio, nombre, nombre_key, hoja, registro_key,
          constitucion, fecha_constitucion, disolucion, fecha_disolucion,
          capital, domicilio, domicilio_key, personas, nif
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        """,
        [
            (
                act.fecha,
                act.cve,
                act.provincia,
                act.anuncio,
                act.nombre,
                act.nombre_key,
                act.hoja,
                act.registro_key,
                act.constitucion,
                act.fecha_constitucion,
                act.disolucion,
                act.fecha_disolucion,
                act.capital,
                act.domicilio,
                act.domicilio_key,
                act.personas,
                act.nif,
            )
            for act in acts
        ],
    )


def fetch(start: str, end: str, workers: int, gap: float) -> None:
    socket.setdefaulttimeout(30)
    start_day = datetime.strptime(start, "%Y-%m-%d")
    end_day = datetime.strptime(end, "%Y-%m-%d")
    days = weekdays(start_day, end_day)
    connection = connect_borme()
    ensure_acto_schema(connection)
    meta_set(connection, "rango", f"{start}..{end}")
    connection.commit()
    pace = Pace(gap)
    consecutive_errors = 0
    log(f"BORME {start} → {end}: {len(days)} días laborables, {workers} peticiones en paralelo")
    try:
        with ThreadPoolExecutor(max_workers=workers) as pool:
            for index, day in enumerate(days, start=1):
                iso = day.strftime("%Y-%m-%d")
                ymd = day.strftime("%Y%m%d")
                status = connection.execute("SELECT estado FROM borme_dia WHERE fecha = ?", (iso,)).fetchone()
                if status and status[0] in ("ok", "vacio"):
                    continue
                try:
                    summary = fetch_bytes(SUMARIO.format(ymd=ymd), pace)
                except Exception as exc:
                    log(f"Sumario {iso}: {exc}")
                    connection.execute(
                        "INSERT INTO borme_dia(fecha, estado, n_docs) VALUES(?,?,?) "
                        "ON CONFLICT(fecha) DO UPDATE SET estado = excluded.estado",
                        (iso, "error", 0),
                    )
                    connection.commit()
                    consecutive_errors += 1
                    if consecutive_errors >= 12:
                        raise SystemExit("Demasiados fallos seguidos al pedir sumarios. Se detiene para no insistir.")
                    continue
                if summary is None:
                    connection.execute(
                        "INSERT INTO borme_dia(fecha, estado, n_docs) VALUES(?,?,?) "
                        "ON CONFLICT(fecha) DO UPDATE SET estado = excluded.estado, n_docs = excluded.n_docs",
                        (iso, "vacio", 0),
                    )
                    connection.commit()
                    consecutive_errors = 0
                    continue
                try:
                    docs = section_a_items(summary)
                except (ET.ParseError, RuntimeError) as exc:
                    log(f"Sumario {iso} ilegible: {exc}")
                    connection.execute(
                        "INSERT INTO borme_dia(fecha, estado, n_docs) VALUES(?,?,?) "
                        "ON CONFLICT(fecha) DO UPDATE SET estado = excluded.estado",
                        (iso, "error", 0),
                    )
                    connection.commit()
                    continue
                if docs is None:
                    connection.execute(
                        "INSERT INTO borme_dia(fecha, estado, n_docs) VALUES(?,?,?) "
                        "ON CONFLICT(fecha) DO UPDATE SET estado = excluded.estado",
                        (iso, "vacio", 0),
                    )
                    connection.commit()
                    continue
                pending = [doc for doc in docs if not doc_ok(connection, doc.cve)]
                failed = False
                futures = {pool.submit(fetch_bytes, doc.url, pace): doc for doc in pending}
                for future in as_completed(futures):
                    doc = futures[future]
                    try:
                        payload = future.result()
                    except Exception as exc:
                        log(f"{doc.cve}: {exc}")
                        payload = None
                    if not payload:
                        connection.execute(
                            "INSERT INTO borme_doc(cve, fecha, n, estado) VALUES(?,?,?,?) "
                            "ON CONFLICT(cve) DO UPDATE SET estado = excluded.estado",
                            (doc.cve, iso, 0, "error"),
                        )
                        connection.commit()
                        failed = True
                        consecutive_errors += 1
                        if consecutive_errors >= 30:
                            raise SystemExit("Demasiados documentos fallidos. Se detiene.")
                        continue
                    try:
                        acts = parse_document(payload, iso)
                    except ET.ParseError as exc:
                        log(f"{doc.cve} XML: {exc}")
                        connection.execute(
                            "INSERT INTO borme_doc(cve, fecha, n, estado) VALUES(?,?,?,?) "
                            "ON CONFLICT(cve) DO UPDATE SET estado = excluded.estado",
                            (doc.cve, iso, 0, "error"),
                        )
                        connection.commit()
                        failed = True
                        continue
                    insert_acts(connection, acts)
                    connection.execute(
                        "INSERT INTO borme_doc(cve, fecha, n, estado) VALUES(?,?,?,?) "
                        "ON CONFLICT(cve) DO UPDATE SET n = excluded.n, estado = excluded.estado, fecha = excluded.fecha",
                        (doc.cve, iso, len(acts), "ok"),
                    )
                    connection.commit()
                    consecutive_errors = 0
                state = "error" if failed else "ok"
                connection.execute(
                    "INSERT INTO borme_dia(fecha, estado, n_docs) VALUES(?,?,?) "
                    "ON CONFLICT(fecha) DO UPDATE SET estado = excluded.estado, n_docs = excluded.n_docs",
                    (iso, state, len(docs)),
                )
                connection.commit()
                if index % 15 == 0 or index == len(days):
                    stored = connection.execute("SELECT COUNT(*) FROM acto").fetchone()[0]
                    done = connection.execute("SELECT COUNT(*) FROM borme_dia WHERE estado IN ('ok', 'vacio')").fetchone()[0]
                    log(f"Días cerrados {done}/{len(days)}; anuncios de sociedad guardados {stored}")
    finally:
        connection.close()


def table_exists(connection: sqlite3.Connection, name: str) -> bool:
    row = connection.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
        (name,),
    ).fetchone()
    return row is not None


def aggregate(compact: bool) -> None:
    connection = connect_borme()
    try:
        ensure_acto_schema(connection)
        if not table_exists(connection, "acto"):
            raise SystemExit("No hay anuncios que agregar.")
        pending = connection.execute(
            "SELECT COUNT(*) FROM borme_dia WHERE estado = 'error'"
        ).fetchone()[0]
        if pending:
            log(f"Hay {pending} días con error. Se agrega lo descargado; vuelve a lanzar fetch para reintentar.")
        log("Agregando anuncios por hoja registral")
        connection.execute("DROP TABLE IF EXISTS sociedad_persona")
        connection.execute("DROP TABLE IF EXISTS sociedad_nombre")
        connection.execute("DROP TABLE IF EXISTS sociedad")
        connection.executescript(
            """
            CREATE TABLE sociedad (
              registro_key TEXT PRIMARY KEY,
              hoja TEXT,
              provincia TEXT,
              nombre TEXT,
              fecha_constitucion TEXT,
              capital_const REAL,
              fuente_const TEXT,
              fecha_disolucion TEXT,
              fuente_dis TEXT,
              disuelta INTEGER NOT NULL,
              domicilio TEXT,
              domicilio_key TEXT,
              fuente_dom TEXT,
              capital REAL,
              capital_fecha TEXT,
              fuente_capital TEXT,
              capitales TEXT,
              n_anuncios INTEGER,
              fecha_ultimo TEXT,
              nif TEXT
            );
            CREATE TABLE sociedad_nombre (
              registro_key TEXT NOT NULL,
              nombre_key TEXT NOT NULL,
              nombre TEXT NOT NULL,
              PRIMARY KEY (registro_key, nombre_key)
            );
            CREATE TABLE sociedad_persona (
              registro_key TEXT NOT NULL,
              rol TEXT NOT NULL,
              nombre_key TEXT NOT NULL,
              nombre TEXT NOT NULL,
              kind TEXT NOT NULL,
              PRIMARY KEY (registro_key, rol, nombre_key)
            );
            """
        )
        connection.execute("CREATE INDEX IF NOT EXISTS idx_acto_reg ON acto(registro_key, fecha, id)")
        cursor = connection.execute(
            """
            SELECT fecha, cve, provincia, anuncio, nombre, nombre_key, hoja, registro_key,
                   constitucion, fecha_constitucion, disolucion, fecha_disolucion,
                   capital, domicilio, domicilio_key, personas, nif
            FROM acto
            ORDER BY registro_key, fecha, id
            """
        )
        bucket: list[Acto] = []
        current = None
        written = 0

        def flush() -> None:
            nonlocal written
            if not bucket:
                return
            profile = reduce_acts(bucket)
            connection.execute(
                """
                INSERT INTO sociedad (
                  registro_key, hoja, provincia, nombre, fecha_constitucion, capital_const, fuente_const,
                  fecha_disolucion, fuente_dis, disuelta, domicilio, domicilio_key, fuente_dom,
                  capital, capital_fecha, fuente_capital, capitales, n_anuncios, fecha_ultimo, nif
                ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                """,
                (
                    profile["registro_key"],
                    profile["hoja"],
                    profile["provincia"],
                    profile["nombre"],
                    profile["fecha_constitucion"],
                    profile["capital_const"],
                    profile["fuente_const"],
                    profile["fecha_disolucion"],
                    profile["fuente_dis"],
                    profile["disuelta"],
                    profile["domicilio"],
                    profile["domicilio_key"],
                    profile["fuente_dom"],
                    profile["capital"],
                    profile["capital_fecha"],
                    profile["fuente_capital"],
                    profile["capitales"],
                    profile["n_anuncios"],
                    profile["fecha_ultimo"],
                    profile["nif"],
                ),
            )
            connection.executemany(
                "INSERT INTO sociedad_nombre (registro_key, nombre_key, nombre) VALUES (?,?,?)",
                [(profile["registro_key"], key, name) for key, name in profile["nombres"].items()],
            )
            connection.executemany(
                "INSERT INTO sociedad_persona (registro_key, rol, nombre_key, nombre, kind) VALUES (?,?,?,?,?)",
                [
                    (profile["registro_key"], rol, key, name, kind)
                    for (rol, key), (name, kind) in profile["personas"].items()
                ],
            )
            written += 1
            if written % 50000 == 0:
                connection.commit()
                log(f"Sociedades agregadas {written}")
            bucket.clear()

        for row in cursor:
            act = Acto(*row)
            if current is None:
                current = act.registro_key
            if act.registro_key != current:
                flush()
                current = act.registro_key
            bucket.append(act)
        flush()
        connection.executescript(
            """
            CREATE INDEX IF NOT EXISTS idx_soc_nombre ON sociedad_nombre(nombre_key);
            CREATE INDEX IF NOT EXISTS idx_soc_persona ON sociedad_persona(nombre_key);
            CREATE INDEX IF NOT EXISTS idx_soc_dom ON sociedad(domicilio_key);
            """
        )
        n_soc = connection.execute("SELECT COUNT(*) FROM sociedad").fetchone()[0]
        n_act = connection.execute("SELECT COUNT(*) FROM acto").fetchone()[0]
        n_hoja = connection.execute("SELECT COUNT(*) FROM acto WHERE hoja != ''").fetchone()[0]
        n_nif = connection.execute("SELECT COUNT(*) FROM acto WHERE nif != ''").fetchone()[0]
        meta_set(connection, "n_actos", str(n_act))
        meta_set(connection, "n_sociedades", str(n_soc))
        meta_set(connection, "n_actos_con_hoja", str(n_hoja))
        meta_set(connection, "n_actos_con_nif", str(n_nif))
        connection.commit()
        log(f"Sociedades {n_soc}; anuncios {n_act}; con hoja {n_hoja}; con NIF etiquetado {n_nif}")
        if compact:
            log("Compactando: se borran los anuncios sueltos y se vacía el fichero")
            connection.execute("DROP TABLE acto")
            connection.commit()
            connection.execute("VACUUM")
            log(f"Extracto {BORME_PATH} ({BORME_PATH.stat().st_size // 1_000_000} MB)")
    finally:
        connection.close()


def connect_bdns() -> sqlite3.Connection:
    if not DB_PATH.exists():
        raise SystemExit(f"No está el índice {DB_PATH}. Ejecuta antes python3 pipeline/build_index.py.")
    if not BORME_PATH.exists():
        raise SystemExit(f"No está el extracto {BORME_PATH}. Ejecuta antes python3 pipeline/borme.py fetch.")
    connection = sqlite3.connect(DB_PATH)
    connection.execute("PRAGMA busy_timeout = 8000")
    connection.execute("PRAGMA temp_store = FILE")
    connection.execute("PRAGMA cache_size = -32000")
    return connection


def capital_events(blob: str) -> list[tuple[str, float, str]]:
    events: list[tuple[str, float, str]] = []
    for piece in (blob or "").split(";"):
        if not piece:
            continue
        parts = piece.split("|")
        if len(parts) != 3:
            continue
        try:
            events.append((parts[0], float(parts[1]), parts[2]))
        except ValueError:
            continue
    return events


def capital_on(blob: str, day: str, const_date: str | None, const_capital: float | None, const_cve: str) -> tuple[float, str, str] | None:
    prior = [event for event in capital_events(blob) if event[0] <= day]
    if prior:
        event = max(prior, key=lambda item: item[0])
        return event[1], event[0], event[2]
    if const_capital is None or not const_date:
        return None
    span = day_span(const_date, day)
    if span is None or span < -CONSTITUTION_LAG_DAYS:
        return None
    return const_capital, const_date, const_cve


def drop_alert_tables(connection: sqlite3.Connection) -> None:
    connection.executescript(
        """
        DROP TABLE IF EXISTS alert_borme_vinculo_item;
        DROP TABLE IF EXISTS alert_borme_vinculo_miembro;
        DROP TABLE IF EXISTS alert_borme_vinculo;
        DROP TABLE IF EXISTS alert_borme_sociedad_item;
        DROP TABLE IF EXISTS alert_borme_sociedad;
        DROP TABLE IF EXISTS borme_fuente;
        DROP TABLE IF EXISTS borme_persona;
        DROP TABLE IF EXISTS borme_empresa;
        DROP TABLE IF EXISTS borme_meta;
        """
    )


def ensure_match_schema(connection: sqlite3.Connection) -> None:
    connection.executescript(
        """
        CREATE TABLE borme_empresa (
          beneficiario_id INTEGER PRIMARY KEY,
          nif TEXT NOT NULL,
          nombre TEXT NOT NULL,
          nombre_key TEXT NOT NULL,
          confianza TEXT NOT NULL,
          n_candidatas INTEGER NOT NULL,
          registro_key TEXT,
          hoja TEXT,
          provincia TEXT,
          fecha_constitucion TEXT,
          capital_const REAL,
          capital REAL,
          capital_fecha TEXT,
          capitales TEXT,
          domicilio TEXT,
          domicilio_key TEXT,
          disuelta INTEGER NOT NULL DEFAULT 0,
          fecha_disolucion TEXT,
          fuente_const TEXT,
          fuente_dis TEXT,
          fuente_dom TEXT,
          fuente_capital TEXT,
          n_anuncios INTEGER,
          nif_borme TEXT
        );
        CREATE TABLE borme_persona (
          beneficiario_id INTEGER NOT NULL,
          rol TEXT NOT NULL,
          nombre TEXT NOT NULL,
          nombre_key TEXT NOT NULL,
          kind TEXT NOT NULL
        );
        CREATE TABLE borme_fuente (
          beneficiario_id INTEGER NOT NULL,
          cve TEXT NOT NULL,
          fecha TEXT,
          url TEXT NOT NULL,
          tipo TEXT NOT NULL
        );
        CREATE TABLE borme_meta (
          clave TEXT PRIMARY KEY,
          valor TEXT
        );
        CREATE TABLE alert_borme_sociedad (
          id INTEGER PRIMARY KEY,
          regla TEXT NOT NULL,
          motivo TEXT NOT NULL,
          confianza TEXT NOT NULL,
          nif TEXT NOT NULL,
          beneficiario_id INTEGER,
          nombre TEXT NOT NULL,
          organismo TEXT NOT NULL,
          organismo_norm TEXT NOT NULL,
          ccaa TEXT NOT NULL,
          anio INTEGER NOT NULL,
          fecha_constitucion TEXT,
          capital REAL,
          fecha_disolucion TEXT,
          importe REAL NOT NULL,
          ratio REAL,
          dias INTEGER,
          fuente_cve TEXT,
          fuente_url TEXT
        );
        CREATE TABLE alert_borme_sociedad_item (
          alert_id INTEGER NOT NULL,
          concesion_id INTEGER NOT NULL,
          fecha TEXT NOT NULL,
          importe REAL NOT NULL,
          codigo_bdns TEXT,
          titulo TEXT
        );
        CREATE TABLE alert_borme_vinculo (
          id INTEGER PRIMARY KEY,
          tipo TEXT NOT NULL,
          motivo TEXT NOT NULL,
          clave TEXT NOT NULL,
          etiqueta TEXT NOT NULL,
          organismo TEXT NOT NULL,
          organismo_norm TEXT NOT NULL,
          ccaa TEXT NOT NULL,
          anio INTEGER NOT NULL,
          n_beneficiarios INTEGER NOT NULL,
          importe REAL NOT NULL
        );
        CREATE TABLE alert_borme_vinculo_miembro (
          alert_id INTEGER NOT NULL,
          beneficiario_id INTEGER,
          nif TEXT,
          nombre TEXT,
          confianza TEXT,
          importe REAL,
          n INTEGER,
          fuente_url TEXT
        );
        CREATE TABLE alert_borme_vinculo_item (
          alert_id INTEGER NOT NULL,
          beneficiario_id INTEGER,
          concesion_id INTEGER NOT NULL,
          fecha TEXT,
          importe REAL,
          titulo TEXT,
          codigo_bdns TEXT
        );
        """
    )


def match() -> None:
    borme = connect_borme()
    try:
        if not table_exists(borme, "sociedad"):
            borme.close()
            aggregate(compact=False)
            borme = connect_borme()
        if not table_exists(borme, "sociedad_nombre"):
            raise SystemExit("El extracto no tiene sociedades agregadas.")
    finally:
        borme.close()

    connection = connect_bdns()
    try:
        log("Cruzando nombres de sociedades con el BORME")
        drop_alert_tables(connection)
        ensure_match_schema(connection)
        connection.execute("ATTACH DATABASE ? AS borme", (str(BORME_PATH),))
        connection.execute("CREATE TEMP TABLE ben (id INTEGER PRIMARY KEY, nif TEXT, nombre TEXT, nombre_key TEXT)")
        beneficiaries = connection.execute(
            """
            SELECT id, nif, nombre FROM beneficiarios
            WHERE length(nif) = 9 AND substr(nif, 1, 1) IN ('A', 'B', 'C', 'D')
            """
        )
        batch: list[tuple] = []
        universe = 0
        universe_nif = 0
        for beneficiario_id, nif, nombre in beneficiaries:
            universe_nif += 1
            key = company_key(nombre or "")
            if not key:
                continue
            batch.append((beneficiario_id, nif, nombre, key))
            universe += 1
            if len(batch) >= 5000:
                connection.executemany("INSERT INTO ben (id, nif, nombre, nombre_key) VALUES (?,?,?,?)", batch)
                batch.clear()
        if batch:
            connection.executemany("INSERT INTO ben (id, nif, nombre, nombre_key) VALUES (?,?,?,?)", batch)
        connection.execute("CREATE INDEX idx_ben_key ON ben(nombre_key)")
        connection.commit()
        log(f"Sociedades de capital en la BDNS (NIF A/B/C/D) con nombre utilizable: {universe}")

        key_counts = {
            key: count
            for key, count in connection.execute("SELECT nombre_key, COUNT(*) FROM ben GROUP BY nombre_key")
        }
        rows = connection.execute(
            """
            SELECT b.id, b.nif, b.nombre, b.nombre_key,
                   COUNT(DISTINCT n.registro_key) AS n_hojas,
                   MIN(n.registro_key) AS registro_key
            FROM ben b
            JOIN borme.sociedad_nombre n ON n.nombre_key = b.nombre_key
            GROUP BY b.id
            """
        )
        assigned: list[tuple] = []
        counts = {"alta": 0, "media": 0, "debil": 0, "ambigua": 0}
        for beneficiario_id, nif, nombre, key, n_hojas, registro_key in rows:
            level = confidence(key, int(n_hojas), int(key_counts.get(key, 1)))
            counts[level] = counts.get(level, 0) + 1
            assigned.append((beneficiario_id, nif, nombre, key, level, int(n_hojas), registro_key if level != "ambigua" else None))
        log(
            "Cruces por nombre: "
            + ", ".join(f"{label} {counts.get(label, 0)}" for label in ("alta", "media", "debil", "ambigua"))
        )
        connection.execute("CREATE TEMP TABLE chosen (id INTEGER PRIMARY KEY, registro_key TEXT, confianza TEXT)")
        connection.executemany(
            "INSERT INTO chosen (id, registro_key, confianza) VALUES (?,?,?)",
            [(item[0], item[6], item[4]) for item in assigned if item[6]],
        )
        profiles = {}
        for row in connection.execute(
            """
            SELECT c.id, s.registro_key, s.hoja, s.provincia, s.nombre, s.fecha_constitucion, s.capital_const,
                   s.fuente_const, s.fecha_disolucion, s.fuente_dis, s.disuelta, s.domicilio, s.domicilio_key,
                   s.fuente_dom, s.capital, s.capital_fecha, s.fuente_capital, s.capitales, s.n_anuncios,
                   s.fecha_ultimo, s.nif
            FROM chosen c
            JOIN borme.sociedad s ON s.registro_key = c.registro_key
            """
        ):
            profiles[int(row[0])] = row

        empresas: list[tuple] = []
        fuentes: list[tuple] = []
        for beneficiario_id, nif, nombre, key, level, n_hojas, registro_key in assigned:
            profile = profiles.get(beneficiario_id)
            if profile is None:
                empresas.append(
                    (
                        beneficiario_id, nif, nombre, key, level, n_hojas, None, None, None,
                        None, None, None, None, None, None, None, 0, None, None, None, None, None, None, None,
                    )
                )
                continue
            (
                _bid, reg, hoja, provincia, _borme_name, fecha_const, capital_const, fuente_const,
                fecha_dis, fuente_dis, disuelta, domicilio, domicilio_norm, fuente_dom, capital,
                capital_fecha, fuente_capital, capitales, n_anuncios, _fecha_ultimo, nif_borme,
            ) = profile
            borme_nifs = [item for item in (nif_borme or "").split(",") if item]
            if borme_nifs and nif not in borme_nifs:
                level = "ambigua"
                empresas.append(
                    (
                        beneficiario_id, nif, nombre, key, level, n_hojas, None, None, None,
                        None, None, None, None, None, None, None, 0, None, None, None, None, None, None, ",".join(borme_nifs),
                    )
                )
                continue
            if borme_nifs and nif in borme_nifs:
                level = "alta"
            empresas.append(
                (
                    beneficiario_id, nif, nombre, key, level, n_hojas, reg, hoja, provincia,
                    fecha_const, capital_const, capital, capital_fecha, capitales, domicilio, domicilio_norm,
                    disuelta or 0, fecha_dis, fuente_const, fuente_dis, fuente_dom, fuente_capital, n_anuncios, nif_borme,
                )
            )
            for tipo, cve, fecha in (
                ("constitucion", fuente_const, fecha_const),
                ("disolucion", fuente_dis, fecha_dis),
                ("domicilio", fuente_dom, capital_fecha if not fecha_const else None),
                ("capital", fuente_capital, capital_fecha),
            ):
                if cve:
                    fuentes.append((beneficiario_id, cve, fecha or "", borme_url(cve), tipo))
        connection.executemany(
            """
            INSERT INTO borme_empresa (
              beneficiario_id, nif, nombre, nombre_key, confianza, n_candidatas, registro_key, hoja, provincia,
              fecha_constitucion, capital_const, capital, capital_fecha, capitales, domicilio, domicilio_key,
              disuelta, fecha_disolucion, fuente_const, fuente_dis, fuente_dom, fuente_capital, n_anuncios, nif_borme
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """,
            empresas,
        )
        connection.execute(
            """
            INSERT INTO borme_persona (beneficiario_id, rol, nombre, nombre_key, kind)
            SELECT e.beneficiario_id, p.rol, p.nombre, p.nombre_key, p.kind
            FROM borme_empresa e
            JOIN borme.sociedad_persona p ON p.registro_key = e.registro_key
            WHERE e.confianza IN ('alta', 'media', 'debil')
            """
        )
        connection.executemany(
            "INSERT INTO borme_fuente (beneficiario_id, cve, fecha, url, tipo) VALUES (?,?,?,?,?)",
            fuentes,
        )
        final_counts = dict(
            connection.execute("SELECT confianza, COUNT(*) FROM borme_empresa GROUP BY confianza").fetchall()
        )
        sin = universe - sum(final_counts.values())
        def ratio(part: int) -> str:
            if universe == 0:
                return "0"
            return f"{part / universe:.4f}"

        meta_rows = {
            "generado_en": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "universo_nif": str(universe_nif),
            "universo_sociedades": str(universe),
            "n_alta": str(final_counts.get("alta", 0)),
            "n_media": str(final_counts.get("media", 0)),
            "n_debil": str(final_counts.get("debil", 0)),
            "n_ambigua": str(final_counts.get("ambigua", 0)),
            "n_sin_cruce": str(sin),
            "tasa_alta": ratio(int(final_counts.get("alta", 0))),
            "tasa_asignada": ratio(int(final_counts.get("alta", 0)) + int(final_counts.get("media", 0))),
            "fuente": "Agencia Estatal Boletín Oficial del Estado",
            "fuente_url": "https://www.boe.es",
            "nota": (
                "Cruce por nombre normalizado entre 2016 y 2023. El BORME no publica el NIF de forma sistemática. "
                "Indicador, no prueba."
            ),
        }
        for key, value in meta_rows.items():
            connection.execute("INSERT INTO borme_meta (clave, valor) VALUES (?, ?)", (key, value))
        borme_range = connection.execute("SELECT valor FROM borme.borme_meta WHERE clave = 'rango'").fetchone()
        if borme_range:
            connection.execute("INSERT INTO borme_meta (clave, valor) VALUES ('rango', ?)", (borme_range[0],))
        coverage = None
        attached = {
            name
            for (name,) in connection.execute(
                "SELECT name FROM borme.sqlite_master WHERE type = 'table'"
            )
        }
        if "acto" in attached:
            coverage = connection.execute("SELECT MIN(fecha), MAX(fecha) FROM borme.acto").fetchone()
        elif "sociedad" in attached:
            coverage = connection.execute(
                "SELECT MIN(fecha_ultimo), MAX(fecha_ultimo) FROM borme.sociedad"
            ).fetchone()
        if coverage and coverage[0] and coverage[1]:
            connection.execute(
                "INSERT INTO borme_meta (clave, valor) VALUES ('cobertura', ?)",
                (f"{coverage[0]}..{coverage[1]}",),
            )
        for key in ("n_actos", "n_sociedades", "n_actos_con_hoja", "n_actos_con_nif"):
            found = connection.execute("SELECT valor FROM borme.borme_meta WHERE clave = ?", (key,)).fetchone()
            if found:
                connection.execute("INSERT INTO borme_meta (clave, valor) VALUES (?, ?)", (key, found[0]))
        connection.executescript(
            """
            CREATE INDEX idx_borme_empresa_key ON borme_empresa(nombre_key);
            CREATE INDEX idx_borme_persona_ben ON borme_persona(beneficiario_id);
            CREATE INDEX idx_borme_persona_key ON borme_persona(nombre_key);
            CREATE INDEX idx_borme_fuente_ben ON borme_fuente(beneficiario_id);
            """
        )
        connection.commit()
        build_sociedad_alerts(connection)
        build_vinculo_alerts(connection)
        connection.commit()
        n_soc = connection.execute("SELECT COUNT(*) FROM alert_borme_sociedad").fetchone()[0]
        n_vin = connection.execute("SELECT COUNT(*) FROM alert_borme_vinculo").fetchone()[0]
        connection.execute("INSERT INTO borme_meta (clave, valor) VALUES ('n_alert_sociedad', ?)", (str(n_soc),))
        connection.execute("INSERT INTO borme_meta (clave, valor) VALUES ('n_alert_vinculo', ?)", (str(n_vin),))
        connection.commit()
        log(f"Indicadores: {n_soc} sociedades, {n_vin} vínculos")
        log(
            f"Tasa de cruce alto {meta_rows['tasa_alta']}; alto o medio {meta_rows['tasa_asignada']} "
            f"sobre {universe} sociedades"
        )
    finally:
        connection.close()


def build_sociedad_alerts(connection: sqlite3.Connection) -> None:
    log("Indicador de sociedades recientes, de poco capital o de cierre próximo")
    profiles = {}
    for row in connection.execute(
        """
        SELECT beneficiario_id, nif, nombre, confianza, fecha_constitucion, capital_const, capital,
               capital_fecha, capitales, disuelta, fecha_disolucion, fuente_const, fuente_dis, fuente_capital
        FROM borme_empresa
        WHERE confianza IN ('alta', 'media')
          AND (
            fecha_constitucion IS NOT NULL
            OR capital_const IS NOT NULL
            OR capital IS NOT NULL
            OR disuelta = 1
          )
        """
    ):
        profiles[int(row[0])] = row
    if not profiles:
        return
    connection.execute("CREATE TEMP TABLE shell_id (id INTEGER PRIMARY KEY)")
    connection.executemany("INSERT INTO shell_id (id) VALUES (?)", [(item,) for item in profiles])
    cursor = connection.execute(
        """
        SELECT c.beneficiario_id, c.organismo, c.organismo_norm, COALESCE(c.ccaa, 'No determinada'),
               c.fecha, c.importe, c.anio, c.id, COALESCE(c.codigo_bdns, ''), COALESCE(c.titulo, '')
        FROM concesiones c
        JOIN shell_id s ON s.id = c.beneficiario_id
        WHERE c.instrumento_slug = 'subvencion' AND c.importe > 0 AND c.fecha IS NOT NULL
          AND c.organismo_norm != ''
        ORDER BY c.beneficiario_id, c.organismo_norm, c.fecha, c.id
        """
    )
    alerts: list[tuple] = []
    items: list[tuple] = []
    next_id = 1
    current_key = None
    grants: list[tuple] = []

    def emit(regla: str, motivo: str, chosen: list[tuple], capital: float | None, ratio: float | None, dias: int | None, cve: str) -> None:
        nonlocal next_id
        if not chosen:
            return
        chosen = sorted(chosen, key=lambda grant: (grant[4], grant[7]))
        largest = max(chosen, key=lambda grant: grant[5])
        amount = sum(grant[5] for grant in chosen)
        profile = profiles[chosen[0][0]]
        alert_id = next_id
        next_id += 1
        alerts.append(
            (
                alert_id,
                regla,
                motivo,
                profile[3],
                profile[1],
                profile[0],
                profile[2],
                largest[1],
                largest[2],
                largest[3],
                int(chosen[0][6] or chosen[0][4][:4]),
                profile[4],
                capital,
                profile[10],
                amount,
                ratio,
                dias,
                cve,
                borme_url(cve),
            )
        )
        for grant in chosen[:15]:
            items.append((alert_id, grant[7], grant[4], grant[5], grant[8], grant[9][:240]))

    def consume(group: list[tuple]) -> None:
        if not group:
            return
        profile = profiles[group[0][0]]
        (
            _bid, _nif, nombre, level, fecha_const, capital_const, _capital, _capital_fecha,
            capitales, _disuelta, fecha_dis, fuente_const, fuente_dis, _fuente_capital,
        ) = profile
        caveat = ""
        if level == "media":
            caveat = "El nombre normalizado es poco distintivo y podría corresponder a otra sociedad homónima. "
        nueva: list[tuple] = []
        corta: list[tuple] = []
        ratio_rows: list[tuple] = []
        cierre: list[tuple] = []
        nueva_capital = None
        nueva_cve = ""
        ratio_best = None
        for grant in group:
            grant_day = grant[4]
            picked = capital_on(capitales or "", grant_day, fecha_const, capital_const, fuente_const or "")
            span_new = day_span(fecha_const, grant_day)
            span_dis = day_span(grant_day, fecha_dis)
            if (
                fecha_const
                and picked
                and picked[0] <= SMALL_CAPITAL
                and span_new is not None
                and 0 <= span_new <= NEW_DAYS
            ):
                nueva.append(grant)
                nueva_capital = picked[0]
                nueva_cve = picked[2] or fuente_const or ""
            if (
                fecha_const
                and fecha_dis
                and span_new is not None
                and span_dis is not None
                and 0 <= span_new <= NEW_DAYS
                and 0 <= span_dis <= NEW_DISSOLVE_DAYS
            ):
                corta.append(grant)
            if picked and 0 < picked[0] <= SMALL_CAPITAL and grant[5] >= max(MIN_GRANT, GRANT_VS_CAPITAL * picked[0]):
                ratio_rows.append(grant)
                ratio_value = grant[5] / picked[0]
                if ratio_best is None or ratio_value > ratio_best[0]:
                    ratio_best = (ratio_value, picked[0], picked[1], picked[2] or "", grant)
            if fecha_dis and span_dis is not None and 0 <= span_dis <= DISSOLVE_SOON_DAYS and grant[5] >= MIN_GRANT:
                cierre.append(grant)
        if nueva and max(grant[5] for grant in nueva) >= MIN_GRANT:
            cited = max(nueva, key=lambda grant: grant[5])
            span_new = day_span(fecha_const, cited[4]) or 0
            extra = ""
            if len(nueva) > 1:
                extra = f" En ese primer año hay {len(nueva)} subvenciones de este organismo."
            emit(
                "nueva_capital",
                (
                    f"{caveat}{nombre} figura constituida en el BORME el {fecha_es(fecha_const)} "
                    f"({fuente_const or 'sin identificador'}), {span_new} días antes de la subvención del "
                    f"{fecha_es(cited[4])}. El capital publicado es {euro(nueva_capital or 0)}. "
                    "Una sociedad recién creada con capital mínimo puede ser un vehículo y también una empresa pequeña legítima. "
                    f"Es un indicador, no una prueba.{extra}"
                ),
                nueva,
                nueva_capital,
                None,
                span_new,
                nueva_cve,
            )
        if corta and max(grant[5] for grant in corta) >= MIN_GRANT:
            cited = max(corta, key=lambda grant: grant[5])
            span_new = day_span(fecha_const, cited[4]) or 0
            span_dis = day_span(cited[4], fecha_dis) or 0
            emit(
                "nueva_disuelta",
                (
                    f"{caveat}Constituida el {fecha_es(fecha_const)} ({fuente_const or 'sin identificador'}) "
                    f"y con disolución o extinción publicada el {fecha_es(fecha_dis)} ({fuente_dis or 'sin identificador'}). "
                    f"La subvención del {fecha_es(cited[4])} cae {span_new} días después de la constitución y "
                    f"{span_dis} días antes del cierre. Es un indicador de sociedad de vida corta, no una prueba."
                ),
                corta,
                nueva_capital if nueva_capital is not None else capital_const,
                None,
                span_new,
                fuente_dis or fuente_const or "",
            )
        if ratio_best is not None:
            ratio_value, capital_value, capital_day, capital_cve, grant = ratio_best
            emit(
                "importe_capital",
                (
                    f"{caveat}La subvención de {euro(grant[5])} equivale a {ratio_value:.0f} veces el capital social de "
                    f"{euro(capital_value)} publicado en el BORME ({capital_cve or 'sin identificador'}, a {fecha_es(capital_day)}). "
                    "El capital social no mide el patrimonio ni la facturación. Es un indicador, no una prueba."
                ),
                ratio_rows,
                capital_value,
                ratio_value,
                day_span(fecha_const, grant[4]),
                capital_cve,
            )
        if cierre:
            closest = min(cierre, key=lambda grant: day_span(grant[4], fecha_dis) or 0)
            span_dis = day_span(closest[4], fecha_dis) or 0
            emit(
                "disuelta_pronto",
                (
                    f"{caveat}El BORME publica disolución o extinción el {fecha_es(fecha_dis)} "
                    f"({fuente_dis or 'sin identificador'}), {span_dis} días después de la subvención de "
                    f"{euro(closest[5])} del {fecha_es(closest[4])}. Un cierre posterior a la ayuda puede ser ordinario. "
                    "Es un indicador, no una prueba."
                ),
                cierre,
                None,
                None,
                span_dis,
                fuente_dis or "",
            )

    for raw in cursor:
        key = (raw[0], raw[2])
        if current_key is None:
            current_key = key
        if key != current_key:
            consume(grants)
            grants = []
            current_key = key
        grants.append(raw)
    consume(grants)
    connection.executemany(
        """
        INSERT INTO alert_borme_sociedad (
          id, regla, motivo, confianza, nif, beneficiario_id, nombre, organismo, organismo_norm, ccaa, anio,
          fecha_constitucion, capital, fecha_disolucion, importe, ratio, dias, fuente_cve, fuente_url
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        """,
        alerts,
    )
    connection.executemany(
        """
        INSERT INTO alert_borme_sociedad_item (alert_id, concesion_id, fecha, importe, codigo_bdns, titulo)
        VALUES (?,?,?,?,?,?)
        """,
        items,
    )
    connection.executescript(
        """
        CREATE INDEX idx_borme_soc_filter ON alert_borme_sociedad(ccaa, anio, importe DESC);
        CREATE INDEX idx_borme_soc_org ON alert_borme_sociedad(organismo_norm, importe DESC);
        CREATE INDEX idx_borme_soc_regla ON alert_borme_sociedad(regla, importe DESC);
        CREATE INDEX idx_borme_soc_item ON alert_borme_sociedad_item(alert_id);
        """
    )
    log(f"Sociedades señaladas: {len(alerts)}")


def build_vinculo_alerts(connection: sqlite3.Connection) -> None:
    log("Indicador de administradores y domicilios compartidos")
    people: dict[str, dict[int, tuple[str, str, str]]] = {}
    for beneficiario_id, rol, nombre, nombre_key, kind, confianza, nif, empresa in connection.execute(
        """
        SELECT p.beneficiario_id, p.rol, p.nombre, p.nombre_key, p.kind, e.confianza, e.nif, e.nombre
        FROM borme_persona p
        JOIN borme_empresa e ON e.beneficiario_id = p.beneficiario_id
        WHERE e.confianza = 'alta'
        """
    ):
        if kind == "E":
            if len(nombre_key) < 8:
                continue
        else:
            if len(nombre_key.split()) < 3 or len(nombre_key) < 12:
                continue
        bucket = people.setdefault(nombre_key, {})
        current = bucket.get(int(beneficiario_id))
        if current is None or rol == "A":
            bucket[int(beneficiario_id)] = (nombre, rol, confianza)
        _ = (nif, empresa)
    frequent = {key for key, members in people.items() if len(members) > 20 or len(members) < 2}
    for key in frequent:
        people.pop(key, None)

    addresses: dict[str, dict[int, str]] = {}
    for beneficiario_id, domicilio_key, domicilio in connection.execute(
        """
        SELECT beneficiario_id, domicilio_key, domicilio
        FROM borme_empresa
        WHERE confianza = 'alta' AND domicilio_key != ''
        """
    ):
        if len(domicilio_key) < 12 or not any(char.isdigit() for char in domicilio_key):
            continue
        addresses.setdefault(domicilio_key, {})[int(beneficiario_id)] = domicilio
    for key in [key for key, members in addresses.items() if len(members) < 2 or len(members) > 12]:
        addresses.pop(key, None)

    ben_ids = set()
    for members in people.values():
        ben_ids.update(members)
    for members in addresses.values():
        ben_ids.update(members)
    if not ben_ids:
        connection.executescript(
            """
            CREATE INDEX idx_borme_vin_filter ON alert_borme_vinculo(ccaa, anio, importe DESC);
            CREATE INDEX idx_borme_vin_org ON alert_borme_vinculo(organismo_norm);
            CREATE INDEX idx_borme_vin_tipo ON alert_borme_vinculo(tipo, importe DESC);
            CREATE INDEX idx_borme_vin_m ON alert_borme_vinculo_miembro(alert_id);
            CREATE INDEX idx_borme_vin_i ON alert_borme_vinculo_item(alert_id);
            """
        )
        log("Vínculos: 0")
        return
    connection.execute("CREATE TEMP TABLE link_id (id INTEGER PRIMARY KEY)")
    connection.executemany("INSERT INTO link_id (id) VALUES (?)", [(item,) for item in ben_ids])
    grants: dict[int, list[tuple]] = {}
    for row in connection.execute(
        """
        SELECT c.beneficiario_id, c.organismo_norm, MAX(c.organismo), COALESCE(MAX(c.ccaa), 'No determinada'),
               MAX(c.anio), COUNT(*), SUM(c.importe)
        FROM concesiones c
        JOIN link_id s ON s.id = c.beneficiario_id
        WHERE c.instrumento_slug = 'subvencion' AND c.importe > 0 AND c.organismo_norm != ''
        GROUP BY c.beneficiario_id, c.organismo_norm
        """
    ):
        grants.setdefault(int(row[0]), []).append(row)

    empresas = {
        int(row[0]): row
        for row in connection.execute(
            "SELECT beneficiario_id, nif, nombre, confianza, fuente_const, fuente_dom, domicilio FROM borme_empresa WHERE confianza = 'alta'"
        )
    }
    alerts: list[tuple] = []
    members_out: list[tuple] = []
    next_id = 1

    def emit(tipo: str, clave: str, etiqueta: str, motivo: str, organismo_norm: str, chosen: list[tuple]) -> None:
        nonlocal next_id
        if len(chosen) < 2 or len(chosen) > 12:
            return
        years = [int(item[4]) for item in chosen if item[4]]
        anio = max(years) if years else 0
        ccaa_counts: dict[str, int] = {}
        for item in chosen:
            ccaa_counts[item[3]] = ccaa_counts.get(item[3], 0) + 1
        ccaa = max(ccaa_counts, key=ccaa_counts.get)
        organismo = chosen[0][2]
        amount = sum(float(item[6]) for item in chosen)
        alert_id = next_id
        next_id += 1
        alerts.append((alert_id, tipo, motivo, clave, etiqueta, organismo, organismo_norm, ccaa, anio, len(chosen), amount))
        for item in chosen:
            empresa = empresas.get(int(item[0]))
            fuente = ""
            if empresa:
                fuente = borme_url(empresa[4] or empresa[5] or "")
            members_out.append(
                (
                    alert_id,
                    int(item[0]),
                    empresa[1] if empresa else "",
                    empresa[2] if empresa else "",
                    empresa[3] if empresa else "alta",
                    float(item[6]),
                    int(item[5]),
                    fuente,
                )
            )

    org_people: dict[str, dict[str, list[tuple]]] = {}
    for key, members in people.items():
        for beneficiario_id, (display, rol, _confianza) in members.items():
            for grant in grants.get(beneficiario_id, []):
                org_people.setdefault(grant[1], {}).setdefault(key, []).append((grant, display, rol))
    for organismo_norm, grouped in org_people.items():
        for key, packed in grouped.items():
            by_ben: dict[int, tuple] = {}
            label = packed[0][1]
            roles = set()
            for grant, display, rol in packed:
                by_ben[int(grant[0])] = grant
                label = display
                roles.add(rol)
            if len(by_ben) < 2:
                continue
            tipo = "socio" if roles == {"S"} else "administrador"
            noun = "socio único" if tipo == "socio" else "administrador"
            emit(
                tipo,
                key,
                label,
                (
                    f"{len(by_ben)} beneficiarios con NIF distinto recibieron subvenciones de este organismo y el BORME "
                    f"publica a la misma persona como {noun}: {label}. El boletín no incluye el DNI, así que un homónimo "
                    "puede explicar la coincidencia. Es un indicador, no una prueba de concertación."
                ),
                organismo_norm,
                list(by_ben.values()),
            )

    org_address: dict[str, dict[str, list[tuple]]] = {}
    for key, members in addresses.items():
        for beneficiario_id, display in members.items():
            for grant in grants.get(beneficiario_id, []):
                org_address.setdefault(grant[1], {}).setdefault(key, []).append((grant, display))
    for organismo_norm, grouped in org_address.items():
        for key, packed in grouped.items():
            by_ben = {}
            label = packed[0][1]
            for grant, display in packed:
                by_ben[int(grant[0])] = grant
                label = display
            if len(by_ben) < 2:
                continue
            emit(
                "domicilio",
                key,
                label,
                (
                    f"{len(by_ben)} beneficiarios con NIF distinto recibieron subvenciones de este organismo y el BORME "
                    f"publica el mismo domicilio social: {label}. Una gestoría o un centro de negocios también concentran "
                    "domicilios. Es un indicador, no una prueba."
                ),
                organismo_norm,
                list(by_ben.values()),
            )

    connection.executemany(
        """
        INSERT INTO alert_borme_vinculo (
          id, tipo, motivo, clave, etiqueta, organismo, organismo_norm, ccaa, anio, n_beneficiarios, importe
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?)
        """,
        alerts,
    )
    connection.executemany(
        """
        INSERT INTO alert_borme_vinculo_miembro (
          alert_id, beneficiario_id, nif, nombre, confianza, importe, n, fuente_url
        ) VALUES (?,?,?,?,?,?,?,?)
        """,
        members_out,
    )
    if members_out:
        organismo_por_alerta = {item[0]: item[6] for item in alerts}
        connection.execute("CREATE TEMP TABLE vinculo_par (alert_id INTEGER, beneficiario_id INTEGER, organismo_norm TEXT)")
        connection.executemany(
            "INSERT INTO vinculo_par (alert_id, beneficiario_id, organismo_norm) VALUES (?,?,?)",
            [(row[0], row[1], organismo_por_alerta[row[0]]) for row in members_out],
        )
        tops: dict[tuple[int, int], list[tuple]] = {}
        for row in connection.execute(
            """
            SELECT p.alert_id, c.beneficiario_id, c.id, c.fecha, c.importe, COALESCE(c.titulo, ''), COALESCE(c.codigo_bdns, '')
            FROM vinculo_par p
            JOIN alert_borme_vinculo v ON v.id = p.alert_id
            JOIN concesiones c ON c.beneficiario_id = p.beneficiario_id AND c.organismo_norm = v.organismo_norm
            WHERE c.instrumento_slug = 'subvencion' AND c.importe > 0
            """
        ):
            slot = tops.setdefault((int(row[0]), int(row[1])), [])
            slot.append((row[4], row[2], row[3], row[5], row[6]))
            slot.sort(reverse=True)
            del slot[4:]
        flat = []
        for (alert_id, beneficiario_id), slot in tops.items():
            for importe, concesion_id, fecha, titulo, codigo in slot:
                flat.append((alert_id, beneficiario_id, concesion_id, fecha, importe, titulo[:240], codigo))
        connection.executemany(
            """
            INSERT INTO alert_borme_vinculo_item (
              alert_id, beneficiario_id, concesion_id, fecha, importe, titulo, codigo_bdns
            ) VALUES (?,?,?,?,?,?,?)
            """,
            flat,
        )
    connection.executescript(
        """
        CREATE INDEX idx_borme_vin_filter ON alert_borme_vinculo(ccaa, anio, importe DESC);
        CREATE INDEX idx_borme_vin_org ON alert_borme_vinculo(organismo_norm);
        CREATE INDEX idx_borme_vin_tipo ON alert_borme_vinculo(tipo, importe DESC);
        CREATE INDEX idx_borme_vin_m ON alert_borme_vinculo_miembro(alert_id);
        CREATE INDEX idx_borme_vin_i ON alert_borme_vinculo_item(alert_id);
        """
    )
    log(f"Vínculos: {len(alerts)}")


def report() -> None:
    if DB_PATH.exists():
        connection = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)
        try:
            if table_exists(connection, "borme_meta"):
                for key, value in connection.execute("SELECT clave, valor FROM borme_meta ORDER BY clave"):
                    print(f"{key}\t{value}")
                print("--- reglas ---")
                if table_exists(connection, "alert_borme_sociedad"):
                    for regla, n in connection.execute(
                        "SELECT regla, COUNT(*) AS n FROM alert_borme_sociedad GROUP BY regla ORDER BY n DESC"
                    ):
                        print(f"sociedad\t{regla}\t{n}")
                if table_exists(connection, "alert_borme_vinculo"):
                    for tipo, n in connection.execute(
                        "SELECT tipo, COUNT(*) AS n FROM alert_borme_vinculo GROUP BY tipo ORDER BY n DESC"
                    ):
                        print(f"vinculo\t{tipo}\t{n}")
                return
        finally:
            connection.close()
    if not BORME_PATH.exists():
        raise SystemExit("Todavía no hay extracto BORME ni cruce en el índice.")
    connection = sqlite3.connect(f"file:{BORME_PATH}?mode=ro", uri=True)
    try:
        for key, value in connection.execute("SELECT clave, valor FROM borme_meta ORDER BY clave"):
            print(f"{key}\t{value}")
        if table_exists(connection, "acto"):
            print("actos", connection.execute("SELECT COUNT(*) FROM acto").fetchone()[0])
        if table_exists(connection, "sociedad"):
            print("sociedades", connection.execute("SELECT COUNT(*) FROM sociedad").fetchone()[0])
    finally:
        connection.close()


def muestra(limit: int) -> None:
    connection = connect_bdns()
    try:
        connection.execute("ATTACH DATABASE ? AS borme", (str(BORME_PATH),))
        print("confianza\tnif\tnombre_bdns\tnombre_borme\tprovincia\thoja\tconstitucion\tcapital\turl")
        rows = connection.execute(
            """
            SELECT e.confianza, e.nif, e.nombre, COALESCE(s.nombre, ''), e.provincia, e.hoja,
                   e.fecha_constitucion, COALESCE(e.capital_const, e.capital),
                   COALESCE(e.fuente_const, e.fuente_capital, e.fuente_dom, '')
            FROM borme_empresa e
            LEFT JOIN borme.sociedad s ON s.registro_key = e.registro_key
            WHERE e.confianza IN ('alta', 'media') AND e.registro_key IS NOT NULL
            ORDER BY e.confianza, RANDOM()
            LIMIT ?
            """,
            (limit,),
        )
        for confianza, nif, nombre, borme_nombre, provincia, hoja, fecha, capital, cve in rows:
            capital_text = "" if capital is None else f"{capital:.2f}"
            print(
                "\t".join(
                    [
                        confianza,
                        nif or "",
                        (nombre or "").replace("\t", " "),
                        (borme_nombre or "").replace("\t", " "),
                        provincia or "",
                        hoja or "",
                        fecha or "",
                        capital_text,
                        borme_url(cve),
                    ]
                )
            )
    finally:
        connection.close()


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Cruce opcional de beneficiarios BDNS con el BORME.")
    parser.add_argument("--self-check", action="store_true")
    parser.add_argument("command", nargs="?", choices=["fetch", "aggregate", "match", "run", "report", "muestra"])
    parser.add_argument("--from", dest="start", default=DEFAULT_FROM)
    parser.add_argument("--to", dest="end", default=DEFAULT_TO)
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--gap", type=float, default=0.12)
    parser.add_argument("--compact", action="store_true")
    parser.add_argument("--limit", type=int, default=40)
    parser.add_argument("--db", default="", help="Ruta alternativa del extracto SQLite")
    return parser.parse_args(argv)


def main() -> None:
    global BORME_PATH
    args = parse_args(sys.argv[1:])
    if args.db:
        BORME_PATH = Path(args.db)
    if args.self_check or args.command is None and "--self-check" in sys.argv:
        self_check()
        if args.command is None:
            return
    command = args.command
    if command is None:
        self_check()
        return
    if command == "fetch":
        fetch(args.start, args.end, max(1, args.workers), max(0.05, args.gap))
        return
    if command == "aggregate":
        aggregate(compact=args.compact)
        return
    if command == "match":
        match()
        return
    if command == "report":
        report()
        return
    if command == "muestra":
        muestra(max(1, args.limit))
        return
    if command == "run":
        fetch(args.start, args.end, max(1, args.workers), max(0.05, args.gap))
        aggregate(compact=True)
        match()
        return
    raise SystemExit(f"Comando desconocido: {command}")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(130)
