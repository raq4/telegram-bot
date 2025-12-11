const { Telegraf, session } = require('telegraf');
const axios = require('axios');
const { createCanvas } = require('canvas');

const bot = new Telegraf(process.env.TELEGRAM_TOKEN);
const MISTRAL_KEY = process.env.MISTRAL_API_KEY;

// Добавляем session middleware
bot.use(session());

// ========== ПРОСТАЯ АДМИН СИСТЕМА ==========
const ADMINS = [815509230]; // Ваш ID - создатель по умолчанию

// Функция проверки админа
function isAdmin(userId) {
  return ADMINS.includes(parseInt(userId));
}

// ========== УЛУЧШЕННЫЙ СТИЛЬ ==========
const IMPROVED_STYLE = `ТЫ — ЭКСПЕРТ ПО РЕШЕНИЮ МАТЕМАТИЧЕСКИХ ЗАДАЧ.
ТВОЯ ЦЕЛЬ — ДАВАТЬ ТОЧНЫЕ, ПОДРОБНЫЕ И ПОНЯТНЫЕ РЕШЕНИЯ.

ВАЖНЕЙШИЕ ПРАВИЛА:
1. ВСЕГДА ОТВЕЧАЙ ТОЛЬКО НА РУССКОМ ЯЗЫКЕ
2. ЕСЛИ СПРАШИВАЮТ О СОЗДАТЕЛЕ — ОТВЕЧАЙ: @rafaelkazaryan
3. ДЕЛАЙ ПОЛНЫЕ, ПОДРОБНЫЕ РЕШЕНИЯ С ПОШАГОВЫМ ОБЪЯСНЕНИЕМ
4. ИСПОЛЬЗУЙ ТОЛЬКО ПРАВИЛЬНЫЕ МАТЕМАТИЧЕСКИЕ ТЕРМИНЫ
5. ПРОВЕРЯЙ СВОИ ВЫЧИСЛЕНИЯ

ТРЕБОВАНИЯ К ФОРМУЛАМ:
1. ВСЕ МАТЕМАТИЧЕСКИЕ ВЫРАЖЕНИЯ В ФОРМАТЕ LaTeX В ДВОЙНЫХ ДОЛЛАРАХ: $$...$$
2. Дроби: \\frac{числитель}{знаменатель}
3. Степени: x^{n}, a^{b+c}
4. Корни: \\sqrt[n]{x}, \\sqrt{x+y}
5. Интегралы: \\int_{a}^{b} f(x) dx
6. Производные: \\frac{d}{dx} f(x)
7. Суммы: \\sum_{i=1}^{n} a_i
8. Греческие буквы: \\alpha, \\beta, \\gamma, \\pi
9. Операции: \\times, \\div, \\pm, \\mp
10. Сравнения: =, \\neq, <, >, \\leq, \\geq
11. Скобки: (), [], \\{\\}, \\langle \\rangle
12. Матрицы: \\begin{matrix} a & b \\\\ c & d \\end{matrix}

СТРУКТУРА ОТВЕТА:
1. ПОНЯТИЕ ЗАДАЧИ (что дано, что найти)
2. ТЕОРИЯ (используемые формулы и правила)
3. РЕШЕНИЕ (пошагово с объяснениями)
4. ОТВЕТ (четко и ясно)
5. ПРОВЕРКА (если возможно)

ПРИМЕР ОТВЕТА:

**Задача:** Найти производную функции f(x) = x² + 3x - 5

**Теория:** Для нахождения производной используем правила:
- Производная суммы равна сумме производных
- (x^n)' = n·x^{n-1}
- (c)' = 0, где c - константа

**Решение:**
1. f(x) = x² + 3x - 5
2. f'(x) = (x²)' + (3x)' - (5)'
3. f'(x) = 2x^{2-1} + 3·1·x^{1-1} - 0
4. f'(x) = 2x¹ + 3·x⁰
5. f'(x) = 2x + 3·1
6. $$f'(x) = 2x + 3$$

**Ответ:** $$f'(x) = 2x + 3$$

**Проверка:** Можно найти производную каждого слагаемого отдельно, результат совпадает.

ВСЕГДА СЛЕДУЙ ЭТОЙ СТРУКТУРЕ!`;

