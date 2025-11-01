const express = require("express");
const bodyParser = require("body-parser");
const { Telegraf } = require("telegraf");

// Load environment variables
const BOT_TOKEN = process.env.TG_BOT_TOKEN;
const ADMIN_USER_IDS = (process.env.ADMIN_USER_IDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const WEBHOOK_URL = process.env.WEBHOOK_URL;

// Create bot and Express app
const bot = new Telegraf(BOT_TOKEN);
const app = express();

// Middleware
app.use(bodyParser.json());
app.use(bot.webhookCallback("/telegram/webhook"));

// ✅ Set the webhook (so Telegram knows where to send messages)
bot.telegram.setWebhook(WEBHOOK_URL);

// ✅ Simple test route
app.get("/", (req, res) => {
  res.send("✅ Sol Smart Flow Bot is running!");
});

// ✅ Example command
bot.start((ctx) => {
  ctx.reply("👋 Hello, I'm your Sol Smart Flow Bot — fully online and working!");
});

// ✅ Optional admin check command
bot.command("admin", (ctx) => {
  const userId = String(ctx.from.id);
  if (ADMIN_USER_IDS.includes(userId)) {
    ctx.reply("✅ You have admin access!");
  } else {
    ctx.reply("❌ Sorry, you're not an admin.");
  }
});

// ✅ Start the Express server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server is running on port ${PORT}`);
});
