"""Optional language-model spec extraction (Anthropic Messages API).

The model only *translates* the request into the template's parameter JSON.
Everything it returns is passed through ``finalize_spec``, which range-checks
each value against the template schema; the geometry is computed by code.

Enabled when ``ANTHROPIC_API_KEY`` is set. Without it the engine uses the
rule-based extractor and says so in ``DesignSpec.extractor``.
"""

from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.request

from ..templates.library import TEMPLATES
from .parser import DesignSpec, ParamValue, finalize_spec, parse

API_URL = "https://api.anthropic.com/v1/messages"
API_VERSION = "2023-06-01"


class LLMUnavailable(RuntimeError):
    pass


def is_configured() -> bool:
    return bool(os.environ.get("ANTHROPIC_API_KEY"))


def _system_prompt() -> str:
    catalog = json.dumps([t.schema() for t in TEMPLATES.values()], ensure_ascii=False)
    return (
        "You convert a 3D-printing request (Arabic or English) into JSON for a parametric CAD template. "
        "Never invent geometry or do arithmetic beyond unit conversion to millimetres. "
        "Choose the single best template key from the catalog or null if none fits. "
        "Only include parameters the user actually stated or clearly implied; omit everything else. "
        'Reply with JSON only: {"template": str|null, "params": {name: number}, "intended_use": '
        '"functional"|"artistic"|"prototype"}.\nCatalog: ' + catalog
    )


def _call(prompt: str, timeout: float = 30.0) -> dict:
    key = os.environ.get("ANTHROPIC_API_KEY")
    if not key:
        raise LLMUnavailable("ANTHROPIC_API_KEY not set")
    body = json.dumps(
        {
            "model": os.environ.get("ENGINE_LLM_MODEL", "claude-sonnet-5-5"),
            "max_tokens": 600,
            "system": _system_prompt(),
            "messages": [{"role": "user", "content": prompt}],
        }
    ).encode()
    req = urllib.request.Request(
        API_URL,
        data=body,
        method="POST",
        headers={"x-api-key": key, "anthropic-version": API_VERSION, "content-type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            payload = json.loads(resp.read())
    except (urllib.error.URLError, TimeoutError) as exc:
        raise LLMUnavailable(f"LLM request failed: {exc}") from exc
    text = "".join(block.get("text", "") for block in payload.get("content", []) if block.get("type") == "text")
    match = re.search(r"\{.*\}", text, re.S)
    if not match:
        raise LLMUnavailable("LLM reply contained no JSON")
    return json.loads(match.group(0))


def parse_with_llm(prompt: str, user_fields: dict[str, float] | None = None, intended_use: str | None = None) -> DesignSpec:
    """Use the LLM when configured; on any failure fall back to the rule parser (recorded in the spec)."""
    if not is_configured():
        return parse(prompt, user_fields, intended_use=intended_use)
    try:
        data = _call(prompt)
    except (LLMUnavailable, json.JSONDecodeError) as exc:
        spec = parse(prompt, user_fields, intended_use=intended_use)
        spec.assumptions.append(f"LLM extraction unavailable ({exc}); rule-based parser used.")
        return spec
    template = TEMPLATES.get(data.get("template") or "")
    from_text: dict[str, ParamValue] = {}
    if template:
        names = {p.name for p in template.params}
        for name, value in (data.get("params") or {}).items():
            if name in names and isinstance(value, (int, float)):
                from_text[name] = ParamValue(float(value), "llm")
    use = intended_use or data.get("intended_use")
    if use not in ("functional", "artistic", "prototype"):
        use = None
    return finalize_spec(prompt, template, from_text, user_fields, use, extractor="llm")
