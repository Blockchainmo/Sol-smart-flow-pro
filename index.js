const express = require("express");
const bodyParser = require("body-parser");
const { Telegraf } = require("telegraf");

const BOT_TOKEN = process.env.TG_BOT_TOKEN;
const ADMIN_USER_IDS = process.env.ADMIN_USER_IDS?.split(",") || [];
const bot = new Telegraf(BOT_TOKEN);

bot.start((ctx) => ctx.reply("👋 Hello from Sol SmartFlow bot. Type /help to see commands!"));
bot.command("help", (ctx) => ctx.reply("🧭 Commands:\n• /status – check if I’m online\n• /ping – test my speed"));
bot.command("status", (ctx) => ctx.reply("✅ Bot is online and running fine."));
bot.command("ping", async (ctx) => {
  const start = Date.now();
  const msg = await ctx.reply("🏓 Ping...");
  const latency = Date.now() - start;
  ctx.telegram.editMessageText(msg.chat.id, msg.message_id, undefined, `🏓 Pong! ${latency}ms`);
});
bot.on("text", (ctx) => ctx.reply("🤖 Try /help"));

const app = express();
app.use(bodyParser.json());
app.post("/telegram/webhook", (req, res) => {
  bot.handleUpdate(req.body, res);
});
app.get("/", (_, res) => res.send("Sol SmartFlow PRO bot is active"));
app.listen(process.env.PORT || 10000, () => console.log("✅ Server is running"));
