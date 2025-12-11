const { Telegraf } = require('telegraf');
const { Redis } = require('@upstash/redis');

// Инициализация Redis
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const bot = new Telegraf(process.env.TELEGRAM_TOKEN);

// Команда /start
bot.start(async (ctx) => {
  // Сохраняем пользователя в Redis
  await redis.set(`user:${ctx.from.id}`, new Date().toISOString());
  
  ctx.reply('🤖 Бот работает с Redis!');
});

// Ответ на сообщения
bot.on('text', async (ctx) => {
  const userId = ctx.from.id;
  const message = ctx.message.text;
  
  // Сохраняем сообщение в Redis
  await redis.lpush(`messages:${userId}`, message);
  
  ctx.reply(`Сообщение сохранено в Redis! Всего: ${await redis.llen(`messages:${userId}`)}`);
});

// Экспорт для Vercel
module.exports = async (req, res) => {
  if (req.method === 'GET') {
    return res.status(200).json({ 
      status: 'Bot with Redis is running',
      redis: 'connected'
    });
  }
  
  try {
    await bot.handleUpdate(req.body);
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Error:', err);
    res.status(500).json({ error: err.message });
  }
};