// ========== ХРАНЕНИЕ ==========
const userHistories = new Map();

function getUserHistory(userId) {
  if (!userHistories.has(userId)) {
    userHistories.set(userId, [
      { role: 'system', content: IMPROVED_STYLE }
    ]);
  }
  return userHistories.get(userId);
}

function addToHistory(userId, role, content) {
  if (!userHistories.has(userId)) {
    userHistories.set(userId, [
      { role: 'system', content: IMPROVED_STYLE }
    ]);
  }
  
  const history = userHistories.get(userId);
  history.push({ role, content });
  
  // Ограничиваем историю 10 сообщениями
  if (history.length > 10) {
    history.splice(1, 2); // Удаляем старые сообщения, кроме системного
  }
}

function clearUserHistory(userId) {
  userHistories.delete(userId);
}

// ========== ПАРСИНГ LATEX ИЗ ОТВЕТА ==========
function extractLatexFromAnswer(text) {
  if (!text) return null;
  
  const latexMatches = text.match(/\$\$(.*?)\$\$/gs);
  if (!latexMatches || latexMatches.length === 0) return null;
  
  // Возвращаем все формулы
  const latexFormulas = latexMatches.map(match => 
    match.replace(/\$\$/g, '').trim()
  );
  
  // Возвращаем первую или объединяем несколько
  return latexFormulas.length === 1 ? latexFormulas[0] : latexFormulas.join('\n\n');
}

// ========== ГЕНЕРАЦИЯ ИЗОБРАЖЕНИЯ С ФОРМУЛОЙ ==========
async function generateFormulaImage(latexFormula) {
  try {
    // Разделяем формулы если их несколько
    const formulas = latexFormula.split('\n\n');
    
    // Для CodeCogs нужно отдельно обработать каждую формулу
    const encodedFormulas = formulas.map(formula => 
      encodeURIComponent(formula.trim())
    );
    
    // Если формула одна
    if (encodedFormulas.length === 1) {
      const imageUrl = `https://latex.codecogs.com/svg.latex?\\bg_white&space;\\huge&space;${encodedFormulas[0]}`;
      
      const response = await axios.get(imageUrl, {
        responseType: 'arraybuffer',
        timeout: 15000
      });
      
      return response.data;
    }
    
    // Для нескольких формул создаем изображение через canvas
    const Canvas = require('canvas');
    const canvas = Canvas.createCanvas(800, formulas.length * 120 + 100);
    const ctx = canvas.getContext('2d');
    
    // Белый фон
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Черный текст
    ctx.fillStyle = 'black';
    ctx.font = 'bold 36px Arial';
    ctx.textAlign = 'center';
    
    // Заголовок
    ctx.fillText('Решение:', canvas.width / 2, 60);
    
    // Формулы
    ctx.font = '28px Arial';
    formulas.forEach((formula, index) => {
      ctx.fillText(formula, canvas.width / 2, 120 + index * 100);
    });
    
    return canvas.toBuffer();
    
  } catch (error) {
    console.error('Ошибка генерации формулы:', error.message);
    return null;
  }
}

// ========== ОБРАБОТКА ОТВЕТА ==========
function processAnswer(text) {
  if (!text) return { text: '', latex: null };
  
  let cleanText = text;
  // Убираем лишние звездочки но сохраняем структуру
  cleanText = cleanText.replace(/\*\*(.*?)\*\*/g, '$1');
  cleanText = cleanText.replace(/\*(.*?)\*/g, '$1');
  
  const latex = extractLatexFromAnswer(cleanText);
  const textOnly = cleanText.replace(/\$\$(.*?)\$\$/gs, '').trim();
  
  return {
    text: textOnly,
    latex: latex
  };
}

