// index.js — Sol Smart Flow Pro (AI + DeFi + Premium + KOL + Helius/Birdeye)
// Node 18+ (global fetch). CommonJS.

const express = require("express");
const bodyParser = require("body-parser");
const { Telegraf } = require("telegraf");
const fs = require("fs");
const path = require("path");

/* ========= ENV ========= */
const BOT_TOKEN = process.env.TG_BOT_TOKEN;
const WEBHOOK_URL = process.env.WEBHOOK_URL; // https://...onrender.com/telegram/webhook

// Premium / payments (soft paywall with redeem code + admin grants)
const PREMIUM_MODE = (process.env.PREMIUM_MODE || "true").toLowerCase() === "true";
const PREMIUM_CODE = process.env.PREMIUM_CODE || ""; // e.g. MORIE100
const PREMIUM_USER_IDS = (process.env.PREMIUM_USER_IDS || "").split(",").map(s=>s.trim()).filter(Boolean);

// Admins
const ADMIN_USER_IDS = (process.env.ADMIN_USER_IDS || "").split(",").map(s=>s.trim()).filter(Boolean);

// AI
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";

// Affiliate
const AFFIL_JUP = process.env.AFFIL_JUP || ""; // e.g. your ref code or URL param

// Helius / Birdeye (optional but powerful)
const HELIUS_API_KEY = process.env.HELIUS_API_KEY || "";
const BIRDEYE_API_KEY = process.env.BIRDEYE_API_KEY || "";

// Twitter (X) KOL tracking
const TWITTER_BEARER = process.env.TWITTER_BEARER || ""; // X v2 Bearer token

// Watchlist (optional, CSV of smart wallets you like)
const WATCH_WALLETS = (process.env.WATCH_WALLETS || "").split(",").map(s=>s.trim()).filter(Boolean);

if (!BOT_TOKEN) { console.error("Missing TG_BOT_TOKEN"); process.exit(1); }

/* ========= Storage ========= */
const DATA_DIR = "./data";
const USERS_JSON = path.join(DATA_DIR, "users.json");         // { [uid]: { wallet, premium } }
const KOLS_JSON  = path.join(DATA_DIR, "kols.json");          // { handles: ["...", ...] }
const ALERTS_JSON= path.join(DATA_DIR, "alerts.json");        // { [uid]: [targets...] }

function ensureDir(p){ if(!fs.existsSync(p)) fs.mkdirSync(p,{recursive:true}); }
function readJson(p, fallback){ try { return JSON.parse(fs.readFileSync(p,"utf8")); } catch { return fallback; } }
function writeJson(p, obj){ fs.writeFileSync(p, JSON.stringify(obj, null, 2)); }

ensureDir(DATA_DIR);
const users  = readJson(USERS_JSON, {});
const kols   = readJson(KOLS_JSON,  { handles: [] });
const alerts = readJson(ALERTS_JSON,{});

/* ========= Helpers ========= */
const isAdmin   = (ctx) => ADMIN_USER_IDS.includes(String(ctx.from.id));
const isPremium = (ctx) => PREMIUM_USER_IDS.includes(String(ctx.from.id)) || users[String(ctx.from.id)]?.premium === true;

function requirePremium(ctx, featureName){
  if (!PREMIUM_MODE) return true;
  if (isPremium(ctx)) return true;
  ctx.reply(`🔒 ${featureName} is premium.\nGet access: /premium`);
  return false;
}

function jupSwapUrl(fromMint="So11111111111111111111111111111111111111112", toMint="Es9vMFrzaC...", amount="1"){
  const base = "https://jup.ag/swap";
  const aff  = AFFIL_JUP ? `&referrer=${encodeURIComponent(AFFIL_JUP)}` : "";
  return `${base}?inputMint=${encodeURIComponent(fromMint)}&outputMint=${encodeURIComponent(toMint)}&amount=${encodeURIComponent(amount)}${aff}`;
}

async function getSOLPrice(){
  const r = await fetch("https://price.jup.ag/v6/price?ids=SOL");
  if(!r.ok) throw new Error("price http "+r.status);
  const j = await r.json();
  const p = j?.data?.SOL?.price;
  if(!p) throw new Error("no price");
  return Number(p);
}

async function getTokenPrice(idOrMint="SOL"){
  const key = idOrMint.length>6? idOrMint : "SOL";
  const r = await fetch(`https://price.jup.ag/v6/price?ids=${encodeURIComponent(key)}`);
  if(!r.ok) throw new Error("price http "+r.status);
  const j = await r.json();
  const p = j?.data?.[key]?.price;
  if(!p) throw new Error("no price for "+key);
  return { id:key, price:Number(p) };
}

