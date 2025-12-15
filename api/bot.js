import { Telegraf } from "telegraf";
import axios from "axios";
import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const localCache = new Map();
const MAX_HISTORY = 50;
const CONTEXT_HISTORY = 10;

async function getChatHistory(chatId) {
  if (localCache.has(chatId)) return localCache.get(chatId);
  try {
    const history = await redis.get(`chat:${chatId}`) || [];
    localCache.set(chatId, history);
    return history;
  } catch {
    return [];
  }
}

async function addToHistory(chatId, role, content) {
  const history = await getChatHistory(chatId);
  history.push({ role, content });
  localCache.set(chatId, history);
  redis.set(`chat:${chatId}`, history.slice(-MAX_HISTORY)).catch(() => {});
}

const bot = new Telegraf(process.env.TELEGRAM_TOKEN, {
  handlerTimeout: 3000,
  channelMode: true
});

const mistralConfig = {
  timeout: 5000,
  headers: {
    'Authorization': `Bearer ${process.env.MISTRAL_API_KEY}`,
    'Content-Type': 'application/json'
  }
};

async function askMistral(text, chatId) {
  const history = await getChatHistory(chatId);
  if (history.length === 0) {
    history.push({
      role: "system",
      content: "Отвечай максимально кратко, 1-2 предложения."
    });
  }
  history.push({ role: "user", content: text });

  try {
    const response = await axios.post(
      "https://api.mistral.ai/v1/chat/completions",
      {
        model: "mistral-tiny",
        messages: history.slice(-CONTEXT_HISTORY),
        max_tokens: 500,
        temperature: 0.2
      },
      mistralConfig
    );
    return response.data.choices[0].message.content;
  } catch {
    return "Краткий ответ.";
  }
}

bot.start(ctx => ctx.reply("⚡ Быстрый бот. Пишите текст или отправляйте фото."));

bot.on("text", async ctx => {
  if (ctx.message.text.startsWith("/")) return;
  const typing = await ctx.replyWithChatAction("typing");
  try {
    const answer = await Promise.race([
      askMistral(ctx.message.text, ctx.chat.id),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 4000))
    ]);
    await ctx.reply(answer);
    addToHistory(ctx.chat.id, "user", ctx.message.text);
    addToHistory(ctx.chat.id, "assistant", answer);
  } catch {
    await ctx.reply("Мгновенный ответ.");
  } finally {
    await typing;
  }
});

bot.on("photo", async ctx => {
  const typing = await ctx.replyWithChatAction("upload_photo");
  try {
    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    const fileLink = await ctx.telegram.getFileLink(photo.file_id);
    const answer = await Promise.race([
      axios.post(
        "https://api.mistral.ai/v1/chat/completions",
        {
          model: "pixtral-12b",
          messages: [{
            role: "user",
            content: [
              { type: "text", text: ctx.message.caption || "Что на фото?" },
              { type: "image_url", image_url: fileLink.href }
            ]
          }],
          max_tokens: 500
        },
        mistralConfig
      ).then(r => r.data.choices[0].message.content),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 6000))
    ]);
    await ctx.reply(answer);
  } catch {
    await ctx.reply("Быстрый анализ фото.");
  } finally {
    await typing;
  }
});

bot.command("clear", async ctx => {
  localCache.delete(ctx.chat.id);
  await redis.del(`chat:${ctx.chat.id}`);
  await ctx.reply("✅ История очищена");
});

export default async function handler(req, res) {
  if (req.method === "POST") {
    try {
      await bot.handleUpdate(req.body, res);
    } catch {
      res.status(200).send("OK");
    }
  } else {
    try {
      await bot.telegram.setWebhook(process.env.WEBHOOK_URL);
      res.status(200).send("Webhook set");
    } catch {
      res.status(200).send("OK");
    }
  }
}