// ========== УЛУЧШЕННЫЙ ЗАПРОС К AI ==========
async function queryMistral(messages, isImage = false) {
  try {
    const model = isImage ? 'mistral-large-latest' : 'mistral-small-latest';
    
    const response = await axios.post(
      'https://api.mistral.ai/v1/chat/completions',
      {
        model: model,
        messages: messages,
        max_tokens: 2000,
        temperature: 0.1, // Низкая температура для точности
        top_p: 0.9,
        response_format: { type: "text" }
      },
      {
        headers: {
          'Authorization': `Bearer ${MISTRAL_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 45000
      }
    );
    
    const answer = response.data.choices[0].message.content;
    const processed = processAnswer(answer);
    
    return {
      success: true,
      text: processed.text,
      latex: processed.latex
    };
    
  } catch (error) {
    console.error('Mistral error:', error.response?.data || error.message);
    return {
      success: false,
      text: `Ошибка при обработке запроса. Пожалуйста, попробуйте еще раз.`,
      latex: null
    };
  }
}

// ========== УЛУЧШЕННАЯ ОБРАБОТКА ФОТО ==========
async function processPhotoWithAI(imageUrl, caption = '') {
  try {
    const prompt = `ПРОАНАЛИЗИРУЙ ЭТО ИЗОБРАЖЕНИЕ И РЕШИ ЗАДАЧУ.

ЕСЛИ НА ИЗОБРАЖЕНИИ:
1. МАТЕМАТИЧЕСКАЯ ЗАДАЧА, УРАВНЕНИЕ ИЛИ ПРИМЕР — РЕШИ ЕГО ПОЛНОСТЬЮ
2. ГРАФИК ИЛИ ДИАГРАММА — ОПИШИ И ПРОАНАЛИЗИРУЙ
3. ТЕКСТ НА ИНОСТРАННОМ ЯЗЫКЕ — ПЕРЕВЕДИ НА РУССКИЙ
4. ДРУГОЕ — ОПИШИ ЧТО ТЫ ВИДИШЬ

ВАЖНЫЕ ПРАВИЛА:
1. БУДЬ ВНИМАТЕЛЕН К ДЕТАЛЯМ
2. РАСПОЗНАВАЙ РУКОПИСНЫЙ ТЕКСТ
3. ИСПОЛЬЗУЙ МАТЕМАТИЧЕСКИЕ СИМВОЛЫ ПРАВИЛЬНО
4. ДАВАЙ ПОЛНЫЕ РЕШЕНИЯ С ПОДРОБНЫМИ ОБЪЯСНЕНИЯМИ
5. ВСЕ ФОРМУЛЫ В ФОРМАТЕ LaTeX: $$...$$

${caption ? `КОММЕНТАРИЙ ПОЛЬЗОВАТЕЛЯ К ФОТО: "${caption}"` : ''}

СТРУКТУРА ОТВЕТА:
1. ОПИСАНИЕ ИЗОБРАЖЕНИЯ
2. ПОСТАНОВКА ЗАДАЧИ
3. ТЕОРЕТИЧЕСКАЯ ЧАСТЬ
4. ПОШАГОВОЕ РЕШЕНИЕ
5. ОТВЕТ
6. ПРОВЕРКА ИЛИ ДОПОЛНИТЕЛЬНЫЕ КОММЕНТАРИИ`;

    const response = await axios.post(
      'https://api.mistral.ai/v1/chat/completions',
      {
        model: 'mistral-large-latest',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: imageUrl } }
            ]
          }
        ],
        max_tokens: 2500,
        temperature: 0.1,
        top_p: 0.9
      },
      {
        headers: {
          'Authorization': `Bearer ${MISTRAL_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 60000
      }
    );
    
    const answer = response.data.choices[0].message.content;
    const processed = processAnswer(answer);
    
    return {
      success: true,
      text: processed.text,
      latex: processed.latex
    };
    
  } catch (error) {
    console.error('Photo processing error:', error.message);
    return {
      success: false,
      text: `Не удалось обработать изображение. Пожалуйста, опишите задачу текстом.`,
      latex: null
    };
  }
}

// ========== КОМАНДЫ ==========
bot.start((ctx) => {
  clearUserHistory(ctx.from.id);
  ctx.reply(`🧮 *Привет! Я — умный математический помощник.*\n\n` +
    `Я могу:\n` +
    `✅ Решать математические задачи\n` +
    `✅ Работать с уравнениями и формулами\n` +
    `✅ Анализировать фотографии задач\n` +
    `✅ Давать подробные решения с объяснениями\n\n` +
    `Просто отправь мне задачу текстом или фото!\n` +
    `/clear — очистить историю диалога`,
    { parse_mode: 'Markdown' });
});

bot.help((ctx) => {
  ctx.reply(`📚 *Как использовать бота:*\n\n` +
    `1. Отправь математическую задачу текстом\n` +
    `2. Или отправь фото с задачей\n` +
    `3. Я решу ее с подробным объяснением\n` +
    `4. Все формулы будут в красивом формате\n\n` +
    `*Примеры задач:*\n` +
    `• Решить уравнение: x² - 5x + 6 = 0\n` +
    `• Найти производную: f(x) = sin(x) + cos(x)\n` +
    `• Вычислить интеграл\n` +
    `• Задачи по геометрии и алгебре`,
    { parse_mode: 'Markdown' });
});

bot.command('clear', (ctx) => {
  clearUserHistory(ctx.from.id);
  ctx.reply('🗑️ История диалога очищена. Можете задавать новые вопросы!');
});

// ========== ПРОСТАЯ АДМИН ПАНЕЛЬ ==========
bot.command('admin', (ctx) => {
  const userId = ctx.from.id;
  
  if (!isAdmin(userId)) {
    return ctx.reply('❌ Доступ только для администраторов');
  }
  
  ctx.reply(
    `👑 *Админ панель*\n\n` +
    `Ваш ID: \`${userId}\`\n` +
    `Всего админов: ${ADMINS.length}\n\n` +
    `*Команды:*\n` +
    `/admins — список админов\n` +
    `/addadmin [ID] — добавить админа\n` +
    `/deladmin [ID] — удалить админа\n` +
    `/stats — статистика\n` +
    `/broadcast [текст] — рассылка`,
    { parse_mode: 'Markdown' }
  );
});

bot.command('admins', (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    return ctx.reply('❌ Доступ только для администраторов');
  }
  
  const adminList = ADMINS.map(id => 
    `${id} ${id === 815509230 ? '👑 (создатель)' : ''} ${id === ctx.from.id ? '(вы)' : ''}`
  ).join('\n');
  
  ctx.reply(`📋 *Администраторы:*\n\n${adminList}\n\nВсего: ${ADMINS.length}`, 
    { parse_mode: 'Markdown' });
});

bot.command('addadmin', (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    return ctx.reply('❌ Доступ только для администраторов');
  }
  
  const args = ctx.message.text.split(' ');
  
  if (args.length < 2) {
    return ctx.reply('❌ Используйте: `/addadmin [ID]`\nПример: `/addadmin 123456789`', 
      { parse_mode: 'Markdown' });
  }
  
  const newAdminId = parseInt(args[1]);
  
  if (isNaN(newAdminId)) {
    return ctx.reply('❌ Неверный ID. ID должен быть числом');
  }
  
  if (ADMINS.includes(newAdminId)) {
    return ctx.reply('❌ Этот пользователь уже администратор');
  }
  
  ADMINS.push(newAdminId);
  ctx.reply(`✅ Пользователь \`${newAdminId}\` добавлен в администраторы`, 
    { parse_mode: 'Markdown' });
});

