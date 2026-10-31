#!/usr/bin/env node
// Resolve OrcaSlicer system presets (with "inherits" chains) into standalone JSON files for the CLI.
//   node scripts/orca-flatten-presets.mjs <OrcaSlicer resources/profiles dir> <out dir> \
//        --machine "Creality Ender-3 0.4 nozzle" --process "0.20mm Standard @Creality Ender3 0.4" \
//        --filament "Creality Generic PLA" [--filament "Creality Generic PETG" ...]
// Writes machine.json, process.json and filament-<slug>.json into <out dir> (= ORCASLICER_PROFILE_DIR).
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [root, out, ...rest] = process.argv.slice(2);
if (!root || !out) { console.error('usage: orca-flatten-presets.mjs <profiles dir> <out dir> --machine NAME --process NAME --filament NAME...'); process.exit(2); }
const want = { machine: [], process: [], filament: [] };
for (let i = 0; i < rest.length; i += 2) { const k = rest[i].replace(/^--/, ''); if (!want[k]) { console.error('unknown option ' + rest[i]); process.exit(2); } want[k].push(rest[i + 1]); }

// index every preset by (type, name). Names repeat across vendors (every vendor has its own
// "fdm_machine_common"), so a parent is looked up in the child's own vendor folder first.
const index = new Map();
const vendorOf = (p) => p.slice(root.length).split(/[\\/]/).filter(Boolean)[0] || '';
function walk(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) { walk(p); continue; }
    if (!f.endsWith('.json')) continue;
    let j; try { j = JSON.parse(readFileSync(p, 'utf8')); } catch { continue; }
    if (!j || typeof j.name !== 'string' || !j.type) continue;
    const key = j.type + '\u0000' + j.name;
    if (!index.has(key)) index.set(key, []);
    index.get(key).push({ file: p, vendor: vendorOf(p), json: j });
  }
}
walk(root);

function find(type, name, vendor) {
  const list = index.get(type + '\u0000' + name) || [];
  return list.find((e) => e.vendor === vendor) || list.find((e) => e.vendor === 'OrcaFilamentLibrary') || (vendor ? null : list[0]) || list[0];
}
function resolveOne(type, name, vendor = '', seen = []) {
  const e = find(type, name, vendor);
  if (!e) throw new Error(`${type} preset "${name}" not found under ${root}`);
  if (seen.includes(name)) throw new Error('inheritance loop: ' + [...seen, name].join(' -> '));
  const own = { ...e.json };
  const parent = own.inherits ? resolveOne(type, own.inherits, e.vendor, [...seen, name]) : {};
  delete own.inherits;
  return { ...parent, ...own };
}

mkdirSync(out, { recursive: true });
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
for (const [type, names] of Object.entries(want)) {
  for (const name of names) {
    const p = resolveOne(type, name);
    // Keep "from": "system": the CLI checks the process's compatible_printers against the machine's *system*
    // name, which for a user preset is its "inherits" (gone after flattening) -> "process not compatible".
    Object.assign(p, { from: 'system', instantiation: 'true' });
    const file = type === 'filament' ? `filament-${slug(name)}.json` : `${type}.json`;
    writeFileSync(join(out, file), JSON.stringify(p, null, 2));
    console.log(`${type}: ${name} -> ${join(out, file)} (${Object.keys(p).length} settings)`);
  }
}
