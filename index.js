// index.js — Sol Smart Flow Pro (Final: High-PnL Smart Wallets + Pump.fun/4meme feed)
// Node 18+ (Render-ready). Uses global fetch; add axios for convenience.

const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const { Telegraf } = require("telegraf");

/* ================= ENV ================= */
const TG_BOT_TOKEN      = process.env.TG_BOT_TOKEN || process.env.BOT_TOKEN; // BotFather token
const WEBHOOK_URL       = process.env.WEBHOOK_URL || "";                     // https://<render>.onrender.com/telegram/webhook
const GROUP_CHAT_ID     = Number(process.env.GROUP_CHAT_ID || 0);            // your group id (-100xxxxxxxxxx)

const HELIUS_API_KEY    = process.env.HELIUS_API_KEY || "";                  // dev.helius.xyz
const BIRDEYE_API_KEY   = process.env.BIRDEYE_API_KEY || "";                 // app.birdeye.so key
const DEX_LIMIT         = Number(process.env.DEX_LIMIT || 30);               // how many pairs to scan each poll

const MIN_USD_ALERT     = Number(process.env.MIN_USD_ALERT || 5000);         // PnL alert threshold
const MIN_LIQ_USD       = Number(process.env.MIN_LIQ_USD || 2000);           // pair filter: min liquidity
const MIN_HOLDERS       = Number(process.env.MIN_HOLDERS || 50);             // pair filter: min holders
const MAX_TOKEN_AGE_MIN = Number(process.env.MAX_TOKEN_AGE_MIN || 120);      // max token age to post (in minutes)
const POLL_SEC          = Number(process.env.POLL_SEC || 60);                // poll interval seconds (dexscreener scan)
const WALLET_POLL_SEC   = Number(process.env.WALLET_POLL_SEC || 60);         // wallet scan interval seconds

// comma-separated Solana wallet list to watch (smart wallets)
const STARTING_WALLETS  = (process.env.WATCHLIST || "").split(",").map(s=>s.trim()).filter(Boolean);

// safety
if (!TG_BOT_TOKEN) { console.error("❌ Missing TG_BOT_TOKEN"); process.exit(1); }
if (!GROUP_CHAT_ID) { console.error("❌ Missing GROUP_CHAT_ID (-100…)"); process.exit(1); }

/* ================= CORE ================= */
const app = express();
app.use(bodyParser.json());
const bot = new Telegraf(TG_BOT_TOKEN);

// memory stores (ephemeral on free Render)
const state = {
  wallets: new Set(STARTING_WALLETS), // watched wallets
  lastPairs: new Set(),               // to avoid duplicate posts
  walletPositions: new Map(),         // wallet -> {mint->{netAmount, avgCostUSD}} (rough estimate)
  lastWalletCheck: 0
};

// simple helpers
const sleep = (ms)=> new Promise(r=>setTimeout(r,ms));
const now = ()=> Date.now();
const log = (...a)=> console.log(new Date().toISOString(), ...a);

/* =============== Telegram helpers =============== */
async function sendText(text, extra={}) {
  try {
    await bot.telegram.sendMessage(GROUP_CHAT_ID, text, { disable_web_page_preview: true, ...extra });
  } catch (e) { console.error("TG send error:", e?.response?.data || e.message); }
}

async function sendCard({ image, caption, buttons }) {
  try {
    const markup = buttons?.length
      ? { inline_keyboard: buttons.map(row => row.map(btn => ({ text: btn.text, url: btn.url }))) }
      : undefined;
    if (image) {
      await bot.telegram.sendPhoto(GROUP_CHAT_ID, image, { caption, parse_mode: "HTML", reply_markup: markup });
    } else {
      await bot.telegram.sendMessage(GROUP_CHAT_ID, caption, { parse_mode: "HTML", reply_markup: markup, disable_web_page_preview: false });
    }
  } catch (e) { console.error("TG card error:", e?.response?.data || e.message); }
}

