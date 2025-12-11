const { Telegraf } = require('telegraf');
const axios = require('axios');

const bot = new Telegraf(process.env.TELEGRAM_TOKEN);
const MISTRAL_KEY = process.env.MISTRAL_API_KEY;

bot.start((ctx) => ctx.reply('🤖 Mistral AI бот готов!'));

bot.on('text', async (ctx) => {
  try {
    const res = await axios.post('https://api.mistral.ai/v1/chat/completions', {
      model: 'mistral-tiny',
      messages: [{role: 'user', content: ctx.message.text}]
    }, {
      headers: {Authorization: `Bearer ${MISTRAL_KEY}`}
    });
    
    ctx.reply(res.data.choices[0].message.content);
  } catch (e) {
    ctx.reply('Ошибка: ' + (e.response?.data?.message || e.message));
  }
});

module.exports = async (req, res) => {
  if (req.method === 'GET') return res.json({status: 'OK'});
  await bot.handleUpdate(req.body);
  res.status(200).end();
};
