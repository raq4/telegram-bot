//const { Telegraf } = require('telegraf');

const bot = new Telegraf(process.env.TELEGRAM_TOKEN);

bot.start((ctx) => {
  ctx.reply('Привет! Бот работает!');
});

bot.on('text', (ctx) => {
  ctx.reply('Получил: ' + ctx.message.text);
});

module.exports = async (req, res) => {
  try {
    await bot.handleUpdate(req.body);
    res.status(200).send('OK');
  } catch (err) {
    res.status(500).send('Error');
  }
};