/* =============== Prices / Data =============== */
async function birdeyePriceUsd(mint) {
  // For SOL native (So111...), use SOL price endpoint; for SPL, Birdeye price by address
  try {
    const url = `https://public-api.birdeye.so/defi/price?address=${encodeURIComponent(mint)}&chain=solana`;
    const r = await axios.get(url, { headers: { "x-api-key": BIRDEYE_API_KEY, accept: "application/json" }});
    return Number(r.data?.data?.value || 0);
  } catch (e) {
    return 0;
  }
}

/* =============== Dexscreener scanning (Pump.fun + 4meme) ===============
   We’ll use Dexscreener latest Solana pairs and filter:
   - dexId 'pumpfun' OR URL contains 'pump.fun'
   - OR (heuristic) name/symbol contains '4meme' (some 4meme pairs tagged differently)
   Then apply filters: liquidity, holders, age.
*/
async function fetchDexPairs() {
  try {
    const url = `https://api.dexscreener.com/latest/dex/pairs/solana`;
    const r = await axios.get(url, { timeout: 15000 });
    const pairs = Array.isArray(r.data?.pairs) ? r.data.pairs.slice(0, DEX_LIMIT) : [];
    const out = [];
    for (const p of pairs) {
      const dexId = (p.dexId || "").toLowerCase();
      const url = p.url || "";
      const isPump = dexId.includes("pumpfun") || url.includes("pump.fun");
      const is4meme = dexId.includes("4meme") || (p.baseToken?.symbol||"").toLowerCase().includes("4meme") || (p.baseToken?.name||"").toLowerCase().includes("4meme");
      if (!(isPump || is4meme)) continue;

      // metrics
      const liqUsd = Number(p.liquidity?.usd || 0);
      const holders = Number(p.info?.holders || 0);
      const ts = Number(p.pairCreatedAt || p.info?.pairCreatedAt || 0);
      const ageMin = ts ? Math.max(0, Math.round((Date.now() - ts)/60000)) : null;

      if (liqUsd < MIN_LIQ_USD) continue;
      if (holders && holders < MIN_HOLDERS) continue;
      if (ageMin !== null && ageMin > MAX_TOKEN_AGE_MIN) continue;

      out.push(p);
    }
    return out;
  } catch (e) {
    log("Dexscreener fetch error", e.message);
    return [];
  }
}

function fmtUsd(n){ return "$" + Number(n||0).toLocaleString(undefined,{maximumFractionDigits:2}); }

/* Post pair card once */
async function postPairIfNew(pair) {
  const key = pair.pairAddress || pair.baseToken?.address || (pair.url||"");
  if (state.lastPairs.has(key)) return;
  state.lastPairs.add(key);

  const name = pair.baseToken?.name || pair.baseToken?.symbol || "New Token";
  const symbol = pair.baseToken?.symbol || "";
  const ca = pair.baseToken?.address || "";
  const liq = fmtUsd(pair.liquidity?.usd || 0);
  const mcap = fmtUsd(pair.marketCap || pair.fdv || 0);
  const price = pair.priceUsd ? `$${Number(pair.priceUsd).toFixed(8)}` : "n/a";
  const holders = pair.info?.holders ? `${pair.info.holders}` : "n/a";
  const ageMin = pair.pairCreatedAt ? Math.max(0, Math.round((Date.now()-pair.pairCreatedAt)/60000)) : "n/a";
  const dexUrl = pair.url || `https://dexscreener.com/solana/${pair.pairAddress || ""}`;

  const caption = [
    `🏁 <b>New Meme Pair</b> ${isNaN(ageMin)? "" : `• <i>${ageMin}m</i>`}`,
    `<b>${name}</b> (${symbol})`,
    `💰 Price: <b>${price}</b>`,
    `📦 MCAP: <b>${mcap}</b>`,
    `💧 Liquidity: <b>${liq}</b>`,
    `👥 Holders: <b>${holders}</b>`,
    `🧾 CA: <code>${ca}</code>`
  ].join("\n");

  const buttons = [
    [{ text:"Open on Dexscreener", url: dexUrl }]
  ];
  await sendCard({ image: null, caption, buttons });
}

/* Poll loop for pairs */
async function pairLoop() {
  const pairs = await fetchDexPairs();
  for (const p of pairs) await postPairIfNew(p);
}

