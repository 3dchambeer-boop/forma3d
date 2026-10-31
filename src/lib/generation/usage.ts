// =====================================================================
// AI usage and cost ledger.
//
// Every Claude call records the token counts the API itself returned in `usage` (never estimates). A reply
// that was cut off or held no JSON was still billed, so it is recorded too. Cost is computed only from
// prices the operator configures (USD per million tokens, AI_PRICING_JSON); the code ships no price table,
// because prices change and an invented number would be a fabricated cost. Unpriced calls are counted and
// reported as such.
//
//   AI_PRICING_JSON      {"claude-sonnet-5-5": {"input": <usd/Mtok>, "output": <usd/Mtok>, "cache_write": .., "cache_read": ..}, ...}
//   AI_MONTHLY_BUDGET_USD  optional hard stop: new calls are refused once this calendar month's priced cost reaches it
//   AI_USAGE_LOG         optional JSONL file; one line per call (no prompts, no replies), re-read on start
// =====================================================================

import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { ProviderError } from './errors.ts';

export interface TokenUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}
export interface Price { input: number; output: number; cache_write?: number; cache_read?: number }
export interface UsageRecord {
  at: number;
  label: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
  cost_usd: number | null; // null: no price configured for this model
  outcome: 'ok' | 'truncated' | 'unparseable' | 'http_error' | 'unreachable';
  http_status?: number;
}

export function pricing(env: Record<string, string | undefined> = process.env): Record<string, Price> {
  const raw = env.AI_PRICING_JSON;
  if (!raw) return {};
  let j: unknown;
  try { j = JSON.parse(raw); } catch { throw new Error('AI_PRICING_JSON is not valid JSON'); }
  const out: Record<string, Price> = {};
  for (const [model, p] of Object.entries(j as Record<string, Partial<Price>>)) {
    const nums = [p.input, p.output, p.cache_write ?? 0, p.cache_read ?? 0];
    if (!nums.every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0)) throw new Error(`AI_PRICING_JSON: prices for ${model} must be non-negative numbers (USD per million tokens)`);
    out[model] = { input: p.input!, output: p.output!, cache_write: p.cache_write, cache_read: p.cache_read };
  }
  return out;
}

/** USD for one call, or null when the model has no configured price. Cache writes/reads fall back to the input price. */
export function costOf(model: string, u: TokenUsage, prices: Record<string, Price>): number | null {
  const p = prices[model];
  if (!p) return null;
  const M = 1e6;
  const c = ((u.input_tokens ?? 0) * p.input + (u.output_tokens ?? 0) * p.output
    + (u.cache_creation_input_tokens ?? 0) * (p.cache_write ?? p.input) + (u.cache_read_input_tokens ?? 0) * (p.cache_read ?? p.input)) / M;
  return Math.round(c * 1e6) / 1e6;
}

const monthStart = (now: number) => { const d = new Date(now); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1); };

export class UsageLedger {
  private records: UsageRecord[] = [];
  constructor(private readonly opts: { file?: string; keep?: number } = {}) {
    if (opts.file && existsSync(opts.file)) {
      for (const line of readFileSync(opts.file, 'utf8').split('\n')) {
        if (!line.trim()) continue;
        try { this.records.push(JSON.parse(line) as UsageRecord); } catch { /* a torn last line is skipped */ }
      }
      this.trim();
    }
  }
  private trim() { const k = this.opts.keep ?? 50_000; if (this.records.length > k) this.records.splice(0, this.records.length - k); }

  add(r: UsageRecord): UsageRecord {
    this.records.push(r); this.trim();
    if (this.opts.file) appendFileSync(this.opts.file, JSON.stringify(r) + '\n', { mode: 0o600 });
    return r;
  }

  totals(since = 0, until = Infinity) {
    const rs = this.records.filter((r) => r.at >= since && r.at < until);
    const byModel: Record<string, { requests: number; input_tokens: number; output_tokens: number; cost_usd: number | null }> = {};
    let cost = 0, unpriced = 0;
    for (const r of rs) {
      const m = (byModel[r.model] ??= { requests: 0, input_tokens: 0, output_tokens: 0, cost_usd: 0 });
      m.requests++; m.input_tokens += r.input_tokens + r.cache_creation_input_tokens + r.cache_read_input_tokens; m.output_tokens += r.output_tokens;
      if (r.cost_usd === null) { unpriced++; m.cost_usd = null; } else { cost += r.cost_usd; if (m.cost_usd !== null) m.cost_usd = Math.round((m.cost_usd + r.cost_usd) * 1e6) / 1e6; }
    }
    return {
      requests: rs.length,
      failed: rs.filter((r) => r.outcome !== 'ok').length,
      input_tokens: rs.reduce((a, r) => a + r.input_tokens + r.cache_creation_input_tokens + r.cache_read_input_tokens, 0),
      output_tokens: rs.reduce((a, r) => a + r.output_tokens, 0),
      cost_usd: Math.round(cost * 1e6) / 1e6, // priced calls only
      unpriced_requests: unpriced,
      by_model: byModel,
      by_label: rs.reduce((a, r) => { a[r.label] = (a[r.label] ?? 0) + 1; return a; }, {} as Record<string, number>),
    };
  }

  monthToDate(now = Date.now()) { return this.totals(monthStart(now), Infinity); }

  /** Refuse a new call once this month's priced cost has reached the budget (nothing is sent to the API). */
  checkBudget(env: Record<string, string | undefined> = process.env, now = Date.now()) {
    const b = env.AI_MONTHLY_BUDGET_USD;
    if (!b) return;
    const budget = Number(b);
    if (!Number.isFinite(budget) || budget < 0) throw new Error('AI_MONTHLY_BUDGET_USD must be a non-negative number');
    const spent = this.monthToDate(now).cost_usd;
    if (spent >= budget) throw new ProviderError('REJECTED', `monthly AI budget reached (${spent.toFixed(2)} of ${budget.toFixed(2)} USD); raise AI_MONTHLY_BUDGET_USD or wait for next month`, false, false, { code: 'BUDGET_EXCEEDED', spent, budget });
  }
}

let shared: UsageLedger | null = null;
/** The process-wide ledger (file-backed when AI_USAGE_LOG is set). */
export function ledger(): UsageLedger {
  shared ??= new UsageLedger({ file: process.env.AI_USAGE_LOG || undefined });
  return shared;
}
/** Tests only. */
export function resetLedger(l: UsageLedger | null = null) { shared = l; }
