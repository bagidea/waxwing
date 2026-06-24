/**
 * resources.js — Antelope Resource Action Builders
 *
 * Zero-dependency helper module that builds signable action objects for every
 * resource-related system-contract action across WAX · EOS · Telos · XPR/Proton.
 *
 * Every builder returns a plain object compatible with WharfKit's Action.from():
 *   { account, name, authorization, data }
 *
 * Usage:
 *   const { CHAINS, formatAsset, stakeCPUNET, buyRAMBytes, powerUp } = require('./resources');
 *
 *   const wax = CHAINS.WAX;
 *   const action = stakeCPUNET("alice", "bob", 1.5, 0.5, wax, { transfer: false });
 *   action.authorization = [{ actor: "alice", permission: "active" }];
 *   // → ready to pass to Session.transact() or Action.from()
 *
 * See resources-spec.md for the full per-chain reference with field descriptions,
 * precision details, and verified sources.
 *
 * @license MIT
 */

// ─── Chain Definitions ─────────────────────────────────────────────────────

/**
 * Chain configuration object.
 * @typedef {Object} ChainConfig
 * @property {string}  id        - Short identifier
 * @property {string}  symbol    - Core token symbol (e.g. "WAX")
 * @property {number}  precision - Decimal places for asset formatting
 * @property {string}  contract  - System contract account name (always "eosio")
 */

/** @type {Record<string, ChainConfig>} */
const CHAINS = {
    WAX:  { id: "wax",  symbol: "WAX",  precision: 8, contract: "eosio" },
    EOS:  { id: "eos",  symbol: "EOS",  precision: 4, contract: "eosio" },
    TLOS: { id: "telos",symbol: "TLOS", precision: 4, contract: "eosio" },
    XPR:  { id: "xpr",  symbol: "XPR",  precision: 4, contract: "eosio" },
};

// ─── Asset Formatting ───────────────────────────────────────────────────────

/**
 * Format a numeric amount into an Antelope asset string for the given chain.
 *
 * @param {number} amount - The token amount (e.g. 1.5).
 * @param {ChainConfig} chain - Chain config (CHAINS.WAX, CHAINS.EOS, etc.).
 * @returns {string} Asset string, e.g. "1.50000000 WAX" or "1.5000 EOS".
 *
 * @example
 *   formatAsset(1.5, CHAINS.WAX)   // → "1.50000000 WAX"
 *   formatAsset(100, CHAINS.EOS)   // → "100.0000 EOS"
 *   formatAsset(0, CHAINS.XPR)     // → "0.0000 XPR"
 */
function formatAsset(amount, chain) {
    const s = Number(amount).toFixed(chain.precision);
    return `${s} ${chain.symbol}`;
}

/**
 * Format a zero-quantity asset string (useful for "stake zero for one resource").
 *
 * @param {ChainConfig} chain
 * @returns {string} e.g. "0.00000000 WAX"
 */
