// Token Launch Radar — the valuation model.
//
// One sealed DefiLlama snapshot in, one ranked board of pre-token protocols out. Every number on
// the board is derived from the snapshot's own ten fields per protocol; no protocol name is ever
// special-cased and no figure comes from outside the file.
//
// The model, in one paragraph. Protocols that already trade give the market's own answer to
// "what is a dollar of TVL worth here?": for each category, the median market-cap / TVL ratio of
// its tokenized members is that category's multiple. A pre-token protocol's implied value is
//
//   implied = TVL x category multiple x growth factor x age factor
//
// where the growth factor rewards a protocol whose TVL is rising over the last seven days and
// discounts one whose TVL is falling, and the age factor pays for track record: a protocol that
// has run longer with no token on record has had more time to prove the TVL is real. Both factors
// are clamped, so one wild week or one ancient listing date cannot swamp the multiple.
//
// Calibration guards, all from the snapshot itself:
//   - a category needs at least MIN_COMPS tokenized members before its own median is trusted;
//     below that, the global median of every tokenized protocol is used instead;
//   - the multiple actually applied is clamped to [MULT_FLOOR, MULT_CAP], because the tail of
//     the ratio distribution holds absurd prints (a prediction market at 400x TVL) that no
//     median of three should be allowed to import into a ranking.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
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

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, stated in the dashboard so a reader can re-run the arithmetic. */
export interface ModelConstants {
  /** Tokenized members a category needs before its own median multiple is trusted. */
  min_comps: number;
  /** The applied multiple never leaves [mult_floor, mult_cap]. */
  mult_floor: number;
  mult_cap: number;
  /** Seven-day TVL change is clamped to [growth_floor_pct, growth_cap_pct] before it is weighed. */
  growth_floor_pct: number;
  growth_cap_pct: number;
  /** growth factor = 1 + clamped change / 100 x growth_weight. */
  growth_weight: number;
  /** age factor = age_floor + age_range x min(age_days, age_full_days) / age_full_days. */
  age_floor: number;
  age_range: number;
  age_full_days: number;
  /** The age a protocol with no listing date is scored at. */
  unknown_age_days: number;
  /** Rows the board carries in all: the watchlist plus the strongest pre-token protocols below it. */
  board_rows: number;
}

export const MODEL: ModelConstants = {
  min_comps: 3,
  mult_floor: 0.02,
  mult_cap: 2.5,
  growth_floor_pct: -50,
  growth_cap_pct: 100,
  growth_weight: 0.6,
  age_floor: 0.75,
  age_range: 0.45,
  age_full_days: 1460,
  unknown_age_days: 365,
  board_rows: 200,
};

/** The model's version label, shown on the dashboard next to the formula. */
export const MODEL_VERSION = 'comps-median-1';

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** Whole days from `listedAt` to `asOf`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The median of a non-empty list, taken on a sorted copy so the caller's order survives. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** One category's calibration line: how many tokenized members, and the multiple they imply. */
export interface CategoryStat {
  category: string;
  comps: number;
  /** The category's own median mcap/TVL, before clamping; null when it has no tokenized member. */
  median_multiple: number | null;
  /** The multiple a pre-token protocol of this category is actually scored with. */
  used_multiple: number;
  /** Where used_multiple came from: the category's own median, or the global fallback. */
  source: 'category' | 'global';
}

/** The calibration the whole board shares: a global median and one line per category. */
export interface Calibration {
  /** Tokenized protocols that carry both a market cap and a TVL: the comp set. */
  comp_count: number;
  /** The median mcap/TVL across the whole comp set, before clamping. */
  global_median: number;
  /** The global median after clamping: the fallback multiple. */
  global_multiple: number;
  categories: CategoryStat[];
  byCategory: Map<string, CategoryStat>;
}

/**
 * Calibrate the multiples from the snapshot's tokenized protocols. A protocol joins the comp set
 * when it records a market cap and a positive TVL; its ratio is what the market pays per TVL
 * dollar. Categories are keyed by the snapshot's category string, with null read as 'Uncategorized'.
 */
