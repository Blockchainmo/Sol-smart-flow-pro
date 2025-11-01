// index.js — Sol Smart Flow Pro (all-in-one)
// Node 18+ (global fetch). CommonJS compatible.

const express = require("express");
const bodyParser = require("body-parser");
const { Telegraf } = require("telegraf");
const fs = require("fs");
const path = require("path");

// ---------- ENV ----------
const BOT_TOKEN       = process.env.TG_BOT_TOKEN || "";
const WEBHOOK_URL     = process.env.WEBHOOK_URL  || "";
const ADMIN_USER_IDS  = (process.env.ADMIN_USER_IDS || "")
  .split(",").map(s => s.trim()).filter(Boolean);

const PREMIUM_MODE    = (process.env.PREMIUM_MODE || "false").toLowerCase() === "true";
const PREMIUM_CODE    = process.env.PREMIUM_CODE || "PAYME";
const OPENAI_API_KEY  = process.env.OPENAI_API_KEY || "";

const HELIUS_API_KEY  = process.env.HELIUS_API_KEY || "";
const BIRDEYE_API_KEY = process.env.BIRDEYE_API_KEY || "";
const TWITTER_BEARER  = process.env.TWITTER_BEARER || "";

const WATCH_WALLETS   = (process.env.WATCH_WALLETS || "")
  .split(",").map(s => s.trim()).filter(Boolean);

// ---------- SANITY ----------
if (!BOT_TOKEN) {
  console.error("Missing TG_BOT_TOKEN env.");
  process.exit(1);
}
if (!WEBHOOK_URL) {
  console.error("Missing WEBHOOK_URL env.");
  process.exit(1);
}

// ---------- DATA DIR ----------
const DATA_DIR     = path.join(__dirname, "data");
const SUBS_FILE    = path.join(DATA_DIR, "subs.json");      // watched wallets per user
const PREMIUM_FILE = path.join(DATA_DIR, "premium.json");   // premium user ids
const KOL_FILE     = path.join(DATA_DIR, "kols.json");      // tracked twitter handles

ensureDir(DATA_DIR);
const subs      = loadJson(SUBS_FILE, {});         
const premium   = new Set(loadJson(PREMIUM_FILE, []));   
const kols      = new Set(loadJson(KOL_FILE, []));       

WATCH_WALLETS.forEach(w => kols.add(w)); 

function ensureDir(d) { try { if (!fs.existsSync(d)) fs.mkdirSync(d); } catch(e){} }
function loadJson(f, dflt) { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch(_){ return dflt; } }
function saveJson(f, v)    { fs.writeFileSync(f, JSON.stringify(v, null, 2)); }

const log = (...a) => console.log(new Date().toISOString(), "-", ...a);

// ---------- TELEGRAM ----------
const bot = new Telegraf(BOT_TOKEN);

function requirePremium(ctx) {
  if (!PREMIUM_MODE) return true;
  const uid = String(ctx.from.id);
  if (premium.has(uid) || ADMIN_USER_IDS.includes(uid)) return true;
  ctx.reply("🔒 Premium feature. Use `/redeem YOURCODE` to unlock.");
  return false;
}

bot.start((ctx) => {
  ctx.reply("👋 Hello, I'm your Sol Smart Flow Bot — fully online!\n\nTry:\n" +
    "• /help\n" +
    "• /ai <question>\n" +
    "• /price <mint>\n" +
    "• /bundle <mint>\n" +
    "• /whales\n" +
    "• /kolnews\n" +
    (PREMIUM_MODE ? "• /redeem <code>  • /premium\n" : "")
  );
});

bot.help((ctx) => {
  ctx.reply("🧭 Commands:\n" +
    "/status – bot health\n" +
    "/ai <q> – quick AI answer\n" +
    "/price <mint> – Birdeye price\n" +
    "/bundle <mint> – recent trades snapshot\n" +
    "/watch <wallet> – add a wallet to watch\n" +
    "/mywatch – list wallets you watch\n" +
    "/whales – latest big txs (Helius)\n" +
    "/koladd <handle> – admin: add KOL (@handle or handle)\n" +
    "/kollist – list tracked KOLs\n" +
    "/kolnews – latest posts from KOLs\n" +
    (PREMIUM_MODE ? "/redeem <code> – unlock premium\n/premium – premium status\n" : "")
  );
});

bot.command("status", (ctx) => {
  ctx.reply("✅ Live & healthy.\n" +
    `Premium: ${PREMIUM_MODE ? "ON" : "OFF"} | Tracked KOLs: ${kols.size}`);
});

if (PREMIUM_MODE) {
  bot.command("redeem", (ctx) => {
    const args = ctx.message.text.split(" ").slice(1);
    const code = (args[0] || "").trim();
    if (!code) return ctx.reply("Usage: /redeem YOURCODE");
    if (code !== PREMIUM_CODE) return ctx.reply("❌ Invalid code.");
    const uid = String(ctx.from.id);
    premium.add(uid);
    saveJson(PREMIUM_FILE, Array.from(premium));
    ctx.reply("✅ Premium unlocked. Enjoy!");
  });

  bot.command("premium", (ctx) => {
    const uid = String(ctx.from.id);
    ctx.reply(premium.has(uid) ? "✨ You have Premium." : "🔒 Not premium. Use /redeem.");
  });
}

