// index.js — Sol Smart Flow Pro v2 (CommonJS, Node 18+)
// Robust Telegram bot with:
// - Group broadcasting
// - Wallet watch & high-PnL/KOL tracker (Helius)
// - Pump.fun / 4Meme trending feed (via Birdeye trending endpoints; soft-fail if unavailable)
// - Admin commands, health checks, webhook & long-polling fallback

const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios").default;
const { Telegraf } = require("telegraf");

// =============== ENV ==================
const TG_BOT_TOKEN     = process.env.TG_BOT_TOKEN;            // required
const WEBHOOK_URL      = process.env.WEBHOOK_URL || "";        // recommended on Render
const ADMIN_USER_IDS   = (process.env.ADMIN_USER_IDS || "").split(",").filter(Boolean); // optional, comma-separated
const GROUP_CHAT_ID    = process.env.GROUP_CHAT_ID || "";      // optional: set to your group id (e.g. -1001234567890)
const HELIUS_API_KEY   = process.env.HELIUS_API_KEY || "";     // required for wallet monitor
const BIRDEYE_API_KEY  = process.env.BIRDEYE_API_KEY || "";    // optional but recommended
const WATCH_WALLETS    = (process.env.WATCH_WALLETS || "").split(",").map(s=>s.trim()).filter(Boolean); // optional csv
const MIN_USD_ALERT    = Number(process.env.MIN_USD_ALERT || "0"); // alert threshold for tx sizing
const NODE_ENV         = process.env.NODE_ENV || "production";

// Safety checks
if (!TG_BOT_TOKEN) throw new Error("Missing TG_BOT_TOKEN");
if (!HELIUS_API_KEY) console.warn("⚠️ HELIUS_API_KEY is missing — wallet tracking will be limited.");
if (!WEBHOOK_URL)     console.warn("⚠️ WEBHOOK_URL not set — falling back to long polling.");

// ============== TELEGRAM ==============
const bot = new Telegraf(TG_BOT_TOKEN, { handlerTimeout: 15_000 });

// keep a runtime group target (can be set by /setgroup)
let TARGET_CHAT_ID = GROUP_CHAT_ID || ""; 
// simple memory stores
const store = {
  watched: new Set(WATCH_WALLETS),
  lastSig: new Map(),         // wallet => last processed signature
  kolScores: new Map(),       // wallet => running pnl score
  lastTrendingAt: 0,
  status: { start: new Date().toISOString(), loops: 0 }
};

// ------ helpers ------
const isAdmin = (ctx) => {
  const id = String(ctx.from?.id || "");
  return ADMIN_USER_IDS.includes(id);
};

const send = async (chatId, text, extra = {}) => {
  try { await bot.telegram.sendMessage(chatId, text, { parse_mode: "HTML", disable_web_page_preview: true, ...extra }); }
  catch (e) { console.error("send error:", e?.response?.data || e.message); }
};

const broadcast = async (text, extra={}) => {
  if (!TARGET_CHAT_ID) return;
  return send(TARGET_CHAT_ID, text, extra);
};

const fmtUsd = (n) => (n === null || n === undefined) ? "?" : `$${Number(n).toLocaleString(undefined,{maximumFractionDigits:2})}`;
const short = (s, n=6) => s?.length>n*2 ? `${s.slice(0,n)}…${s.slice(-n)}` : s;

// ============== EXPRESS (webhook + health) =============
const app = express();
app.use(bodyParser.json({ limit: "512kb" }));

app.get("/", (_req, res)=>res.status(200).send("Sol Smart Flow Pro v2 OK"));
app.get("/health", (_req, res)=>res.json({ ok:true, ...store.status, target: TARGET_CHAT_ID, watched:[...store.watched].length }));

// webhook endpoint for Telegram
app.post("/telegram/webhook", (req, res) => {
  bot.handleUpdate(req.body, res);
});

// start server
const PORT = process.env.PORT || 10000;
app.listen(PORT, async () => {
  console.log(`🚀 Server running on ${PORT}`);
  if (WEBHOOK_URL) {
    try {
      await bot.telegram.setWebhook(`${WEBHOOK_URL.replace(/\/$/,"")}/telegram/webhook`);
      console.log("✅ Webhook set to", `${WEBHOOK_URL}/telegram/webhook`);
    } catch (e) {
      console.error("Failed to set webhook:", e?.response?.data || e.message);
    }
  } else {
    console.log("ℹ️ Using long polling (no WEBHOOK_URL provided).");
    bot.launch().catch(err=>console.error("polling launch err:", err.message));
  }
});

// ============== COMMANDS ==================

