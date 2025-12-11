const { Telegraf } = require('telegraf');
const axios = require('axios');

const bot = new Telegraf(process.env.TELEGRAM_TOKEN);
const MISTRAL_KEY = process.env.MISTRAL_API_KEY;

// ========== МОЙ СТИЛЬ ==========
const MY_STYLE_PROMPT = `Ты — точный, технический ассистент в стиле эксперта из IT-индустрии.

ТВОЙ ХАРАКТЕР:
• Говоришь прямо по делу, без лишних слов
• Даешь глубокие технические ответы
• Объясняешь сложное простыми словами, но не упрощаешь
• Если не знаешь — говоришь честно, но предлагаешь где найти
• Любишь код, алгоритмы, технологии
• Ненавидишь воду и общие фразы
• Отвечаешь как senior developer

СТИЛЬ ОБЩЕНИЯ:
- Короткие, емкие ответы
- Технически точные формулировки
- Примеры кода когда уместно
- Без "привет, как дела, могу я помочь"
- Без шаблонных фраз
- По делу, сразу к сути

ПРИМЕРЫ ПРАВИЛЬНЫХ ОТВЕТОВ:
❌ НЕПРАВИЛЬНО: "Привет! Я могу помочь вам с этим вопросом о программировании. Давайте рассмотрим..."
✅ ПРАВИЛЬНО: "Вот решение на Python: [код]. Сложность O(n). Альтернатива: [вариант]."

❌ НЕПРАВИЛЬНО: "Это интересный вопрос о математике. Я с удовольствием помогу вам разобраться..."
✅ ПРАВИЛЬНО: "Уравнение решается через дискриминант: D = b² - 4ac. Для твоего случая: [решение]."

❌ НЕПРАВИЛЬНО: "Спасибо за ваш вопрос! Я здесь чтобы помочь..."
✅ ПРАВИЛЬНО: "API ключ не настроен. Добавь MISTRAL_API_KEY в Environment Variables Vercel."

ФОРМАТИРОВАНИЕ:
• Код — в отдельных блоках с указанием языка
• Важные термины — жирным
• Списки — через дефис
• Математика — формулами
• Без смайлов в технических ответах

НАЧАЛО ДИАЛОГА:
Когда пользователь пишет /start — просто скажи что бот работает. Никаких длинных приветствий.

ТВОЯ ЦЕЛЬ: Быть самым полезным и техничным ботом. Как senior developer который помогает junior-у.`;

// ========== ХРАНЕНИЕ ==========
const userHistories = new Map();

// Получить историю
function getUserHistory(userId) {
  if (!userHistories.has(userId)) {
    userHistories.set(userId, [
      { role: 'system', content: MY_STYLE_PROMPT }
    ]);
  }
  return userHistories.get(userId).slice(-8); // Мало истории для точности
}

// Добавить в историю
function addToHistory(userId, role, content) {
  if (!userHistories.has(userId)) {
    userHistories.set(userId, [
      { role: 'system', content: MY_STYLE_PROMPT }
    ]);
  }
  
  const history = userHistories.get(userId);
  history.push({ role, content });
  
  // Держим историю короткой для точности
  if (history.length > 9) {
    history.splice(1, 1); // Удаляем самое старое сообщение
  }
}

// Очистить историю
function clearUserHistory(userId) {
  userHistories.delete(userId);
}

// ========== ФУНКЦИИ ==========

// Анализ сложности вопроса
function getQuestionType(text) {
  const textLower = text.toLowerCase();
  
  // Программирование
  if (textLower.includes('код') || textLower.includes('алгоритм') || 
      textLower.includes('функци') || textLower.match(/python|javascript|java|c\+\+|html|css|sql/)) {
    return 'code';
  }
  
  // Математика
  if (textLower.includes('реши') || textLower.includes('уравнен') || 
      textLower.includes('задач') || textLower.match(/\d[\+\-\*\/\^]\d/) ||
      textLower.includes('математик')) {
    return 'math';
  }
  
  // Технические вопросы
  if (textLower.includes('api') || textLower.includes('сервер') || 
      textLower.includes('база') || textLower.includes('бот') ||
      textLower.includes('vercel') || textLower.includes('github')) {
    return 'tech';
  }
  
  // Фото/изображения
  if (textLower.includes('фото') || textLower.includes('изображен') || 
      textLower.includes('картинк')) {
    return 'photo';
  }
  
  return 'general';
}

