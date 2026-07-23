require("dotenv").config();

const fs = require("fs");
const path = require("path");
const TelegramBot = require("node-telegram-bot-api").TelegramBot;
const sqlite3 = require("sqlite3").verbose();
const express = require("express");
const cors = require("cors");
const { MongoClient } = require("mongodb");
const createRouter = require("./routes");
const parseRelineCommand = require("./lib/parse-reline-command");

process.chdir(__dirname);

const lockFile = path.join(__dirname, ".bot.lock");

function acquireLock() {
  if (fs.existsSync(lockFile)) {
    const existingPid = fs.readFileSync(lockFile, "utf8").trim();
    if (existingPid) {
      try {
        process.kill(existingPid, 0);
        console.error(`Another bot instance is already running with PID ${existingPid}.`);
        process.exit(1);
      } catch (error) {
        fs.unlinkSync(lockFile);
      }
    }
  }

  fs.writeFileSync(lockFile, String(process.pid));
}

function releaseLock() {
  try {
    if (fs.existsSync(lockFile)) {
      fs.unlinkSync(lockFile);
    }
  } catch (error) {
    console.error("Failed to remove lock file:", error.message);
  }
}

acquireLock();
process.on("exit", releaseLock);
process.on("SIGINT", () => {
  releaseLock();
  process.exit(0);
});
process.on("SIGTERM", () => {
  releaseLock();
  process.exit(0);
});

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const firstUserPerUtcShiftEnabled = process.env.FIRST_USER_PER_UTC_SHIFT !== "false";
// Test/prod can choose UTC shift boundaries without depending on server local time.
const utcShiftStartHours = parseUtcShiftStartHours(process.env.UTC_SHIFT_START_HOURS);

let mongoClient = null;
let mongoDb = null;
let mongoConnectPromise = null;

function connectMongo() {
  if (mongoDb) return Promise.resolve(mongoDb);
  if (mongoConnectPromise) return mongoConnectPromise;

  const mongoUri = process.env.MONGODB_URI || "mongodb://root:example@127.0.0.1:27017/reline-bot?authSource=admin";

  mongoConnectPromise = (async () => {
    const client = new MongoClient(mongoUri, {
      serverSelectionTimeoutMS: 5000,
    });

    try {
      await client.connect();

      const parsedUri = new URL(mongoUri);
      const dbName = parsedUri.pathname.replace(/^\/+/, "") || "reline-bot";
      const db = client.db(dbName);

      await db.collection("reline_logs").createIndex({ createdAt: -1 });
      await db.collection("reline_logs").createIndex({ monthKey: 1, chatId: 1 });
      await db.collection("reline_shift_locks").createIndex(
        { lockScope: 1, shiftKey: 1 },
        {
          unique: true,
          partialFilterExpression: {
            lockScope: { $exists: true },
            shiftKey: { $exists: true },
          },
        }
      );

      mongoClient = client;
      mongoDb = db;
      console.log("MongoDB connected");
      return mongoDb;
    } catch (error) {
      await client.close().catch(() => {});
      mongoConnectPromise = null;
      console.error("MongoDB connection failed:", error.message);
      throw error;
    }
  })();

  return mongoConnectPromise;
}

async function saveRelineToMongo(payload) {
  const db = await connectMongo();
  await db.collection("reline_logs").insertOne({
    ...payload,
    createdAt: new Date(),
  });
}

async function acquireShiftLock(payload) {
  if (!firstUserPerUtcShiftEnabled) {
    return true;
  }

  const db = await connectMongo();

  try {
    // Atomic upsert guarantees only one message can create the global UTC shift lock.
    const result = await db.collection("reline_shift_locks").findOneAndUpdate(
      {
        lockScope: "global",
        shiftKey: payload.shiftKey,
      },
      {
        $setOnInsert: {
          lockScope: "global",
          shiftKey: payload.shiftKey,
          shiftLabel: payload.shift,
          shiftStart: payload.shiftStart,
          shiftEnd: payload.shiftEnd,
          telegramId: payload.telegramId,
          username: payload.username,
          fullname: payload.fullname,
          chatId: payload.chatId,
          chatTitle: payload.chatTitle,
          text: payload.text,
          messageId: payload.messageId,
          createdAt: new Date(),
        },
      },
      {
        upsert: true,
        returnDocument: "after",
        includeResultMetadata: true,
      }
    );

    return Boolean(result.lastErrorObject && result.lastErrorObject.upserted);
  } catch (error) {
    if (error && error.code === 11000) {
      return false;
    }

    throw error;
  }
}