// /start — quick hello
bot.start(async (ctx) => {
  await ctx.reply("👋 Hello from <b>Sol Smart Flow Pro v2</b> — fully online.\n" +
    "Type <code>/help</code> for commands.", { parse_mode:"HTML" });
});

// /help — command list
bot.command("help", async (ctx) => {
  const help = [
    "<b>Commands</b>",
    "/help — show help",
    "/ping — quick check",
    "/status — service health",
    "/setgroup — use here to set this chat as broadcast target (admin only)",
    "/group — show current broadcast chat",
    "/watch &lt;wallet&gt; — add a wallet to monitor",
    "/unwatch &lt;wallet&gt; — stop monitoring",
    "/list — list watched wallets",
    "/posttest — test a sample alert",
    "",
    "<b>Feeds</b>",
    "• KOL/High-PnL tracker (auto)",
    "• Pump.fun + 4Meme trending (auto, best effort)",
  ].join("\n");
  await ctx.reply(help, { parse_mode:"HTML", disable_web_page_preview:true });
});

bot.command("ping", (ctx)=>ctx.reply("pong ✅"));

bot.command("status", async (ctx) => {
  const text = [
    "🟢 <b>All Systems Operational</b>",
    `• Uptime: <code>${store.status.start}</code>`,
    `• Loops: <code>${store.status.loops}</code>`,
    `• Watched: <code>${store.watched.size}</code>`,
    `• Target: <code>${TARGET_CHAT_ID || "not set"}</code>`,
  ].join("\n");
  await ctx.reply(text, { parse_mode:"HTML" });
});

// set current chat as broadcast target
bot.command("setgroup", async (ctx)=>{
  if (!isAdmin(ctx)) return ctx.reply("⛔ Admins only.");
  TARGET_CHAT_ID = String(ctx.chat.id);
  await ctx.reply(`✅ Broadcast target set to <code>${TARGET_CHAT_ID}</code>`, { parse_mode:"HTML" });
});

bot.command("group", (ctx)=>ctx.reply(`Current broadcast chat: <code>${TARGET_CHAT_ID || "not set"}</code>`, { parse_mode:"HTML" }));

// watch / unwatch / list
bot.hears(/^\/watch\s+([A-Za-z0-9]{20,})/, async (ctx) => {
  const addr = ctx.match[1];
  store.watched.add(addr);
  await ctx.reply(`👀 Watching wallet: <code>${addr}</code>`, { parse_mode:"HTML" });
});
bot.hears(/^\/unwatch\s+([A-Za-z0-9]{20,})/, async (ctx) => {
  const addr = ctx.match[1];
  store.watched.delete(addr);
  store.lastSig.delete(addr);
  await ctx.reply(`🛑 Stopped: <code>${addr}</code>`, { parse_mode:"HTML" });
});
bot.command("list", (ctx)=>ctx.reply(
  [...store.watched].length ? [...store.watched].map(a=>`• <code>${a}</code>`).join("\n") : "No wallets yet.",
  { parse_mode:"HTML" }
));

// /posttest — test message into broadcast chat
bot.command("posttest", async (ctx)=>{
  if (!TARGET_CHAT_ID) return ctx.reply("Set a broadcast group first: /setgroup");
  await broadcast("🧪 Test broadcast from <b>Sol Smart Flow Pro v2</b> — looks good!", { parse_mode:"HTML" });
  await ctx.reply("Sent to broadcast chat ✅");
});

// ============== DATA SOURCES ==================

// Helius: latest transactions for address (enhanced)
async function heliusTx(address, untilSig) {
  if (!HELIUS_API_KEY) return [];
  const url = `https://api.helius.xyz/v0/addresses/${address}/transactions?api-key=${HELIUS_API_KEY}&limit=20`;
  try {
    const { data } = await axios.get(url, { timeout: 12_000 });
    if (!Array.isArray(data)) return [];
    // stop at last processed signature
    const out = [];
    for (const t of data) {
      if (t?.signature === untilSig) break;
      out.push(t);
    }
    return out;
  } catch (e) {
    console.error("heliusTx err:", e?.response?.data || e.message);
    return [];
  }
}

// Birdeye: token price snapshot (best effort)
async function birdeyePrice(mint) {
  if (!BIRDEYE_API_KEY) return null;
  try {
    const r = await axios.get(
      `https://public-api.birdeye.so/defi/price?chain=solana&address=${mint}`,
      { headers:{ "X-API-KEY": BIRDEYE_API_KEY }, timeout: 10_000 }
    );
    return r?.data?.data?.value ?? null;
  } catch (e) {
    return null; // soft-fail
  }
}

