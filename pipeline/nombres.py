#!/usr/bin/env python3
"""Compare a company administrator's name with a public official's name.

Spanish electoral files split given name and surnames. BORME rows usually do
not: they look like ``APELLIDO1 APELLIDO2, NOMBRE`` or ``NOMBRE APELLIDO1
APELLIDO2``. This module normalises both and scores only the name. It does
not decide whether the granting body is the same one: that is ``vinculos.py``.

A match of three or more people who share the sorted name is not returned.
Common names produce homonyms, and this indicator must not publish them.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass

# Particles that are not distinctive. They are removed before comparing so
# "DE LA ROSA" and "ROSA" meet, which also means a particle-only difference
# cannot separate two people. That is a known limit of the score.
PARTICLES = frozenset(
    {
        "DE",
        "DEL",
        "LA",
        "LAS",
        "LOS",
        "Y",
        "I",
        "E",
        "DA",
        "DO",
        "DAS",
        "DOS",
        "VAN",
        "VON",
        "DI",
        "DON",
        "DONA",
    }
)

EXACT_BASE = 0.90
SWAPPED_BASE = 0.87
SINGLE_SURNAME_BASE = 0.84
UNIQUE_BONUS = 0.06
SHARED_PENALTY = 0.02
# Same full name in three or more bodies: do not propose a match.
MAX_PLACES = 2
SINGLE_SURNAME_MIN = 7


def fold_name(value: str) -> str:
    text = unicodedata.normalize("NFD", value or "")
    text = "".join(char for char in text if unicodedata.category(char) != "Mn")
    text = text.upper().replace("·", " ").replace("-", " ").replace("/", " ")
    text = text.replace(".", " ").replace("'", " ")
    text = re.sub(r"[^A-Z0-9 ]+", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def content_tokens(value: str) -> tuple[str, ...]:
    folded = fold_name(value)
    return tuple(token for token in folded.split() if token not in PARTICLES)


def _usable_token(token: str) -> bool:
    return len(token) >= 2


@dataclass(frozen=True)
class Persona:
    ap1: tuple[str, ...]
    ap2: tuple[str, ...]
    pila: tuple[str, ...]

    @property
    def clave(self) -> str:
        return " ".join((*self.ap1, *self.ap2, *self.pila))

    @property
    def firma(self) -> str:
        """Same person with the surnames written in either order."""
        surnames = sorted((" ".join(self.ap1), " ".join(self.ap2)))
        return "|".join((*surnames, " ".join(self.pila)))


def persona_valida(persona: Persona) -> bool:
    if not persona.pila or not persona.ap1:
        return False
    if not all(_usable_token(token) for token in (*persona.pila, *persona.ap1, *persona.ap2)):
        return False
    if not persona.ap2:
        if len(persona.ap1) != 1 or len(persona.ap1[0]) < SINGLE_SURNAME_MIN:
            return False
    return True


def persona_from_parts(nombre: str, apellido1: str, apellido2: str) -> Persona | None:
    persona = Persona(content_tokens(apellido1), content_tokens(apellido2), content_tokens(nombre))
    if not persona.pila or not persona.ap1:
        return None
    if not all(_usable_token(token) for token in (*persona.pila, *persona.ap1, *persona.ap2)):
        return None
    return persona


def interpretations(nombre: str) -> tuple[Persona, ...]:
    """Plausible ways to split a free-text personal name.

    Without a comma, three tokens are ambiguous (name-then-surnames, or
    surnames-then-name). Four or more tokens without a comma are read as
    given names followed by surnames: the last two tokens, and also a
    compound first surname plus a final surname. A comma is the BORME order:
    surnames on the left, given names on the right.
    """
    raw = nombre or ""
    found: list[Persona] = []
    seen: set[Persona] = set()

    def add(ap1: tuple[str, ...], ap2: tuple[str, ...], pila: tuple[str, ...]) -> None:
        persona = Persona(ap1, ap2, pila)
        if persona in seen or not persona_valida(persona):
            return
        seen.add(persona)
        found.append(persona)

    if "," in raw:
        left, right = raw.split(",", 1)
        surnames = content_tokens(left)
        given = content_tokens(right)
        if len(surnames) >= 2 and given:
            # Everything before the last surname stays together, so a compound
            # first surname ("DE LA ROSA GARCIA") is not split into two people.
            add(surnames[:-1], (surnames[-1],), given)
        elif len(surnames) == 1 and given:
            add(surnames, (), given)
        return tuple(found)

    tokens = content_tokens(raw)
    total = len(tokens)
    if total == 2:
        add((tokens[1],), (), (tokens[0],))
        add((tokens[0],), (), (tokens[1],))
        return tuple(found)
    if total >= 3:
        add((tokens[-2],), (tokens[-1],), tokens[:-2])
        if total == 3:
            add((tokens[0],), (tokens[1],), (tokens[2],))
    if total >= 4:
        add(tokens[-3:-1], (tokens[-1],), tokens[:-3])
    return tuple(found)


def _base(persona: Persona, swapped: bool) -> float | None:
    if not persona.ap2:
        if len(persona.ap1) != 1 or len(persona.ap1[0]) < SINGLE_SURNAME_MIN:
            return None
        return SINGLE_SURNAME_BASE
    if swapped:
        return SWAPPED_BASE
    return EXACT_BASE


@dataclass(frozen=True)
class Coincidencia:
    payload: object
    confianza: float
    modo: str
    lugares: int


class IndiceNombres:
    """Officials indexed by structured name. ``payload`` must expose ``place_id``."""

    def __init__(self, filas: list[tuple[Persona, object]]) -> None:
        self._by_clave: dict[str, list[object]] = {}
        self._places: dict[str, set[str]] = {}
        for persona, payload in filas:
            if not persona_valida(persona):
                continue
            place = str(getattr(payload, "place_id"))
            self._by_clave.setdefault(persona.clave, []).append(payload)
            self._places.setdefault(persona.firma, set()).add(place)

    def buscar(self, nombre: str) -> list[Coincidencia]:
        hits: list[Coincidencia] = []
        seen: set[tuple[int, str]] = set()
        for guess in interpretations(nombre):
            self._consider(guess, False, hits, seen)
            if guess.ap2 and guess.ap1 != guess.ap2:
                swapped = Persona(guess.ap2, guess.ap1, guess.pila)
                self._consider(swapped, True, hits, seen)
        return hits

    def _consider(
        self,
        persona: Persona,
        swapped: bool,
        hits: list[Coincidencia],
        seen: set[tuple[int, str]],
    ) -> None:
        payloads = self._by_clave.get(persona.clave)
        if not payloads:
            return
        places = self._places.get(persona.firma, set())
        lugares = len(places)
        if lugares == 0 or lugares > MAX_PLACES:
            return
        base = _base(persona, swapped)
        if base is None:
            return
        if lugares == 1:
            score = base + UNIQUE_BONUS
        else:
            score = base - SHARED_PENALTY
        modo = "apellidos_cambiados" if swapped else "exacto"
        if not persona.ap2:
            modo = "un_apellido"
        for payload in payloads:
            key = (id(payload), modo)
            if key in seen:
                continue
            seen.add(key)
            hits.append(Coincidencia(payload, round(score, 2), modo, lugares))


def self_check() -> None:
    maria = persona_from_parts("María del Carmen", "de la Rosa", "García")
    assert maria is not None
    assert maria.pila == ("MARIA", "CARMEN")
    assert maria.ap1 == ("ROSA",)
    assert maria.ap2 == ("GARCIA",)
    guesses = interpretations("DE LA ROSA GARCIA, MARIA DEL CARMEN")
    assert maria in guesses
    natural = interpretations("María del Carmen de la Rosa García")
    assert maria in natural
    assert interpretations("A. Lizarraga Urrutia") == ()
    short = persona_from_parts("Ana", "Ruiz", "")
    assert short is not None
    assert persona_valida(short) is False

    class Body:
        def __init__(self, place: str) -> None:
            self.place_id = place

    one = Persona(("LIZARRAGA",), ("URRUTIA",), ("AINHOA",))
    shared = Persona(("GARCIA",), ("LOPEZ",), ("ANTONIO",))
    common = Persona(("NAVARRO",), ("SANCHEZ",), ("LUCIA",))
    indice = IndiceNombres(
        [
            (one, Body("abla")),
            (shared, Body("abla")),
            (shared, Body("abertura")),
            (common, Body("abla")),
            (common, Body("abertura")),
            (common, Body("acedera")),
        ]
    )
    solo = indice.buscar("LIZARRAGA URRUTIA, AINHOA")
    assert len(solo) == 1 and solo[0].confianza == 0.96 and solo[0].lugares == 1
    doble = indice.buscar("Antonio García López")
    assert len(doble) == 2 and all(item.confianza == 0.88 for item in doble)
    assert indice.buscar("Lucía Navarro Sánchez") == []
    swapped = indice.buscar("URRUTIA LIZARRAGA, AINHOA")
    assert len(swapped) == 1 and swapped[0].modo == "apellidos_cambiados"
    assert swapped[0].confianza == 0.93
    print("Autocomprobación de nombres correcta.")


if __name__ == "__main__":
    self_check()
