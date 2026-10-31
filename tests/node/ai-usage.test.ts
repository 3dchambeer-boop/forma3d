// Phase 9 — AI usage and cost tracking. SIMULATED: a local HTTP server stands in for api.anthropic.com
// (no API key was available for this run). It answers in the Messages API shape, including `usage`.
// The prices below are test values for arithmetic, not Anthropic's prices.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, describe, test } from 'node:test';

import { askJson } from '../../src/lib/generation/anthropic.ts';
import { ProviderError } from '../../src/lib/generation/errors.ts';
import { costOf, ledger, pricing, resetLedger, UsageLedger } from '../../src/lib/generation/usage.ts';

let server: Server;
const seen: { key: string | undefined; version: string | undefined; model: string }[] = [];
let reply: { status: number; body: unknown } = { status: 200, body: {} };

before(async () => {
  server = createServer((req, res) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => {
      seen.push({ key: req.headers['x-api-key'] as string, version: req.headers['anthropic-version'] as string, model: JSON.parse(b).model });
      res.writeHead(reply.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(reply.body));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  process.env.ANTHROPIC_API_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/messages`;
  process.env.ANTHROPIC_API_KEY = 'sk-test-not-a-real-key';
  process.env.AI_DESIGNER_MODEL_DEFAULT = 'model-priced';
  process.env.AI_DESIGNER_MODEL_QUICK = 'model-unpriced';
  // test prices (USD per million tokens) chosen for easy arithmetic
  process.env.AI_PRICING_JSON = JSON.stringify({ 'model-priced': { input: 2, output: 10, cache_read: 0.2 } });
});
after(() => { server.close(); for (const k of ['ANTHROPIC_API_URL', 'ANTHROPIC_API_KEY', 'AI_PRICING_JSON', 'AI_MONTHLY_BUDGET_USD', 'AI_DESIGNER_MODEL_DEFAULT', 'AI_DESIGNER_MODEL_QUICK']) delete process.env[k]; });
beforeEach(() => { resetLedger(new UsageLedger()); seen.length = 0; delete process.env.AI_MONTHLY_BUDGET_USD; });

const msg = (text: string, usage: object, stop = 'end_turn') => ({ status: 200, body: { content: [{ type: 'text', text }], stop_reason: stop, usage } });

describe('AI usage and cost (simulated Claude API)', () => {
  test('a successful call records the API-reported tokens and the cost from configured prices', async () => {
    reply = msg('{"ok": true}', { input_tokens: 1200, output_tokens: 300, cache_read_input_tokens: 5000 });
    assert.deepEqual(await askJson('design a hook', { label: 'design' }), { ok: true });
    assert.equal(seen[0].key, 'sk-test-not-a-real-key'); assert.equal(seen[0].version, '2023-06-01'); assert.equal(seen[0].model, 'model-priced');
    const t = ledger().totals();
    // 1200*2 + 300*10 + 5000*0.2 = 6400 per million -> 0.0064 USD
    assert.deepEqual([t.requests, t.failed, t.input_tokens, t.output_tokens, t.cost_usd, t.unpriced_requests], [1, 0, 6200, 300, 0.0064, 0]);
    assert.deepEqual(t.by_label, { design: 1 });
  });

  test('a model with no configured price is counted as unpriced, never given an invented cost', async () => {
    reply = msg('{"q": 1}', { input_tokens: 50, output_tokens: 20 });
    await askJson('clarify', { modelTier: 'quick', label: 'clarify' });
    const t = ledger().totals();
    assert.equal(t.unpriced_requests, 1); assert.equal(t.cost_usd, 0); assert.equal(t.by_model['model-unpriced'].cost_usd, null);
  });

  test('a cut-off or non-JSON reply is still billed and recorded; HTTP errors are recorded with no tokens', async () => {
    reply = msg('{"half": ', { input_tokens: 1000, output_tokens: 16000 }, 'max_tokens');
    await assert.rejects(askJson('x'), (e: ProviderError) => e.code === 'ENGINE_ERROR' && e.retryable);
    reply = msg('I cannot do that.', { input_tokens: 100, output_tokens: 10 });
    await assert.rejects(askJson('x'), (e: ProviderError) => e.code === 'ENGINE_ERROR');
    reply = { status: 429, body: { type: 'error', error: { type: 'rate_limit_error' } } };
    await assert.rejects(askJson('x'), (e: ProviderError) => e.code === 'TRANSIENT' && e.retryable);
    reply = { status: 400, body: { type: 'error', error: { type: 'invalid_request_error' } } };
    await assert.rejects(askJson('x'), (e: ProviderError) => e.code === 'REJECTED' && !e.retryable);
    const t = ledger().totals();
    assert.deepEqual([t.requests, t.failed, t.output_tokens], [4, 4, 16010]);
    assert.equal(t.cost_usd, (1000 * 2 + 16000 * 10 + 100 * 2 + 10 * 10) / 1e6);
  });

  test('the monthly budget stops new calls before anything is sent', async () => {
    process.env.AI_MONTHLY_BUDGET_USD = '0.01';
    reply = msg('{}', { input_tokens: 0, output_tokens: 1000 }); // 0.01 USD
    await askJson('x');
    const before = seen.length;
    await assert.rejects(askJson('x'), (e: ProviderError) => e.code === 'REJECTED' && /budget reached/.test(e.message) && (e.details as { code: string }).code === 'BUDGET_EXCEEDED');
    assert.equal(seen.length, before, 'no request reached the API');
    // last month's spending does not count against this month
    const L = new UsageLedger();
    L.add({ at: Date.UTC(2026, 8, 30), label: 'x', model: 'm', input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, cost_usd: 99, outcome: 'ok' });
    assert.doesNotThrow(() => L.checkBudget({ AI_MONTHLY_BUDGET_USD: '1' }, Date.UTC(2026, 9, 2)));
    assert.throws(() => L.checkBudget({ AI_MONTHLY_BUDGET_USD: '1' }, Date.UTC(2026, 8, 30, 12)), /budget reached/);
  });

  test('the JSONL log survives a restart and holds no prompt, reply or key', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'ai-usage-')), 'usage.jsonl');
    resetLedger(new UsageLedger({ file }));
    reply = msg('{"secret_reply": 1}', { input_tokens: 10, output_tokens: 5 });
    await askJson('PROMPT-WITH-CUSTOMER-IDEA', { label: 'design' });
    const text = readFileSync(file, 'utf8');
    assert.ok(!/PROMPT-WITH|secret_reply|sk-test/.test(text), text);
    const again = new UsageLedger({ file });
    assert.equal(again.totals().requests, 1); assert.equal(again.totals().cost_usd, (10 * 2 + 5 * 10) / 1e6);
  });

  test('pricing config is validated', () => {
    assert.throws(() => pricing({ AI_PRICING_JSON: '{bad' }), /not valid JSON/);
    assert.throws(() => pricing({ AI_PRICING_JSON: '{"m": {"input": -1, "output": 1}}' }), /non-negative/);
    assert.equal(costOf('m', { input_tokens: 1e6 }, { m: { input: 3, output: 15 } }), 3);
  });
});
