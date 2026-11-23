#!/usr/bin/env python3
"""Match company administrators to public officials of the granting body.

The BORME pipeline (a separate branch) is expected to create this table. This
script never fills it, except when ``--fixture`` builds a throwaway database.

    borme_admins(nif, nombre, cargo, desde, hasta)

``nif`` is the company tax id. ``nombre`` is the administrator, in either
``APELLIDOS, NOMBRE`` or ``NOMBRE APELLIDOS`` order. ``cargo`` is the company
role. ``desde`` and ``hasta`` are ``YYYY-MM-DD``; ``hasta`` is the last day in
the role and may be empty when the appointment is still open or the date is
unknown. Empty dates lower the score and, together with a shared name, drop
the row under the publication threshold.

Results at or above 0.85 are indicators. They are not proof that the
administrator is that official: a namesake can share both surnames and the
given name. Rows below the threshold are not written.

    python3 pipeline/vinculos.py --self-check
    python3 pipeline/vinculos.py --fixture
    python3 pipeline/vinculos.py
"""

from __future__ import annotations

import csv
import sqlite3
import sys
import tempfile
from dataclasses import dataclass, field
from pathlib import Path

from nombres import (
    EXACT_BASE,
    SHARED_PENALTY,
    UNIQUE_BONUS,
    IndiceNombres,
    Persona,
    content_tokens,
    fold_name,
    self_check as nombres_self_check,
)
from territorio import MunicipioIndex

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = Path(__file__).resolve().parent / "fixtures"
DB_PATH = ROOT / "data" / "bdns.sqlite"
POLITICOS_PATH = ROOT / "data" / "politicos.sqlite"

PUBLISH_THRESHOLD = 0.85
APODERADO_PENALTY = 0.07
SIN_FECHAS_PENALTY = 0.05