export function calibrate(snapshot: Snapshot, model: ModelConstants = MODEL): Calibration {
  const ratios = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    all.push(ratio);
    const key = p.category ?? 'Uncategorized';
    const list = ratios.get(key);
    if (list === undefined) ratios.set(key, [ratio]);
    else list.push(ratio);
  }
  if (all.length === 0) throw new SnapshotError('snapshot.json holds no tokenized protocol to calibrate from');
  const globalMedian = median(all);
  const globalMultiple = clamp(globalMedian, model.mult_floor, model.mult_cap);
  const categories: CategoryStat[] = [...ratios.entries()]
    .map(([category, list]) => {
      const med = median(list);
      const own = list.length >= model.min_comps;
      return {
        category,
        comps: list.length,
        median_multiple: round4(med),
        used_multiple: round4(clamp(own ? med : globalMedian, model.mult_floor, model.mult_cap)),
        source: (own ? 'category' : 'global') as 'category' | 'global',
      };
    })
    .sort((a, b) => b.comps - a.comps || (a.category < b.category ? -1 : 1));
  return {
    comp_count: all.length,
    global_median: round4(globalMedian),
    global_multiple: round4(globalMultiple),
    categories,
    byCategory: new Map(categories.map((c) => [c.category, c])),
  };
}

/** The multiple one protocol is scored with, and the calibration line behind it. */
export function multipleFor(p: SnapshotProtocol, calib: Calibration, model: ModelConstants = MODEL): CategoryStat {
  const stat = calib.byCategory.get(p.category ?? 'Uncategorized');
  if (stat !== undefined) return stat;
  // A category with no tokenized member at all has no line of its own: the global fallback, stated.
  return { category: p.category ?? 'Uncategorized', comps: 0, median_multiple: null, used_multiple: calib.global_multiple, source: 'global' };
}

/** The model's full arithmetic for one protocol: every factor, so the dashboard can show its work. */
export interface Scored {
  implied: number;
  multiple: number;
  multiple_source: 'category' | 'global';
  comps: number;
  growth_pct: number;
  growth_factor: number;
  age_factor: number;
  age: number | null;
}

/** Score one pre-token protocol under the model. The only place implied value is computed. */
export function impliedValue(p: SnapshotProtocol, asOf: string, calib: Calibration, model: ModelConstants = MODEL): Scored {
  const stat = multipleFor(p, calib, model);
  const age = ageDays(asOf, p.listed_at);
  const growthPct = clamp(p.change_7d ?? 0, model.growth_floor_pct, model.growth_cap_pct);
  const growthFactor = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const ageFactor = model.age_floor + (clamp(ageForModel, 0, model.age_full_days) / model.age_full_days) * model.age_range;
  const implied = Math.max(1, Math.round(p.tvl_usd * stat.used_multiple * growthFactor * ageFactor));
  return {
    implied,
    multiple: stat.used_multiple,
    multiple_source: stat.source,
    comps: stat.comps,
    growth_pct: growthPct,
    growth_factor: round4(growthFactor),
    age_factor: round4(ageFactor),
    age,
  };
}

/** Whether a protocol records no token at all: no CoinGecko id, no symbol, no market cap. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.gecko_id === null && p.symbol === null && p.mcap_usd === null;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** A whole word wrapped, staked or staking in a name, in any case: a product of another asset. */
const PRODUCT_WORD = /\b(wrapped|staked|staking)\b/i;

/** Categories that are products of an asset that already trades, never a launch of their own. */
const PRODUCT_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'Anchor BTC',
  'Decentralized BTC',
  'CEX',
]);

/** Exchange names a product may front for: a name opening with one is the exchange's own product. */
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/**
 * Whether a pre-token protocol may stand as an extra board row below the watchlist floor. The
 * extras pass the watchlist's own independence screen, minus the floor: a wrapped, staked or
 * bridged product of a token that already trades (WBTC, USDT0, a staked-ETH product) records no
 * token of its own in the snapshot, but it is not a protocol waiting on a launch, so it is never
 * ranked as one. The snapshot carries no parent field, so the screen works from the category,
 * the version marker and the name, exactly as the watchlist's published rule describes. The
 * board therefore holds as many extras as pass the screen, up to the row target. Watchlist rows
 * themselves are never filtered by this: the floor is always covered in full.
 */
export function isExtraRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name) || PRODUCT_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIXES.some((e) => p.name.startsWith(e))) return false;
  return true;
}

// ------------------------------------------------------------------ farm plans
//
// A farm plan is generated, never written per protocol: the category picks the two real actions,
// the primary chain picks the fee language, the TVL picks the suggested capital and the age picks
// the hold. Every step is one string carrying its action, its cost and its time, inside the
// gate's 20..600 characters.

