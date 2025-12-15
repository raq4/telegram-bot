// api/bot.js — Telegram Bot (Vercel + Mistral)
// ENV: TELEGRAM_TOKEN, MISTRAL_API_KEY, WEBHOOK_URL

import { Telegraf } from "telegraf";
import axios from "axios";

const bot = new Telegraf(process.env.TELEGRAM_TOKEN);

// ---------- MISTRAL TEXT ----------
async function askMistralText(text) {
  const r = await axios.post(
    "https://api.mistral.ai/v1/chat/completions",
    {
      model: "mistral-large-latest",
      messages: [{ role: "user", content: text }],
      max_tokens: 4096
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.MISTRAL_API_KEY}`,
        "Content-Type": "application/json"
      }
    }
  );

  return r.data.choices[0].message.content;
}

// ---------- MISTRAL VISION ----------
async function askMistralVision(imageUrl) {
  const r = await axios.post(
    "https://api.mistral.ai/v1/chat/completions",
    {
      model: "pixtral-12b",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Реши задачу с изображения" },
            { type: "image_url", image_url: imageUrl }
          ]
        }
      ],
      max_tokens: 4096
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.MISTRAL_API_KEY}`,
        "Content-Type": "application/json"
      }
    }
  );

  return r.data.choices[0].message.content;
}

// ---------- BOT ----------
bot.start((ctx) => ctx.reply("Бот запущен. Отправь текст или фото."));

bot.on("text", async (ctx) => {
  const wait = await ctx.reply("⏳");
  try {
    const answer = await askMistralText(ctx.message.text);
    await ctx.deleteMessage(wait.message_id);
    await ctx.reply(answer);
  } catch (e) {
    await ctx.reply("Ошибка обработки текста");
  }
});

bot.on("photo", async (ctx) => {
  const wait = await ctx.reply("🔍");

  try {
    const photo = ctx.message.photo.at(-1);
    const file = await ctx.telegram.getFile(photo.file_id);
    const imageUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_TOKEN}/${file.file_path}`;

    const answer = await askMistralVision(imageUrl);
    await ctx.deleteMessage(wait.message_id);
    await ctx.reply(answer);
  } catch (e) {
    await ctx.reply("Ошибка обработки изображения");
  }
});

// ---------- VERCEL HANDLER ----------
export default async function handler(req, res) {
  if (req.method === "POST") {
    await bot.handleUpdate(req.body);
    res.status(200).send("OK");
  } else {
    await bot.telegram.setWebhook(process.env.WEBHOOK_URL);
    res.status(200).send("Webhook set");
  }
}
