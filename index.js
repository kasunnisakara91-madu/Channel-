require("dotenv").config();

const express = require("express");
const path = require("path");
const fs = require("fs");
const pino = require("pino");

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} = require("@whiskeysockets/baileys");

const config = require("./config");

const {
  connectDatabase,
  isConnected
} = require("./lib/database");

const app = express();

const PORT = config.port;

const SESSION_DIR =
  path.join(__dirname, "session");

fs.mkdirSync(
  SESSION_DIR,
  {
    recursive: true
  }
);

app.use(express.json());

app.use(
  express.urlencoded({
    extended: true
  })
);

let sock = null;

let pairingInProgress = false;

let reconnectTimer = null;

const botStatus = {
  status: "OFFLINE",
  connected: false,
  phone: "",
  startedAt: null,
  lastError: ""
};

global.autoRead = false;


/*
==================================================
                    WEB PAGE
==================================================
*/

app.get("/", (req, res) => {

  res.sendFile(
    path.join(
      __dirname,
      "main.html"
    )
  );

});


/*
==================================================
                    HEALTH
==================================================
*/

app.get(
  "/health",
  (req, res) => {

    res.status(200).json({
      ok: true
    });

  }
);


/*
==================================================
                  STATUS API
==================================================
*/

app.get(
  "/api/status",
  (req, res) => {

    res.json({

      success: true,

      bot: {

        name:
          config.botName,

        owner:
          config.ownerName,

        ownerNumber:
          config.ownerNumber,

        prefix:
          config.prefix

      },

      status:
        botStatus,

      database: {

        connected:
          isConnected()

      },

      autoread:
        global.autoRead

    });

  }
);


/*
==================================================
               NUMBER FORMAT
==================================================
*/

function normalizePhone(value) {

  let phone =
    String(value || "")
      .replace(/\D/g, "");

  if (
    phone.startsWith("0")
  ) {

    phone =
      "94" +
      phone.substring(1);

  }

  if (
    !phone.startsWith("94")
  ) {

    phone =
      "94" +
      phone;

  }

  return phone;

}


/*
==================================================
                 PAIR API
==================================================
*/

app.post(
  "/api/pair",
  async (req, res) => {

    if (pairingInProgress) {

      return res.status(409).json({

        success: false,

        message:
          "Pairing already running."

      });

    }


    if (botStatus.connected) {

      return res.status(409).json({

        success: false,

        message:
          "Bot is already online."

      });

    }


    const phone =
      normalizePhone(
        req.body.phone
      );


    if (
      !/^94\d{9}$/.test(phone)
    ) {

      return res.status(400).json({

        success: false,

        message:
          "Invalid Sri Lankan number."

      });

    }


    pairingInProgress = true;

    botStatus.status =
      "PAIRING";

    botStatus.phone =
      phone;

    botStatus.lastError =
      "";


    try {

      const code =
        await startBot(
          phone
        );


      res.json({

        success: true,

        code:
          code,

        phone:
          phone

      });


    } catch (error) {

      botStatus.status =
        "ERROR";

      botStatus.lastError =
        error.message;


      console.log(
        "Pairing error:",
        error.message
      );


      res.status(500).json({

        success: false,

        message:
          error.message

      });


    } finally {

      pairingInProgress =
        false;

    }

  }
);


/*
==================================================
                  START BOT
==================================================
*/

async function startBot(
  phoneNumber = null
) {

  const {

    state,

    saveCreds

  } =
    await useMultiFileAuthState(
      SESSION_DIR
    );


  const {

    version

  } =
    await fetchLatestBaileysVersion();


  sock =
    makeWASocket({

      version,

      auth:
        state,

      logger:
        pino({
          level:
            "silent"
        }),

      printQRInTerminal:
        false,

      browser: [

        config.botName,

        "Chrome",

        "1.0.0"

      ],

      generateHighQualityLinkPreview:
        true

    });


  sock.ev.on(
    "creds.update",
    saveCreds
  );


  setupConnection();

  setupMessages();


  if (
    !state.creds.registered &&
    phoneNumber
  ) {

    await new Promise(
      resolve =>
        setTimeout(
          resolve,
          1500
        )
    );


    const code =
      await sock.requestPairingCode(
        phoneNumber
      );


    console.log("");
    console.log(
      "================================"
    );
    console.log(
      " MADUSANKA CHANNEL BOT"
    );
    console.log(
      "================================"
    );
    console.log(
      "Phone:",
      phoneNumber
    );
    console.log(
      "Code:",
      code
    );
    console.log(
      "================================"
    );
    console.log("");


    return code;

  }


  return "";

}


