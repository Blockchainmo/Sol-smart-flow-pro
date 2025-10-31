const express = require("express");
const bodyParser = require("body-parser");
const { Telegraf } = require("telegraf");

const BOT_TOKEN = process.env.TG_BOT_TOKEN;
const ADMIN_USER_IDS = process.env.ADMIN_USER_IDS || "";
const WEBHOOK_URL =
  process.env.WEBHOOK_URL ||
  "https://sol-smart-flow-pro.onrender.com/telegram/webhook";

if (!BOT_TOKEN) {
  console.error("Missing TG_BOT_TOKEN env var");
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

bot.start((ctx) => ctx.reply("👋 Hello from Sol SmartFlow bot. Type /help"));
bot.command("help", (ctx) =>
  ctx.reply("🧭 Commands:\n• /status\n• /ping")
);
bot.command("status", (ctx) => ctx.reply("✅ Bot is online and running fine."));
bot.command("ping", async (ctx) => {
  const t = Date.now();
  const m = await ctx.reply("🏓 Ping...");
  const ms = Date.now() - t;
  ctx.telegram.editMessageText(m.chat.id, m.message_id, undefined, `🏓 Pong! ${ms}ms`);
});
bot.on("text", (ctx) => ctx.reply("🤖 Try /help"));

const app = express();
app.use(bodyParser.json());
app.post("/telegram/webhook", (req, res) => {
  bot.handleUpdate(req.body);
  res.status(200).send("OK");
});
app.get("/", (_, res) => res.send("Sol SmartFlow PRO running"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`✅ Server running on port ${PORT}`);
  try {
    await bot.telegram.setWebhook(WEBHOOK_URL);
    console.log("✅ Webhook set:", WEBHOOK_URL);
  } catch (e) {
    console.error("❌ Failed to set webhook:", e.message);
  }
});