// ---------- AI ----------
bot.command("ai", async (ctx) => {
  if (!requirePremium(ctx)) return;
  const q = ctx.message.text.split(" ").slice(1).join(" ").trim();
  if (!q) return ctx.reply("Ask me something: `/ai Will SOL flip ETH?`");
  if (!OPENAI_API_KEY) return ctx.reply("No OpenAI key set by admin.");
  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: q }],
        temperature: 0.5
      })
    });
    const j = await r.json();
    const text = j.choices?.[0]?.message?.content?.trim() || "…";
    ctx.reply(text.slice(0, 3500));
  } catch (e) {
    log("AI error", e.message);
    ctx.reply("AI error. Try again.");
  }
});// ---------- BIRDEYE ----------
bot.command("price", async (ctx) => {
  const args = ctx.message.text.split(" ").slice(1);
  const mint = args[0];
  if (!mint) return ctx.reply("Usage: /price <mint>");
  if (!BIRDEYE_API_KEY) return ctx.reply("No Birdeye API key set.");
  try {
    const r = await fetch(`https://public-api.birdeye.so/public/price?address=${mint}`, {
      headers: { "X-API-KEY": BIRDEYE_API_KEY }
    });
    const j = await r.json();
    if (!j?.data) return ctx.reply("No data found.");
    ctx.reply(`💰 ${j.data.value.toFixed(4)} USD (${mint.slice(0,6)}...)`);
  } catch (e) {
    ctx.reply("Error fetching price.");
    log("price", e);
  }
});

// ---------- HELIUS ----------
bot.command("whales", async (ctx) => {
  if (!HELIUS_API_KEY) return ctx.reply("No Helius API key set.");
  try {
    const r = await fetch(`https://api.helius.xyz/v0/addresses?api-key=${HELIUS_API_KEY}`);
    const j = await r.json();
    const txt = JSON.stringify(j, null, 2).slice(0, 3500);
    ctx.reply("🐋 Whale Data:\n" + txt);
  } catch (e) {
    ctx.reply("Error fetching whale data.");
    log("whales", e);
  }
});

// ---------- KOL TRACKER ----------
bot.command("koladd", (ctx) => {
  const uid = String(ctx.from.id);
  if (!ADMIN_USER_IDS.includes(uid)) return ctx.reply("Admin only.");
  const handle = ctx.message.text.split(" ")[1];
  if (!handle) return ctx.reply("Usage: /koladd handle");
  kols.add(handle.replace("@",""));
  saveJson(KOL_FILE, Array.from(kols));
  ctx.reply(`✅ Added ${handle}`);
});

bot.command("kollist", (ctx) => {
  ctx.reply("🧠 Tracked KOLs:\n" + Array.from(kols).join("\n"));
});

bot.command("kolnews", async (ctx) => {
  if (!requirePremium(ctx)) return;
  if (!TWITTER_BEARER) return ctx.reply("No Twitter token set.");
  const list = Array.from(kols);
  if (list.length === 0) return ctx.reply("No KOLs tracked yet.");
  try {
    const handle = list[Math.floor(Math.random() * list.length)];
    const r = await fetch(`https://api.twitter.com/2/users/by/username/${handle}`, {
      headers: { "Authorization": `Bearer ${TWITTER_BEARER}` }
    });
    const u = await r.json();
    const uid = u?.data?.id;
    if (!uid) return ctx.reply("Can't find that KOL.");
    const r2 = await fetch(`https://api.twitter.com/2/users/${uid}/tweets?max_results=5`, {
      headers: { "Authorization": `Bearer ${TWITTER_BEARER}` }
    });
    const j = await r2.json();
    const tweets = j?.data || [];
    if (tweets.length === 0) return ctx.reply(`No tweets from ${handle}.`);
    const txt = tweets.map(t => `🗣️ @${handle}: ${t.text}`).join("\n\n");
    ctx.reply(txt.slice(0, 3500));
  } catch (e) {
    ctx.reply("Error fetching KOL data.");
    log("kolnews", e);
  }
});

// ---------- WATCHLIST ----------
bot.command("watch", (ctx) => {
  const args = ctx.message.text.split(" ").slice(1);
  const w = args[0];
  if (!w) return ctx.reply("Usage: /watch <wallet>");
  const uid = String(ctx.from.id);
  subs[uid] = subs[uid] || [];
  if (!subs[uid].includes(w)) subs[uid].push(w);
  saveJson(SUBS_FILE, subs);
  ctx.reply("👁️ Added wallet: " + w);
});

bot.command("mywatch", (ctx) => {
  const uid = String(ctx.from.id);
  const list = subs[uid] || [];
  if (list.length === 0) return ctx.reply("No wallets tracked.");
  ctx.reply("👁️ Your watched wallets:\n" + list.join("\n"));
});

// ---------- EXPRESS SERVER ----------
const app = express();
app.use(bodyParser.json());
app.use(bot.webhookCallback("/telegram/webhook"));
app.get("/", (_,res) => res.send("✅ Sol Smart Flow Pro Bot is Live"));
app.get("/health", (_,res) => res.json({ok:true,uptime:process.uptime()}));

bot.telegram.setWebhook(`${WEBHOOK_URL}`);
app.listen(10000, () => log("🚀 Server is running on port 10000"));
log("Webhook set to", WEBHOOK_URL);

// ---------- UTILS ----------
process.on("uncaughtException", (e) => log("UNCAUGHT", e));
process.on("unhandledRejection", (e) => log("REJECTED", e));
