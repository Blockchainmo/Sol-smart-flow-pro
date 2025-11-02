// watch-config.js
module.exports = {
  MCAP_JUMP_PCT: Number(process.env.MCAP_JUMP_PCT || 25),
  WINDOW_MIN: Number(process.env.WINDOW_MIN || 5),
  TREND_EVERY_MIN: Number(process.env.TREND_EVERY_MIN || 5),
  TREND_COUNT: Number(process.env.TREND_COUNT || 10),
};
