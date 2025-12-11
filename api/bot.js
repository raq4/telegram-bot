const { Telegraf } = require('telegraf');
const axios = require('axios');

const bot = new Telegraf(process.env.TELEGRAM_TOKEN);
const MISTRAL_KEY = process.env.MISTRAL_API_KEY;

// ========== РАБОЧИЕ КОМАНДЫ БЕЗ ОШИБОК ==========

bot.start((ctx) => {
  ctx.reply(`👋 Привет! Я бот с Mistral AI.\nКоманды: /help /clear /status`);
});

bot.help((ctx) => {
  ctx.reply('🤖 Помощь:\n• Просто напиши вопрос\n• /clear - очистить историю\n• /status - статус бота');
});

bot.command('clear', (ctx) => {
  ctx.reply('🧹 История очищена!');
});

bot.command('status', (ctx) => {
  ctx.reply(`✅ Бот работает!\nMistral API: ${MISTRAL_KEY ? 'активен' : 'нет'}`);
});

// ========== ОБРАБОТКА ТЕКСТА ==========
bot.on('text', async (ctx) => {
  const text = ctx.message.text;
  if (text.startsWith('/')) return;
  
  if (!MISTRAL_KEY) {
    return ctx.reply('❌ API не настроен');
  }
  
  try {
    const waitMsg = await ctx.reply('💭 Думаю...');
    
    const response = await axios.post(
      'https://api.mistral.ai/v1/chat/completions',
      {
        model: 'mistral-tiny',
        messages: [{ role: 'user', content: text }]
      },
      {
        headers: { 'Authorization': `Bearer ${MISTRAL_KEY}` }
      }
    );
    
    const answer = response.data.choices[0].message.content;
    
    await ctx.deleteMessage(waitMsg.message_id);
    await ctx.reply(answer);
    
  } catch (error) {
    ctx.reply('❌ Ошибка: ' + error.message);
  }
});

// ========== WEBHOOK ==========
module.exports = async (req, res) => {
  if (req.method === 'GET') {
    return res.json({ status: 'Bot is running', ok: true });
  }
  
  try {
    await bot.handleUpdate(req.body);
    res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
};
