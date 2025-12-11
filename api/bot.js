const { Telegraf } = require('telegraf');
const axios = require('axios');

const bot = new Telegraf(process.env.TELEGRAM_TOKEN);
const MISTRAL_KEY = process.env.MISTRAL_API_KEY;

// ========== СТИЛЬ DEEPSEEK (МОЙ ТОЧНЫЙ СТИЛЬ) ==========
const DEEPSEEK_STYLE = `Ты — ассистент DeepSeek. Ты говоришь ТОЧНО в моем стиле.

МОЙ СТИЛЬ ОБЩЕНИЯ:
1. **ПРОФЕССИОНАЛЬНО И ДРУЖЕЛЮБНО**:
   - Вежливый, но без излишней формальности
   - Поддерживающий, но не панибратский
   - Технически точный, но доступный

2. **СТРУКТУРА ОТВЕТОВ**:
   - Начинаю с понимания проблемы
   - Даю четкий, структурированный ответ
   - Использую эмодзи для навигации 🎯 🔧 📝
   - Делю на логические блоки
   - Заканчиваю готовым решением

3. **КОНКРЕТНЫЕ ФРАЗЫ КОТОРЫЕ Я ИСПОЛЬЗУЮ**:
   ✅ "Отлично! Давайте разберемся..."
   ✅ "Понял вашу задачу. Вот решение:"
   ✅ "Сначала проверьте..."
   ✅ "Вот полный код:"
   ✅ "Итак, по шагам:"
   ✅ "🎯 Кратко:"
   ✅ "🔧 Что нужно сделать:"
   ✅ "📝 Пример кода:"
   ✅ "🚀 После этого:"
   ✅ "✅ Проверьте что:"

4. **КАК Я ОБРАЩАЮСЬ**:
   - Использую "вы" (вежливо)
   - Иногда "ты" (если чувствую неформальную обстановку)
   - Никогда "bro", "чувак", "братан"
   - Никогда снисходительный тон

5. **ФОРМАТИРОВАНИЕ**:
   • Использую markdown
   • Код в блоках \`\`\`
   • Списки через дефисы или цифры
   • Эмодзи для акцентов 🚨 💡 ⚠️ ✅

6. **ПРИМЕР МОЕГО ОТВЕТА**:
   "Понял задачу! Нужно создать Telegram бота с Mistral AI.

   🎯 **Что делаем:**
   1. Создаем бота в @BotFather
   2. Получаем API ключ Mistral
   3. Разворачиваем на Vercel

   🔧 **Код бота:**
   \`\`\`javascript
   const bot = new Telegraf(process.env.TOKEN);
   \`\`\`

   ✅ **Проверьте:**
   - Токен добавлен в Environment Variables
   - Вебхук настроен

   Готовы продолжить?"

ТВОЯ ЗАДАЧА: Отвечать ТОЧНО в этом стиле. Будь helpful, technical, structured, friendly.`;

// ========== ХРАНЕНИЕ ==========
const userHistories = new Map();

function getUserHistory(userId) {
  if (!userHistories.has(userId)) {
    userHistories.set(userId, [
      { role: 'system', content: DEEPSEEK_STYLE }
    ]);
  }
  return userHistories.get(userId).slice(-10);
}

function addToHistory(userId, role, content) {
  if (!userHistories.has(userId)) {
    userHistories.set(userId, [
      { role: 'system', content: DEEPSEEK_STYLE }
    ]);
  }
  
  const history = userHistories.get(userId);
  history.push({ role, content });
  
  if (history.length > 11) {
    history.splice(1, 1);
  }
}

function clearUserHistory(userId) {
  userHistories.delete(userId);
}

// ========== ФУНКЦИИ ==========

// Определить тип запроса
function getRequestType(text) {
  const lower = text.toLowerCase();
  
  if (lower.includes('привет') || lower.includes('начать') || lower.includes('/start')) {
    return 'greeting';
  }
  
  if (lower.includes('код') || lower.includes('программир') || lower.includes('алгоритм')) {
    return 'code';
  }
  
  if (lower.includes('реши') || lower.includes('задач') || lower.includes('математ')) {
    return 'math';
  }
  
  if (lower.includes('ошибк') || lower.includes('не работ') || lower.includes('падает')) {
    return 'error';
  }
  
  if (lower.includes('как') || lower.includes('инструкц') || lower.includes('шаг')) {
    return 'tutorial';
  }
  
  return 'general';
}

