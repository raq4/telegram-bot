const { Telegraf } = require('telegraf');
const axios = require('axios');
const { createCanvas } = require('canvas'); // Добавляем canvas для генерации формул

const bot = new Telegraf(process.env.TELEGRAM_TOKEN);
const MISTRAL_KEY = process.env.MISTRAL_API_KEY;

// ========== АДМИН СИСТЕМА ==========
const ADMINS = new Set([815509230]); // Ваш ID по умолчанию
const ADMIN_PASSWORDS = new Map(); // Хранилище паролей для временного доступа

// Генерация случайного пароля
function generatePassword() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let password = '';
  for (let i = 0; i < 8; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
}

// Проверка прав администратора
function isAdmin(userId) {
  return ADMINS.has(parseInt(userId));
}

// Сохранение данных в файл (для Vercel/Serverless)
function saveAdmins() {
  // В serverless среде используем process.env для хранения
  const adminsArray = Array.from(ADMINS);
  process.env.BOT_ADMINS = JSON.stringify(adminsArray);
  console.log('Admins saved:', adminsArray);
}

// Загрузка данных из process.env
function loadAdmins() {
  try {
    if (process.env.BOT_ADMINS) {
      const adminsArray = JSON.parse(process.env.BOT_ADMINS);
      adminsArray.forEach(id => ADMINS.add(parseInt(id)));
      console.log('Admins loaded:', adminsArray);
    }
  } catch (e) {
    console.log('Error loading admins:', e.message);
  }
}

// Инициализация при запуске
loadAdmins();

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
  
  // Ищем формулы в формате $$...$$
  const latexMatches = text.match(/\$\$(.*?)\$\$/gs);
  if (!latexMatches || latexMatches.length === 0) return null;
  
  // Берем первую найденную формулу
  let latex = latexMatches[0].replace(/\$\$/g, '').trim();
  
  // Очищаем от лишних пробелов
  latex = latex.replace(/\s+/g, ' ').trim();
  
  return latex;
}

// ========== ГЕНЕРАЦИЯ ИЗОБРАЖЕНИЯ С ФОРМУЛОЙ ==========
async function generateFormulaImage(latexFormula) {
  try {
    // Для генерации изображений с LaTeX используем внешний API
    // Можно использовать QuickLaTeX, CodeCogs или другие сервисы
    
    const encodedFormula = encodeURIComponent(latexFormula);
    
    // Вариант 1: QuickLaTeX (бесплатный)
    const imageUrl = `https://quicklatex.com/latex3.f?${encodedFormula}`;
    
    // Вариант 2: CodeCogs (тоже бесплатный)
    // const imageUrl = `https://latex.codecogs.com/png.latex?\\dpi{200}${encodedFormula}`;
    
    // Скачиваем изображение
    const response = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 10000
    });
    
    return response.data; // Возвращаем Buffer с изображением
    
  } catch (error) {
    console.error('Ошибка генерации формулы:', error.message);
    return null;
  }
}

// ========== ОБРАБОТКА ОТВЕТА ==========
function processAnswer(text) {
  if (!text) return { text: '', latex: null };
  
  let cleanText = text;
  
  // Убираем Markdown
  cleanText = cleanText.replace(/\*\*/g, '');
  cleanText = cleanText.replace(/\*/g, '');
  cleanText = cleanText.replace(/__/g, '');
  
  // Извлекаем LaTeX формулы
  const latex = extractLatexFromAnswer(cleanText);
  
  // Убираем LaTeX формулы из текстового ответа
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

// ========== АДМИН КОМАНДЫ ==========
bot.command('admin', (ctx) => {
  const userId = ctx.from.id;
  
  if (!isAdmin(userId)) {
    return ctx.reply('⚠️ У вас нет прав администратора.');
  }
  
  ctx.reply(
    `👑 Админ-панель\n\n` +
    `Доступные команды:\n` +
    `/admins - список администраторов\n` +
    `/add_admin - добавить администратора\n` +
    `/remove_admin [ID] - удалить администратора\n` +
    `/generate_invite - создать код приглашения\n` +
    `/stats - статистика бота\n` +
    `/broadcast [сообщение] - рассылка всем пользователям\n\n` +
    `Ваш ID: ${userId}\n` +
    `Всего админов: ${ADMINS.size}`
  );
});

bot.command('admins', (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    return ctx.reply('⚠️ У вас нет прав администратора.');
  }
  
  const adminList = Array.from(ADMINS)
    .map(id => `• ${id} ${id === 815509230 ? '(создатель)' : ''}`)
    .join('\n');
  
  ctx.reply(`📋 Список администраторов (${ADMINS.size}):\n\n${adminList}`);
});