/** What one chain costs to use, in the words a farmer budgets with. */
function gasFor(chain: string): string {
  if (chain === 'Ethereum') return 'about $6 to $12 of gas at typical mainnet fees';
  if (chain === 'Solana') return 'well under $0.10 of network fees';
  if (chain === 'Bitcoin') return 'about $1 to $3 of network fees';
  return 'under $1 of gas on this chain';
}

/** The capital a sensible first position takes, from the protocol's own TVL tier. */
function capitalFor(tvl: number): number {
  if (tvl >= 5_000_000_000) return 500;
  if (tvl >= 1_000_000_000) return 250;
  if (tvl >= 250_000_000) return 150;
  if (tvl >= 50_000_000) return 100;
  return 50;
}

/** How long a position should season, from the protocol's age: younger boards get longer windows. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The two actions that make a farm real for one category: the core position, then its companion. */
function actionsFor(p: SnapshotProtocol, capital: number, chain: string): [string, string] {
  const c = (p.category ?? '').toLowerCase();
  const n = p.name;
  if (c.includes('lend') || c.includes('uncollateralized'))
    return [
      `Supply $${capital} of USDC as collateral to ${n} on ${chain}, choosing the market with the deepest liquidity.`,
      `Borrow about 25% of the collateral's value against it, hold the borrowed funds for a week, then repay in full so both sides of the market record your wallet.`,
    ];
  if (c.includes('cdp') || c.includes('collateral'))
    return [
      `Deposit $${capital} of collateral into a ${n} vault on ${chain} and mint a small amount of its stablecoin against it, keeping the collateral ratio comfortably above liquidation.`,
      `Use the minted stablecoin inside the protocol's own app (a deposit or a swap), then top the vault up once so the position shows repeat activity.`,
    ];
  if (c.includes('dex') || c.includes('liquidity manager'))
    return [
      `Swap about $${Math.max(10, Math.round(capital / 5))} through ${n}'s main market on ${chain} so the wallet has real trading history with the protocol.`,
      `Provide $${capital} of balanced liquidity to ${n}'s busiest pool on ${chain} and leave the position open rather than hopping pools.`,
    ];
  if (c.includes('bridge') || c.includes('cross chain')) {
    const dest = p.chains.find((x) => x !== 'Ethereum');
    const route = dest === undefined ? `between Ethereum and the chains ${n} serves` : `from Ethereum to ${dest}`;
    return [
      `Bridge $${capital} of USDC ${route} through ${n}, and make one transaction with the bridged funds on the far side the same day.`,
      `Bridge a smaller amount back on a different day, so the wallet shows round-trip use rather than a single one-way hop.`,
    ];
  }
  if (c.includes('liquid staking') || c.includes('staking pool') || c === 'staking')
    return [
      `Stake $${capital} of ${chain}'s native asset through ${n} and keep the liquid receipt token in the same wallet.`,
      `Hold the receipt across at least one full reward epoch, then restake the rewards once instead of selling them.`,
    ];
  if (c.includes('restak') || c.includes('anchor btc') || c.includes('decentralized btc'))
    return [
      `Deposit $${capital} of the asset ${n} restakes (its app names the accepted assets) on ${chain} and keep the restaked position open.`,
      `Stay through one full epoch or points period without withdrawing, since restaking records usually snapshot balances at period ends.`,
    ];
  if (c.includes('basis trading'))
    return [
      `Deposit $${capital} of USDC into ${n}'s basis vault on ${chain} and keep the shares rather than trading in and out.`,
      `Add a small second deposit in a later week so the position shows up in more than one accounting period.`,
    ];
  if (c.includes('derivative') || c.includes('options') || c.includes('perpetual'))
    return [
      `Deposit $${capital} of USDC as margin on ${n} and open one small, hedged position sized so a bad day cannot liquidate it.`,
      `Close the position after a few days and open one more in the following week: two completed round trips read as use, one reads as noise.`,
    ];
  if (c.includes('curator') || c.includes('allocator'))
    return [
      `Deposit $${capital} into one curated vault on ${n} (${chain}) after reading the vault's stated strategy on its page.`,
      `Keep the vault shares through a full reallocation cycle and claim any rewards only from the protocol's own page.`,
    ];
  if (c.includes('rwa'))
    return [
      `Buy or mint $${capital} of ${n}'s yield-bearing asset on ${chain}, completing the onboarding steps its app asks for first.`,
      `Hold the asset through at least one full yield distribution so the wallet appears in a holder snapshot.`,
    ];
  if (c.includes('launchpad'))
    return [
      `Register an account with ${n} and stake or commit the amount its next sale asks for, starting with about $${capital}.`,
      `Take part in one sale or allocation round to completion, even a small one, so the wallet is on the participant record.`,
    ];
  if (c.includes('prediction'))
    return [
      `Fund a ${n} account with about $${capital} and place one small position on a market you have actually read.`,
      `Let the position settle rather than selling out early; a settled market is the record that counts.`,
    ];
  if (c.includes('stablecoin') || c.includes('algo-stable') || c.includes('stable'))
    return [
      `Mint or deposit $${capital} of ${n}'s stable asset on ${chain}, using the protocol's own mint or savings route.`,
      `Keep the stable asset (or its savings shares) in the wallet through a full month of balance snapshots.`,
    ];
  if (c.includes('insurance'))
    return [
      `Buy about $${capital} of cover from ${n} on ${chain} for a position you genuinely hold elsewhere.`,
      `Keep the policy to its full term; an expired-in-good-standing policy is the history that counts.`,
    ];
  if (c.includes('privacy'))
    return [
      `Make one shielded deposit of about $${capital} into ${n} on ${chain} from your farming wallet.`,
      `Withdraw to a fresh address you control after the hold below, keeping the amounts unremarkable and the notes private.`,
    ];
  if (c.includes('index'))
    return [
      `Buy or mint about $${capital} of one ${n} index product on ${chain} and hold it in the farming wallet.`,
      `Rebalance or add once in a later week so the wallet shows continuing use, not a single touch.`,
    ];
  if (c.includes('chain'))
    return [
      `Bridge about $${capital} to ${chain} and make ${n}'s own app your first transaction on it.`,
      `Use two more of the chain's native apps in the same week, so the wallet reads as an early resident, not a passer-by.`,
    ];
  if (c.includes('payment') || c.includes('card'))
    return [
      `Open a ${n} account, complete its verification, and make one real payment or top-up of about $${capital}.`,
      `Repeat a small payment in the following month so the account shows a pattern, not a single trial.`,
    ];
  if (c.includes('yield') || c.includes('farm'))
    return [
      `Deposit $${capital} into ${n}'s flagship vault or farm on ${chain} and keep the shares in the wallet.`,
      `Harvest or compound the rewards once after the first week instead of claiming daily; one claim is cheaper and reads the same.`,
    ];
  return [
    `Deposit $${capital} of USDC into ${n} on ${chain} through its main app and keep the position open.`,
    `Make one more qualifying action (a second deposit, a vote or a claim) in a later week so the wallet shows repeat use.`,
  ];
}

