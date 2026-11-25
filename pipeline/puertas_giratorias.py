#!/usr/bin/env python3
"""Puertas giratorias: a local official leaves office and later joins a supplier.

Phase 1 uses only data that is already on disk. It does not rebuild the BDNS
index and it does not download the BORME again.

    python3 pipeline/puertas_giratorias.py --self-check
    python3 pipeline/puertas_giratorias.py
    python3 pipeline/puertas_giratorias.py --limit 50000

Inputs, overridable with flags or ``BDNS_DB``, ``POLITICOS_DB`` and ``BORME_DB``:

- ``data/politicos.sqlite`` — concejales, alcaldes and cabildos for 2015 and 2019
- ``data/borme/borme.sqlite`` — table ``persona_cargo`` (first appointment, a
  later one, and the latest dismissal). ``acto`` is only a fallback while it
  still exists. If compaction removed it and ``persona_cargo`` was never
  built, the command stops and says how to fetch again.
- ``data/bdns.sqlite`` — ``borme_empresa``, concessions, and ``placsp_contrato``
  when the contracts step has been run
- ``data/boe/altos.sqlite`` — optional. Built by ``pipeline/boe_altos.py`` from
  BOE section II.A. State high office is crossed only when that cache exists.

Assumptions about the end of the mandate, stated on every row:

- A 2015 office that does not appear in 2019 is treated as ended on 14 Jun 2019.
  Councillor dates are the term, not a resignation. An earlier alcalde baja is
  used only when no councillor row in that municipality lasts longer.
- There is no 2023 electoral file. Every 2019 office is treated as ended on
  16 Jun 2023, even if that person was re-elected. A row can name someone who
  was still in the seat.
- The appointment date is the earliest nombramiento on that registry sheet, or
  a later nombramiento or reelección when the earliest one falls before the
  person leaves office. A cese is not an appointment. The compact table keeps
  the first date and the last one, not every notice in between. Attorneys-in-fact
  are not in the extract. The date is the gazette day, not the inscription day.
- The gazette date is the publication day, not the inscription day printed in
  the paragraph.
- Money is subsidies (not guarantees or loans) plus PLACSP awards, from an organ
  of the same municipality, mancomunidad, island or province, dated on or before
  the appointment. Amounts during the mandate weigh more than amounts only in
  the gap after leaving.
- ``durante`` is a different subtype: the first publication falls while the
  person still holds the seat. That is the overlap ``vinculos.py`` already
  looks at, not a door that turns after the person leaves. It is kept, with a
  higher bar, so the two patterns are not mixed.
- A first publication before the seat starts is dropped for that seat. The
  person was already on the board.
- Companies whose name looks municipal or public, and NIF letters P, Q and S,
  are dropped. So are BORME matches that are not alta or media, names shared by
  three or more offices, and names that show up on more than 12 companies.

The score is an indicator, not proof of a revolving door or of a homonym.

On a 2 GB host the script streams the gazette, keeps one row per person and
company, and aggregates grants in SQLite instead of in a join held in RAM.
Expect roughly 20–50 minutes and a resident set around 400–800 MB for the full
2016–2023 extract. ``--limit`` reads the first N acts in storage order and
marks the result as partial.
"""

from __future__ import annotations

import argparse
import math
import os
import re
import sqlite3
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from pathlib import Path

from nombres import (
    UNIQUE_BONUS,
    IndiceNombres,
    Persona,
    fold_name,
    interpretations,
)
from territorio import LOCAL_PREFIXES, MunicipioIndex

ROOT = Path(__file__).resolve().parents[1]
DB_PATH = Path(os.environ.get("BDNS_DB", ROOT / "data" / "bdns.sqlite"))
POLITICOS_PATH = Path(os.environ.get("POLITICOS_DB", ROOT / "data" / "politicos.sqlite"))
BORME_PATH = Path(os.environ.get("BORME_DB", ROOT / "data" / "borme" / "borme.sqlite"))

TERM_2015_END = "2019-06-14"
TERM_2019_START = "2019-06-15"
TERM_2019_END = "2023-06-16"
WINDOW_YEARS = 4
NAME_FLOOR = 0.85
MAX_EMPRESAS = 12
MIN_EUROS = 3_000.0
MIN_DESPUES = 0.58
MIN_DURANTE = 0.70
MONEY_CAP = 5_000_000.0
HUGE_NIF = 80_000

ROL_LARGO = {
    "alcalde": "titular de la alcaldía",
    "concejal": "concejal electo",
    "consejero_insular": "miembro electo del cabildo",
    "diputado": "diputado autonómico",
    "alto_cargo": "alto cargo",
}
ROL_RANK = {
    "alcalde": 5,
    "alto_cargo": 4,
    "consejero_insular": 3,
    "diputado": 3,
    "concejal": 1,
}

SUPUESTO_TEXTO = {
    "ausente_en_2019": (
        "Supuesto de cese: ese cargo de 2015 no está en el fichero de 2019, así que el último día "
        "es el 14 jun 2019 salvo una baja de alcalde anterior que no quede tapada por una concejalía. "
        "La fecha de concejal es la del mandato, no una dimisión."
    ),
    "fin_2023": (
        "Supuesto de cese: no hay fichero de electos de 2023. Todo cargo del mandato 2019-2023 se trata "
        "como cesado el 16 jun 2023 aunque esa persona hubiera repetido. Puede seguir en el escaño."
    ),
    "baja_alcalde": (
        "Supuesto de cese: el registro de alcaldes trae una baja anterior al fin del mandato y no hay "
        "concejalía en el mismo sitio con fecha posterior."
    ),
    "fecha_publicada": (
        "El cese es la fecha publicada de ese cargo, no una inferencia del calendario electoral."
    ),
}

