// =====================================================================
// Server-side "ask Claude for JSON" used by the AI designer.
// Same contract as the artifact's sample.json: prompt in, one JSON value out.
// The key stays on the server (ANTHROPIC_API_KEY); nothing reaches a browser.
// =====================================================================

import { ProviderError, isTransientHttpStatus } from './errors.ts';
import { costOf, ledger, pricing, type TokenUsage, type UsageRecord } from './usage.ts';

export interface AskOptions {
  modelTier?: 'quick' | 'default' | 'complex';
  effort?: 'low' | 'medium' | 'high';
  label?: string;
  images?: unknown; // server path renders no images; ignored
}

// read at call time, so the configuration can be checked and changed without re-importing the module
const modelFor = (tier: NonNullable<AskOptions['modelTier']>): string => ({
  quick: process.env.AI_DESIGNER_MODEL_QUICK || 'claude-haiku-5-5',
  default: process.env.AI_DESIGNER_MODEL_DEFAULT || 'claude-sonnet-5-5',
  complex: process.env.AI_DESIGNER_MODEL_COMPLEX || 'claude-opus-5-5',
})[tier];

/** Tolerant JSON extraction: whole reply, else a fenced block, else first '{' to last '}'. */
export function extractJson(text: string): unknown {
  const tries = [text.trim()];
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) tries.push(fence[1].trim());
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a >= 0 && b > a) tries.push(text.slice(a, b + 1));
  for (const t of tries) { try { return JSON.parse(t); } catch { /* next */ } }
  throw new ProviderError('ENGINE_ERROR', 'the model reply contained no parseable JSON', true);
}

export function anthropicConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

export async function askJson(prompt: string, opts: AskOptions = {}): Promise<unknown> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new ProviderError('NOT_CONFIGURED', 'ANTHROPIC_API_KEY is not set');
  const model = modelFor(opts.modelTier ?? 'default');
  const L = ledger();
  L.checkBudget();
  const label = opts.label || 'design';
  const record = (outcome: UsageRecord['outcome'], u: TokenUsage = {}, http_status?: number) => L.add({
    at: Date.now(), label, model, outcome, http_status,
    input_tokens: u.input_tokens ?? 0, output_tokens: u.output_tokens ?? 0,
    cache_creation_input_tokens: u.cache_creation_input_tokens ?? 0, cache_read_input_tokens: u.cache_read_input_tokens ?? 0,
    cost_usd: costOf(model, u, pricing()),
  });
  let res: Response;
  try {
    res = await fetch(process.env.ANTHROPIC_API_URL || 'https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        max_tokens: opts.modelTier === 'quick' ? 4000 : 16000,
        messages: [{ role: 'user', content: prompt + '\n\nReply with the JSON value only.' }],
      }),
      signal: AbortSignal.timeout(300_000),
    });
  } catch (e) {
    record('unreachable');
    throw new ProviderError('TRANSIENT', `Claude API unreachable: ${(e as Error).message}`, true);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    record('http_error', {}, res.status);
    throw new ProviderError(isTransientHttpStatus(res.status) ? 'TRANSIENT' : 'REJECTED', `Claude API HTTP ${res.status}: ${body.slice(0, 300)}`, isTransientHttpStatus(res.status));
  }
  const data = (await res.json()) as { content?: { type: string; text?: string }[]; stop_reason?: string; usage?: TokenUsage };
  const text = (data.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('');
  // billed even when the reply is unusable: record the API's own token counts before any error
  if (data.stop_reason === 'max_tokens') { record('truncated', data.usage); throw new ProviderError('ENGINE_ERROR', 'the design reply was cut off (max_tokens); ask for a simpler model', true); }
  let value: unknown;
  try { value = extractJson(text); } catch (e) { record('unparseable', data.usage); throw e; }
  record('ok', data.usage);
  return value;
}