/** One protocol's farm plan: six steps, each an action with its cost and its time. */
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const chain = p.chains.length > 0 ? p.chains[0]! : 'its main chain';
  const gas = gasFor(chain);
  const capital = capitalFor(p.tvl_usd);
  const hold = holdDaysFor(age);
  const [core, second] = actionsFor(p, capital, chain);
  const chainNote = p.chains.length > 1 ? ` It runs on ${p.chains.length} chains; start on ${chain}, where a position is cheapest to open.` : '';
  const steps = [
    `Set up a fresh wallet for this farm and fund it on ${chain}.${chainNote} Cost: ${gas} to fund and make the first transaction. Time: 10 minutes.`,
    `${core} Cost: $${capital} of capital plus ${gas}. Time: 15 minutes to set up.`,
    `${second} Cost: about $2 to $10 of fees, sized to the action. Time: 10 minutes.`,
    `Repeat one small qualifying action each week (a deposit, a swap, a vote or a claim, whichever the app counts). Cost: roughly $2 of fees a week. Time: 10 minutes a week.`,
    `Hold the position for at least ${hold} days so the activity spans more than one weekly snapshot, and check the protocol's own points or rewards page before you withdraw. Cost: the $${capital} stays in the position; never pay anyone to unlock a claim. Time: ${hold} days.`,
    `Keep a farm log (wallet, dates, amounts, transaction hashes) and unwind only after the hold, or when the protocol announces a token or points snapshot of its own. Cost: nothing but the log. Time: 5 minutes.`,
  ];
  return steps.map((s) => {
    const t = s.trim();
    if (t.length > 600) return `${t.slice(0, 596)}...`;
    if (t.length < 20) return `${t} Keep the position open and check the protocol's own page weekly.`;
    return t;
  });
}