// Форматировать ответ в моем стиле
function formatDeepSeekResponse(text, requestType) {
  // Убираем любые шаблонные фразы которые НЕ в моем стиле
  const notMyStyle = [
    /Я здесь, чтобы предоставить/gi,
  ];
  
  let formatted = text;
  notMyStyle.forEach(regex => {
    formatted = formatted.replace(regex, '');
  });
  
  // Добавляем структуру если ее нет
  if (requestType === 'tutorial' && !formatted.includes('🎯') && !formatted.includes('1.')) {
    const lines = formatted.split('\n').filter(l => l.trim());
    if (lines.length > 3) {
      formatted = `🎯 **План действий:**\n\n` +
                  lines.map((line, i) => `${i + 1}. ${line}`).join('\n') +
                  `\n\n✅ **После этого проверьте работоспособность.**`;
    }
  }
  
  if (requestType === 'code' && formatted.includes('```')) {
    formatted = formatted.replace(/```(\w+)?\n/g, '📝 **Код на $1:**\n```$1\n');
  }
  
  if (requestType === 'error') {
    if (!formatted.includes('🔧') && !formatted.includes('✅')) {
      formatted = `🔧 **Проблема:** ${formatted.split('\n')[0]}\n\n` +
                  `✅ **Решение:**\n${formatted.substring(formatted.indexOf('\n') + 1)}`;
    }
  }
  
  return formatted.trim();
}

// Запрос к Mistral
async function queryMistral(messages) {
  try {
    const response = await axios.post(
      'https://api.mistral.ai/v1/chat/completions',
      {
        model: 'mistral-small-latest',
        messages: messages,
        max_tokens: 1800,
        temperature: 0.7,
        top_p: 0.9
      },
      {
        headers: {
          'Authorization': `Bearer ${MISTRAL_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      }
    );
    
    return {
      success: true,
      answer: response.data.choices[0].message.content
    };
    
  } catch (error) {
    return {
      success: false,
      error: 'Ошибка подключения к AI',
      suggestion: 'Проверьте API ключ Mistral и попробуйте позже.'
    };
  }
}

// ========== КОМАНДЫ ==========

// /start
bot.start((ctx) => {
  clearUserHistory(ctx.from.id);
  ctx.reply(`👋 Привет! Я бот с стилем общения DeepSeek.

🎯 **Что я умею:**
• Отвечать на технические вопросы
• Помогать с программированием  
• Решать математические задачи
• Анализировать изображения

🔧 **Как использовать:**
Просто задайте вопрос — отвечу подробно и по делу.

📝 **Команды:**
/help — помощь
/clear — очистить историю

Готов помочь!`, { parse_mode: 'Markdown' });
});

// /help
bot.help((ctx) => {
  ctx.reply(`🛠️ **Помощь по боту**

🎯 **Мой стиль общения:**
• Вежливый и профессиональный
• Структурированные ответы
• Конкретные решения
• С примерами кода

📋 **Примеры вопросов:**
"Как создать Telegram бота?"
"Помоги с кодом на Python"
"Реши математическую задачу"
Отправьте фото с задачей

🔧 **Техническая поддержка:**
Если бот не работает:
1. Проверьте API ключ Mistral
2. Убедитесь что вебхук настроен
3. Посмотрите логи в Vercel

💡 **Совет:** Задавайте конкретные вопросы — получу точные ответы!`, { 
    parse_mode: 'Markdown' 
  });
});

// /clear
bot.command('clear', (ctx) => {
  clearUserHistory(ctx.from.id);
  ctx.reply('🔄 **История диалога очищена.**\n\nМожем начать новый разговор!', {
    parse_mode: 'Markdown'
  });
});

// ========== ОБРАБОТКА ТЕКСТА ==========
bot.on('text', async (ctx) => {
  const userId = ctx.from.id;
  const userText = ctx.message.text;
  
  if (userText.startsWith('/')) return;
  
  if (!MISTRAL_KEY) {
    return ctx.reply(`🔧 **Проблема с настройкой**

API ключ Mistral не настроен.

🎯 **Что сделать:**
1. Зайдите в Vercel → ваш проект
2. Откройте Settings → Environment Variables
3. Добавьте переменную:
   • Name: \`MISTRAL_API_KEY\`
   • Value: ваш ключ от Mistral AI
4. Перезапустите деплой

После этого бот заработает!`, { parse_mode: 'Markdown' });
  }
  
  const requestType = getRequestType(userText);
  const typingMsg = await ctx.reply('💭 Анализирую вопрос...');
  
  try {
    addToHistory(userId, 'user', userText);
    const historyMessages = getUserHistory(userId);
    
    const aiResult = await queryMistral(historyMessages);
    
    if (aiResult.success) {
      addToHistory(userId, 'assistant', aiResult.answer);
      await ctx.deleteMessage(typingMsg.message_id);
      
      // Форматируем в моем стиле
      const formatted = formatDeepSeekResponse(aiResult.answer, requestType);
      await ctx.reply(formatted, {
        parse_mode: 'Markdown',
        disable_web_page_preview: true
      });
      
    } else {
      await ctx.deleteMessage(typingMsg.message_id);
      ctx.reply(`⚠️ **Техническая проблема**

${aiResult.error}

🔧 **Рекомендация:**
${aiResult.suggestion}

Попробуйте повторить вопрос через минуту.`, {
        parse_mode: 'Markdown'
      });
    }
    
  } catch (error) {
    if (typingMsg) {
      try {
        await ctx.deleteMessage(typingMsg.message_id);
      } catch (e) {}
    }
    
    ctx.reply(`❌ **Произошла ошибка**

${error.message}

🎯 **Что можно сделать:**
1. Проверить интернет-соединение
2. Упростить вопрос
3. Использовать команду /clear

Попробуйте еще раз!`, {
      parse_mode: 'Markdown'
    });
  }
});

// ========== ОБРАБОТКА ФОТО ==========
bot.on('photo', async (ctx) => {
  const userId = ctx.from.id;
  
  if (!MISTRAL_KEY) {
    return ctx.reply('🔧 Настройте MISTRAL_API_KEY в Vercel.');
  }
  
  const caption = ctx.message.caption || '';
  const waitMsg = await ctx.reply('📸 Анализирую изображение...');
  
  try {
    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    const fileLink = await ctx.telegram.getFileLink(photo.file_id);
    const imageUrl = fileLink.href;
    
    addToHistory(userId, 'user', `[Фото: ${caption || 'изображение'}]`);
    
    const response = await axios.post(
      'https://api.mistral.ai/v1/chat/completions',
      {
        model: 'mistral-small-latest',
        messages: [
          {
            role: 'user',
            content: [
              { 
                type: 'text', 
                text: caption ? 
                  `Вопрос пользователя: "${caption}". Проанализируй изображение и ответь на вопрос.` :
                  `Проанализируй это изображение. Если есть задачи — реши их. Если есть текст — обработай его. Отвечай в стиле DeepSeek.`
              },
              { type: 'image_url', image_url: { url: imageUrl } }
            ]
          }
        ],
        max_tokens: 2000,
        temperature: 0.4
      },
      {
        headers: {
          'Authorization': `Bearer ${MISTRAL_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 60000
      }
    );
    
    const analysis = response.data.choices[0].message.content;
    addToHistory(userId, 'assistant', analysis);
    
    await ctx.deleteMessage(waitMsg.message_id);
    
    // Форматируем анализ фото
    let responseText = analysis;
    
    // Улучшаем структуру если это задачи
    if (responseText.toLowerCase().includes('задача') || responseText.includes('решение')) {
      responseText = `📊 **Анализ изображения:**\n\n${responseText}\n\n✅ **Задачи решены.**`;
    } else {
      responseText = `📸 **Анализ изображения:**\n\n${responseText}`;
    }
    
    await ctx.reply(responseText, {
      parse_mode: 'Markdown',
      disable_web_page_preview: true
    });
    
  } catch (error) {
    await ctx.deleteMessage(waitMsg.message_id);
    
    ctx.reply(`⚠️ **Не удалось проанализировать фото**

${error.message}

🎯 **Альтернатива:** 
Опишите что на фото текстом — помогу решить задачу.`, {
      parse_mode: 'Markdown'
    });
  }
});

// ========== WEBHOOK ==========
module.exports = async (req, res) => {
  if (req.method === 'GET') {
    return res.status(200).json({
      status: 'DeepSeek-style Telegram Bot',
      style: 'Professional, structured, helpful',
      features: ['text_ai', 'image_analysis', 'context_memory'],
      timestamp: new Date().toISOString()
    });
  }
  
  try {
    await bot.handleUpdate(req.body);
    res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ error: error.message });
  }
};
