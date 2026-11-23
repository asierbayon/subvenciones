"""Municipality names used to decide whether a grant comes from that council.

The codes and the autonomous-community names match ``build_index.py``. A name
that belongs to more than one municipality is not resolved unless the grant's
community leaves a single candidate.
"""

from __future__ import annotations

import csv
from dataclasses import dataclass
from pathlib import Path

from nombres import fold_name

HERE = Path(__file__).resolve().parent
MUNICIPIOS_CSV = HERE / "vendor" / "municipios.csv"

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

PROVINCE_NAMES = {
    "01": "Álava",
    "02": "Albacete",
    "03": "Alicante",
    "04": "Almería",
    "05": "Ávila",
    "06": "Badajoz",
    "07": "Illes Balears",
    "08": "Barcelona",
    "09": "Burgos",
    "10": "Cáceres",
    "11": "Cádiz",
    "12": "Castellón",
    "13": "Ciudad Real",
    "14": "Córdoba",
    "15": "A Coruña",
    "16": "Cuenca",
    "17": "Girona",
    "18": "Granada",
    "19": "Guadalajara",
    "20": "Gipuzkoa",
    "21": "Huelva",
    "22": "Huesca",
    "23": "Jaén",
    "24": "León",
    "25": "Lleida",
    "26": "La Rioja",
    "27": "Lugo",
    "28": "Madrid",
    "29": "Málaga",
    "30": "Murcia",
    "31": "Navarra",
    "32": "Ourense",
    "33": "Asturias",
    "34": "Palencia",
    "35": "Las Palmas",
    "36": "Pontevedra",
    "37": "Salamanca",
    "38": "Santa Cruz de Tenerife",
    "39": "Cantabria",
    "40": "Segovia",
    "41": "Sevilla",
    "42": "Soria",
    "43": "Tarragona",
    "44": "Teruel",
    "45": "Toledo",
    "46": "Valencia",
    "47": "Valladolid",
    "48": "Bizkaia",
    "49": "Zamora",
    "50": "Zaragoza",
    "51": "Ceuta",
    "52": "Melilla",
}

LOCAL_PREFIXES = (
    "ILUSTRE AYUNTAMIENTO DE ",
    "ILMO AYUNTAMIENTO DE ",
    "AYUNTAMIENTO DE LA ",
    "AYUNTAMIENTO DE LAS ",
    "AYUNTAMIENTO DE LOS ",
    "AYUNTAMIENTO DE EL ",
    "AYUNTAMIENTO DEL ",
    "AYUNTAMIENTO DE ",
    "AYUNTAMIENTO D ",
    "AJUNTAMENT DE LA ",
    "AJUNTAMENT DE LES ",
    "AJUNTAMENT DE ELS ",
    "AJUNTAMENT DE L ",
    "AJUNTAMENT DE ",
    "AJUNTAMENT D ",
    "AJUNTAMENT ",
    "CONCELLO DE ",
    "CONCELLO DA ",
    "CONCELLO DO ",
    "CONCELLO DAS ",
    "CONCELLO DOS ",
    "CONCELLO ",
    "MUNICIPIO DE ",
    "MUNICIPI DE ",
    "MUNICIPI D ",
    "CONCEJO DE ",
)


def muni_keys(nombre: str) -> list[str]:
    keys = [fold_name(nombre)]
    if "/" in nombre:
        for part in nombre.split("/"):
            keys.append(fold_name(part))
    if "," in nombre:
        left, right = nombre.split(",", 1)
        keys.append(fold_name(f"{right} {left}"))
        keys.append(fold_name(left))
    return [key for key in keys if key]


@dataclass(frozen=True)
class Municipio:
    ine: str
    nombre: str
    ccaa: str
    provincia: str


class MunicipioIndex:
    def __init__(self, path: Path = MUNICIPIOS_CSV) -> None:
        self.by_ine: dict[str, Municipio] = {}
        self.by_name: dict[str, list[str]] = {}
        with path.open(encoding="utf-8", newline="") as handle:
            for row in csv.DictReader(handle):
                ine = (row.get("municipio_id") or "").zfill(5)
                provincia = (row.get("provincia_id") or "").zfill(2)
                ccaa = CCAA_BY_PROVINCE.get(provincia)
                if ccaa is None:
                    continue
                municipio = Municipio(
                    ine=ine,
                    nombre=(row.get("nombre") or "").strip(),
                    ccaa=ccaa,
                    provincia=PROVINCE_NAMES.get(provincia, provincia),
                )
                self.by_ine[ine] = municipio
                for key in muni_keys(municipio.nombre):
                    bucket = self.by_name.setdefault(key, [])
                    if ine not in bucket:
                        bucket.append(ine)

    def lookup(self, folded: str, ccaa: str) -> list[str]:
        hits = self.by_name.get(folded, [])
        if not hits:
            return []
        if ccaa and ccaa not in ("", "No determinada"):
            narrowed = [ine for ine in hits if self.by_ine[ine].ccaa == ccaa]
            if len(narrowed) == 1:
                return narrowed
            return []
        if len(hits) == 1:
            return hits
        return []

    def resolve_text(self, text: str, ccaa: str) -> str | None:
        folded = fold_name(text)
        if not folded:
            return None
        found = self.lookup(folded, ccaa)
        if len(found) == 1:
            return found[0]
        for prefix in LOCAL_PREFIXES:
            if not folded.startswith(prefix):
                continue
            tail = folded[len(prefix) :].strip()
            if len(tail) < 3:
                return None
            found = self.lookup(tail, ccaa)
            if len(found) == 1:
                return found[0]
            return None
        return None