connectMongo().catch((error) => {
  console.error("MongoDB startup warning:", error.message);
});

if (!process.env.BOT_TOKEN || process.env.BOT_TOKEN.includes("YOUR_BOT_TOKEN")) {
  console.error("BOT_TOKEN is missing or still using the placeholder value.");
  process.exit(1);
}

const bot = new TelegramBot(process.env.BOT_TOKEN, {
  polling: true,
});

bot.on("polling_error", (error) => {
  console.error("Polling error:", error.message);
});

bot.deleteWebhook().catch((error) => {
  console.error("Failed to clear webhook:", error.message);
});

const db = new sqlite3.Database(path.join(__dirname, "reline.db"));

function initDb() {
  db.serialize(() => {
    db.run(`
      CREATE TABLE IF NOT EXISTS reline_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        telegram_id TEXT,
        username TEXT,
        fullname TEXT,
        reline_time TEXT,
        shift TEXT,
        month_key TEXT,
        chat_id TEXT,
        chat_title TEXT
      )
    `);

    db.all("PRAGMA table_info(reline_logs)", (err, columns) => {
      if (err) {
        console.error(err);
        return;
      }

      const hasMonthKey = columns.some((column) => column.name === "month_key");
      if (!hasMonthKey) {
        db.run("ALTER TABLE reline_logs ADD COLUMN month_key TEXT", (alterErr) => {
          if (alterErr && !/duplicate column name/i.test(alterErr.message)) {
            console.error(alterErr);
          }
        });
      }

      const hasChatId = columns.some((column) => column.name === "chat_id");
      if (!hasChatId) {
        db.run("ALTER TABLE reline_logs ADD COLUMN chat_id TEXT", (alterErr) => {
          if (alterErr && !/duplicate column name/i.test(alterErr.message)) {
            console.error(alterErr);
          }
        });
      }

      const hasChatTitle = columns.some((column) => column.name === "chat_title");
      if (!hasChatTitle) {
        db.run("ALTER TABLE reline_logs ADD COLUMN chat_title TEXT", (alterErr) => {
          if (alterErr && !/duplicate column name/i.test(alterErr.message)) {
            console.error(alterErr);
          }
        });
      }
    });
  });
}

initDb();

function parseUtcShiftStartHours(value) {
  const fallback = [5, 11, 17, 23];
  if (!value) return fallback;

  const hours = value
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((hour) => Number.isInteger(hour) && hour >= 0 && hour <= 23);
  const uniqueHours = [...new Set(hours)].sort((a, b) => a - b);

  return uniqueHours.length ? uniqueHours : fallback;
}

function getUtcShiftWindow(date) {
  const start = new Date(date);
  const h = start.getUTCHours();
  const startHour = [...utcShiftStartHours].reverse().find((hour) => h >= hour) ?? utcShiftStartHours[utcShiftStartHours.length - 1];

  if (startHour > h) {
    start.setUTCDate(start.getUTCDate() - 1);
  }

  start.setUTCHours(startHour, 0, 0, 0);

  const nextStartHour = utcShiftStartHours.find((hour) => hour > startHour) ?? utcShiftStartHours[0];
  const end = new Date(start);
  if (nextStartHour <= startHour) {
    end.setUTCDate(end.getUTCDate() + 1);
  }
  end.setUTCHours(nextStartHour, 0, 0, 0);

  const label = `${String(startHour).padStart(2, "0")}-${String(nextStartHour).padStart(2, "0")}`;

  return {
    start,
    end,
    key: start.toISOString(),
    label,
  };
}

function getMonthKey(date) {
  return date.toISOString().slice(0, 7);
}

function getMonthLabel(date) {
  return date.toLocaleDateString("th-TH", { month: "long", year: "numeric" });
}