// ------------------------------------------------------------------ the board

/** One row of board.json: the ranked board's row, with the model's arithmetic attached. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  watchlist: boolean;
  implied_value_usd: number;
  model: {
    multiple: number;
    multiple_source: 'category' | 'global';
    comps: number;
    growth_pct: number;
    growth_factor: number;
    age_factor: number;
  };
  farm_steps: string[];
}

/** A tokenized protocol, shown on the dashboard as a calibration comparable, never ranked. */
export interface ComparableRow {
  slug: string;
  name: string;
  category: string | null;
  symbol: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number;
  ratio: number;
}

/** Everything the dashboard renders, computed by main.ts and shipped as data.js. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  model: ModelConstants;
  calibration: {
    comp_count: number;
    global_median: number;
    global_multiple: number;
    categories: CategoryStat[];
  };
  watchlist_size: number;
  board_size: number;
  extra_size: number;
  rows: BoardRow[];
  comparables: ComparableRow[];
}

/** The slug order that keeps every sort total: value first, then TVL, then slug. */
function byScore(a: { implied: number; p: SnapshotProtocol }, b: { implied: number; p: SnapshotProtocol }): number {
  return b.implied - a.implied || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0);
}

/**
 * The board: every watchlist protocol, plus the strongest pre-token protocols below the floor up
 * to the model's row target, all scored by the one model and ranked by implied value.
 */
export function buildBoard(snapshot: Snapshot, calib: Calibration, model: ModelConstants = MODEL): BoardRow[] {
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  const extras = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isExtraRankable(p))
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, Math.max(0, model.board_rows - chosen.size));
  for (const p of extras) chosen.set(p.slug, p);

  const watchlist = new Set(snapshot.watchlist);
  const scored = [...chosen.values()].map((p) => ({ p, ...impliedValue(p, snapshot.as_of, calib, model) }));
  scored.sort(byScore);
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    listed_at: s.p.listed_at,
    age_days: s.age,
    watchlist: watchlist.has(s.p.slug),
    implied_value_usd: s.implied,
    model: {
      multiple: s.multiple,
      multiple_source: s.multiple_source,
      comps: s.comps,
      growth_pct: s.growth_pct,
      growth_factor: s.growth_factor,
      age_factor: s.age_factor,
    },
    farm_steps: farmSteps(s.p, s.age),
  }));
}

/** The dashboard's comparables: the largest tokenized protocols, with the market's own ratio. */
export function comparableRows(snapshot: Snapshot, limit = 30): ComparableRow[] {
  return snapshot.protocols
    .filter((p) => p.mcap_usd !== null && p.tvl_usd > 0)
    .sort((a, b) => b.mcap_usd! - a.mcap_usd! || (a.slug < b.slug ? -1 : 1))
    .slice(0, limit)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      symbol: p.symbol,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd!,
      ratio: round4(p.mcap_usd! / p.tvl_usd),
    }));
}

/** The board and the dashboard's data, from the snapshot, in one pass. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const calib = calibrate(snapshot, model);
  const board = buildBoard(snapshot, calib, model);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    model,
    calibration: {
      comp_count: calib.comp_count,
      global_median: calib.global_median,
      global_multiple: calib.global_multiple,
      categories: calib.categories,
    },
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    extra_size: board.filter((r) => !r.watchlist).length,
    rows: board,
    comparables: comparableRows(snapshot),
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
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, shared value, steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  if (slugs.size !== board.length) return 'the board carries a slug twice';
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const byRank = [...board].sort((a, b) => a.rank - b.rank);
  for (let i = 0; i < byRank.length; i++) {
    if (byRank[i]!.rank !== i + 1) return `rank ${i + 1} is ${byRank[i]!.rank}`;
    if (i > 0 && byRank[i]!.implied_value_usd > byRank[i - 1]!.implied_value_usd) return `rank ${i + 1} outvalues rank ${i}`;
  }
  if (board.length >= 2 && board.every((r) => r.implied_value_usd === board[0]!.implied_value_usd)) {
    return 'every row shares one implied value: a board that ranks nothing by value is not a ranking';
  }
  for (const r of board) {
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const len = s.trim().length;
      if (len < 20 || len > 600) return `${r.slug} has a farm step of ${len} characters`;
    }
  }
  return null;
}

/** data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.TOKEN_RADAR=${JSON.stringify(radar)};\n`;
}