bot.command('add_admin', (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    return ctx.reply('⚠️ У вас нет прав администратора.');
  }
  
  // Генерируем временный пароль для добавления админа
  const password = generatePassword();
  const expires = Date.now() + 30 * 60 * 1000; // 30 минут
  ADMIN_PASSWORDS.set(password, { expires, creator: ctx.from.id });
  
  ctx.reply(
    `🔑 Код для добавления администратора:\n\n` +
    `Пароль: <code>${password}</code>\n` +
    `Действует: 30 минут\n\n` +
    `Для добавления администратора новый пользователь должен отправить:\n` +
    `<code>/invite ${password}</code>\n\n` +
    `Или просто перешлите это сообщение новому администратору.`,
    { parse_mode: 'HTML' }
  );
});

bot.command('invite', (ctx) => {
  const userId = ctx.from.id;
  const args = ctx.message.text.split(' ');
  
  if (args.length < 2) {
    return ctx.reply('Использование: /invite [код]');
  }
  
  const password = args[1];
  const inviteData = ADMIN_PASSWORDS.get(password);
  
  if (!inviteData) {
    return ctx.reply('❌ Неверный или просроченный код.');
  }
  
  if (Date.now() > inviteData.expires) {
    ADMIN_PASSWORDS.delete(password);
    return ctx.reply('❌ Срок действия кода истек.');
  }
  
  if (isAdmin(userId)) {
    return ctx.reply('✅ Вы уже администратор.');
  }
  
  // Добавляем в админы
  ADMINS.add(userId);
  ADMIN_PASSWORDS.delete(password);
  saveAdmins();
  
  ctx.reply(
    `✅ Вы стали администратором!\n\n` +
    `Доступные команды:\n` +
    `/admin - панель управления\n` +
    `/admins - список администраторов\n` +
    `/stats - статистика бота\n\n` +
    `Ваш ID: ${userId}`
  );
  
  // Уведомляем создателя кода
  try {
    ctx.telegram.sendMessage(
      inviteData.creator,
      `✅ Пользователь @${ctx.from.username || 'без username'} (ID: ${userId}) активировал код приглашения и стал администратором.`
    );
  } catch (e) {
    console.log('Не удалось уведомить создателя кода:', e.message);
  }
});

bot.command('remove_admin', (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    return ctx.reply('⚠️ У вас нет прав администратора.');
  }
  
  const args = ctx.message.text.split(' ');
  
  if (args.length < 2) {
    return ctx.reply('Использование: /remove_admin [ID]');
  }
  
  const targetId = parseInt(args[1]);
  
  if (isNaN(targetId)) {
    return ctx.reply('❌ Неверный ID.');
  }
  
  if (!ADMINS.has(targetId)) {
    return ctx.reply('❌ Пользователь не является администратором.');
  }
  
  if (targetId === 815509230) {
    return ctx.reply('❌ Нельзя удалить создателя бота.');
  }
  
  ADMINS.delete(targetId);
  saveAdmins();
  
  ctx.reply(`✅ Администратор с ID ${targetId} удален.`);
  
  // Уведомляем удаленного админа
  try {
    ctx.telegram.sendMessage(
      targetId,
      `❌ Ваши права администратора были отозваны.`
    );
  } catch (e) {
    console.log('Не удалось уведомить удаленного администратора:', e.message);
  }
});

