const { Telegraf } = require('telegraf');
const axios = require('axios');

const bot = new Telegraf(process.env.TELEGRAM_TOKEN);

// Проверка Mistral API ключа
const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY;
if (!MISTRAL_API_KEY) {
  console.error('⚠️ MISTRAL_API_KEY не установлен!');
}

bot.start((ctx) => {
  ctx.reply('🤖 Привет! Я бот с Mistral AI. Задай мне вопрос!');
});

bot.on('text', async (ctx) => {
  const userMessage = ctx.message.text;
  
  // Показываем что обрабатываем
  const processingMsg = await ctx.reply('⏳ Думаю...');
  
  try {
    // Запрос к Mistral AI
    const response = await axios.post(
      'https://api.mistral.ai/v1/chat/completions',
      {
        model: 'mistral-tiny',  // или mistral-small, mistral-medium
        messages: [
          {
            role: 'user',
            content: userMessage
          }
        ],
        max_tokens: 1000,
        temperature: 0.7
      },
      {
        headers: {
          'Authorization': `Bearer ${MISTRAL_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    const aiResponse = response.data.choices[0].message.content;
    
    // Удаляем сообщение "Думаю..." и отправляем ответ
    await ctx.deleteMessage(processingMsg.message_id);
    await ctx.reply(aiResponse);
    
  } catch (error) {
    console.error('Mistral API Error:', error.response?.data || error.message);
    
    await ctx.deleteMessage(processingMsg.message_id);
    
    if (error.response?.status === 401) {
      await ctx.reply('❌ Ошибка: Неверный Mistral API ключ');
    } else if (error.response?.status === 429) {
      await ctx.reply('⚠️ Лимит запросов исчерпан. Попробуй позже.');
    } else {
      await ctx.reply('🤔 Ответ от AI не получен. Попробуй еще раз.');
    }
  }
});

// Команда /help
bot.help((ctx) => {
  ctx.reply('📚 Доступные команды:\n/start - Начать\n/help - Помощь\n\nПросто напиши вопрос и я отвечу с помощью Mistral AI!');
});

// Обработчик для Vercel
module.exports = async (req, res) => {
  if (req.method === 'GET') {
    return res.status(200).json({ 
      status: 'Bot with Mistral AI is running',
      ai: 'Mistral AI connected'
    });
  }
  
  try {
    await bot.handleUpdate(req.body);
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Bot Error:', err);
    res.status(500).json({ error: err.message });
  }
};
