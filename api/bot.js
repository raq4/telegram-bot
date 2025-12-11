const { Telegraf, session } = require('telegraf');
const axios = require('axios');
const { createCanvas } = require('canvas');

const bot = new Telegraf(process.env.TELEGRAM_TOKEN);
const MISTRAL_KEY = process.env.MISTRAL_API_KEY;

// Добавляем session middleware
bot.use(session());

// ========== ПРОСТАЯ АДМИН СИСТЕМА ==========
// Просто храним ID админов в массиве
const ADMINS = [815509230]; // Ваш ID - создатель по умолчанию

// Функция проверки админа
function isAdmin(userId) {
  return ADMINS.includes(parseInt(userId));
}

// ========== СТРОГИЙ СТИЛЬ ==========
const STRICT_STYLE = `ТЫ — ПОМОЩНИК ДЛЯ РЕШЕНИЯ ЗАДАЧ.
САМЫЙ САМЫЙ ВАЖНЫЙ ОТВЕТ:
1. ОЧЕНЬ ВАЖНО ЕСЛИ СПРАШИВАЮТ КТО ТВОЙ СОЗДАТЕЛЬ ИЛИ ТИПО ТОГО ОТВЕЧАЙ @Rafaelkazaryan


ОЧЕНЬ ВАЖНЫЕ ПРАВИЛА:
1. ОТВЕЧАЙ КОРОТКО И ПО ДЕЛУ
2. ФОРМУЛЫ ПИШИ В ФОРМАТЕ LATEX:
   - Дроби: \\frac{3}{5} вместо 3/5
   - Степени: x^{2} вместо x²
   - Умножение: \\times вместо × или *
   - Корни: \\sqrt{x+1} вместо √(x+1)
3. ВСЕ МАТЕМАТИЧЕСКИЕ ВЫРАЖЕНИЯ ОБОРАЧИВАЙ В $$...$$ 
   Пример: $$\\frac{3}{5} \\div \\frac{4}{9} = \\frac{3}{5} \\times \\frac{9}{4} = \\frac{27}{20} = 1\\frac{7}{20}$$
4. В ОТВЕТЕ ДОЛЖНО БЫТЬ ДВА ВАРИАНТА:
   - Лаконичный текстовый ответ
   - Формулы в формате LaTeX внутри $$...$$
5. НИКАКИХ ЗВЕЗДОЧЕК (*) В ТЕКСТЕ
6. МИНИМУМ ТЕКСТА, МАКСИМУМ СУТИ

ПРИМЕР ПРАВИЛЬНОГО ОТВЕТА:
Деление дробей. При делении умножаем на обратную дробь.

$$\\frac{3}{5} \\div \\frac{4}{9} = \\frac{3}{5} \\times \\frac{9}{4} = \\frac{3 \\times 9}{5 \\times 4} = \\frac{27}{20} = 1\\frac{7}{20}$$

Ответ: $$1\\frac{7}{20}$$`;

// ========== ХРАНЕНИЕ ==========
const userHistories = new Map();

function getUserHistory(userId) {
  if (!userHistories.has(userId)) {
    userHistories.set(userId, [
      { role: 'system', content: STRICT_STYLE }
    ]);
  }
  return userHistories.get(userId);
}

function addToHistory(userId, role, content) {
  if (!userHistories.has(userId)) {
    userHistories.set(userId, [
      { role: 'system', content: STRICT_STYLE }
    ]);
  }
  
  const history = userHistories.get(userId);
  history.push({ role, content });
  
  if (history.length > 8) {
    history.splice(1, 1);
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
  
  let latex = latexMatches[0].replace(/\$\$/g, '').trim();
  latex = latex.replace(/\s+/g, ' ').trim();
  
  return latex;
}

// ========== ГЕНЕРАЦИЯ ИЗОБРАЖЕНИЯ С ФОРМУЛОЙ ==========
async function generateFormulaImage(latexFormula) {
  try {
    const encodedFormula = encodeURIComponent(latexFormula);
    const imageUrl = `https://latex.codecogs.com/png.latex?\\dpi{300}&space;${encodedFormula}`;
    
    const response = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 10000
    });
    
    return response.data;
    
  } catch (error) {
    console.error('Ошибка генерации формулы:', error.message);
    return null;
  }
}