function zeroAsset(chain) {
    return formatAsset(0, chain);
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** @type {string} System contract account on all chains. */
const SYSTEM = "eosio";

/**
 * Build the base action skeleton.
 * @param {string} actionName
 * @param {Object} data
 * @returns {{ account: string, name: string, authorization: Array, data: Object }}
 */
function makeAction(actionName, data) {
    return {
        account: SYSTEM,
        name: actionName,
        authorization: [],  // caller fills this in
        data,
    };
}

/**
 * Parse a "1.0000 EOS"-style asset string into { amount: number, symbol: string }.
 * Useful for reading chain state or user input.
 *
 * @param {string} assetStr
 * @returns {{ amount: number, symbol: string }}
 */
function parseAsset(assetStr) {
    const [amountStr, symbol] = assetStr.split(" ");
    return { amount: parseFloat(amountStr), symbol };
}

// ─── Stake / Unstake (delegatebw / undelegatebw) ────────────────────────────

/**
 * Build a `delegatebw` action — stake tokens for CPU and/or NET.
 *
 * @param {string} from - Account paying/staking the tokens.
 * @param {string} receiver - Account receiving the resource benefit.
 * @param {number} cpuAmount - Tokens to stake for CPU (0 = skip).
 * @param {number} netAmount - Tokens to stake for NET (0 = skip).
 * @param {ChainConfig} chain - Which chain (determines symbol & precision).
 * @param {Object} [opts]
 * @param {boolean} [opts.transfer=false] - If true, receiver can also unstake.
 * @returns {{ account: string, name: string, authorization: Array, data: Object }}
 *
 * @example
 *   // Stake 1 WAX for CPU, 0.5 WAX for NET, non-transferable:
 *   stakeCPUNET("alice", "bob", 1, 0.5, CHAINS.WAX);
 *
 *   // Stake only CPU (no NET):
 *   stakeCPUNET("alice", "bob", 5, 0, CHAINS.EOS);
 */
function stakeCPUNET(from, receiver, cpuAmount, netAmount, chain, opts = {}) {
    const { transfer = false } = opts;
    return makeAction("delegatebw", {
        from,
        receiver,
        stake_net_quantity: netAmount > 0 ? formatAsset(netAmount, chain) : zeroAsset(chain),
        stake_cpu_quantity: cpuAmount > 0 ? formatAsset(cpuAmount, chain) : zeroAsset(chain),
        transfer,
    });
}

/**
 * Build an `undelegatebw` action — unstake previously staked CPU and/or NET tokens.
 *
 * ⚠️ Tokens are **locked for 3 days** after this call. See resources-spec.md §2.2.
 *
 * @param {string} from - Account that originally staked.
 * @param {string} receiver - Account from which resources are removed.
 * @param {number} cpuAmount - Tokens to unstake from CPU.
 * @param {number} netAmount - Tokens to unstake from NET.
 * @param {ChainConfig} chain
 * @returns {{ account: string, name: string, authorization: Array, data: Object }}
 */
function unstakeCPUNET(from, receiver, cpuAmount, netAmount, chain) {
    return makeAction("undelegatebw", {
        from,
        receiver,
        unstake_net_quantity: netAmount > 0 ? formatAsset(netAmount, chain) : zeroAsset(chain),
        unstake_cpu_quantity: cpuAmount > 0 ? formatAsset(cpuAmount, chain) : zeroAsset(chain),
    });
}

// ─── RAM (buyram / buyrambytes / sellram) ───────────────────────────────────

/**
 * Build a `buyrambytes` action — purchase RAM by specifying the byte count.
 *
 * This is the **recommended** builder for RAM purchases because you typically
 * know how many bytes you need (e.g. 8192 for a new account).
 *
 * @param {string} payer - Account paying the tokens.
 * @param {string} receiver - Account receiving the RAM.
 * @param {number} bytes - Number of bytes to purchase (raw uint32).
 * @returns {{ account: string, name: string, authorization: Array, data: Object }}
 *
 * @example
 *   buyRAMBytes("alice", "bob", 8192); // 8 KB for a new account
 */
function buyRAMBytes(payer, receiver, bytes) {
    return makeAction("buyrambytes", { payer, receiver, bytes });
}

/**
 * Build a `buyram` action — purchase RAM by spending a token amount.
 *
 * Use this when you have a **token budget** rather than a byte target.
 * Price follows the Bancor algorithm with 0.5% fee.
 *
 * @param {string} payer - Account paying.
 * @param {string} receiver - Account receiving RAM.
 * @param {number} tokenAmount - Amount of core tokens to spend.
 * @param {ChainConfig} chain
 * @returns {{ account: string, name: string, authorization: Array, data: Object }}
 *
 * @example
 *   buyRAMWithToken("alice", "bob", 20, CHAINS.EOS); // Spend 20 EOS on RAM
 */
function buyRAMWithToken(payer, receiver, tokenAmount, chain) {
    return makeAction("buyram", {
        payer,
        receiver,
        quant: formatAsset(tokenAmount, chain),
    });
}

/**
 * Build a `sellram` action — sell RAM to reclaim tokens.
 *
 * Tokens are returned **immediately** (no 3-day delay).
 * 0.5% fee applies.
 *
 * @param {string} account - Account selling RAM (tokens returned here).
 * @param {number} bytes - Number of bytes to sell (raw int64).
 * @returns {{ account: string, name: string, authorization: Array, data: Object }}
 *
 * @example
 *   sellRAM("alice", 4096); // Sell 4 KB of RAM
 */
function sellRAM(account, bytes) {
    return makeAction("sellram", { account, bytes });
}

// ─── Refund ─────────────────────────────────────────────────────────────────

/**
 * Build a `refund` action — claim tokens released from `undelegatebw` after the
 * 3-day waiting period.
 *
 * Anyone can push this for any account (with the owner's signature). Normally
 * it fires automatically via a deferred transaction.
 *
 * @param {string} owner - Account whose unstaked tokens should be refunded.
 * @returns {{ account: string, name: string, authorization: Array, data: Object }}
 *
 * @example
 *   refund("alice");
 */
function refund(owner) {
    return makeAction("refund", { owner });
}

// ─── WAX PowerUp ───────────────────────────────────────────────────────────

/**
 * PowerUp fraction constants (denominator = 10^15).
 *
 *   FRAC_100PCT = 1000000000000000  →  100%
 *   FRAC_50PCT  =  500000000000000  →   50%
 *   FRAC_10PCT  =  100000000000000  →   10%
 *   FRAC_1PCT   =   10000000000000  →    1%
 */
const POWERUP_DENOM = 1_000_000_000_000_000; // 10^15

/**
 * Convert a percentage (0–100) to the PowerUp fraction format (int64, denom 10^15).
 *
 * @param {number} pct - Percentage (0–100, supports decimals e.g. 0.1).
 * @returns {number} Fraction as int64.
 *
 * @example
 *   pctToFrac(100)  // → 1000000000000000
 *   pctToFrac(50)   // →  500000000000000
 *   pctToFrac(0.5)  // →    5000000000000
 */
function pctToFrac(pct) {
    return Math.floor((pct / 100) * POWERUP_DENOM);
}

/**
 * Build a `powerup` action — rent temporary CPU/NET on WAX.
 *
 * **WAX ONLY.** Other chains do not support this action.
 *
 * @param {string} payer - Account paying the fee.
 * @param {string} receiver - Account receiving resources.
 * @param {number} cpuPct - Percentage of CPU to rent (0–100).
 * @param {number} netPct - Percentage of NET to rent (0–100).
 * @param {number} maxPayment - Maximum WAX willing to pay (cap), e.g. 0.01.
 * @param {Object} [opts]
 * @param {number} [opts.days=1] - Must match on-chain `powerup_days` (typically 1).
 * @returns {{ account: string, name: string, authorization: Array, data: Object }}
 *
 * @example
 *   // Rent 10% CPU + 5% NET, max 0.01 WAX fee:
 *   powerUp("alice", "alice", 10, 5, 0.01, CHAINS.WAX);
 *
 *   // Rent 100% CPU + 0% NET (CPU-heavy tx):
 *   powerUp("alice", "alice", 100, 0, 0.05, CHAINS.WAX);
 */
function powerUp(payer, receiver, cpuPct, netPct, maxPayment, opts = {}) {
    const { days = 1 } = opts;
    return makeAction("powerup", {
        payer,
        receiver,
        days,
        net_frac: pctToFrac(netPct),
        cpu_frac: pctToFrac(cpuPct),
        max_payment: formatAsset(maxPayment, CHAINS.WAX),
    });
}

/**
 * Build a `powerupexec` action — clean up expired PowerUp loans.
 *
 * Anyone can call this. Typically run by block producers or infrastructure.
 *
 * @param {string} user - Account executing cleanup.
 * @param {number} [max=100] - Max expired loans to process in one transaction.
 * @returns {{ account: string, name: string, authorization: Array, data: Object }}
 */
function powerUpExec(user, max = 100) {
    return makeAction("powerupexec", { user, max });
}

// ─── XPR/Proton-specific ────────────────────────────────────────────────────

/**
 * Build a `setramlimit` action — cap the RAM an account may hold.
 *
 * **XPR/Proton ONLY.** Other chains do not support this action.
 *
 * @param {string} account - Account whose RAM limit is being set.
 * @param {number} ramlimitBytes - Max bytes of RAM (0 = unlimited).
 * @returns {{ account: string, name: string, authorization: Array, data: Object }}
 *
 * @example
 *   setRAMLimit("alice", 1048576); // Cap at 1 MB
 *   setRAMLimit("alice", 0);       // Remove limit
 */
function setRAMLimit(account, ramlimitBytes) {
    return makeAction("setramlimit", { account, ramlimit: ramlimitBytes });
}

// ─── Bulk Helpers ───────────────────────────────────────────────────────────

/**
 * Build a full new-account resource setup: buy RAM + optionally stake CPU/NET.
 *
 * Returns an array of actions that should be executed in a single transaction.
 * The `creator` pays for everything; `newAccount` receives resources.
 *
 * @param {string} creator - Account paying RAM + staking.
 * @param {string} newAccount - The newly created account.
 * @param {number} ramBytes - RAM to buy, e.g. 8192 (typical minimum).
 * @param {number} [cpuStake=0] - Optional CPU stake amount.
 * @param {number} [netStake=0] - Optional NET stake amount.
 * @param {ChainConfig} chain
 * @returns {Array<{ account: string, name: string, authorization: Array, data: Object }>}
 */
function newAccountResources(creator, newAccount, ramBytes, cpuStake = 0, netStake = 0, chain) {
    const actions = [buyRAMBytes(creator, newAccount, ramBytes)];
    if (cpuStake > 0 || netStake > 0) {
        actions.push(stakeCPUNET(creator, newAccount, cpuStake, netStake, chain));
    }
    return actions;
}

// ─── Exports ────────────────────────────────────────────────────────────────

module.exports = {
    // Chain definitions
    CHAINS,

    // Asset utilities
    formatAsset,
    zeroAsset,
    parseAsset,

    // Stake / unstake (all chains)
    stakeCPUNET,
    unstakeCPUNET,

    // RAM (all chains)
    buyRAMBytes,
    buyRAMWithToken,
    sellRAM,

    // Refund (all chains)
    refund,

    // WAX PowerUp
    POWERUP_DENOM,
    pctToFrac,
    powerUp,
    powerUpExec,

    // XPR/Proton
    setRAMLimit,

    // Bulk
    newAccountResources,
};
