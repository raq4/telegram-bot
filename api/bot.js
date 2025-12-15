// api/bot.js — Telegram Bot (Vercel + Mistral) с памятью и быстрыми ответами
// ENV: TELEGRAM_TOKEN, MISTRAL_API_KEY, WEBHOOK_URL, UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN

import { Telegraf } from "telegraf";
import axios from "axios";
import { Redis } from "@upstash/redis";

// ---------- Проверка ENV ----------
if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
  console.error("⚠️ REDIS URL или TOKEN не заданы!");
}
if (!process.env.TELEGRAM_TOKEN) console.error("⚠️ TELEGRAM_TOKEN не задан!");
if (!process.env.MISTRAL_API_KEY) console.error("⚠️ MISTRAL_API_KEY не задан!");
if (!process.env.WEBHOOK_URL) console.error("⚠️ WEBHOOK_URL не задан!");

// ---------- Инициализация Redis ----------
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// ---------- Локальный кэш истории ----------
const localCache = new Map();
const MAX_HISTORY = 55;
const CONTEXT_HISTORY = 10;

async function getChatHistory(chatId) {
  if (localCache.has(chatId)) return localCache.get(chatId);
  try {
    const history = (await redis.get(`chat:${chatId}`)) || [];
    if (!Array.isArray(history)) return [];
    localCache.set(chatId, history);
    return history;
  } catch (err) {
    console.error("Redis get error:", err);
    return [];
  }
}

function saveChatHistory(chatId, history) {
  try {
    localCache.set(chatId, history);
    const trimmed = history.slice(-MAX_HISTORY*2);
    redis.set(`chat:${chatId}`, trimmed).catch(console.error);
    redis.expire(`chat:${chatId}`, 86400).catch(console.error);
  } catch (err) {
    console.error("Redis save error:", err);
  }
}

async function clearChatHistory(chatId) {
  localCache.delete(chatId);
  try {
    await redis.del(`chat:${chatId}`);
    return true;
  } catch (err) {
    console.error("Redis del error:", err);
    return false;
  }
}

async function addToHistory(chatId, role, content, imageUrl = null) {
  const history = await getChatHistory(chatId);
  let message;
  if (imageUrl) {
    message = {
      role,
      content: [
        { type: "text", text: content || "Реши задачу с изображения" },
        { type: "image_url", image_url: imageUrl }
      ]
    };
  } else {
    message = { role, content };
  }
  history.push(message);
  saveChatHistory(chatId, history);
  return history;
}