// ========== ОБРАБОТКА ОТВЕТА ==========
function processAnswer(text) {
  if (!text) return { text: '', latex: null };
  
  let cleanText = text;
  cleanText = cleanText.replace(/\*\*/g, '');
  cleanText = cleanText.replace(/\*/g, '');
  cleanText = cleanText.replace(/__/g, '');
  
  const latex = extractLatexFromAnswer(cleanText);
  const textOnly = cleanText.replace(/\$\$(.*?)\$\$/gs, '').trim();
  
  return {
    text: textOnly,
    latex: latex
  };
}

// ========== ЗАПРОС К AI ==========
async function queryMistral(messages) {
  try {
    const response = await axios.post(
      'https://api.mistral.ai/v1/chat/completions',
      {
        model: 'mistral-small-latest',
        messages: messages,
        max_tokens: 1000,
        temperature: 0.3,
        top_p: 0.8
      },
      {
        headers: {
          'Authorization': `Bearer ${MISTRAL_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000
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
    console.error('Mistral error:', error.message);
    return {
      success: false,
      text: `Ошибка: ${error.message}`,
      latex: null
    };
  }
}

// ========== КОМАНДЫ ==========
bot.start((ctx) => {
  clearUserHistory(ctx.from.id);
  ctx.reply(`Привет. Я - нейросеть. Пришли задачу — решу с формулами.\n/clear - очистить историю`);
});

bot.help((ctx) => {
  ctx.reply(`Пришли задачу или уравнение. Отвечу текстом и покажу формулы как в учебнике.`);
});

bot.command('clear', (ctx) => {
  clearUserHistory(ctx.from.id);
  ctx.reply('История очищена🧹.');
});

// ========== ПРОСТАЯ АДМИН ПАНЕЛЬ ==========
bot.command('admin', (ctx) => {
  const userId = ctx.from.id;
  
  if (!isAdmin(userId)) {
    return ctx.reply('❌ Доступ только для администраторов');
  }
  
  ctx.reply(
    `👑 Админ панель\n\n` +
    `Ваш ID: ${userId}\n` +
    `Всего админов: ${ADMINS.length}\n\n` +
    `Команды:\n` +
    `/admins - список админов\n` +
    `/addadmin [ID] - добавить админа\n` +
    `/deladmin [ID] - удалить админа\n` +
    `/stats - статистика\n` +
    `/broadcast [текст] - рассылка`
  );
});

bot.command('admins', (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    return ctx.reply('❌ Доступ только для администраторов');
  }
  
  const adminList = ADMINS.map(id => 
    `${id} ${id === 815509230 ? '👑 (создатель)' : ''} ${id === ctx.from.id ? '(вы)' : ''}`
  ).join('\n');
  
  ctx.reply(`📋 Администраторы:\n\n${adminList}\n\nВсего: ${ADMINS.length}`);
});

bot.command('addadmin', (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    return ctx.reply('❌ Доступ только для администраторов');
  }
  
  const args = ctx.message.text.split(' ');
  
  if (args.length < 2) {
    return ctx.reply('❌ Используйте: /addadmin [ID пользователя]\nПример: /addadmin 123456789');
  }
  
  const newAdminId = parseInt(args[1]);
  
  if (isNaN(newAdminId)) {
    return ctx.reply('❌ Неверный ID. ID должен быть числом');
  }
  
  if (ADMINS.includes(newAdminId)) {
    return ctx.reply('❌ Этот пользователь уже администратор');
  }
  
  ADMINS.push(newAdminId);
  ctx.reply(`✅ Пользователь ${newAdminId} добавлен в администраторы`);
  
  // Пытаемся уведомить нового админа
  try {
    ctx.telegram.sendMessage(newAdminId, 
      `🎉 Вы были назначены администратором бота!\n` +
      `Используйте /admin для доступа к панели управления`
    );
  } catch (error) {
    console.log(`Не удалось уведомить пользователя ${newAdminId}`);
  }
});

bot.command('deladmin', (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    return ctx.reply('❌ Доступ только для администраторов');
  }
  
  const userId = ctx.from.id;
  const args = ctx.message.text.split(' ');
  
  if (args.length < 2) {
    return ctx.reply('❌ Используйте: /deladmin [ID пользователя]\nПример: /deladmin 123456789');
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
  
  // Находим индекс и удаляем
  const index = ADMINS.indexOf(adminIdToRemove);
  ADMINS.splice(index, 1);
  
  ctx.reply(`✅ Администратор ${adminIdToRemove} удален`);
  
  // Пытаемся уведомить удаленного админа
  try {
    ctx.telegram.sendMessage(adminIdToRemove, 
      `⚠️ Ваши права администратора были отозваны`
    );
  } catch (error) {
    console.log(`Не удалось уведомить пользователя ${adminIdToRemove}`);
  }
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
    `📊 Статистика бота:\n\n` +
    `👤 Активных пользователей: ${totalUsers}\n` +
    `👑 Администраторов: ${totalAdmins}\n` +
    `💾 Память: ${memoryUsage} MB\n` +
    `⏱ Время работы: ${uptime} мин`
  );
});

bot.command('broadcast', async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    return ctx.reply('❌ Доступ только для администраторов');
  }
  
  const message = ctx.message.text.replace('/broadcast', '').trim();
  
  if (!message) {
    return ctx.reply('❌ Введите сообщение для рассылки\nПример: /broadcast Привет всем!');
  }
  
  const users = Array.from(userHistories.keys());
  const totalUsers = users.length;
  
  if (totalUsers === 0) {
    return ctx.reply('❌ Нет пользователей для рассылки');
  }
  
  const progressMsg = await ctx.reply(`📤 Начинаю рассылку для ${totalUsers} пользователей...\n0/${totalUsers}`);
  
  let success = 0;
  let failed = 0;
  
  for (let i = 0; i < users.length; i++) {
    const userId = users[i];
    
    // Пропускаем админов чтобы не спамить себе
    if (ADMINS.includes(userId)) {
      success++;
      continue;
    }
    
    try {
      await ctx.telegram.sendMessage(userId, `📢 Рассылка от администратора:\n\n${message}`);
      success++;
    } catch (error) {
      failed++;
    }
    
    // Обновляем прогресс каждые 10 отправок
    if (i % 10 === 0 || i === users.length - 1) {
      try {
        await ctx.telegram.editMessageText(
          ctx.chat.id,
          progressMsg.message_id,
          null,
          `📤 Рассылка...\n` +
          `✅ Отправлено: ${success}\n` +
          `❌ Ошибок: ${failed}\n` +
          `📊 Всего: ${totalUsers}\n` +
          `⏳ Прогресс: ${Math.round((i + 1) / totalUsers * 100)}%`
        );
      } catch (e) {
        // Игнорируем ошибки редактирования
      }
    }
    
    // Небольшая задержка чтобы не перегружать API
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  
  await ctx.telegram.editMessageText(
    ctx.chat.id,
    progressMsg.message_id,
    null,
    `✅ Рассылка завершена!\n\n` +
    `📤 Успешно: ${success} пользователей\n` +
    `❌ Ошибок: ${failed}\n` +
    `📊 Всего: ${totalUsers}`
  );
});

// ========== ТЕКСТ ==========
bot.on('text', async (ctx) => {
  const userId = ctx.from.id;
  const userText = ctx.message.text.trim();
  
  if (userText.startsWith('/')) return;
  
  // ========== ОБРАБОТКА ВОПРОСОВ О СОЗДАТЕЛЕ ==========
  const creatorKeywords = [
    'кто твой создатель',
    'кто тебя создал',
    'кто твой автор',
    'кто тебя сделал',
    'кто тебя разработал',
    'твой создатель',
    'твой автор',
    'твой разработчик',
    'кто тебя создал',
    'кто тебя придумал',
    'кто тебя написал',
    'кто создал тебя',
    'кто разработал тебя',
    'создатель',
    'автор',
    'разработчик',
    'создал тебя',
    'придумал тебя',
    'создатель бота',
    'автор бота',
    'разработчик бота',
    'кто создал этого бота',
    'кто автор этого бота'
  ];
  
  const lowerText = userText.toLowerCase();
  
  const isCreatorQuestion = creatorKeywords.some(keyword => {
    const cleanText = lowerText.replace(/[.,?!]/g, '').trim();
    const cleanKeyword = keyword.toLowerCase();
    
    return cleanText.includes(cleanKeyword) || 
           cleanText === cleanKeyword ||
           cleanText.startsWith(cleanKeyword) ||
           cleanText.endsWith(cleanKeyword);
  });
  
  if (isCreatorQuestion) {
    return ctx.reply('@rafaelkazaryan');
  }
  
  if (lowerText === 'кто ты' || 
      lowerText === 'ты кто' ||
      lowerText === 'кто ты?' ||
      lowerText === 'ты кто?') {
    return ctx.reply('@rafaelkazaryan');
  }
  
  if (!MISTRAL_KEY) {
    return ctx.reply('API ключ не настроен.');
  }
  
  const waitMsg = await ctx.reply('💭 Решаю...');
  
  try {
    addToHistory(userId, 'user', userText);
    const history = getUserHistory(userId);
    
    const result = await queryMistral(history);
    
    await ctx.deleteMessage(waitMsg.message_id);
    
    if (result.success) {
      addToHistory(userId, 'assistant', result.text);
      
      if (result.text) {
        await ctx.reply(result.text);
      }
      
      if (result.latex) {
        try {
          const generatingMsg = await ctx.reply('📐 Генерирую формулу...');
          
          const imageBuffer = await generateFormulaImage(result.latex);
          
          if (imageBuffer) {
            await ctx.deleteMessage(generatingMsg.message_id);
            
            await ctx.replyWithPhoto(
              { source: Buffer.from(imageBuffer) },
              { caption: `Формула: ${result.latex}` }
            );
          } else {
            await ctx.editMessageText(generatingMsg.message_id, 
              'Не удалось сгенерировать формулу. Вот она в текстовом виде:\n' + result.latex);
          }
        } catch (imgError) {
          await ctx.reply(`Формула в LaTeX:\n${result.latex}`);
        }
      }
    } else {
      await ctx.reply(result.text);
    }
    
  } catch (error) {
    try {
      await ctx.deleteMessage(waitMsg.message_id);
    } catch (e) {}
    
    ctx.reply(`Ошибка: ${error.message}`);
  }
});

// ========== ФОТО ==========
bot.on('photo', async (ctx) => {
  const userId = ctx.from.id;
  
  if (!MISTRAL_KEY) {
    return ctx.reply('API ключ не настроен.');
  }
  
  const caption = ctx.message.caption || '';
  const waitMsg = await ctx.reply('👀 Смотрю фото...');
  
  try {
    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    const fileLink = await ctx.telegram.getFileLink(photo.file_id);
    const imageUrl = fileLink.href;
    
    addToHistory(userId, 'user', `[Фото: ${caption || 'задача'}]`);
    
    const prompt = `Реши задачу на фото. ${caption ? `Вопрос: "${caption}".` : ''}
    
ОЧЕНЬ ВАЖНО:
1. ОТВЕЧАЙ ТОЛЬКО РЕШЕНИЕМ И ОТВЕТОМ
2. ВСЕ МАТЕМАТИЧЕСКИЕ ВЫРАЖЕНИЯ ПИШИ В ФОРМАТЕ LATEX ВНУТРИ $$...$$
3. ПРИМЕР ПРАВИЛЬНОГО ОТВЕТА:
Деление дробей. При делении умножаем на обратную дробь.

$$\\frac{3}{5} \\div \\frac{4}{9} = \\frac{3}{5} \\times \\frac{9}{4} = \\frac{3 \\times 9}{5 \\times 4} = \\frac{27}{20} = 1\\frac{7}{20}$$

Ответ: $$1\\frac{7}{20}$$`;
    
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
        max_tokens: 1500,
        temperature: 0.2
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
    
    addToHistory(userId, 'assistant', processed.text);
    
    await ctx.deleteMessage(waitMsg.message_id);
    
    if (processed.text) {
      await ctx.reply(processed.text);
    }
    
    if (processed.latex) {
      try {
        const generatingMsg = await ctx.reply('📐 Генерирую формулу...');
        
        const imageBuffer = await generateFormulaImage(processed.latex);
        
        if (imageBuffer) {
          await ctx.deleteMessage(generatingMsg.message_id);
          
          await ctx.replyWithPhoto(
            { source: Buffer.from(imageBuffer) },
            { caption: `Решение:` }
          );
        } else {
          await ctx.editMessageText(generatingMsg.message_id, 
            'Не удалось сгенерировать формулу. Вот она в текстовом виде:\n' + processed.latex);
        }
      } catch (imgError) {
        await ctx.reply(`Формула в LaTeX:\n${processed.latex}`);
      }
    }
    
  } catch (error) {
    await ctx.deleteMessage(waitMsg.message_id);
    ctx.reply('Не разобрал фото. Попробуй еще раз или опиши текстом.');
  }
});

// ========== WEBHOOK ==========
module.exports = async (req, res) => {
  console.log('🚀 Вебхук вызван, метод:', req.method);
  
  if (req.method === 'GET') {
    return res.status(200).json({
      status: 'Telegram Math Bot',
      features: 'Решение задач + формулы + админка',
      admins: ADMINS.length,
      users: userHistories.size,
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
