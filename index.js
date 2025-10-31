const express = require("express");
const bodyParser = require("body-parser");
const { Telegraf } = require("telegraf");
const fetch = require("node-fetch");

const BOT_TOKEN = process.env.TG_BOT_TOKEN;
const ADMIN_USER_IDS = (process.env.ADMIN_USER_IDS || "")
  .split(",").map(s=>s.trim()).filter(Boolean);
const WEBHOOK_URL = process.env.WEBHOOK_URL ||
  "https://sol-smart-flow-pro.onrender.com/telegram/webhook";

if (!BOT_TOKEN) { console.error("Missing TG_BOT_TOKEN"); process.exit(1); }

const bot = new Telegraf(BOT_TOKEN);

function logCtx(ctx, tag="MSG"){
  const u=ctx.from; console.log(`[${tag}] ${u?.id} @${u?.username||""} -> ${ctx.message?.text||ctx.updateType}`);
}
bot.start(ctx=>{ logCtx(ctx,"START"); return ctx.reply("👋 Hello from Sol SmartFlow bot! Type /help"); });
bot.help(ctx=>ctx.reply(["/start","/help","/status","/ping","/id","/echo <text>","/price"].join("\n")));
bot.command("status", async ctx=>{
  logCtx(ctx,"STATUS"); const t0=Date.now(); const m=await ctx.reply("⏳ Checking…");
  await ctx.telegram.editMessageText(m.chat.id,m.message_id,undefined,`✅ Up. Latency ~ ${Date.now()-t0}ms`);
});
bot.command("ping", ctx=>ctx.reply("🏓 pong"));
bot.command("id", ctx=>ctx.reply(`👤 Your ID: \`${ctx.from.id}\``,{parse_mode:"Markdown"}));
bot.command("echo", ctx=>{
  const msg=(ctx.message?.text||"").replace(/^\/echo\s*/,""); if(!msg) return ctx.reply("Use: /echo hello");
  return ctx.reply(msg);
});
bot.command("price", async ctx=>{
  try{
    const r=await fetch("https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd");
    const j=await r.json(); const usd=j.solana?.usd; if(!usd) throw 0; await ctx.reply(`💸 SOL price: $${usd}`);
  }catch{ await ctx.reply("⚠️ Couldn’t fetch price, try again."); }
});
bot.on("text", ctx=>{ logCtx(ctx,"TEXT"); return ctx.reply("✅ Bot received your message!"); });

const app = express();
app.use(bodyParser.json());
app.get("/",(_,res)=>res.send("OK"));
app.use(bot.webhookCallback("/telegram/webhook"));

const PORT=process.env.PORT||3000;
app.listen(PORT, async ()=>{
  console.log(`✅ Server is running on :${PORT}`);
  try{ await bot.telegram.setWebhook(WEBHOOK_URL); console.log(`🔗 Webhook set to ${WEBHOOK_URL}`); }
  catch(e){ console.error("Webhook set failed:",e); }
});
  }
});