// ---------- Mistral Text ----------
async function askMistralText(text, chatId) {
  const history = await getChatHistory(chatId);

  if (history.length === 0) {
    history.push({
      role: "system",
      content: "Ты полезный ассистент. Отвечай на русском языке подробно и вежливо."
    });
  }

  history.push({ role: "user", content: text });
  const context = history.slice(-CONTEXT_HISTORY*2);

  try {
    const response = await axios.post(
      "https://api.mistral.ai/v1/chat/completions",
      {
        model: "mistral-large-latest",
        messages: context,
        max_tokens: 4096,
        temperature: 0.7
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.MISTRAL_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    const answer = response.data.choices[0].message.content;
    addToHistory(chatId, "assistant", answer);
    return answer;
  } catch (err) {
    console.error("Mistral Text error:", err);
    return "❌ Ошибка генерации ответа. Попробуйте позже.";
  }
}

// ---------- Mistral Vision ----------
async function askMistralVision(imageUrl, chatId, userText = "Реши задачу с изображения") {
  const history = await getChatHistory(chatId);

  if (history.length === 0) {
    history.push({
      role: "system",
      content: "Ты полезный ассистент с поддержкой изображений. Анализируй изображения и давай подробные ответы на русском языке."
    });
  }

  const visionMessage = {
    role: "user",
    content: [
      { type: "text", text: userText },
      { type: "image_url", image_url: imageUrl }
    ]
  };

  history.push(visionMessage);
  const context = history.slice(-CONTEXT_HISTORY*2);

  try {
    const response = await axios.post(
      "https://api.mistral.ai/v1/chat/completions",
      {
        model: "pixtral-12b",
        messages: context,
        max_tokens: 4096
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.MISTRAL_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    const answer = response.data.choices[0].message.content;
    addToHistory(chatId, "assistant", answer);
    return answer;
  } catch (err) {
    console.error("Mistral Vision error:", err);
    return "❌ Ошибка обработки изображения. Попробуйте другое фото.";
  }
}

// ---------- Telegram Bot ----------
const bot = new Telegraf(process.env.TELEGRAM_TOKEN);

bot.start((ctx) => {
  ctx.reply(
    "🤖 Бот запущен с памятью!\n" +
    "Отправляйте текст или фото.\n" +
    "Команды:\n/clear - очистить историю\n/history - показать количество сообщений"
  );
});

// ---------- Команда очистки истории ----------
bot.command("clear", async (ctx) => {
  const chatId = ctx.chat.id;
  localCache.delete(chatId);
  try {
    await redis.del(`chat:${chatId}`);
    await ctx.reply("✅ История очищена.");
  } catch (err) {
    console.error("Redis clear error:", err);
    await ctx.reply("⚠️ Не удалось очистить историю.");
  }
});

// ---------- Команда истории ----------
bot.command("history", async (ctx) => {
  try {
    const chatId = ctx.chat.id;
    const history = await getChatHistory(chatId);
    if (!Array.isArray(history)) {
      localCache.delete(chatId);
      await ctx.reply("⚠️ История повреждена, сброшена.");
      return;
    }
    await ctx.reply(
      `📊 Сообщений в памяти: ${history.length}\n` +
      `Примерно диалогов: ${Math.floor(history.length / 2)}`
    );
  } catch (err) {
    console.error("History command error:", err);
    await ctx.reply("❌ Не удалось получить историю. Попробуйте позже.");
  }
});

// ---------- Обработка текста ----------
bot.on("text", async (ctx) => {
  if (ctx.message.text.startsWith("/")) return;
  const chatId = ctx.chat.id;
  const waitMsg = await ctx.reply("⏳ Думаю...");

  try {
    const answer = await askMistralText(ctx.message.text, chatId);
    await ctx.deleteMessage(waitMsg.message_id);

    if (answer.length > 4000) {
      for (const chunk of answer.match(/[\s\S]{1,4000}/g)) {
        await ctx.reply(chunk);
      }
    } else {
      await ctx.reply(answer);
    }

    // Асинхронное добавление пользователя
    addToHistory(chatId, "user", ctx.message.text);

  } catch (err) {
    console.error("Text handler error:", err);
    await ctx.deleteMessage(waitMsg.message_id);
    await ctx.reply("❌ Ошибка обработки текста.");
  }
});

// ---------- Обработка фото ----------
bot.on("photo", async (ctx) => {
  const chatId = ctx.chat.id;
  const waitMsg = await ctx.reply("🔍 Анализирую изображение...");

  try {
    const photo = ctx.message.photo.at(-1);
    const file = await ctx.telegram.getFile(photo.file_id);
    const imageUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_TOKEN}/${file.file_path}`;
    const caption = ctx.message.caption || "Что на изображении?";

    const answer = await askMistralVision(imageUrl, chatId, caption);
    await ctx.deleteMessage(waitMsg.message_id);

    if (answer.length > 4000) {
      for (const chunk of answer.match(/[\s\S]{1,4000}/g)) {
        await ctx.reply(chunk);
      }
    } else {
      await ctx.reply(answer);
    }

    addToHistory(chatId, "user", caption, imageUrl);

  } catch (err) {
    console.error("Photo handler error:", err);
    await ctx.deleteMessage(waitMsg.message_id);
    await ctx.reply("❌ Ошибка обработки изображения.");
  }
});

// ---------- Vercel Handler ----------
export default async function handler(req, res) {
  if (req.method === "POST") {
    try {
      await bot.handleUpdate(req.body);
      res.status(200).send("OK");
    } catch (err) {
      console.error("Unhandled bot error:", err);
      res.status(500).send("Bot error");
    }
  } else {
    try {
      await bot.telegram.setWebhook(process.env.WEBHOOK_URL);
      res.status(200).send("Webhook set");
    } catch (err) {
      console.error("Webhook error:", err);
      res.status(500).send("Webhook error");
    }
  }
}