/*
==================================================
              CONNECTION UPDATE
==================================================
*/

function setupConnection() {

  sock.ev.on(
    "connection.update",
    update => {

      const {

        connection,

        lastDisconnect

      } = update;


      if (
        connection ===
        "connecting"
      ) {

        botStatus.status =
          "CONNECTING";

        botStatus.connected =
          false;

        return;

      }


      if (
        connection ===
        "open"
      ) {

        botStatus.status =
          "ONLINE";

        botStatus.connected =
          true;

        botStatus.startedAt =
          Date.now();

        botStatus.lastError =
          "";

        console.log(
          "✅ WhatsApp connected"
        );

        return;

      }


      if (
        connection ===
        "close"
      ) {

        botStatus.connected =
          false;

        botStatus.status =
          "OFFLINE";


        const code =
          lastDisconnect
            ?.error
            ?.output
            ?.statusCode;


        if (
          code ===
          DisconnectReason.loggedOut
        ) {

          botStatus.status =
            "LOGGED OUT";

          console.log(
            "❌ WhatsApp logged out."
          );

          return;

        }


        reconnect();

      }

    }
  );

}


/*
==================================================
                    RECONNECT
==================================================
*/

function reconnect() {

  if (
    reconnectTimer
  ) {

    return;

  }


  console.log(
    "🔄 Reconnecting in 5 seconds..."
  );


  reconnectTimer =
    setTimeout(
      async () => {

        reconnectTimer =
          null;


        try {

          await startBot();

        } catch (error) {

          botStatus.lastError =
            error.message;

          console.log(
            "Reconnect error:",
            error.message
          );

          reconnect();

        }

      },
      5000
    );

}


/*
==================================================
                 MESSAGE TEXT
==================================================
*/

function getText(msg) {

  const message =
    msg.message || {};


  if (
    message.conversation
  ) {

    return message.conversation;

  }


  if (
    message
      .extendedTextMessage
      ?.text
  ) {

    return message
      .extendedTextMessage
      .text;

  }


  if (
    message
      .imageMessage
      ?.caption
  ) {

    return message
      .imageMessage
      .caption;

  }


  if (
    message
      .videoMessage
      ?.caption
  ) {

    return message
      .videoMessage
      .caption;

  }


  return "";

}


/*
==================================================
                 MESSAGE HANDLER
==================================================
*/

function setupMessages() {

  sock.ev.on(
    "messages.upsert",
    async ({
      messages
    }) => {

      for (
        const msg
        of messages
      ) {

        try {

          await handleMessage(
            msg
          );

        } catch (error) {

          console.log(
            "Message error:",
            error.message
          );

        }

      }

    }
  );

}


/*
==================================================
                 HANDLE MESSAGE
==================================================
*/

