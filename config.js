require("dotenv").config();

module.exports = {
  botName: process.env.BOT_NAME || "MADUSANKA CHANNEL BOT",
  ownerName: process.env.OWNER_NAME || "MADUSANKA",
  ownerNumber: String(
    process.env.OWNER_NUMBER || "94756331255"
  ).replace(/\D/g, ""),
  prefix: process.env.PREFIX || ".",
  port: Number(process.env.PORT || 8000),
  mongoUrl: process.env.MONGO_URL || ""
};