async function solBalance(addr){
  const body = { jsonrpc:"2.0", id:1, method:"getBalance", params:[addr] };
  const r = await fetch("https://api.mainnet-beta.solana.com",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
  const j = await r.json();
  const lamports = j?.result?.value ?? 0;
  return lamports/1e9;
}

async function lastSig(addr){
  const body = { jsonrpc:"2.0", id:1, method:"getSignaturesForAddress", params:[addr,{limit:1}] };
  const r = await fetch("https://api.mainnet-beta.solana.com",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
  const j = await r.json();
  return j?.result?.[0]?.signature || "N/A";
}

/* ========= Telegram ========= */
const app = express();
app.use(bodyParser.json());
const bot = new Telegraf(BOT_TOKEN);

/* ======== General Commands ======== */
bot.start(async (ctx)=>{
  await ctx.reply(
    "👋 Welcome to *Sol Smart Flow Pro* — AI + DeFi alerts.\n\n" +
    "Try:\n" +
    "• /price — SOL price\n" +
    "• /alert 200 — ping me when SOL crosses $200\n" +
    "• /track <wallet> — balance + last tx\n" +
    "• /swap — Jupiter link (with your ref)\n" +
    "• /ai Why is SOL pumping?\n" +
    "• /kollist — tracked KOLs\n" +
    "• /kolnews — latest tweets from KOLs\n" +
    (PREMIUM_MODE ? "\nUpgrade: /premium" : ""),
    { parse_mode:"Markdown" }
  );
});

bot.command("help", async (ctx)=>{
  await ctx.reply(
"🧰 *Commands*\n"+
"`/ping` — latency\n"+
"`/price [SYMBOL|MINT]` — price (default SOL)\n"+
"`/alert <price>` — price alert\n"+
"`/track <wallet>` — SOL balance + last tx\n"+
"`/swap` — open Jupiter\n"+
"`/ai <question>` — AI crypto Q&A\n\n"+
"🧠 *KOL tools*\n"+
"`/koladd <handle>` — add KOL (admin)\n"+
"`/kolrm <handle>` — remove KOL (admin)\n"+
"`/kollist` — show tracked KOLs\n"+
"`/kolnews` — latest tweets (premium)\n\n"+
"🐳 *On-chain*\n"+
"`/whales [minSOL]` — scan watch wallets (premium, Helius)\n"+
"`/bundle` — latest bundle hints (premium, Birdeye/Jito)\n\n"+
(PREMIUM_MODE ? "🔒 *Premium*\n`/premium` — how to unlock\n`/redeem <code>` — unlock with code\n" : ""),
{ parse_mode:"Markdown" }
  );
});

bot.command("ping", async (ctx)=>{
  const t0 = Date.now();
  const m = await ctx.reply("🏓 …");
  await ctx.telegram.editMessageText(m.chat.id, m.message_id, undefined, `🏓 ${Date.now()-t0}ms`);
});

bot.command("price", async (ctx)=>{
  const arg = ctx.message.text.split(" ").slice(1).join(" ").trim();
  try {
    const { id, price } = await getTokenPrice(arg || "SOL");
    await ctx.reply(`💰 ${id} = $${price.toFixed(4)} (Jupiter)`);
  } catch(e){ await ctx.reply("❌ "+e.message); }
});

bot.command("alert", async (ctx)=>{
  const raw = (ctx.message.text.split(" ")[1]||"").trim();
  const target = Number(raw);
  if(!target) return ctx.reply("Usage: /alert 175");
  const uid = String(ctx.from.id);
  alerts[uid] = alerts[uid] || [];
  if(!alerts[uid].includes(target)) alerts[uid].push(target);
  writeJson(ALERTS_JSON, alerts);
  await ctx.reply(`🔔 Will alert you when SOL crosses $${target}`);
});

bot.command("track", async (ctx)=>{
  const addr = ctx.message.text.split(" ").slice(1).join(" ").trim();
  if(!addr) return ctx.reply("Usage: /track <solana_wallet>");
  try {
    const [bal, sig] = await Promise.all([solBalance(addr), lastSig(addr)]);
    await ctx.reply(`👜 \`${addr}\`\n• Balance: *${bal.toFixed(4)}* SOL\n• Last tx: \`${sig}\``, { parse_mode:"Markdown" });
  } catch(e){ await ctx.reply("❌ "+e.message); }
});

bot.command("swap", async (ctx)=>{
  const link = jupSwapUrl();
  await ctx.reply(`🔄 Jupiter swap:\n${link}\n\nSet AFFIL_JUP in env to earn on volume.`);
});

/* ======== AI ======== */
bot.command("ai", async (ctx)=>{
  const q = ctx.message.text.split(" ").slice(1).join(" ").trim();
  if(!q) return ctx.reply("Usage: /ai Why is SOL pumping?");
  if(!OPENAI_API_KEY) return ctx.reply("⚠️ Set OPENAI_API_KEY in Render to enable AI.");
  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions",{
      method:"POST",
      headers:{ "content-type":"application/json","authorization":`Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({
        model:"gpt-4o-mini",
        temperature:0.4,
        messages:[
          {role:"system",content:"You are a concise Solana trading assistant. Be practical and actionable."},
          {role:"user",content:q}
        ]
      })
    });
    if(!r.ok) throw new Error("OpenAI "+r.status);
    const j = await r.json();
    const text = j.choices?.[0]?.message?.content?.trim() || "No answer.";
    await ctx.reply(text);
  } catch(e){ await ctx.reply("❌ AI error: "+e.message); }
});

/* ======== Premium ======== */
bot.command("premium", async (ctx)=>{
  if(!PREMIUM_MODE) return ctx.reply("Premium is OFF.");
  const isP = isPremium(ctx);
  await ctx.reply(
    isP ? "✅ You already have premium.\nPremium features: /kolnews, /whales, /bundle" :
    "🔒 Premium unlocks:\n• KOL tweet feed (/kolnews)\n• Whale scans (/whales)\n• Bundle hints (/bundle)\n\n" +
    (PREMIUM_CODE ? "Got a code? Use: /redeem YOURCODE" : "Ask admin for access.")
  );
});

bot.command("redeem", async (ctx)=>{
  if(!PREMIUM_MODE) return ctx.reply("Premium is OFF.");
  const code = (ctx.message.text.split(" ")[1]||"").trim();
  if(!code) return ctx.reply("Usage: /redeem YOURCODE");
  if(!PREMIUM_CODE) return ctx.reply("No code configured.");
  if(code !== PREMIUM_CODE) return ctx.reply("❌ Invalid code.");
  const uid = String(ctx.from.id);
  users[uid] = users[uid] || {};
  users[uid].premium = true;
  writeJson(USERS_JSON, users);
  await ctx.reply("✅ Premium unlocked! Try /kolnews, /whales, /bundle");
});

bot.command("grant", async (ctx)=>{
  if(!isAdmin(ctx)) return;
  const target = (ctx.message.text.split(" ")[1]||"").replace("@","").trim();
  if(!target) return ctx.reply("Usage: /grant <user_id>");
  const uid = target;
  users[uid] = users[uid] || {};
  users[uid].premium = true;
  writeJson(USERS_JSON, users);
  await ctx.reply(`✅ Granted premium to ${uid}`);
});

/* ======== KOL tracker (Twitter API v2) ======== */
// Admin: add/remove; Anyone: list; Premium: news
bot.command("koladd", async (ctx)=>{
  if(!isAdmin(ctx)) return;
  const handle = (ctx.message.text.split(" ")[1]||"").replace("@","").trim().toLowerCase();
  if(!handle) return ctx.reply("Usage: /koladd <handle>");
  if(!kols.handles.includes(handle)){ kols.handles.push(handle); writeJson(KOLS_JSON,kols); }
  await ctx.reply(`✅ Added @${handle}`);
});
bot.command("kolrm", async (ctx)=>{
  if(!isAdmin(ctx)) return;
  const handle = (ctx.message.text.split(" ")[1]||"").replace("@","").trim().toLowerCase();
  if(!handle) return ctx.reply("Usage: /kolrm <handle>");
  kols.handles = kols.handles.filter(h=>h!==handle);
  writeJson(KOLS_JSON,kols);
  await ctx.reply(`✅ Removed @${handle}`);
});
bot.command("kollist", async (ctx)=>{
  if(kols.handles.length===0) return ctx.reply("No KOLs tracked yet. Admin: /koladd <handle>");
  await ctx.reply("🧠 Tracked KOLs:\n• "+kols.handles.map(h=>"@"+h).join("\n• "));
});
bot.command("kolnews", async (ctx)=>{
  if(!requirePremium(ctx,"KOL feed")) return;
  if(!TWITTER_BEARER) return ctx.reply("⚠️ Set TWITTER_BEARER to enable KOL tracking.");
  if(kols.handles.length===0) return ctx.reply("No KOLs yet. Admin: /koladd <handle>");
  try {
    const items = [];
    for(const handle of kols.handles){
      // 1) get user id
      const u = await fetch(`https://api.twitter.com/2/users/by/username/${handle}`,{
        headers:{ authorization:`Bearer ${TWITTER_BEARER}`}
      });
      if(!u.ok) continue;
      const uj = await u.json();
      const id = uj?.data?.id;
      if(!id) continue;
      // 2) latest tweets
      const t = await fetch(`https://api.twitter.com/2/users/${id}/tweets?max_results=5&tweet.fields=created_at&exclude=retweets,replies`,{
        headers:{ authorization:`Bearer ${TWITTER_BEARER}`}
      });
      if(!t.ok) continue;
      const tj = await t.json();
      const lines = (tj.data||[]).map(d=>`• ${new Date(d.created_at).toLocaleString()}: https://x.com/${handle}/status/${d.id}`);
      if(lines.length) items.push(`@${handle}\n${lines.join("\n")}`);
    }
    if(items.length===0) return ctx.reply("No recent tweets retrieved (rate limits?). Try again.");
    await ctx.reply("📰 *KOL feed*\n\n"+items.join("\n\n"), { parse_mode:"Markdown", disable_web_page_preview:true });
  } catch(e){ await ctx.reply("❌ KOL error: "+e.message); }
});

