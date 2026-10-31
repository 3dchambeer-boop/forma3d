"""Text → DesignSpec.

Two extractors share one output contract:

* ``RuleBasedExtractor`` — deterministic, Arabic + English, no network. It is
  always available and is what the test-suite exercises.
* ``LLMExtractor`` (``spec/llm.py``) — optional; asks a language model to fill
  the same JSON. Its output goes through ``finalize_spec`` exactly like the
  rule parser's, so every number is range-checked by code, not trusted.

User-entered form fields always win over anything read from the prompt, and
every parameter records where its value came from, so nothing is applied
silently.
"""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass, field

from ..templates.base import Template
from ..templates.library import TEMPLATES

_AR_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹٫", "01234567890123456789.")
_UNIT_TO_MM = {
    "mm": 1.0, "مم": 1.0, "ملم": 1.0, "ملليمتر": 1.0, "مليمتر": 1.0, "ملي": 1.0, "millimeter": 1.0, "millimetre": 1.0,
    "cm": 10.0, "سم": 10.0, "سنتيمتر": 10.0, "سانتيمتر": 10.0, "سنتي": 10.0, "centimeter": 10.0, "centimetre": 10.0,
    "in": 25.4, "inch": 25.4, "inches": 25.4, "انش": 25.4, "إنش": 25.4,
}
_NUM = r"(\d+(?:\.\d+)?)"
_UNIT_REQUIRED = r"(mm|cm|inch(?:es)?|in|millimet(?:er|re)s?|centimet(?:er|re)s?|مم|ملم|ملليمتر|مليمتر|ملي|سم|سنتيمتر|سانتيمتر|سنتي|انش|إنش)"
_UNIT = _UNIT_REQUIRED + "?"
# Between a parameter name and its value: no digits and no clause separators, so
# "wide, 12 cm tall" never reads 12 as the width.
_GAP = r"[^\d\n,،;]{0,25}?"


@dataclass
class ParamValue:
    value: float
    source: str  # "user_field" | "prompt" | "default" | "llm"
    note: str | None = None


@dataclass
class DesignSpec:
    prompt: str
    language: str
    template: str | None
    template_title: str | None
    intended_use: str
    params: dict[str, ParamValue] = field(default_factory=dict)
    requirements: list[str] = field(default_factory=list)
    assumptions: list[str] = field(default_factory=list)
    clarifications: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    extractor: str = "rules"

    def values(self) -> dict[str, float]:
        return {k: v.value for k, v in self.params.items()}

    def to_dict(self) -> dict:
        return asdict(self)


def normalize(text: str) -> str:
    text = text.translate(_AR_DIGITS)
    text = re.sub(r"[ً-ْـ]", "", text)  # tashkeel + tatweel
    text = text.replace("×", "x").replace("*", "x").replace("أ", "ا").replace("إ", "ا").replace("آ", "ا")
    return text


def detect_language(text: str) -> str:
    arabic = len(re.findall(r"[؀-ۿ]", text))
    latin = len(re.findall(r"[A-Za-z]", text))
    return "ar" if arabic >= latin else "en"


def _to_mm(value: float, unit: str | None) -> float:
    if not unit:
        return value
    return value * _UNIT_TO_MM.get(unit.lower(), 1.0)


def choose_template(text: str) -> Template | None:
    t = normalize(text).lower()
    best, best_len = None, 0
    for tpl in TEMPLATES.values():
        for kw in tpl.keywords:
            k = normalize(kw).lower()
            if k in t and len(k) > best_len:  # longest keyword wins ("حامل هاتف" beats "حامل")
                best, best_len = tpl, len(k)
    return best


def _alias_regex(alias: str) -> str:
    a = re.escape(normalize(alias).lower())
    # Arabic prefixes: ب (with), ال (the), و (and) — "بعرض", "والارتفاع"
    return rf"(?:[وب]?(?:ال)?{a})" if re.match(r"[؀-ۿ]", alias) else rf"\b{a}\b"