# A grant whose text says one of these is not "the council" unless it also
# names an ayuntamiento, a concello or an ajuntament explicitly.
NOT_MUNICIPAL = (
    "DIPUTACION",
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

BORME_ALIASES = {
    "nif": ("nif", "nif_empresa", "empresa_nif"),
    "nombre": ("nombre", "administrador", "nombre_admin"),
    "cargo": ("cargo", "cargo_admin"),
    "desde": ("desde", "fecha_desde", "inicio"),
    "hasta": ("hasta", "fecha_hasta", "fin"),
}


@dataclass(frozen=True)
class Oficial:
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
    clave_organo: str = ""
    precision_fechas: str = "mandato"

    @property
    def place_id(self) -> str:
        if self.ambito == "municipal" and self.ine:
            return f"municipal:{self.ine}"
        if self.ambito == "insular":
            return f"insular:{fold_name(self.municipio)}"
        return f"{self.ambito}:{fold_name(self.cuerpo)}:{fold_name(self.clave_organo)}"


@dataclass(frozen=True)
class Administrador:
    nif: str
    nombre: str
    cargo: str
    desde: str
    hasta: str


@dataclass(frozen=True)
class Concesion:
    id: int
    nif: str
    beneficiario_id: int | None
    empresa: str
    administracion: str
    departamento: str
    organo: str
    organismo: str
    ccaa: str
    fecha: str
    anio: int
    importe: float
    titulo: str
    codigo_bdns: str


@dataclass
class Item:
    concesion_id: int
    fecha: str
    importe: float
    titulo: str
    codigo_bdns: str


@dataclass
class Alerta:
    confianza: float
    lugares: int
    modo: str
    motivo: str
    nif: str
    beneficiario_id: int | None
    empresa: str
    admin_nombre: str
    admin_cargo: str
    admin_desde: str
    admin_hasta: str
    politico_nombre: str
    rol: str
    cuerpo: str
    partido: str
    ccaa: str
    organismo: str
    organismo_norm: str
    anio: int
    fecha_inicio: str
    fecha_fin: str
    n: int
    importe_suma: float
    fuente: str
    fuente_url: str
    mandato_desde: str
    mandato_hasta: str
    precision_fechas: str
    items: list[Item] = field(default_factory=list)


def fecha_es(iso: str) -> str:
    if not iso or len(iso) != 10:
        return "fecha no publicada"
    year, month, day = iso.split("-")
    return f"{day}/{month}/{year}"


def fecha_en_rango(fecha: str, desde: str, hasta: str) -> bool:
    if desde and fecha < desde:
        return False
    if hasta and fecha > hasta:
        return False
    return True


def cargo_debil(cargo: str) -> bool:
    return fold_name(cargo).startswith("APODERAD")


def blob_de(concesion: Concesion) -> str:
    return fold_name(
        " ".join(
            (
                concesion.administracion,
                concesion.departamento,
                concesion.organo,
                concesion.organismo,
            )
        )
    )


def municipio_de_concesion(concesion: Concesion, municipios: MunicipioIndex) -> str | None:
    blob = blob_de(concesion)
    explicit = any(token in blob for token in EXPLICIT_COUNCIL)
    if not explicit and any(token in blob for token in NOT_MUNICIPAL):
        return None
    for text in (
        concesion.administracion,
        concesion.departamento,
        concesion.organo,
        concesion.organismo,
    ):
        found = municipios.resolve_text(text, concesion.ccaa)
        if found:
            return found
    return None


def mismo_cuerpo(oficial: Oficial, concesion: Concesion, municipios: MunicipioIndex) -> str | None:
    if oficial.ambito == "municipal":
        ine = municipio_de_concesion(concesion, municipios)
        if ine and ine == oficial.ine:
            return f"La concesión la otorga el municipio de {oficial.municipio}, que es el de ese cargo."
        return None
    if oficial.ambito == "insular":
        blob = blob_de(concesion)
        island = fold_name(oficial.municipio)
        if "CABILDO" not in blob and "CONSELL INSULAR" not in blob:
            return None
        if f" {island} " not in f" {blob} ":
            return None
        return f"La concesión la otorga el cabildo de {oficial.municipio}, que es el de ese cargo."
    blob = blob_de(concesion)
    if municipio_de_concesion(concesion, municipios):
        return None
    if concesion.ccaa and oficial.ccaa and concesion.ccaa != oficial.ccaa:
        return None
    if oficial.rol == "diputado":
        if any(marker in blob for marker in PARLIAMENT_MARKERS):
            return "La concesión la otorga el parlamento autonómico en el que esa persona tiene escaño."
        return None
    if oficial.rol == "alto_cargo" and len(oficial.clave_organo) >= 8:
        if oficial.clave_organo in blob:
            return "La concesión la otorga el departamento de ese alto cargo."
        return None
    return None


def motivo_de(
    admin: Administrador,
    oficial: Oficial,
    confianza: float,
    lugares: int,
    porque: str,
    notas: list[str],
) -> str:
    rol = ROL_LARGO.get(oficial.rol, oficial.rol)
    partido = f", candidatura {oficial.partido}" if oficial.partido else ""
    cargo = admin.cargo or "cargo societario no informado"
    if admin.desde or admin.hasta:
        sociedad = f"{cargo}, {fecha_es(admin.desde)} a {fecha_es(admin.hasta)}"
    else:
        sociedad = cargo
    frases = [
        f"El nombre del cargo societario «{admin.nombre}» ({sociedad}) coincide con {oficial.nombre}, {rol} de {oficial.cuerpo} ({fecha_es(oficial.desde)} a {fecha_es(oficial.hasta)}{partido}).",
        porque,
        f"Confianza {confianza:.0%}.",
        "Indicador, no prueba: puede tratarse de un homónimo.",
    ]
    if lugares > 1:
        frases.append(
            "El mismo nombre figura en otro órgano; el cruce que se publica es solo con el órgano que concede."
        )
    if oficial.precision_fechas == "posesion":
        frases.append("Las fechas del cargo público son la posesión y la baja del registro de alcaldes.")
    else:
        frases.append(
            "Las fechas del cargo público son las del mandato electoral, no la toma de posesión ni la baja de esta persona."
        )
    frases.extend(notas)
    frases.append(f"Fuente: {oficial.fuente}.")
    return " ".join(frases)


def emparejar(
    oficiales: list[Oficial],
    admins: list[Administrador],
    concesiones: list[Concesion],
    municipios: MunicipioIndex,
) -> list[Alerta]:
    indice = IndiceNombres([(oficial.persona, oficial) for oficial in oficiales])
    by_nif: dict[str, list[Concesion]] = {}
    for concesion in concesiones:
        if concesion.importe <= 0 or not concesion.fecha or not concesion.nif:
            continue
        by_nif.setdefault(concesion.nif, []).append(concesion)

    grupos: dict[tuple, dict] = {}
    for admin in admins:
        hits = indice.buscar(admin.nombre)
        if not hits:
            continue
        for concesion in by_nif.get(admin.nif, []):
            if admin.desde or admin.hasta:
                if not fecha_en_rango(concesion.fecha, admin.desde, admin.hasta):
                    continue
            best: tuple | None = None
            for hit in hits:
                oficial = hit.payload
                if not isinstance(oficial, Oficial):
                    continue
                if not oficial.desde or not fecha_en_rango(concesion.fecha, oficial.desde, oficial.hasta):
                    continue
                notas: list[str] = []
                score = hit.confianza
                if cargo_debil(admin.cargo):
                    score = round(score - APODERADO_PENALTY, 2)
                    notas.append("El cargo en la sociedad es de apoderamiento, no de administración.")
                if not admin.desde and not admin.hasta:
                    score = round(score - SIN_FECHAS_PENALTY, 2)
                    notas.append("El nombramiento societario no trae fechas.")
                if score < PUBLISH_THRESHOLD:
                    continue
                porque = mismo_cuerpo(oficial, concesion, municipios)
                if not porque:
                    continue
                rank = ROL_RANK.get(oficial.rol, 0)
                candidate = (score, rank, oficial, hit, notas, porque)
                if best is None or candidate[0] > best[0] or (candidate[0] == best[0] and candidate[1] > best[1]):
                    best = candidate
            if best is None:
                continue
            score, _rank, oficial, hit, notas, porque = best
            anio = concesion.anio or int(concesion.fecha[:4])
            organismo = concesion.organismo or concesion.departamento or concesion.administracion
            key = (
                admin.nif,
                fold_name(admin.nombre),
                oficial.place_id,
                oficial.rol,
                oficial.desde,
                fold_name(organismo),
                anio,
            )
            grupo = grupos.get(key)
            if grupo is None:
                grupo = {
                    "score": score,
                    "hit": hit,
                    "oficial": oficial,
                    "admin": admin,
                    "notas": notas,
                    "porque": porque,
                    "organismo": organismo,
                    "anio": anio,
                    "ccaa": oficial.ccaa or concesion.ccaa,
                    "empresa": concesion.empresa,
                    "beneficiario_id": concesion.beneficiario_id,
                    "items": [],
                }
                grupos[key] = grupo
            if concesion.beneficiario_id and not grupo["beneficiario_id"]:
                grupo["beneficiario_id"] = concesion.beneficiario_id
            grupo["items"].append(concesion)

    alertas: list[Alerta] = []
    for grupo in grupos.values():
        items = sorted(grupo["items"], key=lambda item: (item.fecha, item.id))
        oficial = grupo["oficial"]
        admin = grupo["admin"]
        hit = grupo["hit"]
        alertas.append(
            Alerta(
                confianza=grupo["score"],
                lugares=hit.lugares,
                modo=hit.modo,
                motivo=motivo_de(admin, oficial, grupo["score"], hit.lugares, grupo["porque"], grupo["notas"]),
                nif=admin.nif,
                beneficiario_id=grupo["beneficiario_id"],
                empresa=grupo["empresa"],
                admin_nombre=admin.nombre,
                admin_cargo=admin.cargo,
                admin_desde=admin.desde,
                admin_hasta=admin.hasta,
                politico_nombre=oficial.nombre,
                rol=oficial.rol,
                cuerpo=oficial.cuerpo,
                partido=oficial.partido,
                ccaa=grupo["ccaa"],
                organismo=grupo["organismo"],
                organismo_norm=fold_name(grupo["organismo"]),
                anio=grupo["anio"],
                fecha_inicio=items[0].fecha,
                fecha_fin=items[-1].fecha,
                n=len(items),
                importe_suma=round(sum(item.importe for item in items), 2),
                fuente=oficial.fuente,
                fuente_url=oficial.fuente_url,
                mandato_desde=oficial.desde,
                mandato_hasta=oficial.hasta,
                precision_fechas=oficial.precision_fechas,
                items=[
                    Item(item.id, item.fecha, item.importe, item.titulo, item.codigo_bdns) for item in items[:40]
                ],
            )
        )
    alertas.sort(key=lambda item: (-item.confianza, -item.importe_suma, item.nif, item.anio))
    return alertas


def write_alertas(connection: sqlite3.Connection, alertas: list[Alerta]) -> None:
    connection.executescript(
        """
        DROP TABLE IF EXISTS alert_vinculo_item;
        DROP TABLE IF EXISTS alert_vinculo;
        CREATE TABLE alert_vinculo (
          id INTEGER PRIMARY KEY,
          confianza REAL NOT NULL,
          lugares INTEGER NOT NULL,
          modo TEXT NOT NULL,
          motivo TEXT NOT NULL,
          nif TEXT NOT NULL,
          beneficiario_id INTEGER,
          empresa TEXT NOT NULL,
          admin_nombre TEXT NOT NULL,
          admin_cargo TEXT NOT NULL,
          admin_desde TEXT NOT NULL,
          admin_hasta TEXT NOT NULL,
          politico_nombre TEXT NOT NULL,
          rol TEXT NOT NULL,
          cuerpo TEXT NOT NULL,
          partido TEXT NOT NULL,
          ccaa TEXT NOT NULL,
          organismo TEXT NOT NULL,
          organismo_norm TEXT NOT NULL,
          anio INTEGER NOT NULL,
          fecha_inicio TEXT NOT NULL,
          fecha_fin TEXT NOT NULL,
          n INTEGER NOT NULL,
          importe_suma REAL NOT NULL,
          fuente TEXT NOT NULL,
          fuente_url TEXT NOT NULL,
          mandato_desde TEXT NOT NULL,
          mandato_hasta TEXT NOT NULL,
          precision_fechas TEXT NOT NULL
        );
        CREATE TABLE alert_vinculo_item (
          alert_id INTEGER NOT NULL,
          concesion_id INTEGER NOT NULL,
          fecha TEXT NOT NULL,
          importe REAL NOT NULL,
          titulo TEXT NOT NULL,
          codigo_bdns TEXT NOT NULL
        );
        """
    )
    for index, alerta in enumerate(alertas, start=1):
        connection.execute(
            """
            INSERT INTO alert_vinculo (
              id, confianza, lugares, modo, motivo, nif, beneficiario_id, empresa,
              admin_nombre, admin_cargo, admin_desde, admin_hasta, politico_nombre,
              rol, cuerpo, partido, ccaa, organismo, organismo_norm, anio,
              fecha_inicio, fecha_fin, n, importe_suma, fuente, fuente_url,
              mandato_desde, mandato_hasta, precision_fechas
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """,
            (
                index,
                alerta.confianza,
                alerta.lugares,
                alerta.modo,
                alerta.motivo,
                alerta.nif,
                alerta.beneficiario_id,
                alerta.empresa,
                alerta.admin_nombre,
                alerta.admin_cargo,
                alerta.admin_desde,
                alerta.admin_hasta,
                alerta.politico_nombre,
                alerta.rol,
                alerta.cuerpo,
                alerta.partido,
                alerta.ccaa,
                alerta.organismo,
                alerta.organismo_norm,
                alerta.anio,
                alerta.fecha_inicio,
                alerta.fecha_fin,
                alerta.n,
                alerta.importe_suma,
                alerta.fuente,
                alerta.fuente_url,
                alerta.mandato_desde,
                alerta.mandato_hasta,
                alerta.precision_fechas,
            ),
        )
        connection.executemany(
            """
            INSERT INTO alert_vinculo_item (alert_id, concesion_id, fecha, importe, titulo, codigo_bdns)
            VALUES (?,?,?,?,?,?)
            """,
            [
                (index, item.concesion_id, item.fecha, item.importe, item.titulo, item.codigo_bdns)
                for item in alerta.items
            ],
        )
    connection.executescript(
        """
        CREATE INDEX idx_vinculo_filter ON alert_vinculo(ccaa, anio, confianza DESC);
        CREATE INDEX idx_vinculo_org ON alert_vinculo(organismo_norm);
        CREATE INDEX idx_vinculo_nif ON alert_vinculo(nif);
        CREATE INDEX idx_vinculo_rol ON alert_vinculo(rol, confianza DESC);
        CREATE INDEX idx_vinculo_item ON alert_vinculo_item(alert_id);
        """
    )
    connection.commit()


def _cell(row: dict[str, str], name: str) -> str:
    return (row.get(name) or "").strip()


def load_fixture_oficiales(path: Path) -> list[Oficial]:
    oficiales: list[Oficial] = []
    with path.open(encoding="utf-8", newline="") as handle:
        for row in csv.DictReader(handle):
            persona = Persona(
                content_tokens(_cell(row, "apellido1")),
                content_tokens(_cell(row, "apellido2")),
                content_tokens(_cell(row, "nombre_pila")),
            )
            nombre = " ".join(
                part
                for part in (
                    _cell(row, "nombre_pila"),
                    _cell(row, "apellido1"),
                    _cell(row, "apellido2"),
                )
                if part
            )
            oficiales.append(
                Oficial(
                    nombre=nombre,
                    persona=persona,
                    rol=_cell(row, "rol"),
                    ambito=_cell(row, "ambito"),
                    cuerpo=_cell(row, "cuerpo"),
                    municipio=_cell(row, "municipio"),
                    ine=_cell(row, "ine"),
                    provincia=_cell(row, "provincia"),
                    ccaa=_cell(row, "ccaa"),
                    desde=_cell(row, "desde"),
                    hasta=_cell(row, "hasta"),
                    partido=_cell(row, "partido"),
                    fuente=_cell(row, "fuente"),
                    fuente_url=_cell(row, "fuente_url"),
                    clave_organo=fold_name(_cell(row, "clave_organo")),
                    precision_fechas=_cell(row, "precision") or "mandato",
                )
            )
    return oficiales


def load_fixture_admins(path: Path) -> list[Administrador]:
    admins: list[Administrador] = []
    with path.open(encoding="utf-8", newline="") as handle:
        for row in csv.DictReader(handle):
            admins.append(
                Administrador(
                    nif=_cell(row, "nif").upper(),
                    nombre=_cell(row, "nombre"),
                    cargo=_cell(row, "cargo"),
                    desde=_cell(row, "desde"),
                    hasta=_cell(row, "hasta"),
                )
            )
    return admins


def load_fixture_concesiones(path: Path) -> list[Concesion]:
    rows: list[Concesion] = []
    with path.open(encoding="utf-8", newline="") as handle:
        for row in csv.DictReader(handle):
            fecha = _cell(row, "fecha")
            beneficiario = _cell(row, "beneficiario_id")
            rows.append(
                Concesion(
                    id=int(_cell(row, "id")),
                    nif=_cell(row, "nif").upper(),
                    beneficiario_id=int(beneficiario) if beneficiario else None,
                    empresa=_cell(row, "empresa"),
                    administracion=_cell(row, "administracion"),
                    departamento=_cell(row, "departamento"),
                    organo=_cell(row, "organo"),
                    organismo=_cell(row, "organismo"),
                    ccaa=_cell(row, "ccaa"),
                    fecha=fecha,
                    anio=int(fecha[:4]) if fecha else 0,
                    importe=float(_cell(row, "importe") or 0),
                    titulo=_cell(row, "titulo"),
                    codigo_bdns=_cell(row, "codigo_bdns"),
                )
            )
    return rows


def run_fixture() -> list[Alerta]:
    municipios = MunicipioIndex()
    return emparejar(
        load_fixture_oficiales(FIXTURES / "oficiales_demo.csv"),
        load_fixture_admins(FIXTURES / "borme_admins.csv"),
        load_fixture_concesiones(FIXTURES / "concesiones_demo.csv"),
        municipios,
    )


def print_fixture(alertas: list[Alerta]) -> None:
    print(f"Indicadores del fixture: {len(alertas)} (umbral {PUBLISH_THRESHOLD:.2f})")
    for alerta in alertas:
        print(
            f"  {alerta.nif} {alerta.confianza:.2f} {alerta.rol} {alerta.anio} "
            f"{alerta.organismo} n={alerta.n} {alerta.importe_suma:.0f} €"
        )


def self_check() -> None:
    nombres_self_check()
    municipios = MunicipioIndex()
    assert municipios.lookup("TORRENT", "") == []
    torrent = municipios.lookup("TORRENT", "Comunitat Valenciana")
    assert len(torrent) == 1
    alcoy = municipios.resolve_text("AJUNTAMENT D'ALCOI", "Comunitat Valenciana")
    assert alcoy is not None
    assert municipios.by_ine["04001"].nombre == "Abla"
    alertas = run_fixture()
    by_nif: dict[str, list[Alerta]] = {}
    for alerta in alertas:
        by_nif.setdefault(alerta.nif, []).append(alerta)
        assert alerta.confianza >= PUBLISH_THRESHOLD
        assert "Indicador, no prueba" in alerta.motivo
        assert "homónimo" in alerta.motivo
        assert "12345678" not in alerta.motivo

    ainhoa = by_nif["B0000014A"]
    assert {item.anio for item in ainhoa} == {2020, 2021}
    assert all(item.rol == "alcalde" for item in ainhoa)
    assert all(item.confianza == round(EXACT_BASE + UNIQUE_BONUS, 2) for item in ainhoa)
    assert "registro de alcaldes" in ainhoa[0].motivo

    apoderada = by_nif["B0000015B"]
    assert len(apoderada) == 1
    assert apoderada[0].confianza == round(EXACT_BASE + UNIQUE_BONUS - APODERADO_PENALTY, 2)
    assert apoderada[0].rol == "alcalde"

    antonio = by_nif["B0000021C"]
    assert len(antonio) == 1 and antonio[0].confianza == round(EXACT_BASE - SHARED_PENALTY, 2)
    assert antonio[0].lugares == 2 and "otro órgano" in antonio[0].motivo
    assert antonio[0].rol == "concejal"
    abertura = by_nif["B0000022D"]
    assert len(abertura) == 1 and "Abertura" in abertura[0].cuerpo

    maria = by_nif["B0000071I"]
    assert len(maria) == 1 and maria[0].confianza == 0.96
    assert maria[0].modo == "exacto"

    cabildo = by_nif["B0000091K"]
    assert len(cabildo) == 1 and cabildo[0].n == 1
    assert "TENERIFE" in cabildo[0].organismo_norm
    assert cabildo[0].rol == "consejero_insular"

    diputado = by_nif["B0000101L"]
    assert len(diputado) == 1 and diputado[0].n == 1
    assert diputado[0].rol == "diputado"

    hacienda = by_nif["B0000111M"]
    assert len(hacienda) == 1 and hacienda[0].rol == "alto_cargo"
    assert "HACIENDA" in hacienda[0].organismo_norm

    absent = {"B0000031E", "B0000041F", "B0000051G", "B0000061H", "B0000081J"}
    assert absent.isdisjoint(by_nif)
    assert len(alertas) == 9
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "vinculos.sqlite"
        connection = sqlite3.connect(path)
        write_alertas(connection, alertas)
        stored = connection.execute("SELECT COUNT(*) FROM alert_vinculo").fetchone()[0]
        items = connection.execute("SELECT COUNT(*) FROM alert_vinculo_item").fetchone()[0]
        connection.execute(
            "CREATE TABLE borme_admins (nif TEXT, nombre TEXT, cargo TEXT, desde TEXT, hasta TEXT)"
        )
        connection.execute(
            "INSERT INTO borme_admins VALUES ('B0000099Z', 'RUIZ LOPEZ, ANA', 'Administradora', '2019-01-01', '')"
        )
        loaded = load_borme(connection)
        connection.close()
        assert stored == 9 and items == 9
        assert len(loaded) == 1 and loaded[0].nif == "B0000099Z" and loaded[0].hasta == ""
    print_fixture(alertas)
    print("Autocomprobación de vínculos correcta.")


def table_columns(connection: sqlite3.Connection, table: str) -> set[str]:
    rows = connection.execute(f"PRAGMA table_info({table})").fetchall()
    return {str(row[1]) for row in rows}


def pick_column(columns: set[str], aliases: tuple[str, ...]) -> str | None:
    for alias in aliases:
        if alias in columns:
            return alias
    return None


def load_borme(connection: sqlite3.Connection) -> list[Administrador]:
    columns = table_columns(connection, "borme_admins")
    if not columns:
        return []
    nif_col = pick_column(columns, BORME_ALIASES["nif"])
    nombre_col = pick_column(columns, BORME_ALIASES["nombre"])
    if nif_col is None or nombre_col is None:
        found = ", ".join(sorted(columns))
        raise SystemExit(f"borme_admins no tiene nif y nombre. Columnas: {found}")
    cargo_col = pick_column(columns, BORME_ALIASES["cargo"])
    desde_col = pick_column(columns, BORME_ALIASES["desde"])
    hasta_col = pick_column(columns, BORME_ALIASES["hasta"])
    selected = [nif_col, nombre_col]
    if cargo_col:
        selected.append(cargo_col)
    if desde_col:
        selected.append(desde_col)
    if hasta_col:
        selected.append(hasta_col)
    query = f"SELECT {', '.join(selected)} FROM borme_admins"
    admins: list[Administrador] = []
    for row in connection.execute(query):
        values = {selected[index]: row[index] for index in range(len(selected))}
        admins.append(
            Administrador(
                nif=str(values[nif_col] or "").strip().upper(),
                nombre=str(values[nombre_col] or "").strip(),
                cargo=str(values.get(cargo_col) or "").strip() if cargo_col else "",
                desde=str(values.get(desde_col) or "").strip() if desde_col else "",
                hasta=str(values.get(hasta_col) or "").strip() if hasta_col else "",
            )
        )
    return [admin for admin in admins if admin.nif and admin.nombre]


def load_oficiales(path: Path) -> list[Oficial]:
    connection = sqlite3.connect(path)
    try:
        rows = connection.execute(
            """
            SELECT nombre, ap1, ap2, pila, rol, ambito, cuerpo, municipio, ine, provincia,
                   ccaa, desde, hasta, partido, fuente, fuente_url, clave_organo, precision_fechas
            FROM politico
            """
        )
        oficiales: list[Oficial] = []
        for row in rows:
            persona = Persona(
                tuple(part for part in str(row[1]).split(" ") if part),
                tuple(part for part in str(row[2]).split(" ") if part),
                tuple(part for part in str(row[3]).split(" ") if part),
            )
            oficiales.append(
                Oficial(
                    nombre=str(row[0]),
                    persona=persona,
                    rol=str(row[4]),
                    ambito=str(row[5]),
                    cuerpo=str(row[6]),
                    municipio=str(row[7]),
                    ine=str(row[8]),
                    provincia=str(row[9]),
                    ccaa=str(row[10]),
                    desde=str(row[11]),
                    hasta=str(row[12]),
                    partido=str(row[13]),
                    fuente=str(row[14]),
                    fuente_url=str(row[15]),
                    clave_organo=str(row[16] or ""),
                    precision_fechas=str(row[17] or "mandato"),
                )
            )
        return oficiales
    finally:
        connection.close()


def load_concesiones(connection: sqlite3.Connection, nifs: set[str]) -> list[Concesion]:
    connection.execute("CREATE TEMP TABLE IF NOT EXISTS vinculo_nif (nif TEXT PRIMARY KEY)")
    connection.execute("DELETE FROM vinculo_nif")
    connection.executemany("INSERT OR IGNORE INTO vinculo_nif (nif) VALUES (?)", [(nif,) for nif in nifs])
    rows = connection.execute(
        """
        SELECT c.id, c.nif, c.beneficiario_id, c.beneficiario_nombre,
               COALESCE(c.administracion, ''), COALESCE(c.departamento, ''),
               COALESCE(c.organo, ''), COALESCE(c.organismo, ''),
               COALESCE(c.ccaa, ''), c.fecha, COALESCE(c.anio, 0), c.importe,
               COALESCE(c.titulo, ''), COALESCE(c.codigo_bdns, '')
        FROM concesiones c
        JOIN vinculo_nif n ON n.nif = c.nif
        WHERE c.instrumento_slug = 'subvencion' AND c.importe > 0 AND c.fecha IS NOT NULL
        """
    )
    concesiones: list[Concesion] = []
    for row in rows:
        concesiones.append(
            Concesion(
                id=int(row[0]),
                nif=str(row[1] or ""),
                beneficiario_id=int(row[2]) if row[2] is not None else None,
                empresa=str(row[3] or ""),
                administracion=str(row[4] or ""),
                departamento=str(row[5] or ""),
                organo=str(row[6] or ""),
                organismo=str(row[7] or ""),
                ccaa=str(row[8] or ""),
                fecha=str(row[9] or ""),
                anio=int(row[10] or 0),
                importe=float(row[11] or 0),
                titulo=str(row[12] or ""),
                codigo_bdns=str(row[13] or ""),
            )
        )
    return concesiones


def nifs_con_nombre(oficiales: list[Oficial], admins: list[Administrador]) -> set[str]:
    indice = IndiceNombres([(oficial.persona, oficial) for oficial in oficiales])
    return {admin.nif for admin in admins if indice.buscar(admin.nombre)}


def build_real(db_path: Path, politicos_path: Path) -> int:
    if not politicos_path.exists():
        raise SystemExit(f"No está {politicos_path}. Ejecuta antes python3 pipeline/politicos.py.")
    if not db_path.exists():
        raise SystemExit(f"No está el índice {db_path}.")
    oficiales = load_oficiales(politicos_path)
    connection = sqlite3.connect(db_path)
    try:
        if "borme_admins" not in {
            row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type = 'table'")
        }:
            print("No hay tabla borme_admins. El indicador queda sin calcular hasta que exista esa tabla.")
            return 0
        admins = load_borme(connection)
        print(f"Administradores leídos: {len(admins)}")
        nifs = nifs_con_nombre(oficiales, admins)
        print(f"NIF con algún nombre de cargo público por encima del filtro de homónimos: {len(nifs)}")
        if not nifs:
            write_alertas(connection, [])
            return 0
        concesiones = load_concesiones(connection, nifs)
        print(f"Subvenciones de esos NIF: {len(concesiones)}")
        alertas = emparejar(oficiales, admins, concesiones, MunicipioIndex())
        write_alertas(connection, alertas)
        print(f"Indicadores publicados: {len(alertas)}")
        return len(alertas)
    finally:
        connection.close()


def main() -> None:
    if "--self-check" in sys.argv:
        self_check()
        return
    if "--fixture" in sys.argv:
        alertas = run_fixture()
        print_fixture(alertas)
        return
    db_path = DB_PATH
    politicos_path = POLITICOS_PATH
    if "--db" in sys.argv:
        db_path = Path(sys.argv[sys.argv.index("--db") + 1])
    if "--politicos" in sys.argv:
        politicos_path = Path(sys.argv[sys.argv.index("--politicos") + 1])
    build_real(db_path, politicos_path)


if __name__ == "__main__":
    main()