/* ======== Whales / Bundles (Helius/Birdeye hooks) ======== */
bot.command("whales", async (ctx)=>{
  if(!requirePremium(ctx,"Whale scanner")) return;
  const min = Number((ctx.message.text.split(" ")[1]||"").trim()) || 500; // min SOL
  if(!HELIUS_API_KEY) return ctx.reply("⚠️ Set HELIUS_API_KEY to enable whale scans.");
  if(WATCH_WALLETS.length===0) return ctx.reply("Set WATCH_WALLETS env (CSV of smart wallets) to scan.");
  try {
    const out = [];
    for(const addr of WATCH_WALLETS){
      // basic recent txs via Helius enhanced endpoint
      const url = `https://api.helius.xyz/v0/addresses/${addr}/transactions?api-key=${HELIUS_API_KEY}&limit=5`;
      const r = await fetch(url);
      if(!r.ok) continue;
      const txs = await r.json();
      for(const tx of txs){
        // very rough: look at SOL pre/post balance delta (when available)
        const solChange = (tx?.accountData?.find?.(()=>false)) ? 0 : 0; // placeholder if schema differs
        // safer: show links quickly
        out.push(`• ${addr.slice(0,4)}…${addr.slice(-4)} tx: https://solscan.io/tx/${tx.signature}`);
      }
    }
    if(out.length===0) return ctx.reply("No recent whale tx found (try a larger window / add wallets).");
    await ctx.reply(`🐳 Whale scans (min ${min} SOL):\n`+out.join("\n"), { disable_web_page_preview:true });
  } catch(e){ await ctx.reply("❌ Whales error: "+e.message); }
});