/* ============== High-PnL wallets (Helius) ==============
   Strategy: for each watched wallet:
   - Pull last N transactions via Helius Address endpoint
   - Coarsely parse tokenTransfers to compute net USD delta per tick
   - Keep a rolling baseline to trigger PnL alerts on big moves
*/
async function fetchWalletTxs(addr, limit=25) {
  const url = `https://api.helius.xyz/v0/addresses/${addr}/transactions?api-key=${HELIUS_API_KEY}&limit=${limit}`;
  try {
    const r = await axios.get(url, { timeout: 15000 });
    return Array.isArray(r.data) ? r.data : [];
  } catch (e) {
    log("Helius tx error", addr, e.message);
    return [];
  }
}

async function estimateTxUsdDelta(tx) {
  // Very coarse: sum native SOL transfers to/from wallet as USD using SOL price;
  // If SPL token transfers exist, try to price baseToken by Birdeye (best-effort).
  let usd = 0;
  try {
    const solPrice = await birdeyePriceUsd("So11111111111111111111111111111111111111112"); // SOL mint
    // native transfers
    const nt = tx.nativeTransfers || [];
    for (const t of nt) {
      const lamports = Number(t.amount || 0);
      const sol = lamports / 1e9;
      // fromUserAccount: negative; toUserAccount: positive — but we don't know perspective here.
      // We'll return absolute magnitude; wallet loop will orient sign.
      usd += Math.abs(sol * solPrice);
    }

    // token transfers (optional rough valuation)
    const tt = tx.tokenTransfers || [];
    for (const tr of tt) {
      const mint = tr.mint || "";
      const ui = Number(tr.tokenAmount || 0);
      if (!mint || !ui) continue;
      const p = await birdeyePriceUsd(mint);
      if (p) usd += Math.abs(ui * p);
    }
  } catch {}
  return usd;
}

const walletLastTotals = new Map(); // addr -> { ts, approxUsd }

async function walletLoop() {
  if (!HELIUS_API_KEY || state.wallets.size === 0) return;
  for (const addr of state.wallets) {
    const txs = await fetchWalletTxs(addr, 15);
    if (!txs.length) continue;

    // Take recent subset and estimate total flow
    let flowUsd = 0;
    for (const tx of txs.slice(0, 5)) {
      const est = await estimateTxUsdDelta(tx);
      flowUsd += est;
    }

    const prev = walletLastTotals.get(addr) || { ts: 0, approxUsd: 0 };
    const delta = flowUsd - prev.approxUsd;
    walletLastTotals.set(addr, { ts: now(), approxUsd: flowUsd });

    // Alert on large move
    if (Math.abs(delta) >= MIN_USD_ALERT) {
      const sig = txs[0]?.signature || txs[0]?.transactionHash || "";
      const url = sig ? `https://solscan.io/tx/${sig}` : `https://solscan.io/account/${addr}`;
      const sign = delta > 0 ? "📈" : "📉";
      await sendText(
        `${sign} <b>High-PnL Flow</b>\n` +
        `🧠 Wallet: <code>${addr}</code>\n` +
        `Δ Flow(approx): <b>${fmtUsd(delta)}</b>\n` +
        `🔗 ${url}`,
        { parse_mode: "HTML" }
      );
    }
  }
}

