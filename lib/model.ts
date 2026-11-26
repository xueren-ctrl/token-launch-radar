// Token launch radar, model v2 ("peer-calibrated").
//
// One sealed snapshot in, one ranked board out. The board covers every slug on the
// snapshot's watchlist (the floor, never a ceiling) plus every other genuine pre-token
// protocol the snapshot carries: no token, not a centralised exchange, not a wrapped,
// staked, bridged or versioned product of something that already trades. The exclusions
// are reported back so the dashboard can show why a protocol is not ranked.
//
// Implied value is derived from the snapshot's own figures, never from a name list:
//
//   multiple   = the median market-cap / TVL of the token-bearing protocols in the
//                same category (computed at runtime from this snapshot); categories
//                with fewer than 3 token-bearing peers fall back to the global median.
//                Clamped to [0.05, 2.00] as an outlier guard, and stated in the page.
//   growth     = change_7d clamped to [-40, +150]; upside earns 0.6 per point, downside
//                costs 0.35 per point (momentum is rewarded more than it is punished).
//   maturity   = 0.5 + min(age_days, 1460) / 1460 * 0.5; unknown age counts as 365 days.
//   breadth    = 1 + 0.04 * min(chains - 1, 5): a protocol live on more chains is worth
//                up to 20% more than a single-chain one.
//   implied    = max(1, round(tvl_usd * multiple * growth * maturity * breadth))
//
// Every factor is stored on the row so the dashboard can show the breakdown and the
// model sandbox can recompute live. No protocol name is ever special-cased.

/** One protocol entry of the sealed snapshot: exactly its ten fields. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole sealed snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them and the sandbox may change them. */
export interface ModelConstants {
  peer_min_count: number;
  multiple_floor: number;
  multiple_cap: number;
  growth_floor: number;
  growth_cap: number;
  growth_up_weight: number;
  growth_down_weight: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  breadth_per_chain: number;
  breadth_max_extra: number;
}

export const MODEL: ModelConstants = {
  peer_min_count: 3,
  multiple_floor: 0.05,
  multiple_cap: 2.0,
  growth_floor: -40,
  growth_cap: 150,
  growth_up_weight: 0.6,
  growth_down_weight: 0.35,
  maturity_floor: 0.5,
  maturity_range: 0.5,
  maturity_days: 1460,
  unknown_age_days: 365,
  breadth_per_chain: 0.04,
  breadth_max_extra: 0.2,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the Live tab carries, by market cap. */
export const LIVE_ROWS = 24;

/** One farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    category_multiple: number;
    multiple_source: 'peers' | 'global';
    peer_count: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with the factors the sandbox needs. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  implied_value_usd: number;
  category_multiple: number;
  growth_pct: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** One protocol the board left out, and the reason it was left out. */
export interface ExcludedRow {
  slug: string;
  name: string;
  category: string | null;
  tvl_usd: number;
  reason: string;
}

/** One category's peer multiple, for the dashboard's model table. */
export interface MultipleRow {
  category: string;
  multiple: number;
  peer_count: number;
  source: 'peers' | 'global';
}

/** Everything the dashboard renders, from the snapshot. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  watchlist: string[];
  board_size: number;
  early_size: number;
  live_size: number;
  excluded_size: number;
  global_multiple: number;
  multiples: MultipleRow[];
  rows: RadarRow[];
  live: LiveRow[];
  excluded: ExcludedRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** The median of a sorted copy; null when empty. */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/**
 * Every category's peer multiple, derived from the snapshot at runtime: the median
 * market-cap / TVL of the category's token-bearing protocols, when at least
 * `peer_min_count` of them exist; otherwise the global median. Clamped to the stated
 * band. Returns the global median too, so the dashboard can name the fallback.
 */
export function peerMultiples(snapshot: Snapshot, model: ModelConstants = MODEL): { byCategory: Map<string, MultipleRow>; global: number } {
  const ratios = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    if (!Number.isFinite(ratio) || ratio <= 0) continue;
    all.push(ratio);
    const key = p.category ?? '(no category)';
    const list = ratios.get(key);
    if (list === undefined) ratios.set(key, [ratio]);
    else list.push(ratio);
  }
  const globalRaw = median(all) ?? model.multiple_floor;
  const global = Math.min(model.multiple_cap, Math.max(model.multiple_floor, globalRaw));
  const byCategory = new Map<string, MultipleRow>();
  for (const [category, values] of ratios) {
    if (values.length >= model.peer_min_count) {
      const raw = median(values) ?? global;
      byCategory.set(category, {
        category,
        multiple: Math.min(model.multiple_cap, Math.max(model.multiple_floor, raw)),
        peer_count: values.length,
        source: 'peers',
      });
    }
  }
  return { byCategory, global };
}