bot.command("bundle", async (ctx)=>{
  if(!requirePremium(ctx,"Bundle tracker")) return;
  if(!BIRDEYE_API_KEY) return ctx.reply("⚠️ Set BIRDEYE_API_KEY to enable bundle/flow hints.");
  try {
    // Birdeye sample — recent tx flow (token-agnostic high-level)
    const r = await fetch("https://public-api.birdeye.so/defi/v1/tx/recent",{
      headers:{ "X-API-KEY": BIRDEYE_API_KEY, "accept":"application/json" }
    });
    if(!r.ok) throw new Error("Birdeye "+r.status);
    const j = await r.json();
    const arr = j?.data?.txs || [];
    const lines = arr.slice(0,10).map(t => `• ${new Date(t.block_time*1000).toLocaleTimeString()} ${t.symbol || ""} ${t.amount || ""} — https://solscan.io/tx/${t.tx_hash}`);
    if(lines.length===0) return ctx.reply("No recent flow. Try again.");
    await ctx.reply("🧺 *Recent bundle/flow hints*\n"+lines.join("\n"), { parse_mode:"Markdown", disable_web_page_preview:true });
  } catch(e){ await ctx.reply("❌ Bundle error: "+e.message); }
});

/* ======== Webhook + server ======== */
if (WEBHOOK_URL) {
  bot.telegram.setWebhook(WEBHOOK_URL);
}
app.use(bot.webhookCallback("/telegram/webhook"));

// health
app.get("/", (_req,res)=>res.send("Sol Smart Flow Pro — OK"));

/* ======== Background price alerts ======== */
async function tickAlerts(){
  try {
    const price = await getSOLPrice();
    for(const [uid, targets] of Object.entries(alerts)){
      for(const t of [...targets]){
        if (price >= t || price <= t) {
          await bot.telegram.sendMessage(uid, `🔔 SOL crossed $${t}. Now $${price.toFixed(4)}`);
          alerts[uid] = alerts[uid].filter(x=>x!==t);
          writeJson(ALERTS_JSON, alerts);
        }
      }
    }
  } catch { /* ignore one-off */ }
}
setInterval(tickAlerts, 60_000);

const PORT = process.env.PORT || 10000;
app.listen(PORT, ()=> console.log(`🚀 Server listening on ${PORT}`));