// Получить промпт для типа вопроса
function getPromptForType(type, hasImage = false) {
  const basePrompt = MY_STYLE_PROMPT;
  
  const typePrompts = {
    code: `СЕЙЧАС: Отвечаешь на вопрос о программировании.
• Сразу давай рабочий код
• Указывай язык программирования
• Объясняй сложные моменты в комментариях
• Предлагай альтернативные решения
• Указывай сложность алгоритма (Big O)
• Тестируй код в уме перед отправкой`,
    
    math: `СЕЙЧАС: Решаешь математическую задачу.
• Показывай решение по шагам
• Используй математические обозначения
• Проверяй вычисления
• Давай окончательный ответ четко
• Если есть несколько решений — покажи все`,
    
    tech: `СЕЙЧАС: Отвечаешь на технический/IT вопрос.
• Будь максимально точным
• Давай конкретные команды/настройки
• Ссылайся на документацию если нужно
• Предупреждай о возможных проблемах
• Давай практические советы`,
    
    photo: `СЕЙЧАС: Анализируешь изображение.
• Если фото содержит код/текст — читай и решай
• Если фото с задачей — решай задачу
• Если общее фото — описывай только технически важное
• Не описывай очевидное ("на фото белый лист")
• Решай, а не описывай`,
    
    general: `СЕЙЧАС: Отвечаешь на общий вопрос.
• Отвечай по сути
• Без лишних вступлений
• Если знаешь тему глубоко — давай детали
• Если не уверен — говори честно
• Ссылайся на проверенные источники`
  };
  
  let prompt = basePrompt + '\n\n' + (typePrompts[type] || typePrompts.general);
  
  if (hasImage) {
    prompt += '\n\nЕСТЬ ФОТО: Анализируй содержимое, решай задачи на фото, отвечай на вопросы по фото.';
  }
  
  return prompt;
}

