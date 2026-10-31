"""Reference results from the Python engine for the parity test (stdin: JSON list of prompts)."""
import json
import sys

from ai_3d_engine.geometry.io import read_stl
from ai_3d_engine.pipeline import PipelineError, generate_parametric
from ai_3d_engine.spec.parser import parse

out = []
for prompt in json.load(sys.stdin):
    spec = parse(prompt)
    row = {"template": spec.template, "params": {k: [v.value, v.source] for k, v in spec.params.items()}, "errors": spec.errors}
    try:
        r = generate_parametric(spec)
        m = read_stl(r.stl)
        row.update(status=r.status, size=r.size_mm, triangles=r.triangles, volume=m.signed_volume(),
                   wall=r.post_export_validation["stats"].get("estimated_min_wall_mm"), requirements=r.spec["requirements"])
    except PipelineError as e:
        row.update(error=e.code)
    out.append(row)
print(json.dumps(out))
