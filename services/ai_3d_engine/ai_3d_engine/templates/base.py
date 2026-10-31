"""Parametric template contract.

A template owns three things: a parameter schema (units, limits, defaults),
the geometry builder, and the human-readable requirements it guarantees.
The language model (or the rule parser) only *chooses* a template and fills
parameters; it never computes geometry. That split follows the finding that
LLMs are unreliable at spatial arithmetic but good at translating intent.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable

from ..geometry.csg import Solid


@dataclass(frozen=True)
class Param:
    name: str
    default: float
    minimum: float
    maximum: float
    unit: str  # "mm" | "deg" | "count" | "bool"
    label_ar: str
    label_en: str
    aliases: tuple[str, ...] = ()  # words in a prompt that refer to this parameter

    def clamp_check(self, value: float) -> str | None:
        if value < self.minimum or value > self.maximum:
            return f"{self.name}={value}{self.unit} outside allowed range [{self.minimum}, {self.maximum}]"
        return None


@dataclass
class Template:
    key: str
    title_ar: str
    title_en: str
    keywords: tuple[str, ...]
    params: tuple[Param, ...]
    build: Callable[[dict], Solid]
    requirements: Callable[[dict], list[str]]
    # parameters that should come from the user; missing ones trigger a clarification question
    key_params: tuple[str, ...] = ()
    notes: list[str] = field(default_factory=list)

    def param(self, name: str) -> Param:
        for p in self.params:
            if p.name == name:
                return p
        raise KeyError(name)

    def defaults(self) -> dict:
        return {p.name: p.default for p in self.params}

    def schema(self) -> dict:
        return {
            "key": self.key,
            "title_ar": self.title_ar,
            "title_en": self.title_en,
            "key_params": list(self.key_params),
            "params": [
                {
                    "name": p.name, "default": p.default, "min": p.minimum, "max": p.maximum,
                    "unit": p.unit, "label_ar": p.label_ar, "label_en": p.label_en,
                }
                for p in self.params
            ],
        }