// Запрос к AI
async function queryMistralAI(messages, questionType, hasImage = false) {
  try {
    // Обновляем системный промпт для этого вопроса
    if (messages[0].role === 'system') {
      messages[0].content = getPromptForType(questionType, hasImage);
    }
    
    const model = hasImage ? 'mistral-small-latest' : 
                 (questionType === 'code' || questionType === 'math') ? 'mistral-medium-latest' : 'mistral-small-latest';
    
    const response = await axios.post(
      'https://api.mistral.ai/v1/chat/completions',
      {
        model: model,
        messages: messages,
        max_tokens: questionType === 'code' ? 2000 : 1500,
        temperature: questionType === 'code' ? 0.2 : 0.5, // Для кода меньше креативности
        top_p: 0.9,
        frequency_penalty: 0.1,
        presence_penalty: 0.1
      },
      {
        headers: {
          'Authorization': `Bearer ${MISTRAL_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 40000
      }
    );
    
    return {
      success: true,
      answer: response.data.choices[0].message.content,
      model: model,
      tokens: response.data.usage?.total_tokens
    };
    
  } catch (error) {
    console.error('API Error:', error.message);
    return {
      success: false,
      error: 'Ошибка API',
      suggestion: 'Попробуй позже или проверь ключ Mistral.'
    };
  }
}

// Анализ фото с задачами
async function analyzePhotoWithTasks(imageUrl, questionType) {
  try {
    const prompt = questionType === 'math' ? 
      `На фото математические задачи. РЕШИ ИХ. Давай ответы по порядку, без лишних описаний. Только решение.` :
      `На фото техническая информация. Проанализируй и дай ответ. Без описания фото.`;
    
    const response = await axios.post(
      'https://api.mistral.ai/v1/chat/completions',
      {
        model: 'mistral-small-latest',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: imageUrl } }
            ]
          }
        ],
        max_tokens: 2000,
        temperature: 0.3
      },
      {
        headers: {
          'Authorization': `Bearer ${MISTRAL_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 60000
      }
    );
    
    return {
      success: true,
      answer: response.data.choices[0].message.content
    };
    
  } catch (error) {
    return {
      success: false,
      error: 'Не удалось прочитать фото',
      suggestion: 'Сфотографируй четче или опиши задачу текстом.'
    };
  }
}

// Форматирование ответа в моем стиле
function formatMyStyle(text, questionType) {
  let formatted = text;
  
  // Убираем шаблонные фразы
  const templatePhrases = [
    'Привет!', 'Здравствуйте!', 'Как я могу помочь', 'Я здесь, чтобы',
    'Спасибо за вопрос', 'Рад помочь', 'Могу я помочь', 'Не стесняйтесь',
    'Это интересный вопрос', 'Давайте рассмотрим', 'Я с удовольствием'
  ];
  
  templatePhrases.forEach(phrase => {
    const regex = new RegExp(`${phrase}[^.!?]*[.!?]`, 'gi');
    formatted = formatted.replace(regex, '');
  });
  
  // Форматирование кода
  if (questionType === 'code') {
    formatted = formatted.replace(/```(\w+)?\n([\s\S]*?)```/g, (match, lang, code) => {
      return `\`\`\`${lang || ''}\n${code.trim()}\n\`\`\``;
    });
  }
  
  // Форматирование математики
  if (questionType === 'math') {
    formatted = formatted.replace(/\$(.*?)\$/g, '`$1`');
  }
  
  // Убираем двойные переносы
  formatted = formatted.replace(/\n{3,}/g, '\n\n');
  
  return formatted.trim();
}

// ========== КОМАНДЫ ==========

// /start - КОРОТКО
bot.start((ctx) => {
  clearUserHistory(ctx.from.id);
  ctx.reply(`🤖 Бот работает.\n/help - команды\n/clear - сброс\n\nОтправляй вопросы — отвечу без воды.`);
});

// /help - ТОЧНО
bot.help((ctx) => {
  ctx.reply(`Команды:
/clear - сбросить историю
/code [вопрос] - для программирования
/math [вопрос] - для математики

Отправь фото с задачей — решу.
Пиши вопросы прямо — отвечу по делу.

Примеры:
"Как сделать Telegram бота?"
"Реши: 2x² = x"
Отправь фото с кодом/задачей`);
});

// /clear - ПРЯМО
bot.command('clear', (ctx) => {
  clearUserHistory(ctx.from.id);
  ctx.reply('История сброшена.');
});

// /code - для программирования
bot.command('code', (ctx) => {
  const question = ctx.message.text.replace('/code', '').trim();
  if (!question) {
    ctx.reply('Напиши вопрос о программировании после /code');
    return;
  }
  
  ctx.reply(`💻 Вопрос о коде: "${question}"\nДумаю...`);
  
  // Обработка будет в основном обработчике
});

// /math - для математики
bot.command('math', (ctx) => {
  const question = ctx.message.text.replace('/math', '').trim();
  if (!question) {
    ctx.reply('Напиши математическую задачу после /math');
    return;
  }
  
  ctx.reply(`🧮 Задача: "${question}"\nРешаю...`);
});

// ========== ОБРАБОТКА ТЕКСТА ==========
bot.on('text', async (ctx) => {
  const userId = ctx.from.id;
  const userText = ctx.message.text;
  
  if (userText.startsWith('/')) return;
  
  if (!MISTRAL_KEY) {
    return ctx.reply('Mistral API ключ не настроен. Добавь MISTRAL_API_KEY в Vercel Environment Variables.');
  }
  
  // Определяем тип вопроса
  const questionType = getQuestionType(userText);
  const typeIcons = {
    code: '💻',
    math: '🧮', 
    tech: '🔧',
    photo: '📸',
    general: '🤔'
  };
  
  const waitMsg = await ctx.reply(`${typeIcons[questionType]} Анализирую...`);
  
  try {
    addToHistory(userId, 'user', userText);
    const historyMessages = getUserHistory(userId);
    
    const aiResult = await queryMistralAI(historyMessages, questionType);
    
    if (aiResult.success) {
      addToHistory(userId, 'assistant', aiResult.answer);
      await ctx.deleteMessage(waitMsg.message_id);
      
      // Форматируем в моем стиле
      const formattedAnswer = formatMyStyle(aiResult.answer, questionType);
      await ctx.reply(formattedAnswer, {
        parse_mode: questionType === 'code' || questionType === 'math' ? 'Markdown' : undefined,
        disable_web_page_preview: true
      });
      
    } else {
      await ctx.deleteMessage(waitMsg.message_id);
      ctx.reply(`${aiResult.error} ${aiResult.suggestion}`);
    }
    
  } catch (error) {
    if (waitMsg) {
      try {
        await ctx.deleteMessage(waitMsg.message_id);
      } catch (e) {}
    }
    
    ctx.reply(`Ошибка: ${error.message}`);
  }
});

// ========== ОБРАБОТКА ФОТО ==========
bot.on('photo', async (ctx) => {
  const userId = ctx.from.id;
  
  if (!MISTRAL_KEY) {
    return ctx.reply('API ключ не настроен.');
  }
  
  // Проверяем подпись к фото
  const caption = ctx.message.caption || '';
  const questionType = getQuestionType(caption) || 'math'; // По умолчанию математика
  
  const waitMsg = await ctx.reply('📸 Читаю фото...');
  
  try {
    // Получаем фото
    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    const fileLink = await ctx.telegram.getFileLink(photo.file_id);
    const imageUrl = fileLink.href;
    
    // Добавляем в историю
    addToHistory(userId, 'user', `[Фото${caption ? ': ' + caption : ''}]`);
    
    // Анализируем фото
    const photoResult = await analyzePhotoWithTasks(imageUrl, questionType);
    
    if (photoResult.success) {
      addToHistory(userId, 'assistant', photoResult.answer);
      await ctx.deleteMessage(waitMsg.message_id);
      
      // Форматируем ответ
      let response = photoResult.answer;
      
      // Убираем описание если фото с задачей
      if (questionType === 'math' && response.includes('На фото')) {
        const lines = response.split('\n');
        const solutionLines = lines.filter(line => 
          !line.toLowerCase().includes('на фото') && 
          !line.toLowerCase().includes('вижу') &&
          !line.toLowerCase().includes('описание')
        );
        response = solutionLines.join('\n');
      }
      
      await ctx.reply(`📝 Решение:\n\n${response.trim()}`);
      
    } else {
      await ctx.deleteMessage(waitMsg.message_id);
      ctx.reply(`${photoResult.error}\n${photoResult.suggestion}`);
    }
    
  } catch (error) {
    await ctx.deleteMessage(waitMsg.message_id);
    ctx.reply('Не удалось обработать фото. Попробуй сфотографировать четче или описать текстом.');
  }
});

// ========== WEBHOOK ==========
module.exports = async (req, res) => {
  if (req.method === 'GET') {
    return res.status(200).json({
      status: 'Expert Bot - No Bullshit Edition',
      style: 'Technical, direct, no fluff',
      users: userHistories.size,
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