bot.command('deladmin', (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    return ctx.reply('❌ Доступ только для администраторов');
  }
  
  const userId = ctx.from.id;
  const args = ctx.message.text.split(' ');
  
  if (args.length < 2) {
    return ctx.reply('❌ Используйте: `/deladmin [ID]`\nПример: `/deladmin 123456789`', 
      { parse_mode: 'Markdown' });
  }
  
  const adminIdToRemove = parseInt(args[1]);
  
  if (isNaN(adminIdToRemove)) {
    return ctx.reply('❌ Неверный ID');
  }
  
  if (adminIdToRemove === 815509230) {
    return ctx.reply('❌ Нельзя удалить создателя бота');
  }
  
  if (!ADMINS.includes(adminIdToRemove)) {
    return ctx.reply('❌ Этот пользователь не является администратором');
  }
  
  const index = ADMINS.indexOf(adminIdToRemove);
  ADMINS.splice(index, 1);
  
  ctx.reply(`✅ Администратор \`${adminIdToRemove}\` удален`, 
    { parse_mode: 'Markdown' });
});

bot.command('stats', (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    return ctx.reply('❌ Доступ только для администраторов');
  }
  
  const totalUsers = userHistories.size;
  const totalAdmins = ADMINS.length;
  const memoryUsage = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
  const uptime = Math.round(process.uptime() / 60);
  
  ctx.reply(
    `📊 *Статистика бота:*\n\n` +
    `👤 Активных пользователей: ${totalUsers}\n` +
    `👑 Администраторов: ${totalAdmins}\n` +
    `💾 Память: ${memoryUsage} MB\n` +
    `⏱ Время работы: ${uptime} мин\n` +
    `🤖 Модель: Mistral AI`,
    { parse_mode: 'Markdown' }
  );
});