async function handleMessage(
  msg
) {

  if (
    !msg?.message
  ) {

    return;

  }


  const from =
    msg.key.remoteJid;


  if (
    !from ||
    from ===
    "status@broadcast"
  ) {

    return;

  }


  /*
  ==============================
          AUTO READ
  ==============================
  */

  if (
    global.autoRead
  ) {

    try {

      await sock.readMessages([
        msg.key
      ]);

    } catch {}

  }


  /*
  ==============================
             TEXT
  ==============================
  */

  const text =
    getText(msg)
      .trim();


  if (
    !text.startsWith(
      config.prefix
    )
  ) {

    return;

  }


  const parts =
    text
      .slice(
        config.prefix.length
      )
      .trim()
      .split(/\s+/);


  const command =
    (
      parts.shift() ||
      ""
    ).toLowerCase();


  const args =
    parts;


  /*
  ==============================
             OWNER
  ==============================
  */

  const sender =
    msg.key.participant ||
    msg.key.remoteJid;


  const senderNumber =
    String(sender)
      .split("@")[0];


  const isOwner =
    senderNumber ===
    config.ownerNumber;


  /*
  ==============================
             REPLY
  ==============================
  */

  const reply =
    message => {

      return sock.sendMessage(

        from,

        {
          text:
            message
        },

        {
          quoted:
            msg
        }

      );

    };


  /*
==================================================
                    COMMANDS
==================================================
*/

  switch (
    command
  ) {


    case "menu":

    case "help":

      return reply(`

╭━━━〔 🤖 ${config.botName} 〕━━━╮
┃
┃ 👑 Owner :
┃ ${config.ownerName}
┃
┃ 📱 Number :
┃ ${config.ownerNumber}
┃
┃
┃ 📌 GENERAL
┃
┃ ${config.prefix}menu
┃ ${config.prefix}ping
┃ ${config.prefix}alive
┃ ${config.prefix}owner
┃ ${config.prefix}info
┃
┃
┃ ⚙️ OWNER
┃
┃ ${config.prefix}autoread on
┃ ${config.prefix}autoread off
┃
╰━━━━━━━━━━━━━━━━━━━━━━╯

`);


    case "ping": {

      const start =
        Date.now();


      await reply(
        "🏓 Pong!"
      );


      const speed =
        Date.now() -
        start;


      return reply(
        `⚡ Response: ${speed} ms`
      );

    }


    case "alive":

      return reply(`

╭━━〔 🟢 BOT STATUS 〕━━╮

┃ 🟢 Status :
┃ ONLINE

┃ 🤖 Bot :
┃ ${config.botName}

┃ 👑 Owner :
┃ ${config.ownerName}

┃ ⚡ Engine :
┃ Baileys

┃ 🌐 Web :
┃ ONLINE

┃ 🗄️ MongoDB :
┃ ${
  isConnected()
    ? "CONNECTED"
    : "OFFLINE"
}

╰━━━━━━━━━━━━━━━━━━━━╯

`);


    case "owner":

      return reply(`

╭━━〔 👑 OWNER 〕━━╮

┃ 👤 Name :
┃ ${config.ownerName}

┃ 📱 Number :
┃ ${config.ownerNumber}

╰━━━━━━━━━━━━━━━━━━╯

`);


    case "info":

      return reply(`

╭━━〔 ℹ️ BOT INFO 〕━━╮

┃ 🤖 Name :
┃ ${config.botName}

┃ 👑 Owner :
┃ ${config.ownerName}

┃ 📱 Number :
┃ ${config.ownerNumber}

┃ 🔧 Prefix :
┃ ${config.prefix}

┃ ⚡ Engine :
┃ Baileys

┃ 🗄️ MongoDB :
┃ ${
  isConnected()
    ? "CONNECTED"
    : "OFFLINE"
}

╰━━━━━━━━━━━━━━━━━━━━╯

`);


    case "autoread":

      if (!isOwner) {

        return reply(
          "❌ Owner Only!"
        );

      }


      if (
        args[0] ===
        "on"
      ) {

        global.autoRead =
          true;

        return reply(
          "✅ Auto Read ON"
        );

      }


      if (
        args[0] ===
        "off"
      ) {

        global.autoRead =
          false;

        return reply(
          "❌ Auto Read OFF"
        );

      }


      return reply(`

📖 AUTO READ

${config.prefix}autoread on

${config.prefix}autoread off

Current:
${
  global.autoRead
    ? "🟢 ON"
    : "🔴 OFF"
}

`);


    default:

      return reply(
        `❌ Unknown command.\nType ${config.prefix}menu`
      );

  }

}


/*
==================================================
                  START SERVER
==================================================
*/

async function startServer() {

  /*
  ==============================
          MONGODB
  ==============================
  */

  await connectDatabase(
    config.mongoUrl
  );


  /*
  ==============================
            SERVER
  ==============================
  */

  app.listen(
    PORT,
    "0.0.0.0",
    () => {

      console.log("");
      console.log(
        "================================"
      );
      console.log(
        " MADUSANKA CHANNEL BOT"
      );
      console.log(
        "================================"
      );
      console.log(
        `🌐 Port: ${PORT}`
      );
      console.log(
        `🤖 Bot: ${config.botName}`
      );
      console.log(
        `👑 Owner: ${config.ownerName}`
      );
      console.log(
        "================================"
      );

    }
  );


  /*
  ==============================
       EXISTING SESSION
  ==============================
  */

  const {
    state
  } =
    await useMultiFileAuthState(
      SESSION_DIR
    );


  if (
    state.creds.registered
  ) {

    console.log(
      "🔄 Existing session found."
    );


    try {

      await startBot();

    } catch (error) {

      console.log(
        "Session error:",
        error.message
      );

    }

  } else {

    console.log(
      "ℹ️ No session found."
    );

    console.log(
      "Use the web panel to pair."
    );

  }

}


startServer()
  .catch(error => {

    console.error(
      "Fatal error:",
      error
    );

    process.exit(1);

  });