def extract_rule_based(prompt: str, template: Template) -> tuple[dict[str, ParamValue], list[str]]:
    """Read parameter values mentioned near their names, e.g. 'بعرض 90 مم', 'height of 11 cm'."""
    text = normalize(prompt).lower()
    found: dict[str, ParamValue] = {}
    notes: list[str] = []
    for p in template.params:
        if p.unit in ("bool", "count") or not p.aliases:
            continue  # booleans and counts have their own rules below
        for alias in p.aliases:
            # English: "8 cm wide" (value first) is tried before "width 8 cm" (name first)
            if p.unit == "deg":
                suffix = re.compile(_NUM + r"\s*(?:°|درجة|درجه|deg(?:rees?)?)\s*" + _alias_regex(alias))
                prefix = re.compile(_alias_regex(alias) + _GAP + _NUM + r"\s*(?:°|درجة|درجه|deg(?:rees?)?)?")
            else:
                suffix = re.compile(_NUM + r"\s*" + _UNIT_REQUIRED + r"\s*(?:of\s+)?" + _alias_regex(alias))
                prefix = re.compile(_alias_regex(alias) + _GAP + _NUM + r"\s*" + _UNIT)
            # Arabic puts the name before the value ("بعرض 90 مم"); only English uses "90 mm wide"
            arabic_alias = bool(re.match(r"[\u0600-\u06FF]", alias))
            m = prefix.search(text) if arabic_alias else (suffix.search(text) or prefix.search(text))
            if m:
                value = float(m.group(1))
                unit = m.group(2) if p.unit == "mm" and m.lastindex and m.lastindex >= 2 else None
                if p.unit == "mm":
                    value = _to_mm(value, unit)
                if p.name not in found:
                    found[p.name] = ParamValue(round(value, 3), "prompt", f"read from '{m.group(0).strip()}'")
                break
    # bare "AxBxC mm" triple → template's first three mm key params, in order
    triple = re.search(_NUM + r"\s*x\s*" + _NUM + r"(?:\s*x\s*" + _NUM + r")?\s*" + _UNIT, text)
    if triple:
        nums = [g for g in triple.groups()[:3] if g]
        unit = triple.group(4)
        keys = [k for k in template.key_params if template.param(k).unit == "mm"]
        for k, n in zip(keys, nums):
            if k not in found:
                found[k] = ParamValue(round(_to_mm(float(n), unit), 3), "prompt", f"read from '{triple.group(0).strip()}'")
    # template-specific boolean features
    if template.key == "phone_stand" and re.search(r"شحن|كيبل|كابل|سلك|charg|cable|usb", text):
        found["charging_slot"] = ParamValue(1, "prompt", "charging/cable opening requested")
    if template.key == "l_bracket" and re.search(r"بدون دعام|بلا دعام|no gusset|without gusset", text):
        found["gusset"] = ParamValue(0, "prompt", "gusset explicitly not wanted")
    if template.key == "wall_hook" and re.search(r"لاصق|بدون براغي|adhesive|no screw", text):
        found["screw_diameter"] = ParamValue(0, "prompt", "adhesive mount, no screw holes")
    count_words = {"واحد": 1, "اثنين": 2, "اثنان": 2, "ثلاث": 3, "اربع": 4, "خمس": 5, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5}
    for p in template.params:
        if p.unit == "count" and p.name not in found:
            for alias in p.aliases:
                a = normalize(alias).lower()
                m = re.search(_NUM + r"\s*" + re.escape(a), text) or re.search(r"(\w+)\s+" + re.escape(a), text)
                if m:
                    raw = m.group(1)
                    val = float(raw) if re.fullmatch(r"\d+(?:\.\d+)?", raw) else count_words.get(raw)
                    if val is not None:
                        found[p.name] = ParamValue(val, "prompt", f"read from '{m.group(0).strip()}'")
                        break
    return found, notes


_USE_PATTERNS = (
    ("functional", r"وظيف|قطعة غيار|تثبيت|حمل|يتحمل|functional|mount|load|bracket|holder"),
    ("artistic", r"فني|زخرف|تمثال|ديكور|مجسم فني|artistic|decorative|sculpture|figurine|statue"),
    ("prototype", r"نموذج اولي|بروتوتايب|prototype|mockup"),
)


def detect_use(text: str, template: Template | None) -> str:
    t = normalize(text).lower()
    for use, pattern in _USE_PATTERNS:
        if re.search(pattern, t):
            return use
    return "functional" if template else "artistic"


def finalize_spec(
    prompt: str,
    template: Template | None,
    from_text: dict[str, ParamValue],
    user_fields: dict[str, float] | None = None,
    intended_use: str | None = None,
    extractor: str = "rules",
) -> DesignSpec:
    lang = detect_language(prompt)
    spec = DesignSpec(
        prompt=prompt,
        language=lang,
        template=template.key if template else None,
        template_title=(template.title_ar if lang == "ar" else template.title_en) if template else None,
        intended_use=intended_use or detect_use(prompt, template),
        extractor=extractor,
    )
    if template is None:
        spec.clarifications.append(
            "لم يُطابق الوصف قالبًا هندسيًا دقيقًا؛ سيتطلب توليدًا حرًا (مزود AI خارجي) دون ضمان أبعاد دقيقة."
            if lang == "ar"
            else "No precise parametric template matches; this needs free-form AI generation without guaranteed dimensions."
        )
        return spec
    user_fields = {k: v for k, v in (user_fields or {}).items() if v is not None}
    for p in template.params:
        if p.name in user_fields:
            spec.params[p.name] = ParamValue(float(user_fields[p.name]), "user_field")
        elif p.name in from_text:
            spec.params[p.name] = from_text[p.name]
        else:
            spec.params[p.name] = ParamValue(p.default, "default")
            if p.name in template.key_params:
                label = p.label_ar if lang == "ar" else p.label_en
                spec.assumptions.append(
                    f"{label}: لم يُذكر، استُخدمت القيمة الافتراضية {p.default:g} {p.unit}" if lang == "ar"
                    else f"{label}: not given, default {p.default:g} {p.unit} used"
                )
                spec.clarifications.append(
                    f"ما {label} المطلوب ({p.unit})؟" if lang == "ar" else f"What {label.lower()} do you need ({p.unit})?"
                )
    for name, pv in spec.params.items():
        problem = template.param(name).clamp_check(pv.value)
        if problem:
            spec.errors.append(problem)
    if not spec.errors:
        spec.requirements = template.requirements(spec.values())
    return spec


def parse(prompt: str, user_fields: dict[str, float] | None = None, template_key: str | None = None,
          intended_use: str | None = None) -> DesignSpec:
    if not prompt or not prompt.strip():
        raise ValueError("prompt is empty")
    template = TEMPLATES.get(template_key) if template_key else choose_template(prompt)
    from_text, _ = extract_rule_based(prompt, template) if template else ({}, [])
    return finalize_spec(prompt, template, from_text, user_fields, intended_use, extractor="rules")
