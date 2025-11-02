// pumpfun-advanced.js
// Adds: market-cap jump alerts + /trending command support (Pump.fun + Birdeye)
// CommonJS to match your project
require("dotenv").config();
const axios = require("axios");
const NodeCache = require("node-cache");
const { MCAP_JUMP_PCT, WINDOW_MIN, TREND_EVERY_MIN, TREND_COUNT } = require("./watch-config");

// ====== ENV ======
const TG_BOT_TOKEN = process.env.TG_BOT_TOKEN;
const GROUP_CHAT_ID = process.env.GROUP_CHAT_ID; // your chat or channel id
const BIRDEYE_API_KEY = process.env.BIRDEYE_API_KEY; // you already have this

// Pump.fun endpoints
const PUMP_TRENDING_API = "https://frontend-api.pump.fun/trending";
const PUMP_FEED_API = "https://frontend-api.pump.fun/coins/created"; // newest coins

// ====== HELPERS ======
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const priceCache = new NodeCache({ stdTTL: 60 * 60, checkperiod: 60 }); // 1h cache

// === Telegram ===
async function tgSend(text) {
  try {
    await axios.post(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
      chat_id: GROUP_CHAT_ID,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    });
  } catch (e) {
    console.error("Telegram send error", e?.response?.data || e.message);
  }
}

// === Birdeye price ===
async function getPriceUSD(mint) {
  if (!BIRDEYE_API_KEY) return null;
  try {
    const url = `https://public-api.birdeye.so/public/price?address=${mint}`;
    const { data } = await axios.get(url, {
      headers: { "X-API-KEY": BIRDEYE_API_KEY, accept: "application/json" }
    });
    const p = data?.data?.value;
    return (typeof p === "number" ? p : null);
  } catch {
    return null;
  }
}

// === Pump.fun NEW COINS ===
async function fetchNewestCoins() {
  try {
    const { data } = await axios.get(PUMP_FEED_API);
    if (Array.isArray(data)) return data.slice(0, 20);
    if (Array.isArray(data?.coins)) return data.coins.slice(0, 20);
    return [];
  } catch (e) {
    console.error("pump.fun feed error", e?.response?.status || e.message);
    return [];
  }
}

// === Pump.fun trending ===
async function fetchTrending() {
  try {
    const { data } = await axios.get(PUMP_TRENDING_API);
    const list = Array.isArray(data) ? data : (Array.isArray(data?.coins) ? data.coins : []);
    return list.slice(0, TREND_COUNT);
  } catch (e) {
    console.error("pump.fun trending error", e?.response?.status || e.message);
    return [];
  }
}

// === Price tracking for jump detection ===
function recordPrice(mint, price) {
  if (!price || !mint) return;
  const now = Date.now();
  const series = priceCache.get(mint) || [];
  const cutoff = now - WINDOW_MIN * 60 * 1000;
  const cleaned = series.filter(p => p.t >= cutoff);
  cleaned.push({ t: now, p: price });
  priceCache.set(mint, cleaned);
}

function computeJumpPct(mint) {
  const series = priceCache.get(mint) || [];
  if (series.length < 2) return 0;
  const first = series[0].p;
  const last  = series[series.length - 1].p;
  if (!first || !last) return 0;
  return ((last - first) / first) * 100;
}

// === MAIN WATCHER ===
let running = false;

async function startPumpfunWatcher() {
  if (running) return;
  running = true;
  await tgSend("🚀 Pump.fun Watcher is now <b>active</b>! I’ll alert on new coins and big moves.");

  const seen = new Set();

  while (running) {
    try {
      const newest = await fetchNewestCoins();

      for (const c of newest) {
        const mint = c?.mint || c?.mintAddress || c?.address || c?.tokenMint || null;
        if (!mint) continue;

        if (!seen.has(mint)) {
          seen.add(mint);

          const price = await getPriceUSD(mint);
          if (price) recordPrice(mint, price);

          const name  = c?.name || c?.symbol || "New token";
          const sym   = c?.symbol || "";
          const link  = `https://pump.fun/coin/${mint}`;

          await tgSend(
            `🆕 <b>New Pump.fun token</b>\n` +
            `• <b>${name}</b> ${sym ? `(${sym})` : ""}\n` +
            `${price ? `• Price: <b>$${price.toFixed(10)}</b>\n` : ""}` +
            `• <a href="${link}">Open on Pump.fun</a>`
          );
        } else {
          const price = await getPriceUSD(mint);
          if (price) {
            recordPrice(mint, price);
            const jump = computeJumpPct(mint);
            if (jump >= MCAP_JUMP_PCT) {
              const link  = `https://pump.fun/coin/${mint}`;
              await tgSend(
                `📈 <b>Big move detected</b>\n` +
                `• Token: <code>${mint.slice(0,6)}...${mint.slice(-4)}</code>\n` +
                `• Change (last ${WINDOW_MIN}m): <b>+${jump.toFixed(1)}%</b>\n` +
                `• <a href="${link}">View on Pump.fun</a>`
              );
              priceCache.del(mint);
            }
          }
        }
      }
    } catch (e) {
      console.error("watch loop error", e.message);
    }
    await sleep(10_000); // check every 10s
  }
}

function stopPumpfunWatcher() {
  running = false;
}

// === Trending scheduler ===
let lastTrendText = "";
async function refreshTrending() {
  const list = await fetchTrending();
  if (!list.length) {
    lastTrendText = "No trending data available right now.";
    return lastTrendText;
  }

  const lines = await Promise.all(
    list.map(async (c, i) => {
      const mint = c?.mint || c?.mintAddress || c?.address || c?.tokenMint || "";
      const name = c?.name || c?.symbol || `Token ${i+1}`;
      const sym  = c?.symbol ? ` (${c.symbol})` : "";
      const link = `https://pump.fun/coin/${mint}`;
      const price = await getPriceUSD(mint);
      const priceStr = price ? `$${price.toFixed(10)}` : "n/a";
      return `${i+1}. <b>${name}${sym}</b> — <i>${priceStr}</i>\n   <a href="${link}">${mint.slice(0,6)}...${mint.slice(-4)}</a>`;
    })
  );

  lastTrendText = "🔥 <b>Pump.fun Trending</b>\n" + lines.join("\n");
  return lastTrendText;
}

function startTrendingRefresher() {
  refreshTrending().catch(()=>{});
  setInterval(() => refreshTrending().catch(()=>{}), TREND_EVERY_MIN * 60 * 1000);
}

// === Exports ===
module.exports = {
  startPumpfunWatcher,
  stopPumpfunWatcher,
  startTrendingRefresher,
  getTrendingText: async () => {
    if (!lastTrendText) await refreshTrending();
    return lastTrendText;
  }
};
