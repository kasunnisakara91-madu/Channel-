const mongoose = require("mongoose");

async function connectDatabase(uri) {
  if (!uri) {
    console.log("ℹ️ MONGO_URL not set - continuing without MongoDB.");
    return false;
  }

  try {
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 10000
    });

    console.log("✅ MongoDB connected");
    return true;

  } catch (error) {
    console.log(
      "⚠️ MongoDB connection failed:",
      error.message
    );

    return false;
  }
}

function isConnected() {
  return mongoose.connection.readyState === 1;
}

module.exports = {
  connectDatabase,
  isConnected
};