function getDisplayName(msg) {
  const from = msg.from || {};
  const username = from.username;
  const firstName = from.first_name || "";
  const lastName = from.last_name || "";
  return username || `${firstName} ${lastName}`.trim() || "ผู้ใช้ที่ไม่ทราบชื่อ";
}

function getChatLabel(msg) {
  const chat = msg.chat || {};
  return chat.title || chat.username || (chat.type === "private" ? "แชทส่วนตัว" : "กลุ่ม");
}

function buildMongoMonthMatch(chatId) {
  const monthKey = getMonthKey(new Date());
  const conditions = [
    {
      $or: [
        { monthKey },
        { month_key: monthKey },
      ],
    },
  ];

  if (chatId) {
    conditions.push({
      $or: [
        { chatId: String(chatId) },
        { chat_id: String(chatId) },
      ],
    });
  }

  return { $and: conditions };
}

async function buildMonthlySummary(chatId) {
  const mongo = await connectMongo();
  const rows = await mongo.collection("reline_logs").aggregate([
    { $match: buildMongoMonthMatch(chatId) },
    {
      $group: {
        _id: { $ifNull: ["$telegramId", "$telegram_id"] },
        telegram_id: { $first: { $ifNull: ["$telegramId", "$telegram_id"] } },
        username: { $first: "$username" },
        fullname: { $first: "$fullname" },
        total: { $sum: 1 },
      },
    },
    {
      $project: {
        _id: 0,
        telegram_id: 1,
        username: 1,
        fullname: 1,
        total: 1,
        amount: { $multiply: ["$total", 50] },
      },
    },
    { $sort: { total: -1, fullname: 1, username: 1 } },
  ]).toArray();

  return rows;
}

async function getRelineLogsFromMongo() {
  const mongo = await connectMongo();
  const rows = await mongo.collection("reline_logs")
    .find({})
    .sort({ createdAt: -1, relineTime: -1, reline_time: -1 })
    .toArray();

  return rows.map((row) => ({
    id: row._id,
    telegram_id: row.telegramId || row.telegram_id || "",
    username: row.username || "",
    fullname: row.fullname || "",
    reline_time: row.relineTime || row.reline_time || row.createdAt,
    shift: row.shift || "",
    month_key: row.monthKey || row.month_key || "",
    chat_id: row.chatId || row.chat_id || "",
    chat_title: row.chatTitle || row.chat_title || "",
  }));
}

function formatMonthlySummary(rows, chatLabel) {
  if (!rows.length) return `ยังไม่มีใครรีไลน์ในกลุ่ม ${chatLabel} ในเดือนนี้ครับ`;

  const monthLabel = getMonthLabel(new Date());
  const lines = rows.map((row, index) => {
    const name = row.fullname || row.username || "ไม่ทราบชื่อ";
    const amount = row.total * 50;
    return `${index + 1}. ${name}: ${row.total} ครั้ง (${amount} บาท)`;
  });

  return `สรุป ${chatLabel} ${monthLabel}:\n${lines.join("\n")}`;
}