bot.command('broadcast', async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    return ctx.reply('❌ Доступ только для администраторов');
  }
  
  const message = ctx.message.text.replace('/broadcast', '').trim();
  
  if (!message) {
    return ctx.reply('❌ Введите сообщение для рассылки\nПример: `/broadcast Привет всем пользователям!`', 
      { parse_mode: 'Markdown' });
  }
  
  const users = Array.from(userHistories.keys());
  const totalUsers = users.length;
  
  if (totalUsers === 0) {
    return ctx.reply('❌ Нет пользователей для рассылки');
  }
  
  const progressMsg = await ctx.reply(`📤 *Начинаю рассылку для ${totalUsers} пользователей...*\n0/${totalUsers}`, 
    { parse_mode: 'Markdown' });
  
  let success = 0;
  let failed = 0;
  
  for (let i = 0; i < users.length; i++) {
    const userId = users[i];
    
    if (ADMINS.includes(userId)) {
      success++;
      continue;
    }
    
    try {
      await ctx.telegram.sendMessage(userId, `📢 *Рассылка от администратора:*\n\n${message}`, 
        { parse_mode: 'Markdown' });
      success++;
    } catch (error) {
      failed++;
    }
    
    if (i % 5 === 0 || i === users.length - 1) {
      try {
        await ctx.telegram.editMessageText(
          ctx.chat.id,
          progressMsg.message_id,
          null,
          `📤 *Рассылка...*\n` +
          `✅ Отправлено: ${success}\n` +
          `❌ Ошибок: ${failed}\n` +
          `📊 Всего: ${totalUsers}\n` +
          `⏳ Прогресс: ${Math.round((i + 1) / totalUsers * 100)}%`,
          { parse_mode: 'Markdown' }
        );
      } catch (e) {}
    }
    
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  
  await ctx.telegram.editMessageText(
    ctx.chat.id,
    progressMsg.message_id,
    null,
    `✅ *Рассылка завершена!*\n\n` +
    `📤 Успешно: ${success} пользователей\n` +
    `❌ Ошибок: ${failed}\n` +
    `📊 Всего: ${totalUsers}`,
    { parse_mode: 'Markdown' }
  );
});