// Birdeye: trending markets (best effort; API subject to change)
async function birdeyeTrending(limit=5) {
  if (!BIRDEYE_API_KEY) return [];
  try {
    const r = await axios.get(
      `https://public-api.birdeye.so/defi/markets/trending?chain=solana&limit=${limit}`,
      { headers:{ "X-API-KEY": BIRDEYE_API_KEY }, timeout: 10_000 }
    );
    return Array.isArray(r?.data?.data) ? r.data.data : [];
  } catch {
    return [];
  }
}

// ============== ANALYTICS / PARSERS ==================

// naive pnl scoring: +2 buy then profitable sell, +1 buy then neutral, -1 loss
function updateKolScore(wallet, pnlUsd) {
  const cur = store.kolScores.get(wallet) || 0;
  const add = pnlUsd > 20 ? 2 : pnlUsd > 0 ? 1 : pnlUsd < -10 ? -1 : 0;
  const next = cur + add;
  store.kolScores.set(wallet, next);
  return next;
}

// simple readable Tx line (fall back if memos unknown)
function summarizeTx(t) {
  const sig = short(t.signature || "");
  const ts = t?.timestamp ? new Date(t.timestamp*1000).toISOString().slice(11,19) : "--:--:--";
  const acts = t?.type || t?.transactionType || "tx";
  const fee  = t?.fee || 0;
  return `[${ts}] ${acts} • fee ${fee} • ${sig}`;
}

// attempt to detect swap + token mint (best effort)
function extractMintFromTokenTransfers(t) {
  const transfers = t?.tokenTransfers;
  if (!Array.isArray(transfers) || !transfers.length) return null;
  // pick token with biggest absolute delta not SOL
  let best = null, maxAbs = 0;
  for (const x of transfers) {
    if (!x?.mint) continue;
    const amt = Math.abs(Number(x?.tokenAmount || 0));
    if (amt > maxAbs) { maxAbs = amt; best = x.mint; }
  }
  return best;
}

// ============== LOOPS ==================

// 1) Wallet monitor loop (KOL / high-PnL signal)
async function walletLoop() {
  store.status.loops++;
  for (const wallet of store.watched) {
    const last = store.lastSig.get(wallet) || null;
    const txs = await heliusTx(wallet, last);
    if (!txs.length) continue;

    // newest first; we want to dispatch oldest->newest
    for (let i=txs.length-1; i>=0; i--) {
      const t = txs[i];
      const sig = t?.signature;
      if (!sig) continue;

      // naive pnl estimate (best effort)
      const pnl = Number(t?.feePayerProfit ?? t?.profit ?? 0);
      const score = updateKolScore(wallet, pnl);

      let line = `🔎 <b>Wallet</b> <code>${short(wallet,8)}</code> ${pnl ? `• PnL ${fmtUsd(pnl)}`:""} • score <code>${score}</code>\n`;
      line += `• ${summarizeTx(t)}\n`;

      const mint = extractMintFromTokenTransfers(t);
      if (mint) {
        const px = await birdeyePrice(mint);
        line += `• Token: <code>${short(mint,6)}</code>${px?` • Price ${fmtUsd(px)}`:""}\n`;
      }

      // size gate (optional)
      const usdV = Number(t?.overallValueUSD ?? t?.nativeTransfers?.[0]?.amount ?? 0);
      if (MIN_USD_ALERT && usdV < MIN_USD_ALERT) {
        // skip small
      } else {
        await broadcast(line, { parse_mode:"HTML" });
      }

      store.lastSig.set(wallet, sig);
    }
  }
}

// 2) Trending (Pump.fun / 4Meme proxy via Birdeye trending)
async function trendingLoop() {
  // run at most every 2 minutes
  const now = Date.now();
  if (now - store.lastTrendingAt < 120_000) return;
  store.lastTrendingAt = now;

  const items = await birdeyeTrending(5);
  if (!items.length) return;

  const msg = items.map((x, i)=>{
    const name = x?.symbol || x?.name || "Token";
    const mint = x?.address || x?.mint || "";
    const px   = x?.price || x?.value || null;
    const mcap = x?.market_cap || x?.mc || null;
    return `${i+1}. <b>${name}</b> • <code>${short(mint,6)}</code> • ${px?fmtUsd(px):"?"}${mcap?` • MC ${fmtUsd(mcap)}`:""}`;
  }).join("\n");

  await broadcast(`🚀 <b>Trending (Pump/4Meme)</b>\n${msg}`, { parse_mode:"HTML" });
}

// master scheduler
setInterval(walletLoop, 25_000);   // every 25s, respects per-wallet paging
setInterval(trendingLoop, 30_000); // soft; internal rate-limit to 2min

// graceful
process.once("SIGINT",  () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
});