bot.command('stats', (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    return ctx.reply('⚠️ У вас нет прав администратора.');
  }
  
  const stats = {
    users: userHistories.size,
    admins: ADMINS.size,
    activeInvites: ADMIN_PASSWORDS.size,
    memoryUsage: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB'
  };
  
  ctx.reply(
    `📊 Статистика бота:\n\n` +
    `👥 Пользователей в памяти: ${stats.users}\n` +
    `👑 Администраторов: ${stats.admins}\n` +
    `🔑 Активных приглашений: ${stats.activeInvites}\n` +
    `💾 Использование памяти: ${stats.memoryUsage}\n\n` +
    `🕒 Время работы: ${Math.round(process.uptime() / 60)} мин.`
  );
});

bot.command('broadcast', async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    return ctx.reply('⚠️ У вас нет прав администратора.');
  }
  
  const message = ctx.message.text.replace('/broadcast', '').trim();
  
  if (!message) {
    return ctx.reply('Использование: /broadcast [сообщение]');
  }
  
  const confirmMsg = await ctx.reply(
    `📢 Подтвердите рассылку:\n\n` +
    `${message}\n\n` +
    `Получателей: ${userHistories.size}\n` +
    `Отправить?`,
    {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✅ Отправить', callback_data: 'broadcast_confirm' },
            { text: '❌ Отмена', callback_data: 'broadcast_cancel' }
          ]
        ]
      }
    }
  );
  
  // Сохраняем данные для рассылки
  ctx.session.broadcastData = {
    message: message,
    users: Array.from(userHistories.keys()),
    sent: 0,
    failed: 0,
    confirmMsgId: confirmMsg.message_id
  };
});

// Обработка inline кнопок
bot.on('callback_query', async (ctx) => {
  const data = ctx.callbackQuery.data;
  const userId = ctx.from.id;
  
  if (!isAdmin(userId)) {
    return ctx.answerCbQuery('❌ Нет прав администратора');
  }
  
  if (data === 'broadcast_confirm') {
    await ctx.answerCbQuery('Начинаю рассылку...');
    
    const broadcastData = ctx.session.broadcastData;
    if (!broadcastData) {
      return ctx.editMessageText('❌ Данные рассылки не найдены');
    }
    
    const totalUsers = broadcastData.users.length;
    
    for (let i = 0; i < totalUsers; i++) {
      const user = broadcastData.users[i];
      
      try {
        await ctx.telegram.sendMessage(user, `📢 Рассылка:\n\n${broadcastData.message}`);
        broadcastData.sent++;
      } catch (error) {
        broadcastData.failed++;
      }
      
      // Обновляем статус каждые 10 отправок
      if (i % 10 === 0 || i === totalUsers - 1) {
        try {
          await ctx.editMessageText(
            `📢 Рассылка...\n\n` +
            `Отправлено: ${broadcastData.sent}\n` +
            `Не удалось: ${broadcastData.failed}\n` +
            `Всего: ${totalUsers}\n` +
            `Прогресс: ${Math.round((i + 1) / totalUsers * 100)}%`,
            { message_id: broadcastData.confirmMsgId }
          );
        } catch (e) {
          // Игнорируем ошибки редактирования
        }
      }
      
      // Задержка между сообщениями
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    await ctx.editMessageText(
      `✅ Рассылка завершена!\n\n` +
      `📤 Успешно: ${broadcastData.sent}\n` +
      `❌ Не удалось: ${broadcastData.failed}\n` +
      `📊 Всего: ${totalUsers}`,
      { message_id: broadcastData.confirmMsgId }
    );
    
    // Очищаем данные рассылки
    delete ctx.session.broadcastData;
    
  } else if (data === 'broadcast_cancel') {
    await ctx.answerCbQuery('Рассылка отменена');
    await ctx.deleteMessage();
    delete ctx.session.broadcastData;
  }
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
  if (req.method === 'GET') {
    return res.status(200).json({
      status: 'Telegram Math Bot with Admin Panel',
      features: 'Текстовые ответы + изображения с формулами + админ-панель',
      admins: ADMINS.size,
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
