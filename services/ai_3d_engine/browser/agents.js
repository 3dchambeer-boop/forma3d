/*
 * FormaAgents — the AI designer.
 *
 *   1. clarify()   understands a free-form idea and asks only the questions that change geometry
 *   2. design()    writes a complete parametric FormaCAD model + requirements + print settings
 *   3. repair()    rewrites the model when the CAD build or mesh validation fails
 *   4. inspect()   looks at rendered views and judges them against the requirements
 *   5. revise()    applies a change the user asks for in plain language
 *
 * The language model never computes geometry itself; it writes a CAD program and
 * deterministic code builds and checks it. `ask` is injected: in the published page
 * it is the artifact `sample` capability, on the server an Anthropic API call.
 */
(function (root) {
  'use strict';

  const PRINTER = { name: 'Creality Ender-3', build_volume_mm: [220, 220, 250], nozzle_mm: 0.4 };

  const CAD_REFERENCE = `FormaCAD — JSON CAD language (millimetres, Z is up, the part rests on the build plate at z=0).
A model is ONE node. Node = exactly one shape/operation key, plus optional transforms:
  "translate":[x,y,z]  "rotate":[rx,ry,rz] (degrees, applied X, then Y, then Z, about the origin, BEFORE translate)
  "mirror":"x"|"y"|"z"  "scale": s | [sx,sy,sz]
Primitives:
  {"box":{"size":[x,y,z],"center":false}}                      corner at origin unless center:true
  {"rounded_box":{"size":[x,y,z],"r":3,"center":false}}         vertical edges rounded with radius r
  {"cylinder":{"d":20,"h":10,"d2":12,"center":false,"segments":64}}   axis = +Z from z=0; d2 makes a cone/frustum; r/r2 also accepted
     low segment counts give exact prisms: "segments":6 is a hexagon with a corner on +X (across flats = d*cos(30), measured along Y) — use it for nut traps and hex sockets
  {"sphere":{"d":20,"segments":40}}                            centred at origin
  {"torus":{"R":20,"r":4,"segments":48}}                       in the XY plane, centred at origin
  {"extrude":{"points":[[x,y],...],"h":5,"holes":[[[x,y],...]]}}   any simple polygon (concave allowed), extruded +Z from 0 to h
  {"revolve":{"profile":[[r,z],...],"segments":64}}            closed profile in the r>=0 half-plane revolved around Z (vases, knobs, bushings)
  {"fillet_box":{"size":[x,y,z],"r":2}}                        box with EVERY edge rounded (true constant radius); r < half the smallest side
  {"chamfer_box":{"size":[x,y,z],"d":1}}                       box with every edge chamfered by d
  {"loft":{"sections":[{"points":[[x,y],...],"z":0},{"points":[...],"z":40}]}}   ruled transition between sections (square base to round top...)
  {"sweep":{"profile":[[x,y],...],"path":[[x,y,z],...]}}        profile swept along a polyline (handles, rails, frames); bends up to 110 deg
  {"mirror_copy":{"axis":"x","child":node}}                    the child plus its mirror image (symmetric parts)
Rounded and chamfered corners (real tangent arcs): add "fillet": r (or [r per point], 0 = sharp) or "chamfer": d to extrude, revolve,
  sweep, or a loft section. Example: {"extrude":{"points":[[0,0],[60,0],[60,40],[0,40]],"h":5,"fillet":4}}. A radius that does not fit
  is an error naming the edge, so keep r below half the shortest adjacent edge.
Booleans:
  {"union":[node,...]}   {"difference":[base, cut1, cut2, ...]}   {"intersection":[node,...]}
Patterns:
  {"linear_array":{"count":4,"step":[dx,dy,dz],"child":node}}
  {"polar_array":{"count":12,"angle":360,"child":node}}        copies rotated about the Z axis through the origin
Numbers anywhere may be expressions over the design parameters: "width/2 - wall", "sin(30)*len", "max(2, wall*1.5)".
Functions: sin cos tan asin acos atan atan2 (degrees), sqrt abs min max floor ceil round pow; constant pi.
Limits: at most 600 nodes, 400 booleans, 128 segments per curve, sizes up to 2000 mm.`;

  const DESIGN_RULES = `Design for FDM printing on a ${PRINTER.name} (${PRINTER.build_volume_mm.join(' x ')} mm, ${PRINTER.nozzle_mm} mm nozzle):
- The finished part must be ONE connected solid. Parts you union must overlap by at least 0.5 mm; never let solids merely touch.
- Every cut in a difference must pass at least 1 mm beyond the faces it cuts through (no coplanar faces between base and cut).
- Walls >= 2 mm (load-bearing >= 3 mm). Minimum feature 1.2 mm. Fit inside the build volume.
- Orient for printing: the largest flat face on z=0; avoid overhangs steeper than 45 degrees from vertical unless supports are acceptable; prefer chamfers to unsupported horizontal edges.
- Clearance holes: M3 3.4 mm, M4 4.5 mm, M5 5.5 mm, M6 6.6 mm; sliding fit +0.4 mm, press fit +0.15 mm, around a held object +0.5 to +1 mm.
- Look professional: real fillets ("fillet" on profiles, fillet_box) on outer edges and chamfers on bottom edges (better first layer), consistent wall thickness, symmetric where the object is symmetric, 64+ segments for visible curves.
- Every key dimension is a named parameter; geometry references parameters through expressions so the user can resize the part.
- Keep the model readable: name groups with "name", stay well under the node limits.

STANDARD PARTS (use these exact numbers; never guess a standard size):
- Hex nuts ISO 4032 (across flats / thickness): M3 5.5/2.4, M4 7/3.2, M5 8/4.7, M6 10/5.2, M8 13/6.8, M10 16/8.4, M12 18/10.8 mm. Nut trap: across flats +0.3 mm, depth thickness +0.4 mm.
- Socket head cap screws ISO 4762 (head diameter / head height): M3 5.5/3, M4 7/4, M5 8.5/5, M6 10/6, M8 13/8, M10 16/10 mm. Counterbore: head diameter +0.6 mm.
- Ball bearings (bore x outer x width): 623 3x10x4, 625 5x16x5, 608 8x22x7, 688 8x16x5, 6000 10x26x8, 6001 12x28x8, 6200 10x30x9 mm. Bearing seat: outer diameter +0.1 mm (press) or +0.3 mm (slip).
- Metric PVC pipe outer diameters: 20, 25, 32, 40, 50, 63, 75, 90, 110 mm. 2020 aluminium extrusion: 20 x 20 mm, slot 6 mm.
- Batteries: AA 14.5 x 50.5 mm, AAA 10.5 x 44.5 mm, 18650 18.5 x 65 mm. ID/credit card 85.6 x 53.98 x 0.76 mm. Arduino Uno board 68.6 x 53.4 mm.
- Anything brand-specific (a phone model, a device) is NOT in this table: use the customer's measured value or state the assumption clearly.

DEVICES (cases, mounts, docks, holders that touch a specific product): never invent a device's camera layout, buttons, ports or corner radius. Take the layout and proportions from the customer's attached photo, absolute sizes from the verified list below or the customer's measurements, and make every feature size and position a named parameter so it can be corrected after a test fit. State each estimated value in assumptions_ar.
- Verified (official spec sheets): iPhone 17 Pro Max 163.4 x 78.0 x 8.75 mm (Apple). Its rear cameras sit on a raised plateau that spans the FULL WIDTH of the top of the back (three lenses on one side, flash and sensors on the other); a case needs one full-width opening there, not a corner square.

VERIFICATION CHECKS (required): list 3-10 measurable checks for the key requirements. Software measures each one on the finished mesh, and failures come back to you. Coordinates are in the same model space as your nodes and may use parameter expressions.
- {"label_ar":"...","type":"size","axis":"x|y|z","expect":expr,"tol":0.2}            overall size of the part along an axis
- {"label_ar":"...","type":"gap","at":[x,y,z],"axis":"x|y|z","expect":expr,"tol":0.1}  width of the EMPTY space (hole, slot, clamp opening) containing point "at", measured along axis
- {"label_ar":"...","type":"wall","at":[x,y,z],"axis":"x|y|z","expect":expr,"tol":0.1} thickness of the MATERIAL containing point "at", measured along axis
- {"label_ar":"...","type":"empty"|"solid","at":[x,y,z]}                              the point must be empty (e.g. a through hole) or inside material
Put "at" well inside the feature (centre of a hole, middle of a wall), not on a face or edge. Round holes are polygons, so use tol >= 0.1 mm for them.`;

  const EXAMPLE = `{"union":[
  {"name":"base","rounded_box":{"size":["width","depth","base_t"],"r":4}},
  {"name":"back plate","rounded_box":{"size":["width","plate_t","height"],"r":3},"rotate":["90-tilt",0,0],"translate":[0,"depth*0.55","base_t-0.5"]},
  {"name":"front lip","box":{"size":["width",3,"base_t+lip"]},"translate":[0,"depth*0.12",0]}
]}`;

  function fmtAnswers(qa) {
    return qa.length ? qa.map((x, i) => `${i + 1}. Q: ${x.question}\n   A: ${x.answer}`).join('\n') : '(none yet)';
  }

  function clarifyPrompt(idea, qa, round, maxRounds) {
    return `You are a senior industrial designer working for a 3D-printing service in Iraq. A customer who may know nothing about design describes an object they want printed. Your job now is ONLY to understand it and ask the minimum precise questions needed to design it well.

Customer's idea (may be Arabic, Iraqi dialect or English):
"""${idea}"""

Questions already asked and answered:
${fmtAnswers(qa)}

This is clarification round ${round} of at most ${maxRounds}.
Ask only what changes geometry, fit or printability: overall size, the exact size of anything it must hold or attach to (phone thickness with case, screw size, pipe diameter...), how it is mounted, the load it carries, where it is used (heat, outdoors -> material), and style only if it matters. Do not ask what you can sensibly assume; state those assumptions instead. Offer a concrete suggested answer for every question so the customer can just confirm. Write all customer-facing text in clear Modern Standard Arabic.
If the object must fit a specific device or existing object and no photo is attached, ask for a clear photo of it with a question of kind "photo", and ask for the measurements of the features the design depends on (for a phone case: the camera area size and distance from the top edge, button positions).
If what you know is already enough to produce a good design, set "ready": true and ask nothing. ${round >= maxRounds ? 'This is the last round: set "ready": true.' : ''}

Reply with only this JSON:
{"understanding_ar": "two sentences restating the object and its purpose",
 "object_type": "short English noun phrase",
 "ready": false,
 "questions": [{"id":"q1","question_ar":"...","why_ar":"one short reason","kind":"number|choice|text|boolean|photo","unit":"mm|deg|count|kg|null","options_ar":["only for choice"],"suggested":"value as string"}],
 "assumptions_ar": ["..."]}
Use 3-6 questions when not ready.`;
  }

  // ---------------------------------------------------------------- multi-concept
  function conceptsPrompt(brief, n = 3) {
    return `You are a senior industrial designer. Propose ${n} genuinely different design concepts for the object below — different in mechanism, structure or form (for example clamp vs adhesive vs screw mount; open tray vs closed box), not the same shape at different sizes. Each must satisfy the brief and be printable on a ${PRINTER.name} (${PRINTER.build_volume_mm.join(' x ')} mm).

OBJECT BRIEF
${brief}

Reply with only this JSON, minified:
{"concepts":[{"key":"a|b|c","title_ar":"short name","approach_ar":"one sentence: how this concept works","differs_by_ar":"what makes it different from the others","tradeoffs_ar":["strength or weakness", "..."]}]}`;
  }
  function checkConcepts(j, n = 3) {
    const list = j && Array.isArray(j.concepts) ? j.concepts : null;
    if (!list || !list.length) throw Object.assign(new Error('no concepts in the reply'), { code: 'invalid_json' });
    return list.slice(0, n).map((c, i) => ({ key: String(c.key || 'abc'[i]).slice(0, 8), title_ar: String(c.title_ar || `مفهوم ${i + 1}`).slice(0, 80), approach_ar: String(c.approach_ar || '').slice(0, 400), differs_by_ar: String(c.differs_by_ar || '').slice(0, 300), tradeoffs_ar: (Array.isArray(c.tradeoffs_ar) ? c.tradeoffs_ar : []).slice(0, 5).map((t) => String(t).slice(0, 200)) }));
  }
  const conceptBrief = (brief, c, others) => `${brief}

DESIGN CONCEPT TO BUILD: "${c.title_ar}" — ${c.approach_ar}
It must stay clearly different from the other concepts: ${others.map((o) => `"${o.title_ar}" (${o.approach_ar})`).join('; ')}.`;

  // concepts -> one full design loop per concept (no visual inspection, one repair) -> distinctness check
  async function conceptsLoop(deps, brief, opts = {}) {
    const { ask, onStep } = deps, n = Math.min(3, Math.max(2, opts.n || 3));
    onStep('concepts', 'running');
    const concepts = checkConcepts(await ask(conceptsPrompt(brief, n), { ...(opts.tier || DESIGN_TIER), label: 'concepts' }), n);
    onStep('concepts', 'done', concepts.map((c) => c.title_ar).join(' · '));
    const out = [];
    for (const [i, c] of concepts.entries()) {
      const stepped = (id, state, info) => onStep(`${id}_${i}`, state, info, `${c.title_ar}: `);
      try {
        const r = await designLoop({ ...deps, render: null, onStep: stepped }, conceptBrief(brief, c, concepts.filter((o) => o !== c)), { maxRepairs: opts.maxRepairs ?? 1, inspect: false, tier: opts.tier });
        out.push({ concept: c, ...r });
      } catch (e) { if (e && e.code === 'cancelled') throw e; out.push({ concept: c, design: null, result: null, error: e }); }
    }
    const sigs = out.map((o) => (o.result && o.result.signature) || null);
    const dist = deps.distinctness ? deps.distinctness(sigs) : null;
    return { concepts: out, distinctness: dist };
  }

  // ---------------------------------------------------------------- assemblies (several printed parts)
  const ASSEMBLY_REFERENCE = `ASSEMBLY FORMAT
{"name_ar":"...","summary_ar":"...",
 "parts":[{"id":"snake_case","name_ar":"...","qty":1,"translate":[x,y,z],"rotate":[rx,ry,rz],
           "datums":{"name":{"axis":"z","at":mm_in_part_frame,"dir":1|-1}},
           "axes":{"name":{"point":[x,y,z],"dir":[dx,dy,dz]}},   axis lines (pins, holes) in the part's own frame
           "design":{ one complete single-part design: name_ar, summary_ar, requirements, parameters, model, checks, print }}],
 "constraints":[
   {"type":"mate","a":"part_id","a_face":"+z","b":"part_id","b_face":"-z","offset":0},   faces point at each other; b is moved
   {"type":"flush","a":..,"a_face":"+x","b":..,"b_face":"+x","offset":0},                 same direction, same plane
   {"type":"align","a":..,"b":..,"axis":"x"},                                             bounding-box centres coincide
   {"type":"clearance","a":..,"b":..,"min":0.3,"ignore_contact":true},                    measured gap, ignoring resting faces
   {"type":"concentric","a":..,"a_axis":"pin","b":..,"b_axis":"hole"},                     b slides until its axis is on a's axis
   {"type":"revolute","a":..,"a_axis":"pin","b":..,"b_axis":"hole","angle":0,"range":[0,90],"step":15},
                                                                                           hinge: concentric + turned to "angle";
                                                                                           the whole range is checked for collisions
   {"type":"slider","a":..,"a_axis":"rail","b":..,"b_axis":"bore","offset":0,"range":[0,60],"step":5},
                                                                                           prismatic: b on a's axis, "offset" mm along it;
                                                                                           the whole travel is checked for collisions
   {"type":"cylindrical","a":..,"a_axis":..,"b":..,"b_axis":..},                            concentric, turning and sliding free
   {"type":"planar","a":..,"a_face":"+z","b":..,"b_face":"-z"},                            faces in contact, free within the plane
   {"type":"fixed","a":..,"b":..}]}                                                        b keeps its spec pose relative to a
Faces: "+x","-x","+y","-y","+z","-z" = that side of the part's bounding box, or a datum name (use a datum when a pin or lip
sticks out past the face you mean). The first part is fixed; only "b" moves (mate/flush/align/concentric by translation, revolute/angle by turning about a's axis). Each part is modelled in its
own frame in its print orientation. Mating parts need real clearances (0.2-0.4 mm for sliding fits, 0.1-0.2 press fits).`;
  function assemblyPrompt(brief) {
    return `You are a senior mechanical designer. The object below needs SEVERAL printed parts that fit together. Design every part and how they are assembled. Deterministic software builds each part, solves the constraints, checks every pair for interference with exact booleans, and measures each clearance.

OBJECT BRIEF
${brief}

${DESIGN_RULES}

${CAD_REFERENCE}

${ASSEMBLY_REFERENCE}

Reply with only the assembly JSON, minified.`;
  }
  function checkAssembly(j) {
    if (!j || !Array.isArray(j.parts) || !j.parts.length) throw Object.assign(new Error('the assembly has no parts'), { code: 'invalid_json' });
    if (j.parts.length > 12) throw Object.assign(new Error('at most 12 parts'), { code: 'invalid_json' });
    return { name_ar: String(j.name_ar || 'تجميعة'), summary_ar: String(j.summary_ar || ''), constraints: Array.isArray(j.constraints) ? j.constraints : [],
      parts: j.parts.map((p, i) => ({ id: String(p.id || 'part' + (i + 1)).replace(/[^\w-]/g, '_').slice(0, 40), name_ar: String(p.name_ar || p.id || ''), qty: Math.max(1, Math.min(50, Number(p.qty) || 1)), translate: p.translate, rotate: p.rotate, datums: p.datums, axes: p.axes, design: checkDesign(p.design) })) };
  }
  function describeAssemblyProblem(err, asm) {
    if (err) return 'Building or assembling failed: ' + (err.message || err.code);
    const bad = [];
    for (const c of asm.constraints) {
      if (c.ok) continue;
      const hits = (c.sweep || []).filter((s) => s.hits.length);
      bad.push(c.type === 'clearance' ? `clearance ${c.a}/${c.b} is ${c.measured_mm} mm, needs >= ${c.min}`
        : hits.length ? `${c.type === 'slider' ? 'slider' : 'hinge'} ${c.b} on ${c.a} collides at ${hits.map((s) => `${s.offset !== undefined ? s.offset + ' mm' : s.angle + ' deg'} (${s.hits.map((h) => `${h.with} ${h.volume_mm3} mm3`).join(', ')})`).join('; ')}`
        : `${c.type} ${c.a}/${c.b} left a residual of ${c.residual_mm ?? c.residual_deg ?? c.residual}`);
    }
    for (const i of asm.interference) bad.push(`parts ${i.a} and ${i.b} overlap by ${i.volume_mm3} mm3`);
    return bad.join('; ');
  }
  async function assemblyLoop(deps, brief, opts = {}) {
    const { ask, assemble, onStep } = deps, T = opts.tier || DESIGN_TIER, maxRepairs = opts.maxRepairs ?? 1;
    onStep('design', 'running');
    let spec = checkAssembly(await ask(assemblyPrompt(brief), { ...T, label: 'design' }));
    onStep('design', 'done', `${spec.name_ar} — ${spec.parts.length} قطع`);
    let asm = null, err = null;
    for (let attempt = 0; ; attempt++) {
      onStep('build', 'running', attempt ? `محاولة ${attempt + 1}` : '');
      try { asm = await assemble(spec); err = null; } catch (e) { asm = null; err = e; }
      if (asm && asm.ok) { onStep('build', 'done', 'لا تداخل، والقيود محققة'); break; }
      if (attempt >= maxRepairs) { onStep('build', err ? 'failed' : 'warn', describeAssemblyProblem(err, asm)); break; }
      onStep('repair', 'running', describeAssemblyProblem(err, asm));
      spec = checkAssembly(await ask(`${assemblyPrompt(brief)}

YOUR PREVIOUS ASSEMBLY
${JSON.stringify(spec)}

PROBLEMS FOUND BY THE CHECKER (fix them; keep everything that already works)
${describeAssemblyProblem(err, asm)}`, { ...T, label: 'repair' }));
      onStep('repair', 'done');
    }
    return { spec, assembly: asm, error: err };
  }

  function designPrompt(brief) {
    return `You are a senior mechanical/industrial designer. Design the object below for 3D printing and express it as a FormaCAD model. Deterministic software will build your model, validate the mesh (watertight, single body, walls, build volume) and show it to the customer, so the model must be complete and correct.

OBJECT BRIEF
${brief}

${DESIGN_RULES}

${CAD_REFERENCE}

Example fragment (style only, not this object):
${EXAMPLE}

Think through the shape, the coordinate placement of every feature and the order of booleans before writing. Double-check: rotations happen about the origin before translation; cylinders grow +Z from their base; cuts overshoot by 1 mm; unions overlap by 0.5 mm.

Reply with only this JSON, minified (no indentation, no comments):
{"name_ar":"short product name",
 "summary_ar":"2-3 sentences describing the design and why it fits the need",
 "requirements":["measurable 'shall' statements with units and tolerances, English"],
 "parameters":[{"name":"snake_case","label_ar":"...","value":number,"unit":"mm|deg|count","min":number,"max":number}],
 "model":{ ...one FormaCAD node... },
 "checks":[{"label_ar":"...","type":"size|gap|wall|empty|solid", "...": "see VERIFICATION CHECKS"}],
 "print":{"material":"PLA|PETG|TPU|ABS","layer_height_mm":0.2,"infill_percent":20,"supports":false,"orientation_ar":"...","notes_ar":["..."]},
 "assumptions_ar":["..."]}`;
  }

  function repairPrompt(brief, design, problem) {
    return `You designed the FormaCAD model below for this brief, but building or checking it failed. Fix the model so it builds and passes validation, keeping the design intent and the parameter names unless a change is necessary.

OBJECT BRIEF
${brief}

PROBLEM REPORTED BY THE CAD ENGINE
${problem}

YOUR PREVIOUS DESIGN
${JSON.stringify(design)}

${DESIGN_RULES}

${CAD_REFERENCE}

Typical causes: a cut that does not overshoot (coplanar faces), parts that only touch instead of overlapping, a feature placed outside the body because of rotate/translate order, a difference whose first node is not the body, sizes outside the build volume.
Reply with only the complete corrected design JSON, minified (no indentation) in the same shape as before (name_ar, summary_ar, requirements, parameters, model, checks, print, assumptions_ar).`;
  }

  function revisePrompt(brief, design, request) {
    return `Here is a 3D-printable design and the customer's change request. Apply the change precisely and return the full updated design. Keep everything the customer did not ask to change.

OBJECT BRIEF
${brief}

CUSTOMER'S CHANGE REQUEST (Arabic or English)
"""${request}"""

CURRENT DESIGN
${JSON.stringify(design)}

${DESIGN_RULES}

${CAD_REFERENCE}

Reply with only the complete updated design JSON, minified (no indentation) in the same shape (name_ar, summary_ar, requirements, parameters, model, checks, print, assumptions_ar).`;
  }

  function inspectPrompt(brief, design, measured) {
    return `You are the quality inspector of a 3D-printing service. The attached image shows the model just built from the design below, rendered from four views (labelled ISO, FRONT, RIGHT, TOP; Z up; grid squares are 10 mm). Judge whether it matches the brief and requirements and whether it is a professional, printable product. Any further images are the customer's own photos of the object or device: compare feature positions (openings, cameras, ports, buttons) against them.

OBJECT BRIEF
${brief}

REQUIREMENTS
${(design.requirements || []).map((r) => '- ' + r).join('\n')}

MEASURED BY THE ENGINE
${measured}

Be concrete. Only ask for a revision for real defects (missing or misplaced feature, wrong proportion, part that cannot hold its object, unprintable feature, clearly unfinished look). Write findings in Modern Standard Arabic.
Reply with only this JSON:
{"verdict":"pass|revise","score":1-10,"findings_ar":["..."],"fix_instructions":"precise English instructions for the designer, empty when pass"}`;
  }

  function briefOf(idea, understanding, qa) {
    return `Customer idea: ${idea}\nUnderstanding: ${understanding || '-'}\nAnswers:\n${fmtAnswers(qa)}`;
  }

  function checkDesign(d) {
    if (!d || typeof d !== 'object') throw new Error('design is not an object');
    if (!d.model || typeof d.model !== 'object') throw new Error('design has no model');
    if (!Array.isArray(d.parameters)) d.parameters = [];
    d.parameters = d.parameters.filter((p) => p && /^[A-Za-z_][A-Za-z0-9_]*$/.test(p.name) && Number.isFinite(Number(p.value)))
      .map((p) => ({ ...p, value: Number(p.value), min: Number.isFinite(+p.min) ? +p.min : undefined, max: Number.isFinite(+p.max) ? +p.max : undefined }));
    d.requirements = Array.isArray(d.requirements) ? d.requirements.map(String) : [];
    d.assumptions_ar = Array.isArray(d.assumptions_ar) ? d.assumptions_ar.map(String) : [];
    d.print = d.print && typeof d.print === 'object' ? d.print : {};
    d.checks = Array.isArray(d.checks) ? d.checks.filter((c) => c && typeof c === 'object' && c.type).slice(0, 40) : [];
    return d;
  }

  function describeBuildProblem(err, result) {
    if (err) return `${err.code || 'ERROR'}: ${err.message}`;
    const v = result.post_export_validation;
    const issues = v.issues.map((i) => `${i.code}${i.count != null ? ' x' + i.count : ''}: ${i.message}`).join('\n');
    const an = result.analysis || {};
    const failed = (an.checks || []).filter((c) => !c.pass).map((c) => `CHECK FAILED "${c.label}" (${c.type}): ${c.error ? 'error ' + c.error : `expected ${c.expect}, measured ${c.measured}${c.tol != null ? ' (tol ' + c.tol + ')' : ''}${c.note ? ', ' + c.note : ''}`}`);
    const dfm = ((an.dfm && an.dfm.issues) || []).filter((i) => i.severity === 'error').map((i) => `DFM ${i.code}: ${i.message}`);
    const extra = failed.length || dfm.length ? '\n' + [...failed, ...dfm].join('\n') + (failed.length ? '\nA failed check means either the geometry is wrong or the check point/axis is wrong; fix whichever is wrong (never loosen a tolerance just to pass).' : '') : '';
    return `Mesh validation status ${v.status}. Size ${result.size_mm.x} x ${result.size_mm.y} x ${result.size_mm.z} mm.\n${issues}${extra}`;
  }

  function needsRepair(result) {
    if (!result) return true;
    const codes = result.post_export_validation.issues.map((i) => i.code);
    const an = result.analysis || {};
    const badCheck = (an.checks || []).some((c) => !c.pass);
    const dfmError = ((an.dfm && an.dfm.issues) || []).some((i) => i.severity === 'error' && i.area_mm2 > 5);
    return result.status === 'REPAIR_REQUIRED' || codes.includes('MULTIPLE_BODIES') || codes.includes('EXCEEDS_BUILD_VOLUME') || badCheck || dfmError;
  }

  /**
   * Run design → build → (repair) → (inspect) with progress callbacks.
   * deps: { ask(prompt, opts) -> JSON, build(design) -> Promise<result>, render(result) -> Promise<Blob|null>, onStep(id, state, info) }
   */
  // Tier for writing CAD models. The top tier thinks for minutes before the first
  // character, and long silent calls are the ones that get cut; this answers in ~1 min.
  const DESIGN_TIER = { modelTier: 'default', effort: 'medium' };

  async function designLoop(deps, brief, opts = {}) {
    const { ask, build, render, onStep } = deps;
    const maxRepairs = opts.maxRepairs ?? 2;
    const T = opts.tier || DESIGN_TIER;
    onStep('design', 'running');
    let design = checkDesign(await ask(designPrompt(brief), { ...T, label: 'design' }));
    onStep('design', 'done', design.name_ar);
    let result = null, err = null;
    for (let attempt = 0; ; attempt++) {
      onStep('build', 'running', attempt ? `محاولة ${attempt + 1}` : '');
      err = null; result = null;
      try { result = await build(design); } catch (e) { err = e; }
      if (!err && !needsRepair(result)) { onStep('build', 'done', result.status); break; }
      if (attempt >= maxRepairs) { onStep('build', err ? 'failed' : 'warn', describeBuildProblem(err, result)); break; }
      onStep('repair', 'running', describeBuildProblem(err, result));
      design = checkDesign(await ask(repairPrompt(brief, design, describeBuildProblem(err, result)), { ...T, label: 'repair' }));
      onStep('repair', 'done');
    }
    let inspection = null;
    if (result && render && opts.inspect !== false) {
      const image = await render(result).catch(() => null);
      if (image) {
        onStep('inspect', 'running');
        const measured = `size ${result.size_mm.x} x ${result.size_mm.y} x ${result.size_mm.z} mm; validation ${result.status}; parameters ${JSON.stringify(result.params)}`;
        inspection = await ask(inspectPrompt(brief, design, measured), { modelTier: 'default', images: [image], label: 'inspect' }).catch(() => null);
        if (inspection && inspection.verdict === 'revise' && inspection.fix_instructions && opts.autoFix !== false) {
          onStep('inspect', 'warn', (inspection.findings_ar || []).join(' · '));
          onStep('repair', 'running', 'تطبيق ملاحظات الفحص البصري');
          try {
            const fixed = checkDesign(await ask(revisePrompt(brief, design, 'Inspector findings to fix: ' + inspection.fix_instructions), { ...T, label: 'fix' }));
            const r2 = await build(fixed);
            if (!needsRepair(r2)) { design = fixed; result = r2; inspection.applied = true; }
            onStep('repair', 'done');
          } catch (e) { onStep('repair', 'warn', e.message); }
        } else onStep('inspect', 'done', inspection ? `${inspection.score}/10` : '');
      }
    }
    return { design, result, error: result ? null : err, inspection };
  }

  const api = { assemblyPrompt, checkAssembly, assemblyLoop, describeAssemblyProblem, conceptsPrompt, checkConcepts, conceptsLoop, DESIGN_TIER, PRINTER, CAD_REFERENCE, DESIGN_RULES, clarifyPrompt, designPrompt, repairPrompt, revisePrompt, inspectPrompt, briefOf, checkDesign, designLoop, needsRepair, describeBuildProblem };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FormaAgents = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
