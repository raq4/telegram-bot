// Telegram бот на Node.js для Vercel Serverless
const { Telegraf } = require('telegraf');
const { Redis } = require('@upstash/redis');

// Инициализация Redis
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// Создаем бота
const bot = new Telegraf(process.env.TELEGRAM_TOKEN);

// Команда /start
bot.start(async (ctx) => {
  await ctx.reply('🤖 Бот работает на Upstash + Vercel!');
  
  // Сохраняем пользователя в Redis
  await redis.set(`user:${ctx.from.id}`, JSON.stringify({
    id: ctx.from.id,
    username: ctx.from.username,
    first_name: ctx.from.first_name,
    last_seen: new Date().toISOString(),
  }));
});

// Обработка текстовых сообщений
bot.on('text', async (ctx) => {
  const userMessage = ctx.message.text;
  
  // Сохраняем историю в Redis
  const chatId = `chat:${ctx.from.id}`;
  await redis.lpush(chatId, `User: ${userMessage}`);
  await redis.ltrim(chatId, 0, 9); // Храним последние 10 сообщений
  
  // Здесь можно добавить интеграцию с Mistral AI
  const response = await fetch('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.MISTRAL_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'mistral-tiny',
      messages: [{ role: 'user', content: userMessage }],
    }),
  });
  
  if (response.ok) {
    const data = await response.json();
    const aiResponse = data.choices[0].message.content;
    
    // Сохраняем ответ в Redis
    await redis.lpush(chatId, `Bot: ${aiResponse}`);
    
    // Отправляем пользователю
    await ctx.reply(aiResponse);
  } else {
    await ctx.reply('⚠️ Ошибка при запросе к AI');
  }
});

// Команда /stats (показывает статистику)
bot.command('stats', async (ctx) => {
  const userKey = `user:${ctx.from.id}`;
  const userData = await redis.get(userKey);
  
  if (userData) {
    await ctx.reply(`📊 Ваша статистика:\nID: ${userData.id}\nИмя: ${userData.first_name}\nПоследний раз: ${userData.last_seen}`);
  }
});

// Экспорт для Vercel Serverless
module.exports = async (req, res) => {
  try {
    await bot.handleUpdate(req.body);
    res.status(200).send('OK');
  } catch (error) {
    console.error(error);
    res.status(500).send('Error');
  }
};