/** The multiple one category gets: its peer median, or the global median when too few peers. */
export function multipleFor(category: string | null, peers: { byCategory: Map<string, MultipleRow>; global: number }): MultipleRow {
  const key = category ?? '(no category)';
  const row = peers.byCategory.get(key);
  if (row !== undefined) return row;
  return { category: key, multiple: peers.global, peer_count: 0, source: 'global' };
}

/** The growth multiplier: upside earns more per point than downside costs. */
export function growthMultiplier(growthPct: number, model: ModelConstants = MODEL): number {
  const g = Math.min(model.growth_cap, Math.max(model.growth_floor, growthPct));
  return g >= 0 ? 1 + (g / 100) * model.growth_up_weight : 1 + (g / 100) * model.growth_down_weight;
}

/** The maturity multiplier: older (listed longer) counts for more, up to the cap. */
export function maturityMultiplier(age: number | null, model: ModelConstants = MODEL): number {
  const days = age ?? model.unknown_age_days;
  return model.maturity_floor + (Math.min(Math.max(days, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
}

/** The breadth multiplier: more chains, up to the stated extra. */
export function breadthMultiplier(chains: string[], model: ModelConstants = MODEL): number {
  return 1 + Math.min(Math.max(chains.length - 1, 0), model.breadth_max_extra / model.breadth_per_chain) * model.breadth_per_chain;
}

/** All four factors and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  peers: { byCategory: Map<string, MultipleRow>; global: number },
  model: ModelConstants = MODEL,
): { implied: number; multiple: MultipleRow; growthPct: number; growthMult: number; maturityMult: number; breadthMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const multiple = multipleFor(protocol.category, peers);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, finite(protocol.change_7d, 0)));
  const growthMult = growthMultiplier(growthPct, model);
  const maturityMult = maturityMultiplier(age, model);
  const breadthMult = breadthMultiplier(protocol.chains, model);
  const implied = Math.max(1, Math.round(protocol.tvl_usd * multiple.multiple * growthMult * maturityMult * breadthMult));
  return { implied, multiple, growthPct, growthMult, maturityMult, breadthMult, age };
}

/** A name that ends in a release marker is a versioned pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Categories whose products are wrapped, staked or bridged versions of something else. */
const WRAPPED_STAKED_BRIDGED = /bridge|stak|restak|wrap/i;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * Why a pre-token protocol is not rankable, or null when it is: centralised exchanges
 * never launch a token this radar watches, wrapped / staked / bridged products are
 * receipts for something that already trades, and versioned pools are releases of
 * another protocol. The watchlist is exempt: it is the floor and always ranks.
 */
export function exclusionReason(p: SnapshotProtocol): string | null {
  if (p.category === 'CEX') return 'centralised exchange';
  if (WRAPPED_STAKED_BRIDGED.test(p.category ?? '')) return 'wrapped, staked or bridged product';
  if (VERSIONED.test(p.name)) return 'versioned pool of another protocol';
  return null;
}

/** Whether a protocol is one the board may rank beyond the watchlist. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && exclusionReason(p) === null;
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, peers: { byCategory: Map<string, MultipleRow>; global: number }, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug ranks, even one whose category would
  // otherwise exclude it (three watchlist protocols sit in normally-excluded
  // categories; the snapshot's own watchlist outranks the heuristic).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every other genuine pre-token protocol, by implied value.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, peers, model);
    return { p, ...v };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      category_multiple: s.multiple.multiple,
      multiple_source: s.multiple.source,
      peer_count: s.multiple.peer_count,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      breadth_multiplier: round4(s.breadthMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and re-check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The gas line for the main action, from the capital tier. */
function gasFor(capital: number): string {
  return capital >= 150 ? 'about $8 of gas' : 'about $4 of gas';
}

/** The category's one action, in words a farmer can follow. Never a protocol name list. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Lend $${capital} of USDC into ${name}'s lending market on ${chain} and leave the deposit earning.`;
  if (c.includes('dex')) return `Add $${capital} of liquidity to ${name}'s deepest pool on ${chain} and keep the LP position.`;
  if (c.includes('yield') || c.includes('leveraged farm') || c.includes('farm')) return `Deposit $${capital} of USDC into ${name}'s highest-yield vault on ${chain} and leave it compounding.`;
  if (c.includes('rwa')) return `Mint $${capital} of ${name}'s tokenised yield asset on ${chain} and hold it in the wallet.`;
  if (c.includes('derivative') || c.includes('basis') || c.includes('perpetual')) return `Post $${capital} of USDC as margin on ${name} and open one small hedged position.`;
  if (c.includes('prediction')) return `Back one outcome with $${capital} on ${name} and let the position settle.`;
  if (c.includes('curator') || c.includes('allocator')) return `Allocate $${capital} into a ${name} curator vault on ${chain} and hold the vault shares.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and hold the policy to expiry.`;
  if (c.includes('chain')) return `Bridge $${capital} to ${chain} through its official bridge and use one native app there.`;
  if (c.includes('payment') || c.includes('card')) return `Fund $${capital} through ${name} on ${chain} and make one real payment with it.`;
  if (c.includes('governance')) return `Lock $${capital} in ${name}'s governance vault on ${chain} and vote once.`;
  if (c.includes('privacy')) return `Shield $${capital} through ${name} on ${chain} and keep the shielded balance.`;
  if (c.includes('option')) return `Deposit $${capital} into an ${name} options vault on ${chain} and hold the position to expiry.`;
  if (c.includes('index')) return `Buy $${capital} of the ${name} index on ${chain} and hold it.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/**
 * A protocol's farm plan: six steps, plus a seventh when the protocol spans three or
 * more chains (repeat on a second chain) or holds over $500M (split the wallets).
 * Derived from the protocol's own record (category, chains, TVL, age), never from a
 * hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
  const steps: FarmStep[] = [
    {
      text: `Open a fresh wallet that will only ever hold this farm's funds, and store its recovery phrase offline on paper.`,
      cost: 'about $2 of gas for the first transfer',
      time: '5 minutes',
    },
    {
      text: action,
      cost: `$${capital} of capital plus ${gasFor(capital)}`,
      time: '15 minutes to set up',
    },
    {
      text: `Do one real action a week inside ${p.name} — a deposit, a swap, a vote, or a claim — so the wallet shows a live pattern.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Leave the position untouched for at least ${hold} days, so the activity spans more than one points snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
  ];
  if (p.chains.length >= 3) {
    const second = p.chains[1]!;
    steps.push({
      text: `Repeat the same position on a second chain ${p.name} supports, ${second}, with half the capital, so the farm is not tied to one chain.`,
      cost: `$${Math.floor(capital / 2)} of capital plus gas`,
      time: '20 minutes',
    });
  } else if (p.tvl_usd >= 500_000_000) {
    steps.push({
      text: `Split the position across two wallets so no single wallet holds the whole farm.`,
      cost: 'one extra wallet, no extra capital',
      time: '10 minutes',
    });
  }
  steps.push(
    {
      text: `When a claim opens, use only the claim link the protocol itself publishes, and never pay a fee to claim.`,
      cost: 'nothing to check; never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Record the wallet, the dates and every transaction hash in a farm log, so the position can be repeated or unwound.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  );
  return steps;
}

/** The live-token protocols, by market cap, for the dashboard's Live tab. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** The protocols the board left out, with the reason each was left out. */
export function excludedRows(snapshot: Snapshot): ExcludedRow[] {
  const watchlist = new Set(snapshot.watchlist);
  return snapshot.protocols
    .filter((p) => isPreToken(p) && !watchlist.has(p.slug))
    .map((p) => ({ p, reason: exclusionReason(p) }))
    .filter((x): x is { p: SnapshotProtocol; reason: string } => x.reason !== null)
    .sort((a, b) => b.p.tvl_usd - a.p.tvl_usd)
    .map((x) => ({
      slug: x.p.slug,
      name: x.p.name,
      category: x.p.category,
      tvl_usd: x.p.tvl_usd,
      reason: x.reason,
    }));
}

/** A board row's compact form for data.js, with the farm plan and the factors. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    category_multiple: row.model.category_multiple,
    growth_pct: row.model.growth_pct,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    breadth_multiplier: row.model.breadth_multiplier,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const peers = peerMultiples(snapshot, model);
  const board = buildBoard(snapshot, peers, model);
  const live = liveRows(snapshot);
  const excluded = excludedRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const multiples: MultipleRow[] = [...peers.byCategory.values()]
    .sort((a, b) => b.multiple - a.multiple || (a.category < b.category ? -1 : 1));
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    watchlist: snapshot.watchlist,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    excluded_size: excluded.length,
    global_multiple: peers.global,
    multiples,
    rows: board.map(radarRow),
    live,
    excluded,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  if (board.length < 100 || board.length > 4000) return `the board has ${board.length} rows, outside 100..4000`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    if (!r.slug || /\s/.test(r.slug)) return `row ${r.rank} has a bad slug`;
    if (!r.name) return `row ${r.rank} has no name`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 1e14) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