// ========== ОБРАБОТКА ТЕКСТА ==========
bot.on('text', async (ctx) => {
  const userId = ctx.from.id;
  const userText = ctx.message.text.trim();
  
  if (userText.startsWith('/')) return;
  
  // ========== ОБРАБОТКА ВОПРОСОВ О СОЗДАТЕЛЕ ==========
  const creatorKeywords = [
    'кто твой создатель', 'кто тебя создал', 'кто твой автор',
    'кто тебя сделал', 'кто тебя разработал', 'твой создатель',
    'твой автор', 'твой разработчик', 'кто тебя придумал',
    'кто тебя написал', 'кто создал тебя', 'кто разработал тебя',
    'создатель', 'автор', 'разработчик', 'создал тебя',
    'придумал тебя', 'создатель бота', 'автор бота',
    'разработчик бота', 'кто создал этого бота', 'кто автор этого бота'
  ];
  
  const lowerText = userText.toLowerCase();
  
  const isCreatorQuestion = creatorKeywords.some(keyword => {
    const cleanText = lowerText.replace(/[.,?!]/g, '').trim();
    const cleanKeyword = keyword.toLowerCase();
    return cleanText.includes(cleanKeyword);
  });
  
  if (isCreatorQuestion || lowerText === 'кто ты' || lowerText === 'ты кто') {
    return ctx.reply('@rafaelkazaryan');
  }
  
  if (!MISTRAL_KEY) {
    return ctx.reply('⚠️ Сервис временно недоступен. Попробуйте позже.');
  }
  
  const waitMsg = await ctx.reply('🤔 *Анализирую задачу...*', { parse_mode: 'Markdown' });
  
  try {
    addToHistory(userId, 'user', userText);
    const history = getUserHistory(userId);
    
    const result = await queryMistral(history);
    
    await ctx.deleteMessage(waitMsg.message_id);
    
    if (result.success) {
      addToHistory(userId, 'assistant', result.text);
      
      // Отправляем текстовый ответ
      if (result.text) {
        const formattedText = result.text
          .replace(/^#+\s*/gm, '') // Убираем маркдаун заголовки
          .replace(/\*\*(.*?)\*\*/g, '*$1*'); // Преобразуем в телеграм маркдаун
        
        await ctx.reply(formattedText, { parse_mode: 'Markdown' });
      }
      
      // Если есть формулы, генерируем изображение
      if (result.latex) {
        try {
          const generatingMsg = await ctx.reply('📐 *Генерирую формулы...*', { parse_mode: 'Markdown' });
          
          const imageBuffer = await generateFormulaImage(result.latex);
          
          if (imageBuffer) {
            await ctx.deleteMessage(generatingMsg.message_id);
            
            await ctx.replyWithPhoto(
              { source: Buffer.from(imageBuffer) },
              { caption: '📖 *Математические формулы:*', parse_mode: 'Markdown' }
            );
          } else {
            await ctx.editMessageText(generatingMsg.message_id, 
              '📝 *Формулы в текстовом виде:*\n```latex\n' + result.latex + '\n```',
              { parse_mode: 'Markdown' }
            );
          }
        } catch (imgError) {
          await ctx.reply('📝 *Формулы:*\n```latex\n' + result.latex + '\n```', 
            { parse_mode: 'Markdown' });
        }
      }
    } else {
      await ctx.reply(result.text);
    }
    
  } catch (error) {
    try {
      await ctx.deleteMessage(waitMsg.message_id);
    } catch (e) {}
    
    ctx.reply(`❌ Ошибка: ${error.message}\nПожалуйста, попробуйте еще раз.`);
  }
});

// ========== УЛУЧШЕННАЯ ОБРАБОТКА ФОТО ==========
bot.on('photo', async (ctx) => {
  const userId = ctx.from.id;
  
  if (!MISTRAL_KEY) {
    return ctx.reply('⚠️ Сервис временно недоступен. Попробуйте позже.');
  }
  
  const caption = ctx.message.caption || '';
  const waitMsg = await ctx.reply('👁️ *Анализирую изображение...*', { parse_mode: 'Markdown' });
  
  try {
    // Берем фото наилучшего качества
    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    const fileLink = await ctx.telegram.getFileLink(photo.file_id);
    const imageUrl = fileLink.href;
    
    console.log(`🖼️ Обработка фото от пользователя ${userId}, размер: ${photo.file_size} bytes`);
    
    addToHistory(userId, 'user', `[Фото: ${caption || 'математическая задача'}]`);
    
    // Используем улучшенную обработку фото
    const result = await processPhotoWithAI(imageUrl, caption);
    
    await ctx.deleteMessage(waitMsg.message_id);
    
    if (result.success) {
      addToHistory(userId, 'assistant', result.text);
      
      // Отправляем текстовый ответ
      if (result.text) {
        const formattedText = result.text
          .replace(/^#+\s*/gm, '')
          .replace(/\*\*(.*?)\*\*/g, '*$1*');
        
        // Разбиваем длинные сообщения (Telegram ограничение 4096 символов)
        const maxLength = 4000;
        if (formattedText.length > maxLength) {
          const parts = [];
          for (let i = 0; i < formattedText.length; i += maxLength) {
            parts.push(formattedText.substring(i, i + maxLength));
          }
          for (const part of parts) {
            await ctx.reply(part, { parse_mode: 'Markdown' });
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        } else {
          await ctx.reply(formattedText, { parse_mode: 'Markdown' });
        }
      }
      
      // Если есть формулы, генерируем изображение
      if (result.latex) {
        try {
          const generatingMsg = await ctx.reply('📐 *Генерирую формулы из решения...*', 
            { parse_mode: 'Markdown' });
          
          const imageBuffer = await generateFormulaImage(result.latex);
          
          if (imageBuffer) {
            await ctx.deleteMessage(generatingMsg.message_id);
            
            await ctx.replyWithPhoto(
              { source: Buffer.from(imageBuffer) },
              { caption: '🧮 *Формулы решения:*', parse_mode: 'Markdown' }
            );
          } else {
            await ctx.editMessageText(generatingMsg.message_id, 
              '📝 *Формулы:*\n```latex\n' + result.latex + '\n```',
              { parse_mode: 'Markdown' }
            );
          }
        } catch (imgError) {
          await ctx.reply('📝 *Формулы решения:*\n```latex\n' + result.latex + '\n```', 
            { parse_mode: 'Markdown' });
        }
      }
    } else {
      await ctx.reply(result.text);
    }
    
  } catch (error) {
    await ctx.deleteMessage(waitMsg.message_id);
    console.error('Photo processing error:', error);
    ctx.reply('❌ Не удалось обработать изображение. Пожалуйста:\n' +
      '1. Убедитесь, что фото четкое и хорошо освещено\n' +
      '2. Попробуйте описать задачу текстом\n' +
      '3. Или отправьте другое фото');
  }
});

// ========== WEBHOOK ==========
module.exports = async (req, res) => {
  console.log('🚀 Вебхук вызван, метод:', req.method);
  
  if (req.method === 'GET') {
    return res.status(200).json({
      status: 'Умный математический бот с админ-панелью',
      version: '2.0',
      features: [
        'Решение математических задач',
        'Обработка фото с задачами', 
        'Подробные решения с формулами',
        'Админ-панель управления'
      ],
      stats: {
        admins: ADMINS.length,
        active_users: userHistories.size,
        uptime: Math.round(process.uptime())
      },
      timestamp: new Date().toISOString()
    });
  }
  
  try {
    console.log('📨 Получено обновление от Telegram');
    await bot.handleUpdate(req.body);
    res.status(200).json({ ok: true });
  } catch (error) {
    console.error('❌ Ошибка вебхука:', error.message);
    res.status(500).json({ error: error.message });
  }
};