/* ============== Webhooks (Helius + Telegram) ============== */
// Helius webhook (optional, for instant push). Set in Helius dashboard to: /helius
app.post("/helius", async (req, res) => {
  try {
    const events = Array.isArray(req.body) ? req.body : [req.body];
    for (const ev of events) {
      const asText = JSON.stringify(ev).slice(0, 900);
      // A very light filter: only post if any watched wallet appears in accounts list
      const hit = [...state.wallets].some(w => asText.includes(w));
      if (hit) {
        await sendText(`🚨 <b>Watched Wallet Activity</b>\n<code>${asText}</code>`, { parse_mode: "HTML" });
      }
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(200).json({ ok: false });
  }
});

// Telegram webhook endpoint
app.post("/telegram/webhook", (req, res) => {
  try { bot.handleUpdate(req.body); } catch {}
  res.sendStatus(200);
});

/* ============== Commands ============== */
bot.start((ctx)=> ctx.reply(
  "👋 Sol Smart Flow Pro — live.\n\n" +
  "• /status — bot & filters\n" +
  "• /watch add <WALLET> — track wallet\n" +
  "• /watch rm <WALLET> — untrack wallet\n" +
  "• /watch ls — list wallets\n" +
  "• /posttest — send a sample card\n" +
  "• /price <MINT> — Birdeye price\n" +
  "All alerts go to this group."
));

bot.command("status", (ctx)=>{
  const lines = [
    "✅ Bot live.",
    `• Group: ${GROUP_CHAT_ID}`,
    `• Wallets: ${[...state.wallets].length}`,
    `• PnL threshold: ${fmtUsd(MIN_USD_ALERT)}`,
    `• Dex filter: liq≥${fmtUsd(MIN_LIQ_USD)}, holders≥${MIN_HOLDERS}, age≤${MAX_TOKEN_AGE_MIN}m`,
    `• Polls: pairs ${POLL_SEC}s, wallets ${WALLET_POLL_SEC}s`
  ];
  ctx.reply(lines.join("\n"));
});

bot.command("watch", (ctx)=>{
  const [,sub,arg] = (ctx.message.text||"").split(/\s+/);
  if (sub === "add" && arg) {
    state.wallets.add(arg);
    return ctx.reply(`✅ Added wallet\n${arg}`);
  }
  if (sub === "rm" && arg) {
    state.wallets.delete(arg);
    return ctx.reply(`🗑️ Removed wallet\n${arg}`);
  }
  if (sub === "ls") {
    const list = [...state.wallets];
    return ctx.reply(list.length ? "👀 Watched wallets:\n" + list.join("\n") : "No wallets yet.");
  }
  ctx.reply("Use:\n/watch add <WALLET>\n/watch rm <WALLET>\n/watch ls");
});

bot.command("price", async (ctx)=>{
  const mint = (ctx.message.text||"").split(/\s+/)[1];
  if (!mint) return ctx.reply("Use: /price <MINT_ADDRESS>");
  try {
    const url = `https://public-api.birdeye.so/defi/price?address=${encodeURIComponent(mint)}&chain=solana`;
    const r = await axios.get(url, { headers: { "x-api-key": BIRDEYE_API_KEY, accept: "application/json" }});
    const v = Number(r.data?.data?.value || 0);
    return ctx.reply(v ? `💸 ${v.toPrecision(8)} USD` : "No price.");
  } catch { return ctx.reply("Price error."); }
});

bot.command("posttest", async (ctx)=>{
  await sendCard({
    image: null,
    caption: [
      "🏁 <b>New Meme Pair</b> • <i>demo</i>",
      "<b>UnicornSheepDog</b> (USDOG)",
      "💰 Price: <b>$0.00001234</b>",
      "📦 MCAP: <b>$37,800</b>",
      "💧 Liquidity: <b>$9,200</b>",
      "👥 Holders: <b>128</b>",
      "🧾 CA: <code>SoMeMintAddressHere</code>"
    ].join("\n"),
    buttons: [[{ text:"Open on Dexscreener", url:"https://dexscreener.com/solana" }]]
  });
  ctx.reply("✅ Sent demo card.");
});

/* ============== Loops & Launch ============== */
async function startLoops() {
  // pairs loop
  setInterval(pairLoop, Math.max(15, POLL_SEC) * 1000);
  // wallets loop
  setInterval(walletLoop, Math.max(15, WALLET_POLL_SEC) * 1000);
  // kick immediately once
  pairLoop().catch(()=>{});
  walletLoop().catch(()=>{});
}

app.get("/", (_req,res)=> res.send("Sol Smart Flow Pro — Final build running."));
const PORT = process.env.PORT || 10000;
app.listen(PORT, async ()=>{
  log("Server on", PORT);
  if (WEBHOOK_URL) {
    try { await bot.telegram.setWebhook(WEBHOOK_URL); log("Webhook set:", WEBHOOK_URL); }
    catch(e){ log("Webhook set failed:", e.message); }
  }
  startLoops();
});