// Commands and ordinary chat never consume a UTC shift lock.
bot.on("message", async (msg) => {
  try {
    if (!msg.from || !msg.chat) {
      return;
    }

    const text = msg.text || "";
    const chatId = String(msg.chat.id);
    const telegramId = String(msg.from.id);
    const displayName = getDisplayName(msg);
    const chatLabel = getChatLabel(msg);

    const now = new Date();
    const shiftWindow = getUtcShiftWindow(now);
    const shift = shiftWindow.label;
    const monthKey = getMonthKey(now);
    const username = msg.from.username || "";
    const fullname = `${msg.from.first_name || ""} ${msg.from.last_name || ""}`.trim();

    if (/^\/start(?:@\w+)?(?:\s|$)/i.test(text)) {
      await bot.sendMessage(chatId, "สวัสดีครับ! พิมพ์ว่า รีไลน์ เพื่อบันทึกและดูสรุปเดือนนี้\nใช้ /summary เพื่อดูสรุปเดือนนี้\nหากต้องการนับย้อนหลังให้พิมพ์ เช่น รีไลน์ 10");
      return;
    }

    if (/^\/(?:summary|stats)(?:@\w+)?(?:\s|$)/i.test(text)) {
      const rows = await buildMonthlySummary(chatId);
      await bot.sendMessage(msg.chat.id, formatMonthlySummary(rows, chatLabel));
      return;
    }

    const relineCommand = parseRelineCommand(text);
    if (!relineCommand.isReline) {
      return;
    }

    const lockPayload = {
      telegramId,
      username,
      fullname,
      shift,
      shiftKey: shiftWindow.key,
      shiftStart: shiftWindow.start.toISOString(),
      shiftEnd: shiftWindow.end.toISOString(),
      chatId,
      chatTitle: chatLabel,
      text,
      messageId: msg.message_id,
    };

    let hasShiftLock = false;
    try {
      hasShiftLock = await acquireShiftLock(lockPayload);
    } catch (error) {
      console.error("Shift lock error:", error);
      return;
    }

    if (!hasShiftLock) {
      return;
    }

    const payload = {
      ...lockPayload,
      relineTime: now.toISOString(),
      monthKey,
      isCountdown: relineCommand.countdownTarget !== null,
      countdownTarget: relineCommand.countdownTarget,
    };

    await saveRelineToMongo(payload);

    // Insert accepted first reline into local SQLite for backward compatibility.
    return new Promise((resolve, reject) => {
      db.run(
        `
        INSERT INTO reline_logs
        (telegram_id, username, fullname, reline_time, shift, month_key, chat_id, chat_title)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [telegramId, username, fullname, now.toISOString(), shift, monthKey, chatId, chatLabel],
        async (err) => {
          if (err) {
            console.error("Database insert error:", err);
            bot.sendMessage(msg.chat.id, "❌ เกิดข้อผิดพลาดในการบันทึก");
            return reject(err);
          }

          try {
            const rows = await buildMonthlySummary(chatId);
            const me = rows.find((row) => row.telegram_id === telegramId);
            const myTotal = me ? me.total : 1;

            let responseText = `✅ บันทึกรีไลน์แล้ว: ${displayName}\n📊 เดือนนี้คุณมี ${myTotal} ครั้ง\n`;

            if (relineCommand.countdownTarget !== null) {
              const target = relineCommand.countdownTarget;
              const remaining = target - myTotal;
              if (remaining > 0) {
                responseText += `⏱️ นับย้อนหลังจาก ${target}: เหลือ ${remaining} ครั้ง\n`;
              } else if (remaining === 0) {
                responseText += `🎉 ครบ ${target} ครั้งแล้ว!\n`;
              } else {
                responseText += `🏆 ไปแล้ว ${Math.abs(remaining)} ครั้ง!\n`;
              }
            }

            responseText += `\n${formatMonthlySummary(rows, chatLabel)}`;

            bot.sendMessage(msg.chat.id, responseText).then(() => resolve()).catch(reject);
          } catch (error) {
            console.error("Error building summary:", error);
            bot.sendMessage(msg.chat.id, "⚠️ บันทึกสำเร็จแต่ไม่สามารถโหลดสรุปได้");
            reject(error);
          }
        }
      );
    });
  } catch (error) {
    console.error("Message handler error:", error);
    bot.sendMessage(msg.chat.id, "❌ เกิดข้อผิดพลาด โปรดลองใหม่");
  }
});

app.use("/", createRouter({
  dashboardPath: path.join(__dirname, "dashboard.html"),
  getRelineLogsFromMongo,
  buildMonthlySummary,
}));

const port = process.env.PORT || 3000;

app.listen(port, "0.0.0.0", () => {
  console.log(`API running on http://0.0.0.0:${port}`);
});

bot.setMyCommands([
  { command: "start", description: "เริ่มใช้งานบอท" },
  { command: "summary", description: "ดูสรุปเดือนนี้" },
  { command: "stats", description: "ดูสรุปเดือนนี้" },
])
  .then(() => console.log("Bot commands registered"))
  .catch((error) => console.error("Failed to register commands:", error.message));

console.log("Bot is running...");
