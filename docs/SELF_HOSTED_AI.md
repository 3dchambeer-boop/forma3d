# Self-hosted 3D generation (Phase 6)

Status: **integration ready, model not run.** The authoring environment has no GPU and no access to model
weights, so no open model was executed or benchmarked. Nothing in the app claims otherwise: the
`SELF_HOSTED` provider reports NOT_CONFIGURED until `SELF_HOSTED_INFERENCE_URL/_TOKEN` are set.

## Architecture decision

Two different problems, two different tools:

| Request | Best tool | Why |
|---|---|---|
| Functional part with dimensions (stand, box, bracket, spacer, hook) | `PARAMETRIC` — ai_3d_engine templates | exact millimetres, always watertight, free, instant |
| Organic / artistic shape | diffusion-based mesh model (Tripo today, self-hosted later) | parametric CAD cannot express it |

This follows the research notes: the language model translates intent; deterministic code computes
geometry. Growing the template library (gears, enclosures with lids, cable clips…) gives more value for
functional parts than any generative model.

## Candidate open models (to verify before use)

Source: secondary survey (cmarix.com, 2026) — **read each model's LICENSE file before deploying.**

| Model | Input | Licence (as reported) | VRAM | Note |
|---|---|---|---|---|
| TRELLIS 2 (Microsoft) | image → 3D | MIT | ≥ 16 GB | strongest permissive option; needs a text→image step |
| Hunyuan3D 2.1 (Tencent) | image → 3D | Tencent community licence; **not valid in EU, UK, South Korea**; extra licence > 1 M MAU | ≥ 16 GB | check territory terms for your users |
| Stable Fast 3D (Stability) | image → 3D | Stability Community (commercial < $1 M revenue) | ~8 GB | fast, lower detail |
| TripoSR | image → 3D | MIT | ~6 GB | older, coarse geometry |
| InstantMesh (Tencent ARC) | image → 3D | Apache-2.0 | n/a | multi-view pipeline |
| Point-E (OpenAI) | text → point cloud | MIT | low | not a mesh; unsuitable |

Most strong open models are image-to-3D. A text pipeline therefore needs text → image (an
Apache-2.0/MIT text-to-image model) → image-to-3D. Recommended first candidate: **TRELLIS 2 (MIT)**.

## Inference service contract (implemented by `src/lib/generation/providers/self-hosted.ts`)

```
POST /v1/text-to-3d        Authorization: Bearer <token>
     {"prompt": str, "negative_prompt": str|null, "job_id": str}       → 202 {"task_id": str, "model": str}
GET  /v1/tasks/{task_id}   → {"status": "queued|running|succeeded|failed", "progress": 0-100, "output_url": "/v1/tasks/{id}/output.glb", "error": str}
GET  {output_url}          → GLB bytes (same origin as the service; metres, +Y up per glTF)
```

Server requirements: load weights once at start-up; one GPU job at a time with a queue; per-job timeout;
catch CUDA OOM and report `failed`; delete outputs after download.

## Evaluation plan (Phase D)

Prompt set: 10 functional, 10 simple shapes, 10 decorative (Arabic and English). For each provider record:
generation success, `mesh_validation_service` status, slicing success, time, GPU memory, cost per model,
and a 1–5 human score for shape match. `services/ai_3d_engine` already produces the geometry metrics;
`python -m ai_3d_engine convert out.glb --target-longest 100 -o out.stl` validates any provider output.
