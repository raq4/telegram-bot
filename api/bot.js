const { Telegraf } = require('telegraf');

const bot = new Telegraf(process.env.TELEGRAM_TOKEN);

bot.start((ctx) => {
  ctx.reply('Привет! Бот работает!');
});

bot.on('text', (ctx) => {
  ctx.reply('Вы сказали: ' + ctx.message.text);
});

module.exports = async (req, res) => {
  if (req.method === 'GET') {
    return res.status(200).json({ status: 'Bot is running' });
  }
  
  try {
    await bot.handleUpdate(req.body);
    res.status(200).json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
