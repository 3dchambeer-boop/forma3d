// CadClient against a local HTTP stand-in that implements the documented cad_engine responses.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { describe, test } from 'node:test';
import { CadClient, CadServiceError } from '../../src/lib/cad/cad-client.ts';

async function serve(handler: (body: any, headers: any) => [number, unknown]) {
  const srv = createServer(async (req, res) => {
    let raw = ''; for await (const c of req) raw += c;
    const [status, body] = handler(raw ? JSON.parse(raw) : null, req.headers);
    res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body));
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${(srv.address() as { port: number }).port}`, close: () => srv.close() };
}

describe('CadClient', () => {
  test('sends the design, token and quality; decodes files; refuses a STEP that failed its re-open check', async () => {
    let seen: any;
    const s = await serve((body, headers) => {
      seen = { body, token: headers['x-cad-token'] };
      const ok = body.formats.includes('stl');
      return [200, { report: { valid: true }, exports: { step: { base64: Buffer.from('ISO-10303-21;').toString('base64'), check: { ok } }, stl: { base64: Buffer.from('stl').toString('base64'), check: { volume_rel_err: 1e-4 } } } }];
    });
    const c = new CadClient(s.url, 'secret');
    const out = await c.build({ model: { box: { size: [1, 2, 3] } } }, { w: 4 }, ['step', 'stl'], { linear_mm: 0.02, angular_deg: 4 });
    assert.equal(out.exports.step!.bytes.toString(), 'ISO-10303-21;');
    assert.equal(seen.token, 'secret');
    assert.deepEqual(seen.body.quality, { linear_mm: 0.02, angular_deg: 4 });
    await assert.rejects(c.build({}, {}, ['step']), (e: unknown) => e instanceof CadServiceError && e.code === 'STEP_CHECK_FAILED');
    s.close();
  });
  test('maps CAD errors with their model path, and an unreachable service to 503', async () => {
    const s = await serve(() => [422, { detail: { code: 'CAD_ERROR', message: 'model.fillet_edges: fillet r=6 mm failed', path: 'model.fillet_edges' } }]);
    await assert.rejects(new CadClient(s.url, '').build({}, {}, ['step']), (e: unknown) => e instanceof CadServiceError && e.status === 422 && e.path === 'model.fillet_edges');
    s.close();
    await assert.rejects(new CadClient('http://127.0.0.1:9', '').build({}, {}, ['step']), (e: unknown) => e instanceof CadServiceError && e.status === 503);
  });
});
