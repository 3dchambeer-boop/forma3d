"""Test bridge: run a real ai_3d_engine task from Node tests without the HTTP layer.

stdin: {"task": "...", "kwargs": {...}, "data_path": optional, "out_path": "..."}
stdout: {"metadata": {...}} or {"error": {"code","message","details"}}
"""
import json
import sys

from ai_3d_engine.sandbox import SandboxError, run_isolated



def main() -> None:
    req = json.load(sys.stdin)
    kwargs = req["kwargs"]
    if req.get("data_path"):
        with open(req["data_path"], "rb") as fh:
            kwargs["data"] = fh.read()
    try:
        out = run_isolated(req["task"], kwargs)
    except SandboxError as exc:
        print(json.dumps({"error": {"code": exc.code, "message": exc.message, "details": exc.details}}, default=str))
        return
    with open(req["out_path"], "wb") as fh:
        fh.write(out["stl"])
    print(json.dumps({"metadata": out["metadata"]}, default=str))


if __name__ == "__main__":  # required: the sandbox's spawned child re-imports this module
    main()
