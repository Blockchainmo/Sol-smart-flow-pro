// index.js — Sol Smart Flow Pro (drop-in full file)
// Node 18+ (global fetch) — works on Render Free

const express = require("express");
const bodyParser = require("body-parser");
const { Telegraf } = require("telegraf");

// ---------- ENV ----------
const BOT_TOKEN       = process.env.TG_BOT_TOKEN;
const ADMIN_USER_IDS  = (process.env.ADMIN_USER_IDS || "").split(",").map(s=>s.trim()).filter(Boolean);
const WEBHOOK_URL     = process.env.WEBHOOK_URL || ""; // e.g. https://sol-smart-flow-pro.onrender.com/telegram/webhook
const HELIUS_API_KEY  = process.env.HELIUS_API_KEY || "";
const BIRDEYE_API_KEY = process.env.BIRDEYE_API_KEY || "";
const OPENAI_API_KEY  = process.env.OPENAI_API_KEY || "";
const PREMIUM_SECRET  = process.env.PREMIUM_SECRET || ""; // optional
const PREMIUM_USERS   = (process.env.PREMIUM_USERS || "").split(",").map(s=>s.trim()).filter(Boolean);
// Comma-separated list of wallets to watch (KOLs/whales)
const KOL_WALLETS     = (process.env.KOL_WALLETS || "").split(",").map(s=>s.trim()).filter(Boolean);

// ---------- GUARDS ----------
function log(...a){ console.log(new Date().toISOString(), ...a); }

if(!BOT_TOKEN){ log("❌ Missing TG_BOT_TOKEN"); process.exit(1); }
if(!WEBHOOK_URL){ log("❌ Missing WEBHOOK_URL"); process.exit(1); }

const bot = new Telegraf(BOT_TOKEN);

// ---------- HELPERS ----------
const isAdmin = (id) => ADMIN_USER_IDS.includes(String(id));
const isPremium = (id) => PREMIUM_USERS.includes(String(id));

async function aiExplain(text){
  if(!OPENAI_API_KEY) return "";
  try{
    const r = await fetch("https://api.openai.com/v1/chat/completions",{
      method:"POST",
      headers:{
        "Content-Type":"application/json",
        "Authorization":`Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model:"gpt-4o-mini",
        messages:[{role:"user", content:text}],
        temperature:0.4
      })
    });
    const j = await r.json();
    return j?.choices?.[0]?.message?.content?.trim() || "";
  }catch(e){
    log("AI error", e.message);
    return "";
  }
}

async function heliusTxs(address){
  if(!HELIUS_API_KEY) return [];
  try{
    const url = `https://api.helius.xyz/v0/addresses/${address}/transactions?api-key=${HELIUS_API_KEY}&limit=5`;
    const r = await fetch(url);
    return await r.json();
  }catch(e){
    log("Helius fetch error", e.message);
    return [];
  }
}

async function birdeyeTokenInfo(mint){
  if(!BIRDEYE_API_KEY || !mint) return null;
  try{
    const r = await fetch(`https://public-api.birdeye.so/defi/price?address=${mint}`,{
      headers:{ "X-API-KEY": BIRDEYE_API_KEY, "accept":"application/json" }
    });
    const j = await r.json();
    return j?.data || null;
  }catch(e){
    log("Birdeye error", e.message);
    return null;
  }
}

// ---------- BASIC COMMANDS ----------
bot.start(async (ctx)=>{
  const u = ctx.from?.id;
  await ctx.reply(
`👋 Hello from Sol Smart Flow Pro!
Commands:
/help – show help
/ping – quick check
/status – service status

Admin:
/admin – admin check
/watchlist – show KOL wallets
/preview <MINT> – quick Birdeye price
`, { disable_web_page_preview:true });
  log("START from", u);
});

bot.help((ctx)=> ctx.reply("Use /ping /status. Admins get /watchlist and auto alerts."));

bot.command("ping", (ctx)=> ctx.reply("🏓 pong"));
bot.command("status", (ctx)=> ctx.reply("✅ Live, webhook set, monitoring on"));

// ---------- ADMIN COMMANDS ----------
bot.command("admin", (ctx)=>{
  const uid = String(ctx.from.id);
  ctx.reply(isAdmin(uid) ? "🛡️ You are admin." : "⛔ Not admin.");
});

bot.command("watchlist", async (ctx)=>{
  const uid = String(ctx.from.id);
  if(!isAdmin(uid)) return ctx.reply("⛔ Admin only.");
  if(!KOL_WALLETS.length) return ctx.reply("No KOL_WALLETS configured.");
  await ctx.reply(`👀 Watching:\n${KOL_WALLETS.join("\n")}`);
});

bot.command("preview", async (ctx)=>{
  const uid = String(ctx.from.id);
  if(!isAdmin(uid) && !isPremium(uid)) return ctx.reply("🔒 Premium only. Ask admin for access.");
  const parts = ctx.message.text.split(/\s+/);
  const mint = parts[1];
  if(!mint) return ctx.reply("Usage: /preview <MINT_ADDRESS>");
  const info = await birdeyeTokenInfo(mint);
  if(!info) return ctx.reply("No data from Birdeye.");
  const price = info?.value || info?.price || info?.priceUsd || "n/a";
  await ctx.reply(`💡 ${mint}\nApprox price: ${price}`);
});

// ---------- EXPRESS SERVER ----------
const app = express();
app.use(bodyParser.json());
app.use(bot.webhookCallback("/telegram/webhook"));
app.get("/", (_,res)=>res.send("✅ Sol Smart Flow Pro Bot is Live"));
app.get("/health", (_,res)=>res.json({ ok:true, uptime:process.uptime() }));

bot.telegram.setWebhook(WEBHOOK_URL);
app.listen(10000, ()=> log("🚀 Server running on 10000"));
log("Webhook set to", WEBHOOK_URL);

// ---------- AUTO-SIGNAL LOOP (KOL + WHALE MONITOR) ----------
const SIGNAL_INTERVAL = 60 * 1000; // 60s

async function signalLoop(){
  if(!KOL_WALLETS.length || !HELIUS_API_KEY) return;
  for(const wallet of KOL_WALLETS){
    const txs = await heliusTxs(wallet);
    if(!Array.isArray(txs)) continue;
    for(const tx of txs){
      const sig  = tx.signature || tx?.transactionHash || "unknown";
      const type = tx?.type || "";
      const ts   = tx?.timestamp ? new Date(tx.timestamp*1000).toLocaleTimeString() : "";
      if(type.includes("SWAP") || type.includes("TRANSFER") || type.includes("TRADE")){
        const msg = `📈 KOL Activity
🧠 Wallet: ${wallet}
🕒 Time: ${ts}
🔁 Type: ${type}
🔗 Tx: https://solscan.io/tx/${sig}`;
        // send to first admin (and broadcast to all admins if you like)
        for(const admin of ADMIN_USER_IDS){
          await bot.telegram.sendMessage(admin, msg, { disable_web_page_preview:true }).catch(()=>{});
        }
        // optional AI explanation
        const ai = await aiExplain(`Explain this Solana transaction briefly for short-term traders:\n${msg}`);
        if(ai){
          for(const admin of ADMIN_USER_IDS){
            await bot.telegram.sendMessage(admin, `🤖 AI Insight:\n${ai}`).catch(()=>{});
          }
        }
      }
    }
  }
}

setInterval(signalLoop, SIGNAL_INTERVAL);
log("🚨 Auto-signal loop started (60s)");

// ---------- UTILS ----------
process.on("uncaughtException", (e)=> log("UNCAUGHT", e));
process.on("unhandledRejection", (e)=> log("REJECTED", e));