NOT_MUNICIPAL = (
    "DIPUTACION",
    "DIPUTACIO",
    "DEPUTACION",
    "CABILDO",
    "CONSELL INSULAR",
    "PARLAMENTO",
    "PARLAMENT ",
    "CORTES DE",
    "CORTS VALENCIAN",
    "ASAMBLEA DE",
    "ASAMBLEA REGIONAL",
    "JUNTA GENERAL",
    "MINISTERIO",
    "CONSEJERIA",
    "CONSELLERIA",
    "GENERALITAT",
    "XUNTA DE",
    "GOBIERNO VASCO",
    "GOBIERNO DE ",
)
EXPLICIT_COUNCIL = ("AYUNTAMIENTO", "AJUNTAMENT", "CONCELLO", "UDALA")
PARLIAMENT_MARKERS = (
    "PARLAMENTO DE",
    "PARLAMENT DE",
    "CORTES DE",
    "CORTS VALENCIAN",
    "ASAMBLEA DE",
    "ASAMBLEA REGIONAL",
    "JUNTA GENERAL",
)
TERRITORY_SCORE = {
    "municipio": 1.0,
    "mancomunidad": 0.82,
    "ministerio": 0.75,
    "isla": 0.72,
    "parlamento": 0.70,
    "provincia": 0.48,
}
PUBLIC_RE = re.compile(
    r"\bMUNICIPAL(?:ES)?\b"
    r"|\bPUBLICAS?\b"
    r"|\bPUBLICOS?\b"
    r"|\bPATRONATOS?\b"
    r"|\bPATRONATS?\b"
    r"|SOCIEDAD MIXTA"
    r"|\b(?:AYUNTAMIENTO|AJUNTAMENT|CONCELLO|UDALA|CABILDO|DIPUTACION|DIPUTACIO|MANCOMUNIDAD|MANCOMUNITAT)\b"
)
ISO_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def log(message: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {message}", flush=True)


def rss_mb() -> int:
    try:
        with open("/proc/self/status", encoding="utf-8") as handle:
            for line in handle:
                if line.startswith("VmRSS:"):
                    return int(line.split()[1]) // 1024
    except OSError:
        return 0
    return 0


def clamp(value: float) -> float:
    if value < 0:
        return 0.0
    if value > 1:
        return 1.0
    return value


def text_of(value: object) -> str:
    if value is None:
        return ""
    return str(value).strip()


def float_of(value: object) -> float:
    if value is None or value == "":
        return 0.0
    return float(value)


def optional_int(value: object) -> int | None:
    if value is None or value == "":
        return None
    return int(value)


def fecha_es(iso: str) -> str:
    if not ISO_RE.fullmatch(iso or ""):
        return "fecha no publicada"
    year, month, day = iso.split("-")
    return f"{day}/{month}/{year}"


def shift_days(iso: str, days: int) -> str:
    found = datetime.strptime(iso, "%Y-%m-%d") + timedelta(days=days)
    return found.strftime("%Y-%m-%d")


def add_years(iso: str, years: int) -> str:
    found = datetime.strptime(iso, "%Y-%m-%d")
    try:
        return found.replace(year=found.year + years).strftime("%Y-%m-%d")
    except ValueError:
        return found.replace(year=found.year + years, day=28).strftime("%Y-%m-%d")


def day_gap(start: str, end: str) -> int:
    left = datetime.strptime(start, "%Y-%m-%d")
    right = datetime.strptime(end, "%Y-%m-%d")
    return (right - left).days


def euro(value: float) -> str:
    if abs(value - round(value)) < 0.001:
        amount = f"{value:,.0f}"
    else:
        amount = f"{value:,.2f}"
    amount = amount.replace(",", "X").replace(".", ",").replace("X", ".")
    return f"{amount} €"


def borme_url(cve: str) -> str:
    if not cve:
        return ""
    return f"https://www.boe.es/diario_borme/txt.php?id={cve}"


def decode_people(blob: str) -> list[tuple[str, str, str, str, str]]:
    """Same tab layout ``borme.encode_people`` writes. A 4-field row is a nombramiento."""
    rows: list[tuple[str, str, str, str, str]] = []
    for line in (blob or "").split("\n"):
        parts = line.split("\t")
        if len(parts) == 4:
            rows.append((parts[0], parts[1], parts[2], parts[3], "nombramiento"))
            continue
        if len(parts) == 5:
            rows.append((parts[0], parts[1], parts[2], parts[3], parts[4] or "nombramiento"))
    return rows


def empresa_publica(nombre: str) -> bool:
    folded = fold_name(nombre)
    if not folded:
        return False
    if PUBLIC_RE.search(folded):
        return True
    return False


def nif_publico(nif: str) -> bool:
    cleaned = (nif or "").strip().upper()
    if not cleaned:
        return False
    return cleaned[0] in {"P", "Q", "S"}


def puntos_nombre(confianza: float) -> float:
    return clamp((confianza - 0.80) / 0.16)


def puntos_territorio(coherencia: str) -> float:
    return TERRITORY_SCORE.get(coherencia, 0.0)


def puntos_tiempo(dias: int, tipo: str) -> float:
    if tipo == "durante":
        return 0.55
    span = WINDOW_YEARS * 365
    return clamp(1.0 - 0.8 * (max(dias, 0) / span))


def puntos_dinero(importe_mandato: float, importe_previo: float) -> float:
    if importe_mandato > 0:
        base = importe_mandato
    else:
        base = importe_previo * 0.5
    if base <= 0:
        return 0.0
    return clamp(math.log10(base) / math.log10(MONEY_CAP))


def puntos_tamano(capital: float | None, importe_total: float) -> float:
    size = 0.6
    if capital is not None and capital > 0:
        if capital <= 10_000:
            size = 1.0
        elif capital <= 100_000:
            size = 0.78
        elif capital <= 1_000_000:
            size = 0.5
        else:
            size = 0.22
    if importe_total >= 5_000_000:
        return min(size, 0.28)
    if importe_total >= 1_000_000:
        return min(size, 0.45)
    return size


def puntuacion(
    confianza: float,
    lugares: int,
    coherencia: str,
    dias: int,
    tipo: str,
    importe_mandato: float,
    importe_previo: float,
    capital: float | None,
    importe_total: float,
) -> float:
    raw = (
        0.30 * puntos_nombre(confianza)
        + 0.22 * puntos_territorio(coherencia)
        + 0.18 * puntos_tiempo(dias, tipo)
        + 0.20 * puntos_dinero(importe_mandato, importe_previo)
        + 0.10 * puntos_tamano(capital, importe_total)
    )
    if tipo == "durante":
        raw -= 0.06
    if lugares >= 2:
        raw -= 0.05
    return round(clamp(raw), 4)


def publica(tipo: str, score: float, importe_mandato: float, importe_previo: float) -> bool:
    if importe_mandato > 0:
        money = importe_mandato
    else:
        money = importe_previo
    if money < MIN_EUROS:
        return False
    if tipo == "durante":
        return score >= MIN_DURANTE
    return score >= MIN_DESPUES


@dataclass(frozen=True)
class Cargo:
    nombre: str
    persona: Persona
    rol: str
    ambito: str
    cuerpo: str
    municipio: str
    ine: str
    provincia: str
    ccaa: str
    desde: str
    hasta: str
    partido: str
    fuente: str
    fuente_url: str
    clave_organo: str
    precision_fechas: str

    @property
    def place_id(self) -> str:
        if self.ambito == "municipal" and self.ine:
            return f"municipal:{self.ine}"
        if self.ambito == "insular":
            return f"insular:{fold_name(self.municipio)}"
        return f"{self.ambito}:{fold_name(self.clave_organo)}:{fold_name(self.cuerpo)}"


@dataclass(frozen=True)
class Salida:
    firma: str
    persona: Persona
    nombre: str
    rol: str
    ambito: str
    cuerpo: str
    municipio: str
    ine: str
    provincia: str
    ccaa: str
    desde: str
    hasta: str
    ventana: str
    partido: str
    fuente: str
    fuente_url: str
    clave_organo: str
    precision_fechas: str
    supuesto: str

    @property
    def place_id(self) -> str:
        if self.ambito == "municipal" and self.ine:
            return f"municipal:{self.ine}"
        if self.ambito == "insular":
            return f"insular:{fold_name(self.municipio)}"
        return f"{self.ambito}:{fold_name(self.clave_organo)}:{fold_name(self.cuerpo)}"


@dataclass
class Mencion:
    firma: str
    registro_key: str
    fecha: str
    cve: str
    empresa: str
    nombre_borme: str
    confianza: float
    lugares: int
    modo: str
    accion: str = "nombramiento"
    fecha_alta: str = ""
    accion_alta: str = ""
    cve_alta: str = ""
    fecha_ultimo: str = ""
    accion_ultimo: str = ""
    cve_ultimo: str = ""
    fecha_cese: str = ""
    cve_cese: str = ""


@dataclass
class Empresa:
    registro_key: str
    nif: str
    beneficiario_id: int | None
    nombre: str
    confianza: str
    capital: float | None


@dataclass
class Movimiento:
    clase: str
    ref: str
    fecha: str
    importe: float
    titulo: str
    url: str
    administracion: str
    departamento: str
    organo: str
    organismo: str
    organismo_norm: str
    ccaa: str
    extra: str = ""


@dataclass
class Item:
    clase: str
    ref: str
    fecha: str
    importe: float
    titulo: str
    url: str


@dataclass
class Caso:
    tipo: str
    puntuacion: float
    confianza_nombre: float
    lugares: int
    modo: str
    motivo: str
    nif: str
    beneficiario_id: int | None
    empresa: str
    confianza_empresa: str
    capital: float | None
    importe_total_empresa: float
    politico_nombre: str
    rol: str
    cuerpo: str
    partido: str
    municipio: str
    provincia: str
    ccaa: str
    mandato_desde: str
    mandato_hasta: str
    precision_fechas: str
    supuesto: str
    cese: str
    nombramiento: str
    dias: int
    admin_cargo: str
    admin_nombre: str
    organismo: str
    organismo_norm: str
    coherencia: str
    importe_mandato: float
    importe_previo: float
    n_ayudas: int
    n_contratos: int
    anio: int
    fuente_borme: str
    fuente_url: str
    fuente_politico: str
    fuente_politico_url: str
    items: list[Item] = field(default_factory=list)


def clasificar(fecha: str, salida: Salida) -> str:
    if not ISO_RE.fullmatch(fecha):
        return "fuera"
    if fecha < salida.desde:
        return "antes"
    if fecha <= salida.hasta:
        return "durante"
    if fecha <= salida.ventana:
        return "despues"
    return "tarde"


def precision_de(cargos: list[Cargo], cese: str) -> str:
    for cargo in cargos:
        if cargo.hasta == cese and cargo.precision_fechas == "mandato":
            return "mandato"
    for cargo in cargos:
        if cargo.hasta == cese and cargo.precision_fechas == "posesion":
            return "posesion"
    return "mandato"


def principal_de(cargos: list[Cargo]) -> Cargo:
    return max(cargos, key=lambda cargo: (ROL_RANK.get(cargo.rol, 0), cargo.desde, cargo.hasta))


def fuentes_de(cargos: list[Cargo]) -> str:
    found: list[str] = []
    for cargo in cargos:
        if cargo.fuente and cargo.fuente not in found:
            found.append(cargo.fuente)
    return ". ".join(found)


def salida_local(cargos: list[Cargo]) -> Salida | None:
    dated = [cargo for cargo in cargos if cargo.desde and cargo.hasta]
    if not dated:
        return None
    start = min(cargo.desde for cargo in dated)
    has_2019 = any(cargo.desde >= TERM_2019_START or cargo.hasta > TERM_2015_END for cargo in dated)
    if has_2019:
        limit = TERM_2019_END
        supuesto = "fin_2023"
    else:
        limit = TERM_2015_END
        supuesto = "ausente_en_2019"
    early = [
        cargo.hasta
        for cargo in dated
        if cargo.rol == "alcalde" and cargo.precision_fechas == "posesion" and cargo.hasta
    ]
    concejal_hasta = [
        cargo.hasta for cargo in dated if cargo.rol != "alcalde" and cargo.hasta
    ]
    last_concejal = max(concejal_hasta) if concejal_hasta else ""
    cese = max(cargo.hasta for cargo in dated)
    if early and max(early) < limit and (not last_concejal or max(early) >= last_concejal):
        cese = max(early)
        supuesto = "baja_alcalde"
    if cese < start:
        return None
    head = principal_de(dated)
    return Salida(
        firma=head.persona.firma,
        persona=head.persona,
        nombre=head.nombre,
        rol=head.rol,
        ambito=head.ambito,
        cuerpo=head.cuerpo,
        municipio=head.municipio,
        ine=head.ine,
        provincia=head.provincia,
        ccaa=head.ccaa,
        desde=start,
        hasta=cese,
        ventana=add_years(cese, WINDOW_YEARS),
        partido=head.partido,
        fuente=fuentes_de(dated),
        fuente_url=head.fuente_url,
        clave_organo=head.clave_organo,
        precision_fechas=precision_de(dated, cese),
        supuesto=supuesto,
    )


def salida_publicada(cargo: Cargo) -> Salida | None:
    if not cargo.desde or not cargo.hasta or cargo.hasta < cargo.desde:
        return None
    return Salida(
        firma=cargo.persona.firma,
        persona=cargo.persona,
        nombre=cargo.nombre,
        rol=cargo.rol,
        ambito=cargo.ambito,
        cuerpo=cargo.cuerpo,
        municipio=cargo.municipio,
        ine=cargo.ine,
        provincia=cargo.provincia,
        ccaa=cargo.ccaa,
        desde=cargo.desde,
        hasta=cargo.hasta,
        ventana=add_years(cargo.hasta, WINDOW_YEARS),
        partido=cargo.partido,
        fuente=cargo.fuente,
        fuente_url=cargo.fuente_url,
        clave_organo=fold_name(cargo.clave_organo),
        precision_fechas=cargo.precision_fechas or "fecha_publicada",
        supuesto="fecha_publicada",
    )


def salidas_de(cargos: list[Cargo]) -> list[Salida]:
    grouped: dict[tuple[str, str], list[Cargo]] = {}
    published: list[Salida] = []
    for cargo in cargos:
        if cargo.ambito in {"municipal", "insular"}:
            grouped.setdefault((cargo.persona.firma, cargo.place_id), []).append(cargo)
            continue
        salida = salida_publicada(cargo)
        if salida is not None:
            published.append(salida)
    salidas: list[Salida] = []
    for bucket in grouped.values():
        salida = salida_local(bucket)
        if salida is not None:
            salidas.append(salida)
    salidas.extend(published)
    return salidas


def resolve_organo(text: str, ccaa: str, municipios: MunicipioIndex) -> str | None:
    direct = municipios.resolve_text(text, ccaa)
    if direct:
        return direct
    folded = fold_name(text)
    if not folded:
        return None
    for prefix in LOCAL_PREFIXES:
        index = folded.find(prefix)
        if index < 0:
            continue
        tokens = folded[index + len(prefix) :].split()
        size = min(5, len(tokens))
        while size > 0:
            found = municipios.lookup(" ".join(tokens[:size]), ccaa)
            if len(found) == 1:
                return found[0]
            size -= 1
    return None


MINISTRY_GENERIC = frozenset(
    {
        "MINISTERIO",
        "MINISTERIOS",
        "FUNCION",
        "PUBLICA",
        "PUBLICO",
        "POLITICA",
        "GENERAL",
        "ESTADO",
        "ASUNTOS",
        "SECRETARIA",
        "GOBIERNO",
        "PRESIDENCIA",
        "RELACIONES",
        "MEMORIA",
        "DEMOCRATICA",
    }
)


def ministry_tokens(value: str) -> set[str]:
    return {token for token in fold_name(value).split() if len(token) >= 7 and token not in MINISTRY_GENERIC}


def coherencia(
    salida: Salida,
    campos: list[str],
    ccaa: str,
    municipios: MunicipioIndex,
) -> str | None:
    pieces = [piece for piece in campos if piece]
    if not pieces:
        return None
    blob = fold_name(" ".join(pieces))
    if not blob:
        return None
    scope = ccaa or salida.ccaa
    matched_ine = ""
    if salida.ine:
        for piece in pieces:
            found = resolve_organo(piece, scope, municipios)
            if found == salida.ine:
                matched_ine = found
                break
    explicit = any(token in blob for token in EXPLICIT_COUNCIL)
    blocked = any(token in blob for token in NOT_MUNICIPAL)
    if matched_ine and (explicit or not blocked):
        return "municipio"
    if salida.rol == "diputado":
        if any(marker in blob for marker in PARLIAMENT_MARKERS):
            if not ccaa or ccaa in {"", "No determinada"} or ccaa == salida.ccaa:
                return "parlamento"
    if salida.clave_organo and len(salida.clave_organo) >= 8 and salida.clave_organo in blob:
        return "ministerio"
    if salida.ambito == "estatal" and "MINISTERIO" in blob:
        if ministry_tokens(salida.clave_organo) & ministry_tokens(blob):
            return "ministerio"
    if any(token in blob for token in ("DIPUTACION", "DIPUTACIO", "DEPUTACION")) and not explicit:
        province = fold_name(salida.provincia)
        padded = f" {blob} "
        if province and (f" {province} " in padded or blob.endswith(province)):
            return "provincia"
    if "MANCOMUNIDAD" in blob or "MANCOMUNITAT" in blob:
        municipality = fold_name(salida.municipio)
        if len(municipality) >= 4 and f" {municipality} " in f" {blob} ":
            return "mancomunidad"
    if salida.ambito == "insular" and ("CABILDO" in blob or "CONSELL INSULAR" in blob):
        island = fold_name(salida.municipio)
        if island and f" {island} " in f" {blob} ":
            return "isla"
    if matched_ine:
        return "municipio"
    return None


def frase_fecha(accion: str, nombramiento: str, fecha_alta: str) -> str:
    if accion == "reeleccion":
        return (
            "Esa publicación es una reelección, no un nombramiento nuevo: puede que ya estuviera en el órgano. "
            "El extracto guarda el alta y la última fecha, no cada anuncio intermedio, y usa el día del boletín."
        )
    if fecha_alta and nombramiento != fecha_alta:
        return (
            f"Hay un alta anterior el {fecha_es(fecha_alta)} y esta es la posterior. "
            "El extracto guarda esas dos fechas, no las intermedias. Un cese no cuenta como nombramiento. "
            "La fecha es el día de publicación."
        )
    return (
        "La fecha es el primer nombramiento de esa persona en la hoja. Un cese no cuenta como nombramiento. "
        "No se guardan apoderados. La fecha es el día de publicación, no el de inscripción."
    )


def motivo_de(
    salida: Salida,
    tipo: str,
    empresa: str,
    nombre_borme: str,
    nombramiento: str,
    dias: int,
    organismo: str,
    coherencia_nombre: str,
    importe_mandato: float,
    importe_previo: float,
    score: float,
    confianza: float,
    lugares: int,
    confianza_empresa: str,
    accion: str = "nombramiento",
    fecha_alta: str = "",
) -> str:
    rol = ROL_LARGO.get(salida.rol, salida.rol)
    partido = f", candidatura {salida.partido}" if salida.partido else ""
    if tipo == "despues":
        cuando = f"Esa publicación es {dias} días después del cese supuesto."
    else:
        cuando = (
            "Esa publicación cae durante el mandato. No es una puerta giratoria posterior al cese; "
            "queda como subtipo aparte."
        )
    frases = [
        (
            f"{salida.nombre}, {rol} de {salida.cuerpo} "
            f"({fecha_es(salida.desde)} a {fecha_es(salida.hasta)}{partido})."
        ),
        SUPUESTO_TEXTO.get(salida.supuesto, ""),
        (
            f"El BORME del {fecha_es(nombramiento)} publica a «{nombre_borme}» como administrador "
            f"o consejero de {empresa}."
        ),
        frase_fecha(accion, nombramiento, fecha_alta),
        cuando,
        (
            f"De {organismo} constan {euro(importe_mandato)} en subvenciones y contratos con fecha "
            f"dentro del mandato, y {euro(importe_previo)} hasta el día del anuncio "
            f"(coherencia {coherencia_nombre})."
        ),
        (
            f"Puntuación {score:.0%}. Confianza del nombre {confianza:.0%}. "
            f"Cruce de la sociedad: {confianza_empresa}."
        ),
    ]
    if lugares > 1:
        frases.append("El mismo nombre figura en otro órgano. Puede ser otra persona.")
    if salida.precision_fechas == "posesion":
        frases.append("Las fechas de alcaldía usadas son la posesión y la baja del registro.")
    elif salida.precision_fechas == "mandato":
        frases.append(
            "Las fechas del escaño son las del mandato electoral, no la toma de posesión ni la baja de esta persona."
        )
    frases.append("Indicador, no prueba.")
    frases.append(f"Fuente del cargo: {salida.fuente}.")
    return " ".join(frase for frase in frases if frase)


def load_cargos(path: Path) -> list[Cargo]:
    connection = sqlite3.connect(f"{path.resolve().as_uri()}?mode=ro", uri=True)
    try:
        rows = connection.execute(
            """
            SELECT nombre, ap1, ap2, pila, rol, ambito, cuerpo, municipio, ine, provincia,
                   ccaa, desde, hasta, partido, fuente, fuente_url, clave_organo, precision_fechas
            FROM politico
            """
        )
        cargos: list[Cargo] = []
        for row in rows:
            persona = Persona(
                tuple(part for part in text_of(row[1]).split(" ") if part),
                tuple(part for part in text_of(row[2]).split(" ") if part),
                tuple(part for part in text_of(row[3]).split(" ") if part),
            )
            cargos.append(
                Cargo(
                    nombre=text_of(row[0]),
                    persona=persona,
                    rol=text_of(row[4]),
                    ambito=text_of(row[5]),
                    cuerpo=text_of(row[6]),
                    municipio=text_of(row[7]),
                    ine=text_of(row[8]),
                    provincia=text_of(row[9]),
                    ccaa=text_of(row[10]),
                    desde=text_of(row[11]),
                    hasta=text_of(row[12]),
                    partido=text_of(row[13]),
                    fuente=text_of(row[14]),
                    fuente_url=text_of(row[15]),
                    clave_organo=text_of(row[16]),
                    precision_fechas=text_of(row[17]) or "mandato",
                )
            )
        return cargos
    finally:
        connection.close()


def table_names(connection: sqlite3.Connection) -> set[str]:
    rows = connection.execute(
        "SELECT name FROM sqlite_master WHERE type IN ('table', 'view')"
    )
    return {str(row[0]) for row in rows}


def table_columns(connection: sqlite3.Connection, name: str) -> set[str]:
    rows = connection.execute(f"PRAGMA table_info({name})").fetchall()
    return {str(row[1]) for row in rows}


def fechas_de(mencion: Mencion) -> list[tuple[str, str, str]]:
    found: list[tuple[str, str, str]] = []
    if mencion.fecha:
        found.append((mencion.fecha, mencion.accion or "nombramiento", mencion.cve))
    if mencion.fecha_ultimo and mencion.fecha_ultimo != mencion.fecha:
        found.append((mencion.fecha_ultimo, mencion.accion_ultimo or "nombramiento", mencion.cve_ultimo))
    return found


def fundir(base: Mencion, extra: Mencion) -> None:
    best: dict[str, tuple[str, str]] = {}
    for fecha, accion, cve in fechas_de(base) + fechas_de(extra):
        current = best.get(fecha)
        if current is None or (accion == "nombramiento" and current[0] != "nombramiento"):
            best[fecha] = (accion, cve)
    ordered = sorted(best)
    if not ordered:
        return
    first = ordered[0]
    base.fecha = first
    base.accion = best[first][0]
    base.cve = best[first][1]
    base.fecha_alta = first
    base.accion_alta = best[first][0]
    base.cve_alta = best[first][1]
    if len(ordered) > 1:
        last = ordered[-1]
        base.fecha_ultimo = last
        base.accion_ultimo = best[last][0]
        base.cve_ultimo = best[last][1]
    else:
        base.fecha_ultimo = ""
        base.accion_ultimo = ""
        base.cve_ultimo = ""
    if extra.fecha_cese and (not base.fecha_cese or extra.fecha_cese > base.fecha_cese):
        base.fecha_cese = extra.fecha_cese
        base.cve_cese = extra.cve_cese
    if extra.confianza > base.confianza:
        base.confianza = extra.confianza
        base.modo = extra.modo
        base.lugares = extra.lugares
        base.nombre_borme = extra.nombre_borme or base.nombre_borme


def record_mencion(
    store: dict[str, dict[str, Mencion]],
    toxic: set[str],
    mencion: Mencion,
) -> None:
    if not mencion.fecha_alta:
        mencion.fecha_alta = mencion.fecha
        mencion.accion_alta = mencion.accion
        mencion.cve_alta = mencion.cve
    if mencion.firma in toxic:
        return
    bucket = store.get(mencion.firma)
    if bucket is None:
        store[mencion.firma] = {mencion.registro_key: mencion}
        return
    current = bucket.get(mencion.registro_key)
    if current is not None:
        fundir(current, mencion)
        return
    if len(bucket) >= MAX_EMPRESAS:
        toxic.add(mencion.firma)
        del store[mencion.firma]
        return
    bucket[mencion.registro_key] = mencion


def cita_de(mencion: Mencion, salida: Salida) -> tuple[str, str, str, str] | None:
    """Pick the appointment that best fits this seat.

    A later date wins when the first one is before the person leaves office.
    A dismissal is not a candidate. A nombramiento is preferred to a reelección
    on the same side of the cese.
    """
    candidatas: list[tuple[str, str, str]] = []
    if mencion.fecha_alta or mencion.fecha:
        alta = mencion.fecha_alta or mencion.fecha
        candidatas.append((alta, mencion.accion_alta or mencion.accion or "nombramiento", mencion.cve_alta or mencion.cve))
    if mencion.fecha_ultimo and all(mencion.fecha_ultimo != item[0] for item in candidatas):
        candidatas.append((mencion.fecha_ultimo, mencion.accion_ultimo or "nombramiento", mencion.cve_ultimo))
    despues: list[tuple[str, str, str]] = []
    durante: list[tuple[str, str, str]] = []
    for fecha, accion, cve in candidatas:
        kind = clasificar(fecha, salida)
        if kind == "despues":
            despues.append((fecha, accion, cve))
            continue
        if kind == "durante":
            durante.append((fecha, accion, cve))
    if despues:
        despues.sort(key=lambda item: (item[1] != "nombramiento", item[0]))
        fecha, accion, cve = despues[0]
        return fecha, accion, cve, "despues"
    if durante:
        durante.sort(key=lambda item: (item[1] != "nombramiento", item[0]))
        fecha, accion, cve = durante[0]
        return fecha, accion, cve, "durante"
    return None


def leer_persona_cargo(
    connection: sqlite3.Connection,
    indice: IndiceNombres,
    limit: int,
) -> tuple[dict[str, dict[str, Mencion]], int, str, str]:
    names = table_names(connection)
    joins = ""
    nombre_sql = "c.nombre_key"
    empresa_sql = "''"
    if "sociedad_persona" in names:
        nombre_sql = "COALESCE(p.nombre, c.nombre_key)"
        joins += (
            " LEFT JOIN sociedad_persona p"
            " ON p.registro_key = c.registro_key AND p.rol = c.rol AND p.nombre_key = c.nombre_key"
        )
    if "sociedad" in names:
        empresa_sql = "COALESCE(s.nombre, '')"
        joins += " LEFT JOIN sociedad s ON s.registro_key = c.registro_key"
    query = f"""
        SELECT c.registro_key, {nombre_sql}, {empresa_sql},
               c.fecha_alta, c.accion_alta, c.cve_alta,
               c.fecha_ultimo, c.accion_ultimo, c.cve_ultimo,
               c.fecha_cese, c.cve_cese
        FROM persona_cargo c
        {joins}
        WHERE c.rol = 'A' AND c.fecha_alta != ''
    """
    if limit > 0:
        query = f"{query} LIMIT ?"
        cursor = connection.execute(query, (limit,))
    else:
        cursor = connection.execute(query)
    store: dict[str, dict[str, Mencion]] = {}
    toxic: set[str] = set()
    scanned = 0
    first = ""
    last = ""
    for row in cursor:
        scanned += 1
        alta = text_of(row[3])
        if ISO_RE.fullmatch(alta):
            if not first or alta < first:
                first = alta
            if alta > last:
                last = alta
        sheet = text_of(row[0])
        display = text_of(row[1])
        if not sheet or not display:
            continue
        hits = indice.buscar(display)
        if not hits:
            continue
        by_firma: dict[str, object] = {}
        for hit in hits:
            if hit.confianza < NAME_FLOOR:
                continue
            payload = hit.payload
            if not isinstance(payload, Salida):
                continue
            current = by_firma.get(payload.firma)
            if current is None or hit.confianza > current.confianza:
                by_firma[payload.firma] = hit
        for firma, hit in by_firma.items():
            record_mencion(
                store,
                toxic,
                Mencion(
                    firma=firma,
                    registro_key=sheet,
                    fecha=alta,
                    cve=text_of(row[5]),
                    empresa=text_of(row[2]),
                    nombre_borme=display,
                    confianza=hit.confianza,
                    lugares=hit.lugares,
                    modo=hit.modo,
                    accion=text_of(row[4]) or "nombramiento",
                    fecha_alta=alta,
                    accion_alta=text_of(row[4]) or "nombramiento",
                    cve_alta=text_of(row[5]),
                    fecha_ultimo=text_of(row[6]),
                    accion_ultimo=text_of(row[7]),
                    cve_ultimo=text_of(row[8]),
                    fecha_cese=text_of(row[9]),
                    cve_cese=text_of(row[10]),
                ),
            )
        if scanned % 500_000 == 0:
            kept = sum(len(bucket) for bucket in store.values())
            log(f"Cargos {scanned}; menciones {kept}; RSS {rss_mb()} MB")
    kept = sum(len(bucket) for bucket in store.values())
    log(f"Cargos leídos {scanned}; menciones {kept}; nombres con demasiadas sociedades {len(toxic)}; RSS {rss_mb()} MB")
    return store, scanned, first, last


def scan_borme(
    path: Path,
    indice: IndiceNombres,
    limit: int,
) -> tuple[dict[str, dict[str, Mencion]], int, str, str]:
    connection = sqlite3.connect(f"{path.resolve().as_uri()}?mode=ro", uri=True)
    try:
        connection.execute("PRAGMA query_only = ON")
        connection.execute("PRAGMA cache_size = -20000")
        connection.execute("PRAGMA mmap_size = 0")
        connection.execute("PRAGMA temp_store = FILE")
        names = table_names(connection)
        if "persona_cargo" in names:
            return leer_persona_cargo(connection, indice, limit)
        if "acto" not in names:
            raise SystemExit(
                "El extracto BORME no tiene persona_cargo ni acto, así que no hay fecha de nombramiento. "
                "El compactado antiguo borró los anuncios. Con esta versión hay que volver a bajarlos y agregar: "
                "python3 pipeline/borme.py fetch && python3 pipeline/borme.py aggregate --compact. "
                "Un día ya marcado como hecho se salta si sus anuncios siguen en acto; si se compactaron, se vuelven a pedir."
            )
        store: dict[str, dict[str, Mencion]] = {}
        toxic: set[str] = set()
        scanned = 0
        first = ""
        last = ""
        query = (
            "SELECT fecha, cve, nombre, registro_key, personas FROM acto "
            "WHERE personas IS NOT NULL AND personas != ''"
        )
        if limit > 0:
            query = f"{query} LIMIT ?"
            cursor = connection.execute(query, (limit,))
        else:
            cursor = connection.execute(query)
        for fecha, cve, empresa, registro_key, personas in cursor:
            scanned += 1
            day = text_of(fecha)
            if ISO_RE.fullmatch(day):
                if not first or day < first:
                    first = day
                if day > last:
                    last = day
            sheet = text_of(registro_key)
            if not sheet:
                continue
            for rol, display, _key, kind, accion in decode_people(text_of(personas)):
                if rol != "A" or kind != "P" or accion == "cese":
                    continue
                hits = indice.buscar(display)
                if not hits:
                    continue
                by_firma: dict[str, object] = {}
                for hit in hits:
                    if hit.confianza < NAME_FLOOR:
                        continue
                    payload = hit.payload
                    if not isinstance(payload, Salida):
                        continue
                    current = by_firma.get(payload.firma)
                    if current is None or hit.confianza > current.confianza:
                        by_firma[payload.firma] = hit
                for firma, hit in by_firma.items():
                    record_mencion(
                        store,
                        toxic,
                        Mencion(
                            firma=firma,
                            registro_key=sheet,
                            fecha=day,
                            cve=text_of(cve),
                            empresa=text_of(empresa),
                            nombre_borme=display,
                            confianza=hit.confianza,
                            lugares=hit.lugares,
                            modo=hit.modo,
                            accion=accion or "nombramiento",
                        ),
                    )
            if scanned % 500_000 == 0:
                kept = sum(len(bucket) for bucket in store.values())
                log(
                    f"Actos {scanned}; menciones {kept}; nombres descartados por ir en más de "
                    f"{MAX_EMPRESAS} sociedades {len(toxic)}; RSS {rss_mb()} MB"
                )
        kept = sum(len(bucket) for bucket in store.values())
        log(
            f"Actos leídos {scanned}; menciones {kept}; nombres con demasiadas sociedades {len(toxic)}; "
            f"RSS {rss_mb()} MB"
        )
        return store, scanned, first, last
    finally:
        connection.close()


def load_empresas(connection: sqlite3.Connection, keys: list[str]) -> dict[str, Empresa]:
    names = table_names(connection)
    if "borme_empresa" not in names:
        raise SystemExit(
            "No está borme_empresa en el índice. Ejecuta antes python3 pipeline/borme.py match. "
            "Sin ese cruce no hay NIF al que colgar la subvención."
        )
    columns = table_columns(connection, "borme_empresa")
    needed = {"registro_key", "nif", "beneficiario_id", "nombre", "confianza"}
    if not needed <= columns:
        found = ", ".join(sorted(columns))
        raise SystemExit(f"borme_empresa no tiene las columnas esperadas ({found}).")
    has_capital = "capital" in columns
    connection.execute("CREATE TEMP TABLE pg_reg (registro_key TEXT PRIMARY KEY)")
    batch: list[tuple[str]] = []
    for key in keys:
        batch.append((key,))
        if len(batch) >= 500:
            connection.executemany("INSERT OR IGNORE INTO pg_reg (registro_key) VALUES (?)", batch)
            batch.clear()
    if batch:
        connection.executemany("INSERT OR IGNORE INTO pg_reg (registro_key) VALUES (?)", batch)
    capital_sql = "e.capital" if has_capital else "NULL"
    rows = connection.execute(
        f"""
        SELECT e.registro_key, e.nif, e.beneficiario_id, e.nombre, e.confianza, {capital_sql}
        FROM borme_empresa e
        JOIN pg_reg r ON r.registro_key = e.registro_key
        WHERE e.confianza IN ('alta', 'media') AND e.nif IS NOT NULL AND e.nif != ''
        """
    )
    found: dict[str, Empresa] = {}
    rank = {"alta": 2, "media": 1}
    for row in rows:
        empresa = Empresa(
            registro_key=text_of(row[0]),
            nif=text_of(row[1]).upper(),
            beneficiario_id=optional_int(row[2]),
            nombre=text_of(row[3]),
            confianza=text_of(row[4]),
            capital=float(row[5]) if row[5] is not None else None,
        )
        current = found.get(empresa.registro_key)
        if current is None or rank.get(empresa.confianza, 0) > rank.get(current.confianza, 0):
            found[empresa.registro_key] = empresa
    return found


def prepare_nif(connection: sqlite3.Connection, nifs: set[str]) -> None:
    connection.execute("CREATE TEMP TABLE pg_nif (nif TEXT PRIMARY KEY)")
    batch = [(nif,) for nif in nifs]
    connection.executemany("INSERT OR IGNORE INTO pg_nif (nif) VALUES (?)", batch)


def stream_into(
    connection: sqlite3.Connection,
    select_sql: str,
    insert_sql: str,
) -> int:
    inserted = 0
    batch: list[tuple] = []
    for row in connection.execute(select_sql):
        cleaned = tuple(row)
        fecha = text_of(cleaned[2])
        importe = float_of(cleaned[3])
        if not ISO_RE.fullmatch(fecha) or importe <= 0:
            continue
        batch.append(cleaned)
        if len(batch) >= 5000:
            connection.executemany(insert_sql, batch)
            inserted += len(batch)
            batch.clear()
    if batch:
        connection.executemany(insert_sql, batch)
        inserted += len(batch)
    return inserted


def load_money(connection: sqlite3.Connection) -> tuple[int, int]:
    names = table_names(connection)
    connection.execute(
        """
        CREATE TEMP TABLE pg_ayuda (
          nif TEXT NOT NULL,
          ref TEXT NOT NULL,
          fecha TEXT NOT NULL,
          importe REAL NOT NULL,
          administracion TEXT NOT NULL,
          departamento TEXT NOT NULL,
          organo TEXT NOT NULL,
          organismo TEXT NOT NULL,
          organismo_norm TEXT NOT NULL,
          ccaa TEXT NOT NULL,
          titulo TEXT NOT NULL,
          codigo_bdns TEXT NOT NULL
        )
        """
    )
    connection.execute(
        """
        CREATE TEMP TABLE pg_contrato (
          nif TEXT NOT NULL,
          ref TEXT NOT NULL,
          fecha TEXT NOT NULL,
          importe REAL NOT NULL,
          administracion TEXT NOT NULL,
          departamento TEXT NOT NULL,
          organo TEXT NOT NULL,
          organismo TEXT NOT NULL,
          organismo_norm TEXT NOT NULL,
          ccaa TEXT NOT NULL,
          titulo TEXT NOT NULL,
          url TEXT NOT NULL
        )
        """
    )
    if {"lut_persona", "concesion", "lut_organismo", "lut_instrumento"} <= names:
        grant_sql = """
            SELECT p.nif, c.id, c.fecha, c.importe,
                   COALESCE(o.administracion, ''), COALESCE(o.departamento, ''),
                   COALESCE(o.organo, ''), COALESCE(o.organismo, ''), COALESCE(o.organismo_norm, ''),
                   COALESCE(ca.nombre, ''), COALESCE(cv.titulo, ''), COALESCE(cv.codigo_bdns, '')
            FROM pg_nif n
            JOIN lut_persona p ON p.nif = n.nif
            JOIN concesion c ON c.persona_id = p.id
            JOIN lut_organismo o ON o.id = c.organismo_id
            JOIN lut_instrumento i ON i.id = c.instrumento_id
            LEFT JOIN convocatoria cv ON cv.id = c.id_convocatoria
            LEFT JOIN lut_ccaa ca ON ca.id = c.ccaa_id
            WHERE i.slug = 'subvencion' AND c.importe > 0 AND c.fecha IS NOT NULL AND c.fecha != ''
        """
    elif "concesiones" in names:
        grant_sql = """
            SELECT c.nif, c.id, c.fecha, c.importe,
                   COALESCE(c.administracion, ''), COALESCE(c.departamento, ''),
                   COALESCE(c.organo, ''), COALESCE(c.organismo, ''), COALESCE(c.organismo_norm, ''),
                   COALESCE(c.ccaa, ''), COALESCE(c.titulo, ''), COALESCE(c.codigo_bdns, '')
            FROM pg_nif n
            JOIN concesiones c ON c.nif = n.nif
            WHERE c.instrumento_slug = 'subvencion' AND c.importe > 0
              AND c.fecha IS NOT NULL AND c.fecha != ''
        """
    else:
        raise SystemExit("No está la tabla de concesiones en el índice.")
    grants = stream_into(
        connection,
        grant_sql,
        """
        INSERT INTO pg_ayuda (
          nif, ref, fecha, importe, administracion, departamento, organo, organismo,
          organismo_norm, ccaa, titulo, codigo_bdns
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
        """,
    )
    connection.execute("CREATE INDEX pg_ayuda_nif ON pg_ayuda(nif)")
    contracts = 0
    if "placsp_contrato" in names:
        contracts = stream_into(
            connection,
            """
            SELECT c.nif, c.expediente || ':' || c.lote, c.fecha, COALESCE(c.importe, 0),
                   COALESCE(c.organo, ''), COALESCE(c.padres, ''), COALESCE(c.organo_canon, ''),
                   COALESCE(c.organo, ''), COALESCE(c.organo_canon, ''), '',
                   COALESCE(c.titulo, ''), COALESCE(c.url, '')
            FROM pg_nif n
            JOIN placsp_contrato c ON c.nif = n.nif
            WHERE c.fecha IS NOT NULL AND c.fecha != ''
            """,
            """
            INSERT INTO pg_contrato (
              nif, ref, fecha, importe, administracion, departamento, organo, organismo,
              organismo_norm, ccaa, titulo, url
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
            """,
        )
        connection.execute("CREATE INDEX pg_contrato_nif ON pg_contrato(nif)")
    log(f"Subvenciones de esas sociedades: {grants}. Contratos: {contracts}")
    return grants, contracts


def load_sizes(connection: sqlite3.Connection) -> dict[str, float]:
    names = table_names(connection)
    if {"beneficiario", "lut_persona"} <= names:
        query = """
            SELECT p.nif, b.importe_total
            FROM beneficiario b
            JOIN lut_persona p ON p.id = b.persona_id
            JOIN pg_nif n ON n.nif = p.nif
        """
    elif "beneficiarios" in names:
        query = """
            SELECT b.nif, b.importe_total
            FROM beneficiarios b
            JOIN pg_nif n ON n.nif = b.nif
        """
    else:
        return {}
    found: dict[str, float] = {}
    for nif, total in connection.execute(query):
        found[text_of(nif).upper()] = float_of(total)
    return found


def movimientos_de(connection: sqlite3.Connection, nif: str) -> list[Movimiento]:
    count = connection.execute("SELECT COUNT(*) FROM pg_ayuda WHERE nif = ?", (nif,)).fetchone()[0]
    rows: list[Movimiento] = []
    if count > HUGE_NIF:
        query = """
            SELECT organismo_norm, MIN(organismo), MIN(administracion), MIN(departamento),
                   MIN(organo), MIN(ccaa), substr(fecha, 1, 7) || '-01', SUM(importe), SUM(1)
            FROM pg_ayuda
            WHERE nif = ?
            GROUP BY organismo_norm, substr(fecha, 1, 7)
        """
        for row in connection.execute(query, (nif,)):
            rows.append(
                Movimiento(
                    clase="ayuda",
                    ref="",
                    fecha=text_of(row[6]),
                    importe=float_of(row[7]),
                    titulo=f"{int(row[8])} subvenciones en el mes",
                    url="",
                    administracion=text_of(row[2]),
                    departamento=text_of(row[3]),
                    organo=text_of(row[4]),
                    organismo=text_of(row[1]),
                    organismo_norm=text_of(row[0]),
                    ccaa=text_of(row[5]),
                )
            )
    else:
        for row in connection.execute(
            """
            SELECT ref, fecha, importe, administracion, departamento, organo, organismo,
                   organismo_norm, ccaa, titulo, codigo_bdns
            FROM pg_ayuda WHERE nif = ?
            """,
            (nif,),
        ):
            rows.append(
                Movimiento(
                    clase="ayuda",
                    ref=text_of(row[0]),
                    fecha=text_of(row[1]),
                    importe=float_of(row[2]),
                    titulo=text_of(row[9]),
                    url="",
                    administracion=text_of(row[3]),
                    departamento=text_of(row[4]),
                    organo=text_of(row[5]),
                    organismo=text_of(row[6]),
                    organismo_norm=text_of(row[7]),
                    ccaa=text_of(row[8]),
                    extra=text_of(row[10]),
                )
            )
    for row in connection.execute(
        """
        SELECT ref, fecha, importe, administracion, departamento, organo, organismo,
               organismo_norm, ccaa, titulo, url
        FROM pg_contrato WHERE nif = ?
        """,
        (nif,),
    ):
        rows.append(
            Movimiento(
                clase="contrato",
                ref=text_of(row[0]),
                fecha=text_of(row[1]),
                importe=float_of(row[2]),
                titulo=text_of(row[9]),
                url=text_of(row[10]),
                administracion=text_of(row[3]),
                departamento=text_of(row[4]),
                organo=text_of(row[5]),
                organismo=text_of(row[6]) or text_of(row[5]),
                organismo_norm=text_of(row[7]) or fold_name(text_of(row[5])),
                ccaa=text_of(row[8]),
            )
        )
    return rows


def campos_de(mov: Movimiento) -> list[str]:
    return [mov.administracion, mov.departamento, mov.organo, mov.organismo, mov.extra]


def elegir_organismo(movs: list[Movimiento]) -> tuple[str, str]:
    totals: dict[str, list] = {}
    for mov in movs:
        label = mov.organismo or mov.organo or mov.administracion
        key = mov.organismo_norm or fold_name(label)
        slot = totals.get(key)
        if slot is None:
            totals[key] = [label, mov.importe]
            continue
        slot[1] += mov.importe
    best_key = ""
    best_label = ""
    best_amount = -1.0
    for key, (label, amount) in totals.items():
        if amount > best_amount:
            best_key = key
            best_label = label
            best_amount = amount
    return best_label, best_key


def items_de(movs: list[Movimiento], desde: str, hasta: str) -> list[Item]:
    ordered = sorted(
        movs,
        key=lambda mov: (mov.fecha < desde or mov.fecha > hasta, -mov.importe, mov.fecha, mov.ref),
    )
    items: list[Item] = []
    for mov in ordered[:8]:
        items.append(
            Item(
                clase=mov.clase,
                ref=mov.ref,
                fecha=mov.fecha,
                importe=round(mov.importe, 2),
                titulo=mov.titulo,
                url=mov.url,
            )
        )
    return items


def casos_de_par(
    salida: Salida,
    mencion: Mencion,
    empresa: Empresa,
    tipo: str,
    movs: list[Movimiento],
    importe_total: float,
    municipios: MunicipioIndex,
) -> list[Caso]:
    buckets: dict[str, list[Movimiento]] = {}
    for mov in movs:
        if not mov.fecha or mov.fecha > mencion.fecha:
            continue
        level = coherencia(salida, campos_de(mov), mov.ccaa, municipios)
        if not level:
            continue
        buckets.setdefault(level, []).append(mov)
    built: list[Caso] = []
    for level, group in buckets.items():
        mandato = 0.0
        previo = 0.0
        n_ayudas = 0
        n_contratos = 0
        for mov in group:
            previo += mov.importe
            if mov.clase == "ayuda":
                n_ayudas += 1
            else:
                n_contratos += 1
            if salida.desde <= mov.fecha <= salida.hasta:
                mandato += mov.importe
        mandato = round(mandato, 2)
        previo = round(previo, 2)
        dias = day_gap(salida.hasta, mencion.fecha)
        score = puntuacion(
            mencion.confianza,
            mencion.lugares,
            level,
            dias,
            tipo,
            mandato,
            previo,
            empresa.capital,
            importe_total,
        )
        if mencion.accion == "reeleccion":
            score = round(max(0.0, score - 0.04), 4)
        if not publica(tipo, score, mandato, previo):
            continue
        label, norm = elegir_organismo(group)
        built.append(
            Caso(
                tipo=tipo,
                puntuacion=score,
                confianza_nombre=mencion.confianza,
                lugares=mencion.lugares,
                modo=mencion.modo,
                motivo=motivo_de(
                    salida,
                    tipo,
                    empresa.nombre or mencion.empresa,
                    mencion.nombre_borme,
                    mencion.fecha,
                    dias,
                    label,
                    level,
                    mandato,
                    previo,
                    score,
                    mencion.confianza,
                    mencion.lugares,
                    empresa.confianza,
                    mencion.accion,
                    mencion.fecha_alta or mencion.fecha,
                ),
                nif=empresa.nif,
                beneficiario_id=empresa.beneficiario_id,
                empresa=empresa.nombre or mencion.empresa,
                confianza_empresa=empresa.confianza,
                capital=empresa.capital,
                importe_total_empresa=importe_total,
                politico_nombre=salida.nombre,
                rol=salida.rol,
                cuerpo=salida.cuerpo,
                partido=salida.partido,
                municipio=salida.municipio,
                provincia=salida.provincia,
                ccaa=salida.ccaa,
                mandato_desde=salida.desde,
                mandato_hasta=salida.hasta,
                precision_fechas=salida.precision_fechas,
                supuesto=salida.supuesto,
                cese=salida.hasta,
                nombramiento=mencion.fecha,
                dias=dias,
                admin_cargo="Administrador",
                admin_nombre=mencion.nombre_borme,
                organismo=label,
                organismo_norm=norm or fold_name(label),
                coherencia=level,
                importe_mandato=mandato,
                importe_previo=previo,
                n_ayudas=n_ayudas,
                n_contratos=n_contratos,
                anio=int(mencion.fecha[:4]),
                fuente_borme=mencion.cve,
                fuente_url=borme_url(mencion.cve),
                fuente_politico=salida.fuente,
                fuente_politico_url=salida.fuente_url,
                items=items_de(group, salida.desde, salida.hasta),
            )
        )
    return built


def construir_casos(
    connection: sqlite3.Connection,
    salidas_por_firma: dict[str, list[Salida]],
    store: dict[str, dict[str, Mencion]],
    empresas: dict[str, Empresa],
    municipios: MunicipioIndex,
) -> list[Caso]:
    sizes = load_sizes(connection)
    pending: list[tuple[Salida, Mencion, Empresa, str]] = []
    for buckets in store.values():
        for mencion in buckets.values():
            empresa = empresas.get(mencion.registro_key)
            if empresa is None:
                continue
            if empresa.confianza not in {"alta", "media"}:
                continue
            if nif_publico(empresa.nif) or empresa_publica(empresa.nombre) or empresa_publica(mencion.empresa):
                continue
            for salida in salidas_por_firma.get(mencion.firma, []):
                cita = cita_de(mencion, salida)
                if cita is None:
                    continue
                fecha, accion, cve, kind = cita
                elegida = Mencion(
                    firma=mencion.firma,
                    registro_key=mencion.registro_key,
                    fecha=fecha,
                    cve=cve,
                    empresa=mencion.empresa,
                    nombre_borme=mencion.nombre_borme,
                    confianza=mencion.confianza,
                    lugares=mencion.lugares,
                    modo=mencion.modo,
                    accion=accion,
                    fecha_alta=mencion.fecha_alta or mencion.fecha,
                    accion_alta=mencion.accion_alta or mencion.accion,
                    cve_alta=mencion.cve_alta or mencion.cve,
                    fecha_ultimo=mencion.fecha_ultimo,
                    accion_ultimo=mencion.accion_ultimo,
                    cve_ultimo=mencion.cve_ultimo,
                    fecha_cese=mencion.fecha_cese,
                    cve_cese=mencion.cve_cese,
                )
                pending.append((salida, elegida, empresa, kind))
    log(f"Candidatos con fecha dentro de mandato o de la ventana de {WINDOW_YEARS} años: {len(pending)}")
    by_nif: dict[str, list[tuple[Salida, Mencion, Empresa, str]]] = {}
    for item in pending:
        by_nif.setdefault(item[2].nif, []).append(item)
    casos: list[Caso] = []
    for nif, group in by_nif.items():
        movs = movimientos_de(connection, nif)
        total = sizes.get(nif, 0.0)
        for salida, mencion, empresa, kind in group:
            casos.extend(casos_de_par(salida, mencion, empresa, kind, movs, total, municipios))
        del movs
    casos.sort(
        key=lambda caso: (
            -caso.puntuacion,
            -caso.importe_mandato,
            -caso.importe_previo,
            caso.nif,
            caso.nombramiento,
            caso.coherencia,
        )
    )
    return casos


def write_casos(
    connection: sqlite3.Connection,
    casos: list[Caso],
    meta: dict[str, str],
) -> None:
    connection.executescript(
        """
        DROP TABLE IF EXISTS alert_puerta_item;
        DROP TABLE IF EXISTS alert_puerta;
        DROP TABLE IF EXISTS alert_puerta_meta;
        CREATE TABLE alert_puerta (
          id INTEGER PRIMARY KEY,
          tipo TEXT NOT NULL,
          puntuacion REAL NOT NULL,
          confianza_nombre REAL NOT NULL,
          lugares INTEGER NOT NULL,
          modo TEXT NOT NULL,
          motivo TEXT NOT NULL,
          nif TEXT NOT NULL,
          beneficiario_id INTEGER,
          empresa TEXT NOT NULL,
          confianza_empresa TEXT NOT NULL,
          capital REAL,
          importe_total_empresa REAL NOT NULL,
          politico_nombre TEXT NOT NULL,
          rol TEXT NOT NULL,
          cuerpo TEXT NOT NULL,
          partido TEXT NOT NULL,
          municipio TEXT NOT NULL,
          provincia TEXT NOT NULL,
          ccaa TEXT NOT NULL,
          mandato_desde TEXT NOT NULL,
          mandato_hasta TEXT NOT NULL,
          precision_fechas TEXT NOT NULL,
          supuesto TEXT NOT NULL,
          cese TEXT NOT NULL,
          nombramiento TEXT NOT NULL,
          dias INTEGER NOT NULL,
          admin_cargo TEXT NOT NULL,
          admin_nombre TEXT NOT NULL,
          organismo TEXT NOT NULL,
          organismo_norm TEXT NOT NULL,
          coherencia TEXT NOT NULL,
          importe_mandato REAL NOT NULL,
          importe_previo REAL NOT NULL,
          n_ayudas INTEGER NOT NULL,
          n_contratos INTEGER NOT NULL,
          anio INTEGER NOT NULL,
          fuente_borme TEXT NOT NULL,
          fuente_url TEXT NOT NULL,
          fuente_politico TEXT NOT NULL,
          fuente_politico_url TEXT NOT NULL
        );
        CREATE TABLE alert_puerta_item (
          alert_id INTEGER NOT NULL,
          clase TEXT NOT NULL,
          ref TEXT NOT NULL,
          fecha TEXT NOT NULL,
          importe REAL NOT NULL,
          titulo TEXT NOT NULL,
          url TEXT NOT NULL
        );
        CREATE TABLE alert_puerta_meta (
          clave TEXT PRIMARY KEY,
          valor TEXT NOT NULL
        );
        """
    )
    for index, caso in enumerate(casos, start=1):
        connection.execute(
            """
            INSERT INTO alert_puerta (
              id, tipo, puntuacion, confianza_nombre, lugares, modo, motivo, nif, beneficiario_id,
              empresa, confianza_empresa, capital, importe_total_empresa, politico_nombre, rol, cuerpo,
              partido, municipio, provincia, ccaa, mandato_desde, mandato_hasta, precision_fechas,
              supuesto, cese, nombramiento, dias, admin_cargo, admin_nombre, organismo, organismo_norm,
              coherencia, importe_mandato, importe_previo, n_ayudas, n_contratos, anio, fuente_borme,
              fuente_url, fuente_politico, fuente_politico_url
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """,
            (
                index,
                caso.tipo,
                caso.puntuacion,
                caso.confianza_nombre,
                caso.lugares,
                caso.modo,
                caso.motivo,
                caso.nif,
                caso.beneficiario_id,
                caso.empresa,
                caso.confianza_empresa,
                caso.capital,
                caso.importe_total_empresa,
                caso.politico_nombre,
                caso.rol,
                caso.cuerpo,
                caso.partido,
                caso.municipio,
                caso.provincia,
                caso.ccaa,
                caso.mandato_desde,
                caso.mandato_hasta,
                caso.precision_fechas,
                caso.supuesto,
                caso.cese,
                caso.nombramiento,
                caso.dias,
                caso.admin_cargo,
                caso.admin_nombre,
                caso.organismo,
                caso.organismo_norm,
                caso.coherencia,
                caso.importe_mandato,
                caso.importe_previo,
                caso.n_ayudas,
                caso.n_contratos,
                caso.anio,
                caso.fuente_borme,
                caso.fuente_url,
                caso.fuente_politico,
                caso.fuente_politico_url,
            ),
        )
        connection.executemany(
            """
            INSERT INTO alert_puerta_item (alert_id, clase, ref, fecha, importe, titulo, url)
            VALUES (?,?,?,?,?,?,?)
            """,
            [
                (index, item.clase, item.ref, item.fecha, item.importe, item.titulo, item.url)
                for item in caso.items
            ],
        )
    connection.executemany(
        "INSERT INTO alert_puerta_meta (clave, valor) VALUES (?, ?)",
        list(meta.items()),
    )
    connection.executescript(
        """
        CREATE INDEX idx_puerta_filter ON alert_puerta(tipo, ccaa, anio, puntuacion DESC);
        CREATE INDEX idx_puerta_org ON alert_puerta(organismo_norm);
        CREATE INDEX idx_puerta_nif ON alert_puerta(nif);
        CREATE INDEX idx_puerta_item ON alert_puerta_item(alert_id);
        """
    )
    connection.commit()


def print_top(casos: list[Caso], limit: int = 15) -> None:
    despues = sum(1 for caso in casos if caso.tipo == "despues")
    durante = sum(1 for caso in casos if caso.tipo == "durante")
    print(f"Indicadores: {len(casos)} (después del cese {despues}, durante el mandato {durante})")
    for caso in casos[:limit]:
        print(
            f"  {caso.puntuacion:.2f}  {caso.tipo:8}  {caso.politico_nombre}  →  {caso.empresa}  "
            f"{caso.nombramiento}  mandato {caso.importe_mandato:.0f} €  {caso.coherencia}  {caso.organismo}"
        )


def open_bdns(path: Path) -> sqlite3.Connection:
    connection = sqlite3.connect(path)
    connection.execute("PRAGMA busy_timeout = 8000")
    connection.execute("PRAGMA cache_size = -32768")
    connection.execute("PRAGMA mmap_size = 0")
    connection.execute("PRAGMA temp_store = FILE")
    return connection


def cargos_desde_boe(path: Path) -> list[Cargo]:
    from boe_altos import load_eventos, mandatos_de

    cargos: list[Cargo] = []
    for mandato in mandatos_de(load_eventos(path)):
        guesses = interpretations(mandato.nombre)
        if not guesses:
            continue
        persona = guesses[0]
        cargos.append(
            Cargo(
                nombre=mandato.nombre,
                persona=persona,
                rol="alto_cargo",
                ambito="estatal",
                cuerpo=f"{mandato.departamento}: {mandato.cargo}",
                municipio="",
                ine="",
                provincia="",
                ccaa="Administración General del Estado",
                desde=mandato.desde,
                hasta=mandato.hasta,
                partido="",
                fuente="Agencia Estatal Boletín Oficial del Estado. Sección II.A, ceses y nombramientos.",
                fuente_url=mandato.url or "https://www.boe.es",
                clave_organo=fold_name(mandato.departamento),
                precision_fechas="cese",
            )
        )
    return cargos


def calcular(
    db_path: Path,
    politicos_path: Path,
    borme_path: Path,
    limit: int,
    boe_path: Path | None = None,
    use_boe: bool = True,
) -> list[Caso]:
    if not politicos_path.exists():
        raise SystemExit(f"No está {politicos_path}. Ejecuta antes python3 pipeline/politicos.py.")
    if not borme_path.exists():
        raise SystemExit(f"No está {borme_path}. Hace falta el extracto con la tabla acto.")
    if not db_path.exists():
        raise SystemExit(f"No está el índice {db_path}.")
    if limit > 0:
        log(
            f"Muestra: solo los primeros {limit} actos con personas. "
            "La tabla alert_puerta quedará incompleta."
        )
    cargos = load_cargos(politicos_path)
    if use_boe:
        chosen_boe = boe_path if boe_path is not None else ROOT / "data" / "boe" / "altos.sqlite"
        if chosen_boe.exists():
            extra = cargos_desde_boe(chosen_boe)
            log(f"Altos cargos con cese en el BOE: {len(extra)}")
            cargos.extend(extra)
    log(f"Cargos leídos: {len(cargos)}")
    salidas = salidas_de(cargos)
    log(f"Ceses supuestos (un órgano por persona): {len(salidas)}")
    del cargos
    indice = IndiceNombres([(salida.persona, salida) for salida in salidas])
    salidas_por_firma: dict[str, list[Salida]] = {}
    for salida in salidas:
        salidas_por_firma.setdefault(salida.firma, []).append(salida)
    store, scanned, first, last = scan_borme(borme_path, indice, limit)
    keys = [mencion.registro_key for buckets in store.values() for mencion in buckets.values()]
    connection = open_bdns(db_path)
    try:
        empresas = load_empresas(connection, keys)
        log(f"Hojas con ficha de beneficiario (alta o media): {len(empresas)}")
        nifs = {empresa.nif for empresa in empresas.values() if empresa.nif}
        prepare_nif(connection, nifs)
        load_money(connection)
        municipios = MunicipioIndex()
        casos = construir_casos(connection, salidas_por_firma, store, empresas, municipios)
        meta = {
            "built_at": datetime.now().strftime("%Y-%m-%d %H:%M"),
            "n": str(len(casos)),
            "n_despues": str(sum(1 for caso in casos if caso.tipo == "despues")),
            "n_durante": str(sum(1 for caso in casos if caso.tipo == "durante")),
            "parcial": "1" if limit > 0 else "0",
            "limit_actos": str(limit),
            "actos": str(scanned),
            "borme_desde": first,
            "borme_hasta": last,
            "ventana_anos": str(WINDOW_YEARS),
            "supuesto": (
                "2015 ausente en 2019: cese 2019-06-14. "
                "2019 sin fichero de 2023: cese 2023-06-16, aunque repitiera. "
                "Baja de alcalde anterior si no queda concejalía posterior."
            ),
        }
        write_casos(connection, casos, meta)
        print_top(casos)
        return casos
    finally:
        connection.close()


def cargo_fixture(
    nombre: str,
    apellido1: str,
    apellido2: str,
    rol: str,
    ambito: str,
    municipio: str,
    ine: str,
    provincia: str,
    ccaa: str,
    desde: str,
    hasta: str,
    partido: str = "PSOE",
    fuente: str = "Fichero de prueba",
    fuente_url: str = "https://example.test/cargo",
    clave_organo: str = "",
    precision_fechas: str = "mandato",
) -> Cargo:
    persona = Persona(
        tuple(part for part in fold_name(apellido1).split(" ") if part),
        tuple(part for part in fold_name(apellido2).split(" ") if part),
        tuple(part for part in fold_name(nombre).split(" ") if part),
    )
    display = " ".join(part for part in (nombre, apellido1, apellido2) if part)
    cuerpo = f"Municipio de {municipio}"
    if ambito == "insular":
        cuerpo = f"Cabildo Insular de {municipio}"
    return Cargo(
        nombre=display,
        persona=persona,
        rol=rol,
        ambito=ambito,
        cuerpo=cuerpo,
        municipio=municipio,
        ine=ine,
        provincia=provincia,
        ccaa=ccaa,
        desde=desde,
        hasta=hasta,
        partido=partido,
        fuente=fuente,
        fuente_url=fuente_url,
        clave_organo=clave_organo,
        precision_fechas=precision_fechas,
    )


def self_check() -> None:
    assert add_years("2019-06-14", 4) == "2023-06-14"
    assert shift_days("2019-06-14", 1) == "2019-06-15"
    assert empresa_publica("AGUAS MUNICIPALES DE ABERTURA SL")
    assert empresa_publica("SOCIEDAD MIXTA DE SERVICIOS SL")
    assert empresa_publica("PATRONATO DE TURISMO SL")
    assert empresa_publica("SERVICIOS DEL AYUNTAMIENTO DE ABERTURA SL")
    assert not empresa_publica("EDITORIAL PUBLICACIONES BELMONTE SL")
    assert not empresa_publica("TALLERES QUIROGA BELMONTE SL")
    assert nif_publico("P2800000A")
    assert not nif_publico("B11111111")
    assert abs(puntos_nombre(0.96) - 1) < 1e-9
    assert puntos_territorio("municipio") == 1
    assert puntos_territorio("provincia") == 0.48
    assert puntos_tiempo(0, "despues") == 1
    assert puntos_tiempo(0, "durante") == 0.55

    solo_2015 = cargo_fixture(
        "Ana", "Quiroga", "Belmonte", "concejal", "municipal", "Abertura", "10002",
        "Cáceres", "Extremadura", "2015-06-13", "2019-06-14",
    )
    otra_vez = cargo_fixture(
        "Bruno", "Salmerón", "Delgado", "concejal", "municipal", "Abertura", "10002",
        "Cáceres", "Extremadura", "2015-06-13", "2019-06-14",
    )
    bruno_2019 = cargo_fixture(
        "Bruno", "Salmerón", "Delgado", "concejal", "municipal", "Abertura", "10002",
        "Cáceres", "Extremadura", "2019-06-15", "2023-06-16",
    )
    alcalde_sigue = cargo_fixture(
        "Bruno", "Salmerón", "Delgado", "alcalde", "municipal", "Abertura", "10002",
        "Cáceres", "Extremadura", "2019-06-17", "2021-03-01", partido="PP",
        precision_fechas="posesion", fuente="Registro de alcaldes",
    )
    carla = cargo_fixture(
        "Carla", "Hongos", "Yunque", "alcalde", "municipal", "Abertura", "10002",
        "Cáceres", "Extremadura", "2019-06-17", "2021-03-01",
        precision_fechas="posesion", fuente="Registro de alcaldes",
    )
    salidas = salidas_de([solo_2015, otra_vez, bruno_2019, alcalde_sigue, carla])
    by_name = {salida.nombre: salida for salida in salidas}
    assert by_name["Ana Quiroga Belmonte"].hasta == "2019-06-14"
    assert by_name["Ana Quiroga Belmonte"].supuesto == "ausente_en_2019"
    assert by_name["Ana Quiroga Belmonte"].ventana == "2023-06-14"
    bruno = by_name["Bruno Salmerón Delgado"]
    assert bruno.hasta == "2023-06-16"
    assert bruno.supuesto == "fin_2023"
    assert bruno.desde == "2015-06-13"
    assert bruno.rol == "alcalde"
    assert by_name["Carla Hongos Yunque"].hasta == "2021-03-01"
    assert by_name["Carla Hongos Yunque"].supuesto == "baja_alcalde"
    assert clasificar("2020-06-01", bruno) == "durante"
    assert clasificar("2023-09-01", bruno) == "despues"
    assert clasificar("2015-04-01", by_name["Ana Quiroga Belmonte"]) == "antes"
    assert clasificar("2023-07-01", by_name["Ana Quiroga Belmonte"]) == "tarde"
    assert clasificar("2020-02-01", by_name["Ana Quiroga Belmonte"]) == "despues"

    municipios = MunicipioIndex()
    assert municipios.resolve_text("AYUNTAMIENTO DE ABERTURA", "Extremadura") == "10002"
    ana = by_name["Ana Quiroga Belmonte"]
    assert coherencia(ana, ["Ayuntamiento de Abertura"], "Extremadura", municipios) == "municipio"
    assert (
        coherencia(ana, ["Diputación Provincial de Cáceres"], "Extremadura", municipios) == "provincia"
    )
    assert coherencia(ana, ["Ayuntamiento de Alcuéscar"], "Extremadura", municipios) is None
    assert (
        coherencia(ana, ["Mancomunidad de municipios de Abertura"], "Extremadura", municipios)
        == "mancomunidad"
    )
    felipe = cargo_fixture(
        "Felipe", "Heredia", "Gomera", "consejero_insular", "insular", "Tenerife", "",
        "Santa Cruz de Tenerife", "Canarias", "2015-06-13", "2019-06-14",
    )
    isla = salidas_de([felipe])[0]
    assert coherencia(isla, ["Cabildo Insular de Tenerife"], "Canarias", municipios) == "isla"
    ministerio = salida_publicada(
        cargo_fixture(
            "Gorka", "Umerez", "Loiola", "alto_cargo", "estatal", "", "",
            "Madrid", "Administración General del Estado", "2018-06-08", "2020-01-13",
            clave_organo="MINISTERIO DE HACIENDA", precision_fechas="posesion",
        )
    )
    assert ministerio is not None
    assert (
        coherencia(
            ministerio,
            ["Ministerio de Hacienda"],
            "Administración General del Estado",
            municipios,
        )
        == "ministerio"
    )
    assert (
        coherencia(
            ministerio,
            ["Ministerio de Hacienda y Función Pública"],
            "Administración General del Estado",
            municipios,
        )
        == "ministerio"
    )
    assert coherencia(ministerio, ["Ayuntamiento de Abertura"], "Extremadura", municipios) is None

    # The name bonus used by vinculos stays importable so a future change there
    # does not silently diverge from this threshold.
    assert UNIQUE_BONUS == 0.06

    import tempfile

    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        politicos = root / "politicos.sqlite"
        borme = root / "borme.sqlite"
        bdns = root / "bdns.sqlite"
        write_fixture(politicos, borme, bdns)
        casos = calcular(bdns, politicos, borme, 0)
        by_nif: dict[str, list[Caso]] = {}
        for caso in casos:
            by_nif.setdefault(caso.nif, []).append(caso)

        ana_casos = by_nif["B11111111"]
        assert len(ana_casos) == 1
        head = ana_casos[0]
        assert head.tipo == "despues"
        assert head.coherencia == "municipio"
        assert head.supuesto == "ausente_en_2019"
        assert head.cese == "2019-06-14"
        assert head.nombramiento == "2020-02-01"
        assert head.importe_mandato == 35000
        assert head.importe_previo == 35000
        assert head.n_ayudas == 1
        assert head.n_contratos == 1
        assert head.beneficiario_id == 1
        assert head.puntuacion >= MIN_DESPUES
        assert "no prueba" in head.motivo
        assert "2023" in head.motivo or "2019" in head.motivo
        assert {item.clase for item in head.items} == {"ayuda", "contrato"}

        assert by_nif["B22222222"][0].tipo == "durante"
        assert by_nif["B22222222"][0].puntuacion >= MIN_DURANTE
        assert "B33333333" not in by_nif
        assert "B44444444" not in by_nif
        assert "B55555555" not in by_nif
        assert "B66666666" not in by_nif
        assert by_nif["B77777771"][0].tipo == "durante"
        assert by_nif["B77777772"][0].tipo == "despues"
        assert by_nif["B77777772"][0].supuesto == "fin_2023"
        assert by_nif["B77777772"][0].cese == "2023-06-16"
        assert by_nif["B88888881"][0].tipo == "despues"
        assert by_nif["B88888881"][0].supuesto == "baja_alcalde"
        assert by_nif["B88888881"][0].cese == "2021-03-01"
        assert "B99999991" not in by_nif
        assert by_nif["B10101010"][0].coherencia == "provincia"
        assert by_nif["B10101010"][0].confianza_empresa == "media"
        assert by_nif["B12121212"][0].coherencia == "isla"
        assert "B13131313" not in by_nif
        assert "B14141414" in by_nif
        reap = by_nif["B16161616"][0]
        assert reap.tipo == "despues"
        assert reap.nombramiento == "2020-09-01"

        connection = sqlite3.connect(bdns)
        stored = connection.execute("SELECT COUNT(*) FROM alert_puerta").fetchone()[0]
        items = connection.execute("SELECT COUNT(*) FROM alert_puerta_item").fetchone()[0]
        parcial = connection.execute(
            "SELECT valor FROM alert_puerta_meta WHERE clave = 'parcial'"
        ).fetchone()[0]
        connection.close()
        assert stored == len(casos)
        assert items > 0
        assert parcial == "0"

    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        politicos = root / "politicos.sqlite"
        borme = root / "borme.sqlite"
        bdns = root / "bdns.sqlite"
        boe = root / "altos.sqlite"
        write_estatal_fixture(politicos, borme, bdns, boe)
        casos = calcular(bdns, politicos, borme, 0, boe_path=boe)
        assert len(casos) == 1
        caso = casos[0]
        assert caso.tipo == "despues"
        assert caso.coherencia == "ministerio"
        assert caso.rol == "alto_cargo"
        assert caso.cese == "2020-01-13"
        assert caso.nombramiento == "2020-06-01"
        assert caso.nif == "B20202020"
        assert "Hacienda" in caso.organismo
        assert caso.supuesto == "fecha_publicada"

    with tempfile.TemporaryDirectory() as tmp:
        empty = Path(tmp) / "vacio.sqlite"
        sqlite3.connect(empty).close()
        try:
            scan_borme(empty, IndiceNombres([]), 0)
            raise AssertionError("un extracto sin fechas tenía que detenerse")
        except SystemExit as exc:
            assert "persona_cargo" in str(exc)
        solo_acto = Path(tmp) / "acto.sqlite"
        connection = sqlite3.connect(solo_acto)
        connection.execute(
            "CREATE TABLE acto (fecha TEXT, cve TEXT, nombre TEXT, registro_key TEXT, personas TEXT)"
        )
        connection.execute(
            "INSERT INTO acto VALUES ('2020-02-01', 'BORME-A-2020-1-10', 'TALLER SL', 'H1', ?)",
            (people_blob("QUIROGA BELMONTE ANA"),),
        )
        connection.commit()
        connection.close()
        store, scanned, _first, _last = scan_borme(solo_acto, IndiceNombres([(ana.persona, ana)]), 0)
        assert scanned == 1
        assert store[ana.firma]["H1"].fecha == "2020-02-01"
    print("Autocomprobación de puertas giratorias correcta.")


def write_estatal_fixture(politicos: Path, borme: Path, bdns: Path, boe: Path) -> None:
    connection = sqlite3.connect(politicos)
    connection.execute(
        """
        CREATE TABLE politico (
          id INTEGER PRIMARY KEY,
          nombre TEXT, ap1 TEXT, ap2 TEXT, pila TEXT, rol TEXT, ambito TEXT, cuerpo TEXT,
          municipio TEXT, ine TEXT, provincia TEXT, ccaa TEXT, desde TEXT, hasta TEXT,
          partido TEXT, fuente TEXT, fuente_url TEXT, clave_organo TEXT, precision_fechas TEXT
        )
        """
    )
    connection.commit()
    connection.close()

    connection = sqlite3.connect(borme)
    connection.execute(
        """
        CREATE TABLE persona_cargo (
          registro_key TEXT NOT NULL,
          nombre_key TEXT NOT NULL,
          rol TEXT NOT NULL,
          fecha_alta TEXT NOT NULL,
          accion_alta TEXT NOT NULL,
          cve_alta TEXT NOT NULL,
          fecha_ultimo TEXT NOT NULL DEFAULT '',
          accion_ultimo TEXT NOT NULL DEFAULT '',
          cve_ultimo TEXT NOT NULL DEFAULT '',
          fecha_cese TEXT NOT NULL DEFAULT '',
          cve_cese TEXT NOT NULL DEFAULT '',
          PRIMARY KEY (registro_key, rol, nombre_key)
        )
        """
    )
    connection.execute(
        """
        INSERT INTO persona_cargo (
          registro_key, nombre_key, rol, fecha_alta, accion_alta, cve_alta
        ) VALUES ('ZUGASTI1', 'ZUGASTI LARRANAGA NEREA', 'A', '2020-06-01', 'nombramiento', 'BORME-A-2020-80-28')
        """
    )
    connection.execute(
        """
        CREATE TABLE sociedad_persona (
          registro_key TEXT, rol TEXT, nombre_key TEXT, nombre TEXT, kind TEXT
        )
        """
    )
    connection.execute(
        "INSERT INTO sociedad_persona VALUES ('ZUGASTI1', 'A', 'ZUGASTI LARRANAGA NEREA', 'ZUGASTI LARRANAGA NEREA', 'P')"
    )
    connection.execute("CREATE TABLE sociedad (registro_key TEXT PRIMARY KEY, nombre TEXT, cierre TEXT NOT NULL DEFAULT '')")
    connection.execute("INSERT INTO sociedad (registro_key, nombre) VALUES ('ZUGASTI1', 'ESTUDIOS ZUGASTI LARRANAGA SL')")
    connection.commit()
    connection.close()

    connection = sqlite3.connect(bdns)
    connection.execute(
        """
        CREATE TABLE borme_empresa (
          beneficiario_id INTEGER PRIMARY KEY,
          registro_key TEXT, nif TEXT, nombre TEXT, confianza TEXT, capital REAL
        )
        """
    )
    connection.execute(
        """
        INSERT INTO borme_empresa (registro_key, nif, beneficiario_id, nombre, confianza, capital)
        VALUES ('ZUGASTI1', 'B20202020', 20, 'ESTUDIOS ZUGASTI LARRANAGA SL', 'alta', 4000)
        """
    )
    connection.execute(
        """
        CREATE TABLE concesiones (
          id INTEGER, nif TEXT, fecha TEXT, importe REAL, administracion TEXT, departamento TEXT,
          organo TEXT, organismo TEXT, organismo_norm TEXT, ccaa TEXT, titulo TEXT, codigo_bdns TEXT,
          instrumento_slug TEXT, beneficiario_id INTEGER
        )
        """
    )
    organismo = "Ministerio de Hacienda y Función Pública"
    connection.execute(
        """
        INSERT INTO concesiones (
          id, nif, fecha, importe, administracion, departamento, organo, organismo, organismo_norm,
          ccaa, titulo, codigo_bdns, instrumento_slug, beneficiario_id
        ) VALUES (20, 'B20202020', '2019-05-01', 60000, 'Estado', ?, '', ?, ?, 
                  'Administración General del Estado', 'Ayuda industrial', 'BDNS-20', 'subvencion', 20)
        """,
        (organismo, organismo, fold_name(organismo)),
    )
    connection.execute(
        "CREATE TABLE beneficiarios (id INTEGER PRIMARY KEY, nif TEXT, nombre TEXT, importe_total REAL, n_concesiones INTEGER)"
    )
    connection.execute(
        "INSERT INTO beneficiarios (id, nif, nombre, importe_total, n_concesiones) VALUES (20, 'B20202020', 'ESTUDIOS ZUGASTI LARRANAGA SL', 60000, 1)"
    )
    connection.commit()
    connection.close()

    from boe_altos import Evento, connect, write_events

    connection = connect(boe)
    write_events(
        connection,
        "2020-01-14",
        [
            Evento(
                "BOE-A-2020-100",
                "cese",
                "2020-01-13",
                "2020-01-14",
                "Nerea Zugasti Larrañaga",
                "Directora general",
                "MINISTERIO DE HACIENDA",
                "Cese de prueba",
                "https://www.boe.es/diario_boe/txt.php?id=BOE-A-2020-100",
            )
        ],
        "ok",
    )
    connection.commit()
    connection.close()


def people_blob(display: str) -> str:
    folded = fold_name(display)
    return f"A\t{display}\t{folded}\tP"


def write_fixture(politicos: Path, borme: Path, bdns: Path) -> None:
    cargos = [
        cargo_fixture(
            "Ana", "Quiroga", "Belmonte", "concejal", "municipal", "Abertura", "10002",
            "Cáceres", "Extremadura", "2015-06-13", "2019-06-14",
        ),
        cargo_fixture(
            "Bruno", "Salmerón", "Delgado", "concejal", "municipal", "Abertura", "10002",
            "Cáceres", "Extremadura", "2015-06-13", "2019-06-14",
        ),
        cargo_fixture(
            "Bruno", "Salmerón", "Delgado", "concejal", "municipal", "Abertura", "10002",
            "Cáceres", "Extremadura", "2019-06-15", "2023-06-16",
        ),
        cargo_fixture(
            "Carla", "Hongos", "Yunque", "alcalde", "municipal", "Abertura", "10002",
            "Cáceres", "Extremadura", "2019-06-17", "2021-03-01",
            precision_fechas="posesion", fuente="Registro de alcaldes",
        ),
        cargo_fixture(
            "Diego", "Navarro", "Sánchez", "concejal", "municipal", "Abertura", "10002",
            "Cáceres", "Extremadura", "2015-06-13", "2019-06-14",
        ),
        cargo_fixture(
            "Diego", "Navarro", "Sánchez", "concejal", "municipal", "Abadía", "10001",
            "Cáceres", "Extremadura", "2015-06-13", "2019-06-14",
        ),
        cargo_fixture(
            "Diego", "Navarro", "Sánchez", "concejal", "municipal", "Alcuéscar", "10010",
            "Cáceres", "Extremadura", "2015-06-13", "2019-06-14",
        ),
        cargo_fixture(
            "Elena", "Ripollés", "Montseny", "concejal", "municipal", "Abertura", "10002",
            "Cáceres", "Extremadura", "2015-06-13", "2019-06-14",
        ),
        cargo_fixture(
            "Felipe", "Heredia", "Gomera", "consejero_insular", "insular", "Tenerife", "",
            "Santa Cruz de Tenerife", "Canarias", "2015-06-13", "2019-06-14",
        ),
    ]
    connection = sqlite3.connect(politicos)
    connection.execute(
        """
        CREATE TABLE politico (
          id INTEGER PRIMARY KEY,
          nombre TEXT, ap1 TEXT, ap2 TEXT, pila TEXT, rol TEXT, ambito TEXT, cuerpo TEXT,
          municipio TEXT, ine TEXT, provincia TEXT, ccaa TEXT, desde TEXT, hasta TEXT,
          partido TEXT, fuente TEXT, fuente_url TEXT, clave_organo TEXT, precision_fechas TEXT
        )
        """
    )
    connection.executemany(
        """
        INSERT INTO politico (
          nombre, ap1, ap2, pila, rol, ambito, cuerpo, municipio, ine, provincia, ccaa,
          desde, hasta, partido, fuente, fuente_url, clave_organo, precision_fechas
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        """,
        [
            (
                cargo.nombre,
                " ".join(cargo.persona.ap1),
                " ".join(cargo.persona.ap2),
                " ".join(cargo.persona.pila),
                cargo.rol,
                cargo.ambito,
                cargo.cuerpo,
                cargo.municipio,
                cargo.ine,
                cargo.provincia,
                cargo.ccaa,
                cargo.desde,
                cargo.hasta,
                cargo.partido,
                cargo.fuente,
                cargo.fuente_url,
                cargo.clave_organo,
                cargo.precision_fechas,
            )
            for cargo in cargos
        ],
    )
    connection.commit()
    connection.close()

    # registro_key, nombre_key, nombre, empresa, alta, accion, cve, ultimo, accion_ultimo, cve_ultimo
    cargos_fecha = [
        ("QUIROGA1", "QUIROGA BELMONTE ANA", "QUIROGA BELMONTE ANA", "TALLERES QUIROGA BELMONTE SL", "2020-02-01", "nombramiento", "BORME-A-2020-20-10", "2021-08-01", "nombramiento", "BORME-A-2021-30-10"),
        ("QUIROGA2", "QUIROGA BELMONTE ANA", "QUIROGA BELMONTE ANA", "SERVICIOS RURALES BELMONTE SL", "2018-01-15", "nombramiento", "BORME-A-2018-10-10", "", "", ""),
        ("QUIROGA3", "QUIROGA BELMONTE ANA", "QUIROGA BELMONTE ANA", "CONSTRUCCIONES QUIROGA VIEJA SL", "2015-04-01", "nombramiento", "BORME-A-2015-4-10", "", "", ""),
        ("QUIROGA4", "QUIROGA BELMONTE ANA", "QUIROGA BELMONTE ANA", "AGUAS MUNICIPALES DE ABERTURA SL", "2020-04-01", "nombramiento", "BORME-A-2020-40-10", "", "", ""),
        ("QUIROGA5", "QUIROGA BELMONTE ANA", "QUIROGA BELMONTE ANA", "HORNOS DE ALCUESCAR SL", "2020-05-01", "nombramiento", "BORME-A-2020-50-10", "", "", ""),
        ("QUIROGA6", "QUIROGA BELMONTE ANA", "QUIROGA BELMONTE ANA", "TARDIA QUIROGA SL", "2023-07-01", "nombramiento", "BORME-A-2023-70-10", "", "", ""),
        ("QUIROGA7", "QUIROGA BELMONTE ANA", "QUIROGA BELMONTE ANA", "VUELTA QUIROGA BELMONTE SL", "2016-03-01", "nombramiento", "BORME-A-2016-3-10", "2020-09-01", "nombramiento", "BORME-A-2020-90-10"),
        ("BRUNO1", "SALMERON DELGADO BRUNO", "SALMERON DELGADO BRUNO", "PANADERIA SALMERON SL", "2020-06-01", "nombramiento", "BORME-A-2020-60-10", "", "", ""),
        ("BRUNO2", "SALMERON DELGADO BRUNO", "SALMERON DELGADO BRUNO", "HORNO NUEVO SALMERON SL", "2023-09-01", "nombramiento", "BORME-A-2023-90-10", "", "", ""),
        ("CARLA1", "HONGOS YUNQUE CARLA", "HONGOS YUNQUE CARLA", "CLINICA HONGOS YUNQUE SL", "2021-06-01", "nombramiento", "BORME-A-2021-60-10", "", "", ""),
        ("DIEGO1", "NAVARRO SANCHEZ DIEGO", "NAVARRO SANCHEZ DIEGO", "COMUN NAVARRO SL", "2020-03-01", "nombramiento", "BORME-A-2020-31-10", "", "", ""),
        ("ELENA1", "RIPOLLES MONTSENY ELENA", "RIPOLLES MONTSENY ELENA", "ESTUDIOS RIPOLLES SL", "2020-01-15", "nombramiento", "BORME-A-2020-15-10", "", "", ""),
        ("FELIPE1", "HEREDIA GOMERA FELIPE", "HEREDIA GOMERA FELIPE", "CHARTER HEREDIA GOMERA SL", "2020-04-15", "nombramiento", "BORME-A-2020-45-38", "", "", ""),
        ("AMB1", "QUIROGA BELMONTE ANA", "QUIROGA BELMONTE ANA", "AMBIGUA QUIROGA SL", "2020-02-02", "nombramiento", "BORME-A-2020-22-10", "", "", ""),
        ("PUB1", "QUIROGA BELMONTE ANA", "QUIROGA BELMONTE ANA", "EDITORIAL PUBLICACIONES BELMONTE SL", "2020-03-15", "nombramiento", "BORME-A-2020-33-10", "", "", ""),
    ]
    connection = sqlite3.connect(borme)
    connection.execute(
        """
        CREATE TABLE persona_cargo (
          registro_key TEXT NOT NULL,
          nombre_key TEXT NOT NULL,
          rol TEXT NOT NULL,
          fecha_alta TEXT NOT NULL,
          accion_alta TEXT NOT NULL,
          cve_alta TEXT NOT NULL,
          fecha_ultimo TEXT NOT NULL DEFAULT '',
          accion_ultimo TEXT NOT NULL DEFAULT '',
          cve_ultimo TEXT NOT NULL DEFAULT '',
          fecha_cese TEXT NOT NULL DEFAULT '',
          cve_cese TEXT NOT NULL DEFAULT '',
          PRIMARY KEY (registro_key, rol, nombre_key)
        )
        """
    )
    connection.execute(
        """
        CREATE TABLE sociedad_persona (
          registro_key TEXT NOT NULL,
          rol TEXT NOT NULL,
          nombre_key TEXT NOT NULL,
          nombre TEXT NOT NULL,
          kind TEXT NOT NULL
        )
        """
    )
    connection.execute(
        "CREATE TABLE sociedad (registro_key TEXT PRIMARY KEY, nombre TEXT, cierre TEXT NOT NULL DEFAULT '')"
    )
    connection.executemany(
        """
        INSERT INTO persona_cargo (
          registro_key, nombre_key, rol, fecha_alta, accion_alta, cve_alta,
          fecha_ultimo, accion_ultimo, cve_ultimo
        ) VALUES (?, ?, 'A', ?, ?, ?, ?, ?, ?)
        """,
        [
            (key, nombre_key, alta, accion, cve, ultimo, accion_ultimo, cve_ultimo)
            for key, nombre_key, _nombre, _empresa, alta, accion, cve, ultimo, accion_ultimo, cve_ultimo in cargos_fecha
        ],
    )
    connection.executemany(
        "INSERT INTO sociedad_persona (registro_key, rol, nombre_key, nombre, kind) VALUES (?, 'A', ?, ?, 'P')",
        [(key, nombre_key, nombre) for key, nombre_key, nombre, _empresa, *_rest in cargos_fecha],
    )
    connection.executemany(
        "INSERT INTO sociedad (registro_key, nombre) VALUES (?, ?)",
        [(key, empresa) for key, _nombre_key, _nombre, empresa, *_rest in cargos_fecha],
    )
    connection.commit()
    connection.close()

    empresas = [
        ("QUIROGA1", "B11111111", 1, "TALLERES QUIROGA BELMONTE SL", "alta", 3000),
        ("QUIROGA2", "B22222222", 2, "SERVICIOS RURALES BELMONTE SL", "alta", 3000),
        ("QUIROGA3", "B33333333", 3, "CONSTRUCCIONES QUIROGA VIEJA SL", "alta", 3000),
        ("QUIROGA4", "B44444444", 4, "AGUAS MUNICIPALES DE ABERTURA SL", "alta", 3000),
        ("QUIROGA5", "B55555555", 5, "HORNOS DE ALCUESCAR SL", "alta", 3000),
        ("QUIROGA6", "B66666666", 6, "TARDIA QUIROGA SL", "alta", 3000),
        ("BRUNO1", "B77777771", 7, "PANADERIA SALMERON SL", "alta", 8000),
        ("BRUNO2", "B77777772", 8, "HORNO NUEVO SALMERON SL", "alta", 8000),
        ("CARLA1", "B88888881", 9, "CLINICA HONGOS YUNQUE SL", "alta", 6000),
        ("DIEGO1", "B99999991", 10, "COMUN NAVARRO SL", "alta", 3000),
        ("ELENA1", "B10101010", 11, "ESTUDIOS RIPOLLES SL", "media", 20000),
        ("FELIPE1", "B12121212", 12, "CHARTER HEREDIA GOMERA SL", "alta", 15000),
        ("AMB1", "B13131313", 13, "AMBIGUA QUIROGA SL", "ambigua", 3000),
        ("PUB1", "B14141414", 14, "EDITORIAL PUBLICACIONES BELMONTE SL", "alta", 4000),
        ("QUIROGA7", "B16161616", 16, "VUELTA QUIROGA BELMONTE SL", "alta", 3000),
    ]
    grants = [
        (1, "B11111111", "2018-05-01", 25000, "Ayuntamiento de Abertura", "Extremadura", "Ayuda al taller"),
        (2, "B11111111", "2021-03-01", 99999, "Ayuntamiento de Abertura", "Extremadura", "Ayuda posterior"),
        (3, "B22222222", "2017-04-01", 20000, "Ayuntamiento de Abertura", "Extremadura", "Ayuda rural"),
        (4, "B33333333", "2018-05-01", 20000, "Ayuntamiento de Abertura", "Extremadura", "Obra"),
        (5, "B44444444", "2018-06-01", 50000, "Ayuntamiento de Abertura", "Extremadura", "Agua"),
        (6, "B55555555", "2018-06-01", 40000, "Ayuntamiento de Alcuéscar", "Extremadura", "Horno"),
        (7, "B66666666", "2018-08-01", 30000, "Ayuntamiento de Abertura", "Extremadura", "Tarde"),
        (8, "B77777771", "2019-09-01", 18000, "Ayuntamiento de Abertura", "Extremadura", "Pan"),
        (9, "B77777772", "2021-02-01", 22000, "Ayuntamiento de Abertura", "Extremadura", "Horno nuevo"),
        (10, "B88888881", "2020-05-01", 30000, "Ayuntamiento de Abertura", "Extremadura", "Clínica"),
        (11, "B99999991", "2018-05-01", 40000, "Ayuntamiento de Abertura", "Extremadura", "Común"),
        (12, "B10101010", "2018-09-01", 40000, "Diputación Provincial de Cáceres", "Extremadura", "Estudio"),
        (13, "B12121212", "2018-07-01", 35000, "Cabildo Insular de Tenerife", "Canarias", "Charter"),
        (14, "B13131313", "2018-05-01", 50000, "Ayuntamiento de Abertura", "Extremadura", "Ambigua"),
        (15, "B14141414", "2018-10-01", 12000, "Ayuntamiento de Abertura", "Extremadura", "Editorial"),
        (16, "B16161616", "2018-04-01", 15000, "Ayuntamiento de Abertura", "Extremadura", "Segunda alta"),
    ]
    connection = sqlite3.connect(bdns)
    connection.execute(
        """
        CREATE TABLE borme_empresa (
          beneficiario_id INTEGER PRIMARY KEY,
          registro_key TEXT, nif TEXT, nombre TEXT, confianza TEXT, capital REAL
        )
        """
    )
    connection.executemany(
        """
        INSERT INTO borme_empresa (registro_key, nif, beneficiario_id, nombre, confianza, capital)
        VALUES (?,?,?,?,?,?)
        """,
        empresas,
    )
    connection.execute(
        """
        CREATE TABLE concesiones (
          id INTEGER, nif TEXT, fecha TEXT, importe REAL, administracion TEXT, departamento TEXT,
          organo TEXT, organismo TEXT, organismo_norm TEXT, ccaa TEXT, titulo TEXT, codigo_bdns TEXT,
          instrumento_slug TEXT, beneficiario_id INTEGER
        )
        """
    )
    connection.executemany(
        """
        INSERT INTO concesiones (
          id, nif, fecha, importe, administracion, departamento, organo, organismo, organismo_norm,
          ccaa, titulo, codigo_bdns, instrumento_slug, beneficiario_id
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        """,
        [
            (
                row[0],
                row[1],
                row[2],
                row[3],
                row[4],
                "",
                "",
                row[4],
                fold_name(row[4]),
                row[5],
                row[6],
                f"BDNS-{row[0]}",
                "subvencion",
                int(row[1][-2:]),
            )
            for row in grants
        ],
    )
    connection.execute(
        """
        CREATE TABLE placsp_contrato (
          expediente TEXT, lote TEXT, nif TEXT, fecha TEXT, importe REAL, organo TEXT,
          organo_canon TEXT, padres TEXT, titulo TEXT, url TEXT
        )
        """
    )
    connection.execute(
        """
        INSERT INTO placsp_contrato (
          expediente, lote, nif, fecha, importe, organo, organo_canon, padres, titulo, url
        ) VALUES ('EXP-1', '1', 'B11111111', '2018-11-02', 10000, 'Ayuntamiento de Abertura',
                  'AYUNTAMIENTO DE ABERTURA', '', 'Contrato menor de mantenimiento',
                  'https://contrataciondelsectorpublico.gob.es/example')
        """
    )
    connection.execute(
        """
        CREATE TABLE beneficiarios (
          id INTEGER PRIMARY KEY, nif TEXT, nombre TEXT, importe_total REAL, n_concesiones INTEGER
        )
        """
    )
    connection.executemany(
        "INSERT INTO beneficiarios (id, nif, nombre, importe_total, n_concesiones) VALUES (?,?,?,?,?)",
        [(row[2], row[1], row[3], 50000, 2) for row in empresas],
    )
    connection.commit()
    connection.close()


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Indicador de puertas giratorias locales.")
    parser.add_argument("--self-check", action="store_true")
    parser.add_argument("--db", type=Path, default=None)
    parser.add_argument("--politicos", type=Path, default=None)
    parser.add_argument("--borme", type=Path, default=None)
    parser.add_argument("--boe", type=Path, default=None, help="SQLite de ceses II.A. Por defecto data/boe/altos.sqlite si existe.")
    parser.add_argument("--sin-boe", action="store_true", help="No cruza altos cargos aunque exista la caché.")
    parser.add_argument(
        "--limit",
        type=int,
        default=0,
        help="Lee solo los primeros N actos con personas, en el orden del fichero, y marca el resultado como parcial.",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> None:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    if args.self_check:
        self_check()
        return
    if args.limit < 0:
        raise SystemExit("--limit tiene que ser 0 o mayor.")
    calcular(
        args.db or DB_PATH,
        args.politicos or POLITICOS_PATH,
        args.borme or BORME_PATH,
        args.limit,
        boe_path=args.boe,
        use_boe=not args.sin_boe,
    )


if __name__ == "__main__":
    main()
