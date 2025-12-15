import { Telegraf } from "telegraf";
import axios from "axios";
import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const bot = new Telegraf(process.env.TELEGRAM_TOKEN);

const MAX_HISTORY = 99;
const CONTEXT_HISTORY = 20;
const localCache = new Map();

async function getHistory(chatId) {
  if (localCache.has(chatId)) return localCache.get(chatId);
  try {
    const history = (await redis.get(`chat:${chatId}`)) || [];
    localCache.set(chatId, history);
    return history;
  } catch (err) {
    console.error(err);
    return [];
  }
}

function saveHistory(chatId, history) {
  const trimmed = history.slice(-MAX_HISTORY*2);
  localCache.set(chatId, trimmed);
  redis.set(`chat:${chatId}`, trimmed).catch(console.error);
  redis.expire(`chat:${chatId}`, 86400).catch(console.error);
}

async function addMessage(chatId, role, content, imageUrl = null) {
  const history = await getHistory(chatId);
  const msg = imageUrl ? { role, content: [{ type: "text", text: content }, { type: "image_url", image_url: imageUrl }] } : { role, content };
  history.push(msg);
  saveHistory(chatId, history);
  return history;
}

// Универсальная функция для Mistral (текст/изображение)
async function askMistral(chatId, userMessage, imageUrl = null) {
  const history = await getHistory(chatId);
  if (history.length === 0) {
    history.push({ role: "system", content: imageUrl ? "Ты ассистент с поддержкой изображений." : "Ты полезный ассистент. Отвечай подробно на русском." });
  }

  const userMsg = imageUrl ? { role: "user", content: [{ type: "text", text: userMessage }, { type: "image_url", image_url: imageUrl }] } : { role: "user", content: userMessage };
  history.push(userMsg);

  const context = history.slice(-CONTEXT_HISTORY*2);

  const model = imageUrl ? "pixtral-12b" : "mistral-large-latest";

  try {
    const r = await axios.post("https://api.mistral.ai/v1/chat/completions", {
      model,
      messages: context,
      max_tokens: 4096,
    }, {
      headers: { Authorization: `Bearer ${process.env.MISTRAL_API_KEY}`, "Content-Type": "application/json" }
    });

    const answer = r.data.choices[0].message.content;
    addMessage(chatId, "assistant", answer); // Асинхронно сохраняем
    return answer;
  } catch (err) {
    console.error(err);
    return "❌ Ошибка генерации. Попробуйте позже.";
  }
}

// ---------- Команды ----------
bot.start((ctx) => ctx.reply("🤖 Бот запущен! Текст или фото, команды: /clear, /history"));

bot.command("clear", async (ctx) => {
  const chatId = ctx.chat.id;
  localCache.delete(chatId);
  try {
    await redis.del(`chat:${chatId}`);
    ctx.reply("✅ История очищена.");
  } catch (err) {
    console.error(err);
    ctx.reply("⚠️ Не удалось очистить историю.");
  }
});

bot.command("history", async (ctx) => {
  const chatId = ctx.chat.id;
  const history = await getHistory(chatId);
  ctx.reply(`📊 Сообщений в памяти: ${history.length}\nПримерно диалогов: ${Math.floor(history.length / 2)}`);
});

// ---------- Обработка текста ----------
bot.on("text", async (ctx) => {
  const chatId = ctx.chat.id;
  if (ctx.message.text.startsWith("/")) return;

  const waitMsg = await ctx.reply("⏳ Думаю...");

  const answer = await askMistral(chatId, ctx.message.text);

  await ctx.deleteMessage(waitMsg.message_id);
  if (answer.length > 4000) {
    for (const chunk of answer.match(/[\s\S]{1,4000}/g)) await ctx.reply(chunk);
  } else {
    await ctx.reply(answer);
  }

  addMessage(chatId, "user", ctx.message.text); // Асинхронно
});

// ---------- Обработка фото ----------
bot.on("photo", async (ctx) => {
  const chatId = ctx.chat.id;
  const waitMsg = await ctx.reply("🔍 Анализирую изображение...");
  try {
    const photo = ctx.message.photo.at(-1);
    const file = await ctx.telegram.getFile(photo.file_id);
    const imageUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_TOKEN}/${file.file_path}`;
    const caption = ctx.message.caption || "Что на фото?";

    const answer = await askMistral(chatId, caption, imageUrl);
    await ctx.deleteMessage(waitMsg.message_id);

    if (answer.length > 4000) {
      for (const chunk of answer.match(/[\s\S]{1,4000}/g)) await ctx.reply(chunk);
    } else {
      await ctx.reply(answer);
    }

    addMessage(chatId, "user", caption, imageUrl); // Асинхронно
  } catch (err) {
    console.error(err);
    await ctx.deleteMessage(waitMsg.message_id);
    await ctx.reply("❌ Ошибка обработки фото.");
  }
});

// ---------- Vercel Handler ----------
export default async function handler(req, res) {
  if (req.method === "POST") {
    try {
      await bot.handleUpdate(req.body);
      res.status(200).send("OK");
    } catch (err) {
      console.error(err);
      res.status(500).send("Bot error");
    }
  } else {
    try {
      await bot.telegram.setWebhook(process.env.WEBHOOK_URL);
      res.status(200).send("Webhook set");
    } catch (err) {
      console.error(err);
      res.status(500).send("Webhook error");
    }
  }
}
