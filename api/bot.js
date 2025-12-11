const { Telegraf } = require('telegraf');
const axios = require('axios');

const bot = new Telegraf(process.env.TELEGRAM_TOKEN);
const MISTRAL_KEY = process.env.MISTRAL_API_KEY;

// Проверка ключа
if (!MISTRAL_KEY) {
  console.log('⚠️ Mistral API ключ не найден');
}

// Команда /start
bot.start((ctx) => {
  ctx.reply('📸 Привет! Я бот с Mistral AI Vision!\n\nОтправь мне:\n• Текст - я отвечу\n• Фото - опишу что на фото\n• Голосовое - расшифрую');
});

// Обработка ТЕКСТА
bot.on('text', async (ctx) => {
  const userText = ctx.message.text;
  
  if (!MISTRAL_KEY) {
    return ctx.reply('❌ Mistral API не настроен');
  }
  
  const waitMsg = await ctx.reply('🤔 Думаю...');
  
  try {
    const response = await axios.post(
      'https://api.mistral.ai/v1/chat/completions',
      {
        model: 'mistral-small-latest',
        messages: [{ role: 'user', content: userText }],
        max_tokens: 1000,
        temperature: 0.7
      },
      {
        headers: {
          'Authorization': `Bearer ${MISTRAL_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      }
    );
    
    const aiResponse = response.data.choices[0].message.content;
    await ctx.deleteMessage(waitMsg.message_id);
    await ctx.reply(aiResponse);
    
  } catch (error) {
    await ctx.deleteMessage(waitMsg.message_id);
    
    if (error.code === 'ECONNABORTED') {
      await ctx.reply('⏳ Время ожидания истекло. Попробуй короче вопрос.');
    } else if (error.response?.status === 429) {
      await ctx.reply('🚫 Лимит запросов. Подожди немного.');
    } else {
      await ctx.reply('❌ Ошибка: ' + (error.response?.data?.message || error.message));
    }
  }
});

// Обработка ФОТОГРАФИЙ
bot.on('photo', async (ctx) => {
  if (!MISTRAL_KEY) {
    return ctx.reply('❌ Mistral API не настроен');
  }
  
  const waitMsg = await ctx.reply('👀 Смотрю на фото...');
  
  try {
    // Берем самую качественную версию фото
    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    const fileLink = await ctx.telegram.getFileLink(photo.file_id);
    const imageUrl = fileLink.href;
    
    // Отправляем фото в Mistral AI Vision
    const response = await axios.post(
      'https://api.mistral.ai/v1/chat/completions',
      {
        model: 'mistral-small-latest', // Поддерживает vision
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Опиши подробно что на этом изображении. Будь точным и детальным.' },
              { type: 'image_url', image_url: { url: imageUrl } }
            ]
          }
        ],
        max_tokens: 1000
      },
      {
        headers: {
          'Authorization': `Bearer ${MISTRAL_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 40000
      }
    );
    
    const description = response.data.choices[0].message.content;
    await ctx.deleteMessage(waitMsg.message_id);
    await ctx.reply(`📸 Описание фото:\n\n${description}`);
    
  } catch (error) {
    await ctx.deleteMessage(waitMsg.message_id);
    console.error('Vision error:', error.response?.data || error.message);
    
    if (error.response?.data?.error?.code === 'model_not_found') {
      await ctx.reply('⚠️ Твоя модель Mistral не поддерживает Vision. Нужна mistral-large-latest.');
    } else {
      await ctx.reply('❌ Не смог распознать фото. Попробуй другое изображение.');
    }
  }
});

// Обработка ГОЛОСОВЫХ (если нужно)
bot.on('voice', async (ctx) => {
  await ctx.reply('🎤 Голосовые сообщения пока не поддерживаются. Напиши текст или отправь фото!');
});

// Команда /help
bot.help((ctx) => {
  ctx.reply(`
🎯 Доступные функции:
• Напиши текст - получи ответ от AI
• Отправь фото - получи описание
• /help - эта справка
• /models - какие модели доступны

📸 Для фото: отправь четкое изображение
🤖 Используется Mistral AI Vision
  `);
});

// Команда /models - проверка доступных моделей
bot.command('models', async (ctx) => {
  if (!MISTRAL_KEY) {
    return ctx.reply('❌ API ключ не настроен');
  }
  
  try {
    const response = await axios.get('https://api.mistral.ai/v1/models', {
      headers: { 'Authorization': `Bearer ${MISTRAL_KEY}` }
    });
    
    const models = response.data.data
      .map(m => `• ${m.id}${m.id.includes('latest') ? ' ✅' : ''}`)
      .join('\n');
    
    ctx.reply(`📋 Доступные модели:\n\n${models}\n\nДля фото нужна модель с поддержкой Vision.`);
  } catch (error) {
    ctx.reply('❌ Не удалось получить список моделей');
  }
});

// Обработчик для Vercel
module.exports = async (req, res) => {
  if (req.method === 'GET') {
    return res.status(200).json({ 
      status: 'Mistral Vision Bot is running',
      features: ['text', 'photos', 'ai_vision']
    });
  }
  
  try {
    await bot.handleUpdate(req.body);
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Webhook error:', err);
    res.status(500).json({ error: err.message });
  }
};
