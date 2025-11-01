require("dotenv").config();
const axios = require("axios");

// Telegram bot details
const token = process.env.TG_BOT_TOKEN;
const chatId = process.env.ADMIN_USER_ID;

// Simple delay helper
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function sendMessage(text) {
  try {
    await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
      chat_id: chatId,
      text,
      parse_mode: "HTML",
    });
  } catch (err) {
    console.error("❌ Telegram send error:", err.message);
  }
}

// Listen for new Pump.fun tokens
async function watchPumpFun() {
  console.log("👀 Watching Pump.fun...");
  await sendMessage("🚀 Pump.fun Watcher is now active!");

  let lastSeen = "";

  while (true) {
    try {
      const res = await axios.get("https://pump.fun/api/trending?limit=1");
      const tokenData = res.data[0];

      if (tokenData && tokenData.mint !== lastSeen) {
        lastSeen = tokenData.mint;

        const msg = `
🔥 <b>New Pump.fun Token!</b>
💰 <b>Name:</b> ${tokenData.name}
🔤 <b>Symbol:</b> ${tokenData.symbol}
🌐 <b>Mint:</b> ${tokenData.mint}
📈 <b>Market Cap:</b> $${tokenData.marketCap?.toLocaleString() || "N/A"}
`;

        await sendMessage(msg);
      }
    } catch (e) {
      console.log("⚠️ Error fetching Pump.fun:", e.message);
    }

    await sleep(10000); // check every 10s
  }
}

watchPumpFun();
