const express = require('express');
const { Telegraf, Markup } = require('telegraf');
const mongoose = require('mongoose');
const path = require('path');
const axios = require('axios');
const { type } = require('os');
require('dotenv').config();

const app = express();



const bot = new Telegraf(process.env.BOT_TOKEN);

app.use(express.json());

mongoose.connect(process.env.MONGO_URI);

// --- СХЕМА ОБЪЯВЛЕНИЙ ---
const adSchema = new mongoose.Schema({
    id: String,
    vacancyInOut: { type:String, default: 'НОВА ВАКАНСІЯ'},
    category: String,
    vacancy: String,
    salary: String,
    city: { type: String, default: 'Одеса' },
    address: String,
    duties: String,
    schedule: String,
    phone: String,
    telegram: String,
    viber: String,
    person: String,
    tariff: String,
    isVip: { type: Boolean, default: false },
    userId: String,
    status: { type: String, default: 'pending' },
    expireAt: Date,
    repostsRemaining: { type: Number, default: 0 },
    repostIntervalHrs: { type: Number, default: 24 }, // По умолчанию раз в сутки
    lastRepostDate: { type: Date, default: Date.now },
    views: { type: Number, default: 0 }
}, { timestamps: true });

const Ad = mongoose.model('Ad', adSchema);

// Маршрут для удаления объявления (СТРОГО ПО ТВОЕМУ КОДУ)
app.delete('/api/admin/delete/:id', async (req, res) => {
    try {
        const adminKey = req.headers['x-admin-key'];
        if (adminKey !== process.env.ADMIN_PASS) {
            return res.status(403).json({ error: "Доступ запрещен" });
        }

        const adId = req.params.id; // Это будет твой "v74914"
        
        // Используем deleteOne и ищем по полю id (твоему), а не по системному _id
        const result = await Ad.deleteOne({ id: adId });

        if (result.deletedCount > 0) {
            console.log(`Объявление с кастомным ID ${adId} успешно удалено`);
            res.json({ success: true });
        } else {
            console.log(`Объявление ${adId} не найдено в базе`);
            res.status(404).json({ error: "Объявление не найдено" });
        }
    } catch (error) {
        console.error("ОШИБКА СЕРВЕРА:", error.message);
        res.status(500).json({ error: error.message });
    }
});




// Маршрут для индексации объявлений поисковиками
app.get('/seo-catalog', async (req, res) => {
    try {
        // Загружаем все объявления для теста (раз их 41)
        const ads = await Ad.find({}).sort({ createdAt: -1 }).lean();
        
        console.log('Найдено объявлений для вывода:', ads.length);

        let html = `
<!DOCTYPE html>
<html lang="uk">
<head>
    <meta charset="UTF-8">
    <title>Дошка оголошень Одеса | Архів</title>
    <style>
        body { font-family: sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; line-height: 1.5; }
        .ad-box { border-bottom: 1px solid #ccc; padding: 15px 0; }
        h2 { color: #007bff; margin: 0; }
        .link { color: green; text-decoration: none; font-weight: bold; }
    </style>
</head>
<body>
    <h1>Актуальні оголошення Одеси (${ads.length})</h1>
    <hr>`;

        if (ads.length === 0) {
            html += `<p>Оголошень не знайдено в базі даних.</p>`;
        } else {
            ads.forEach(ad => {
                // Используем те поля, которые точно есть в твоей схеме (vacancy, duties)
                const title = ad.vacancy || ad.category || 'Оголошення без назви';
                const description = ad.duties || ad.address || '';
                
                html += `
                <div class="ad-box">
                    <h2>${title}</h2>
                    <p>${description.substring(0, 200)}${description.length > 200 ? '...' : ''}</p>
                    <a class="link" href="https://${req.get('host')}/?id=${ad._id}">Відкрити контакти →</a>
                </div>`;
            });
        }

        html += `</body></html>`;
        
        // Самый важный момент — отправка сформированного HTML
        res.send(html);

    } catch (error) {
        console.error('Ошибка рендеринга каталога:', error);
        res.status(500).send("Помилка при формуванні сторінки");
    }
});



// --- СХЕМА ТАРИФОВ (Новое!) ---
// Позволяет менять цену, дни и количество репостов через админку
const tariffSchema = new mongoose.Schema({
    id: String, // Ключ тарифа (например, '150')
    price: Number, // Сумма к оплате
    days: Number, // Сколько дней висит на сайте
    reposts: Number, // Сколько раз летит в канал
    label: String, // Название (Пробний, Стандарт...)
    isVip: Boolean, // Дает ли статус VIP автоматически
    repostIntervalHrs: { type: Number, default: 24 } // Интервал вывода в канал 
});
const Tariff = mongoose.model('Tariff', tariffSchema);

// --- СХЕМА РЕКВИЗИТОВ (Ротатор) ---
const paymentSchema = new mongoose.Schema({
    value: String, // Номер карты или IBAN
    label: String, // Название банка (Моно, Приват)
    usageCount: { type: Number, default: 0 }, // Счетчик выдач (для ротации)
    isActive: { type: Boolean, default: true }
});
const Payment = mongoose.model('Payment', paymentSchema);

// --- СХЕМА БАНЕРОВ ---
const bannerSchema = new mongoose.Schema({
    title: String,
    content: String,
    link: String,
    isActive: { type: Boolean, default: true }
});
const Banner = mongoose.model('Banner', bannerSchema);


// 1. СОЗДАНИЕ И РЕДАКТИРОВАНИЕ БАННЕРОВ (ОДИН ПУТЬ)
app.post('/api/admin/banners/save', async (req, res) => {
    try {
        const adminKey = req.headers['x-admin-key'];
        if (adminKey !== process.env.ADMIN_PASS) return res.status(403).send("No");

        const { id, title, content, link, isActive } = req.body;

        if (id) {
            // Если есть id, значит редактируем существующий по системному _id
            await Banner.findByIdAndUpdate(id, { title, content, link, isActive });
            console.log(`Реклама ${id} обновлена`);
        } else {
            // Если id нет, создаем новый
            const newBanner = new Banner({ 
                title, 
                content, 
                link, 
                isActive: isActive !== undefined ? isActive : true 
            });
            await newBanner.save();
            console.log("Создана новая рекламная карточка");
        }
        res.json({ success: true });
    } catch (e) {
        console.error("Ошибка при сохранении баннера:", e);
        res.status(500).send(e.message);
    }
});

// 2. УДАЛЕНИЕ БАННЕРА (СТРОГО ПО ТВОЕМУ FETCH)
app.delete('/api/admin/banners/:id', async (req, res) => {
    try {
        const adminKey = req.headers['x-admin-key'];
        if (adminKey !== process.env.ADMIN_PASS) return res.status(403).send("No");

        const result = await Banner.findByIdAndDelete(req.params.id);
        
        if (result) {
            console.log(`Реклама ${req.params.id} успешно удалена`);
            res.json({ success: true });
        } else {
            res.status(404).json({ error: "Баннер не найден" });
        }
    } catch (e) {
        console.error("Ошибка при удалении баннера:", e);
        res.status(500).send(e.message);
    }
});



// --- ЛОГИКА РОТАТОРА ---
// Выбирает реквизит, который использовался МЕНЬШЕ всего раз
async function getNextPaymentDetail(userChoice) {
    // Ищем активный реквизит именно того типа, который выбрал юзер
    const details = await Payment.find({
        isActive: true,
        label: userChoice
    }).sort({ usageCount: 1 }); // Берем тот, который меньше всего светился

    if (details.length === 0) return null;

    const selected = details[0];
    selected.usageCount += 1;
    await selected.save();
    return `${selected.label}: ${selected.value}`;
}

// --- ИНИЦИАЛИЗАЦИЯ ТАРИФОВ (При первом запуске) ---
async function initTariffs() {
    const count = await Tariff.countDocuments();
    if (count === 0) {
        const defaults = [
            { id: '150', price: 150, days: 7, reposts: 1, label: 'Пробний', isVip: false },
            { id: '400', price: 400, days: 30, reposts: 1, label: 'Стандарт', isVip: false },
            { id: '800', price: 800, days: 30, reposts: 7, label: 'Турбо', isVip: true }
        ];
        await Tariff.insertMany(defaults);
        console.log("✅ Базові тарифи створені");
    }
}
initTariffs();

// --- TG BOT: КОМАНДА START ---
bot.start(async (ctx) => {
    // Проверяем, пришел ли параметр "app" из ссылки
    const startPayload = ctx.payload; 

    if (startPayload === 'app') {
        // Если человек пришел по ссылке из канала, сразу предлагаем ему открыть шторку!
        return await ctx.reply('👋 Ласкаво просимо! Натисніть кнопку нижче, щоб відкрити дошку оголошень:', 
            Markup.inlineKeyboard([
                [Markup.button.webApp('🚀 Відкрити дошку', 'https://board-odessa.onrender.com')]
            ])
        );
    }

    // Тут твой старый обычный код для тех, кто просто зашел в бота:
    await ctx.reply('⚓ Привіт! Я бот дошки оголошень!\nНатисніть кнопку нижче, щоб відкрити сайт:',
        Markup.keyboard([
            [Markup.button.webApp('🌍 Відкрити Одеса-Борд', 'https://board-odessa.onrender.com')]
        ]).resize().persistent()
    ); // <-- Вот тут мы закрыли скобку функции ctx.reply без лишних кавычек
});


// --- API ДЛЯ САЙТА ---
app.get('/api/outdata', async (req, res) => {
    try {
        // status: 'active' гарантирует, что мы не тянем черновики
        // Теперь тянем и активные, и те, что ждут оплаты
        const ads = await Ad.find({ status: { $in: ['active', 'pending'] } })
            .sort({ updatedAt: -1 }) // Свежие и репостнутые — сверху
            .limit(30);              // Только первые 25 штук        
        res.json(ads);
    } catch (err) {
        res.status(500).send(err);
    }
});


// Вставь это после получения списка объявлений
app.post('/api/outdata/view/:id', async (req, res) => {
    try {
        const adId = req.params.id;
        await Ad.findOneAndUpdate({ id: adId }, { $inc: { views: 1 } });
        res.status(200).json({ success: true });
    } catch (err) {
        console.error('Ошибка счетчика:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});


app.get('/api/banners', async (req, res) => {
    try { res.json(await Banner.find({ isActive: true })); } catch (e) { res.json([]); }
});

// СОЗДАНИЕ ОБЪЯВЛЕНИЯ (С ротатором и динамическим тарифом)
app.post('/api/outdata/create', async (req, res) => {
    try {
        const d = req.body;

        // обязательный дубляж для безопасности
        // Улучшенная проверка на номера телефонов (UA-коды)
        if (containsForbiddenContact(d.vacancy) || containsForbiddenContact(d.duties)) {
            return res.status(400).json({
                error: "Контакти та посилання заборонені в описі. Використовуйте спеціальні поля."
            });
        }


        // 1. Ищем настройки тарифа в базе
        const t = await Tariff.findOne({ id: d.tariff });
        if (!t) return res.status(400).json({ error: "Невірний тариф" });

        // --- ЛОГИКА VIP И ЦЕНЫ (Исправлено) ---
        // Проверяем, пришла ли галочка VIP от пользователя
        const userWantsVip = d.isVip === true || d.isVip === 'true';

        // Итоговая цена: цена тарифа + 150, если выбран VIP
        const finalPrice = t.price + (userWantsVip ? 150 : 0);

        // Итоговый статус VIP: если он есть в тарифе ИЛИ выбран пользователем
        const finalIsVip = t.isVip || userWantsVip;
        // ---------------------------------------

        // 2. Получаем карту из ротатора (передаем выбранный метод)
        const paymentDetail = await getNextPaymentDetail(d.payMethod);

        const adId = 'v' + Math.floor(10000 + Math.random() * 90000);
        const newAd = new Ad({
            ...d,
            id: adId,
            isVip: finalIsVip, // Используем итоговый статус
            status: 'pending',
            repostsRemaining: t.reposts,
            repostIntervalHrs: t.repostIntervalHrs || 24,
            expireAt: new Date(Date.now() + t.days * 24 * 60 * 60 * 1000)
        });
        await newAd.save();

        // 3. Уведомление админу (теперь с правильной ценой)
        if (process.env.ADMIN_ID) {
            bot.telegram.sendMessage(process.env.ADMIN_ID,
                `🆕 ЗАМОВЛЕННЯ: ${adId}\n💎 VIP: ${finalIsVip ? 'ТАК' : 'НІ'}\n💰 До сплати: ${finalPrice} грн\n💳 Спосіб: ${d.payMethod}\n📍 Реквізити: ${paymentDetail}`, {
                ...Markup.inlineKeyboard([
                    [Markup.button.callback('✅ Оплачено', `paid_${adId}`)],
                    [Markup.button.callback('🗑 Видалити', `del_${adId}`)]
                ])
            });
        }

        // Возвращаем на сайт правильные реквизиты и итоговую цену
        res.json({
            id: adId,
            success: true,
            payment: paymentDetail,
            price: finalPrice // Отправляем итоговую сумму с учетом VIP
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: e.message });
    }
});

// Отдает только те типы оплаты, которые включены в админке
// Новый маршрут (API), чтобы сайт знал, что показывать
app.get('/api/active-pay-methods', async (req, res) => {
    try {
        // 1. Берем ВСЕ активные реквизиты, сортируем по количеству использований (меньшие — выше)
        const allActive = await Payment.find({ isActive: true }).sort({ usageCount: 1 });

        const rotated = {};
        
        allActive.forEach(item => {
            // Определяем "чистый" тип, убирая цифры и лишние слова
            // Это позволит сгруппировать "Картка 1" и "Картка 2" в одну группу "картка"
            let type = 'інше';
            const labelLower = item.label.toLowerCase();
            
            if (labelLower.includes('карт')) type = 'картка';
            else if (labelLower.includes('тел') || labelLower.includes('viber')) type = 'телефон';
            else if (labelLower.includes('iban')) type = 'iban';

            // Если в этой группе еще нет кандидата — берем этот (он будет самым "свежим" из-за сортировки)
            if (!rotated[type]) {
                rotated[type] = item.label;
            }
        });

        // Отправляем массив из 2-3 уникальных названий (по одному на тип)
        res.json(Object.values(rotated));
    } catch (e) {
        console.error("Ошибка ротатора в API:", e);
        res.json([]);
    }
});


// --- АДМИН-API: ТАРИФЫ И РЕКВИЗИТЫ ---

// 1. Получение всех тарифов
app.get('/api/admin/tariffs', async (req, res) => {
    if (req.headers['x-admin-key'] !== process.env.ADMIN_PASS) return res.status(403).send();
    res.json(await Tariff.find({}));
});

// Маршрут для страницы создания (доступен всем)
app.get('/api/pub/tariffs', async (req, res) => {
    try {
        const tariffs = await Tariff.find({});
        res.json(tariffs);
    } catch (e) {
        res.status(500).json([]);
    }
});

// СОХРАНЕНИЕ ТАРИФА 
app.post('/api/admin/tariffs/save', async (req, res) => {
    if (req.headers['x-admin-key'] !== process.env.ADMIN_PASS) return res.status(403).send();
    
    // 1. Извлекаем данные (проверь, чтобы названия совпадали с админкой)
    const { id, price, days, reposts, repostIntervalHrs, label } = req.body;
    
    // ЛОГ ДЛЯ ПРОВЕРКИ (увидишь в терминале)
    console.log(`[SAVE TARIFF] ID: ${id}, Interval: ${repostIntervalHrs}`);
    
    try {
        // 2. Обновляем в базе. ВАЖНО: используем reposts (с 's' на конце)
        const updated = await Tariff.findOneAndUpdate(
            { id: id }, 
            { 
                $set: { // Используем $set для принудительного обновления
                    price: Number(price), 
                    days: Number(days), 
                    reposts: Number(reposts), 
                    repostIntervalHrs: Number(repostIntervalHrs),
                    label: label 
                }
            },
            { new: true, upsert: true } // Создаст поле, если его нет
        );
        res.json({ success: true, data: updated });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});


// 3. ДОБАВЛЕНИЕ НОВОГО ТАРИФА
app.post('/api/admin/tariffs/add', async (req, res) => {
    if (req.headers['x-admin-key'] !== process.env.ADMIN_PASS) return res.status(403).send();
    try {
        const newTariff = new Tariff(req.body);
        await newTariff.save();
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// 4. УДАЛЕНИЕ ТАРИФА 
app.delete('/api/admin/tariffs/:id', async (req, res) => {
    if (req.headers['x-admin-key'] !== process.env.ADMIN_PASS) return res.status(403).send();
    await Tariff.findOneAndDelete({ id: req.params.id });
    res.json({ success: true });
});


app.get('/api/admin/payments', async (req, res) => {
    if (req.headers['x-admin-key'] !== process.env.ADMIN_PASS) return res.status(403).send();
    res.json(await Payment.find({}));
});

app.post('/api/admin/payments/save', async (req, res) => {
    if (req.headers['x-admin-key'] !== process.env.ADMIN_PASS) return res.status(403).send();
    const d = req.body;
    if (d._id) await Payment.findByIdAndUpdate(d._id, d);
    else await new Payment(d).save();
    res.json({ success: true });
});

app.delete('/api/admin/payments/:id', async (req, res) => {
    if (req.headers['x-admin-key'] !== process.env.ADMIN_PASS) return res.status(403).send();
    await Payment.findByIdAndDelete(req.params.id);
    res.json({ success: true });
});

// (Остальные админ-маршруты: all-ads, update, delete остаются без изменений...)
app.get('/api/admin/all-ads', async (req, res) => {
    if (req.headers['x-admin-key'] !== process.env.ADMIN_PASS) return res.status(403).send();
    await Ad.updateMany({ status: 'active', expireAt: { $lt: new Date() } }, { $set: { status: 'archived' } });
    const ads = await Ad.find({}).sort({ createdAt: -1 });
    const stats = { total: ads.length, pending: ads.filter(a => a.status === 'pending').length, active: ads.filter(a => a.status === 'active').length, banners: await Banner.countDocuments() };
    res.json({ ads, stats });
});

app.post('/api/admin/update/:id', async (req, res) => {
    if (req.headers['x-admin-key'] !== process.env.ADMIN_PASS) return res.status(403).send();
    const ad = await Ad.findOneAndUpdate({ id: req.params.id }, { $set: req.body }, { new: true });
    res.json({ success: !!ad });
});

async function sendToTelegram(ad) {
    try {
        const tgContact = ad.telegram ? ad.telegram.replace(/[@\s]/g, '').trim() : '';
        const viberContact = ad.viber ? ad.viber.replace(/[^0-9]/g, '').trim() : '';
        
        // Твои константы разделителей
        const textTop = `👆👆👆📝📢🔍👆👆👆\n\n`;
        const textBottom = `👇👇👇📝🔍👇👇👇\n\n`;
        
        // Поясняющий текст для кнопок на сайт
        const textExplanation = `<b>Виберіть зручний спосіб роботи з дошкою:</b>\n\n` +
            `⚡ <b>В Телеграм</b> — відкриється прямо тут (безпечно, просто натисніть 'ОК' у вікні дозволу).\n` +
            `🌐 <b>В браузері</b> — звичний спосіб через Chrome/Safari.`;
        
        // 1 + 2. Собираем первое сообщение (textTop + само объявление)
        const textMain = textTop + `\n\n✳️✳️✳️✳️✳️✳️✳️✳️✳️\n\n`
            + `⚓ <b>${ad.isVip ? '⭐ ТОП ВАКАНСІЯ' : escapeHTML(ad.vacancyInOut || 'НОВА ВАКАНСІЯ')}</b> ⚓\n\n` +
            `👤 <b>Посада:</b> ${escapeHTML(ad.vacancy)}\n` +
            `📝 <b>Опис:</b> ${escapeHTML(ad.duties)}\n\n` +
            `🕘 <b>Графік:</b> ${escapeHTML(ad.schedule || 'За домовленістю')}\n\n` +
            `💰 <b>Зарплата:</b> ${escapeHTML(ad.salary)}\n` +
            `📍 <b>Місто/Район:</b> ${escapeHTML(ad.city)}, ${escapeHTML(ad.address || 'Одеса')}\n` +
            `📞 <b>Контакти:</b> ${ad.phone} (${escapeHTML(ad.person)})`;
        
        // Формируем кнопки контактов (если они есть)
        const contactButtons = [];
        if (tgContact) {
            contactButtons.push(Markup.button.url('💬 Telegram', `https://t.me/${tgContact}`));
        }
        if (viberContact) {
            contactButtons.push(Markup.button.url('🟣 Viber', `https://board-odessa.onrender.com/viber/${viberContact}`));
        }
        
        // Кнопки для сайта (всегда две штуки)
        const siteButtons = [
    [Markup.button.url('⚡ Відкрити в Телеграм', 'https://t.me/odessa_smart_job_bot?start=app')],
    [Markup.button.url('🌐 Відкрити в браузері', 'https://board-odessa.onrender.com')]
];
        
        // Проверяем: есть ли контакты?
        if (contactButtons.length > 0) {
            // --- ВАРИАНТ С ДВУМЯ СООБЩЕНИЯМИ ---
            
            // 1. Выводим textTop + вакансию с кнопками контактов
            await bot.telegram.sendMessage(process.env.CHANNEL_ID, textMain, {
                parse_mode: 'HTML',
                ...Markup.inlineKeyboard([contactButtons])
            });
            
            // 2. Выводим textBottom + текст о кнопках + сами кнопки
            const secondMessageText = textBottom + textExplanation;
            await bot.telegram.sendMessage(process.env.CHANNEL_ID, secondMessageText, {
                parse_mode: 'HTML',
                ...Markup.inlineKeyboard(siteButtons)
            });
            
        } else {
            // --- ВАРИАНТ С ОДНИМ СООБЩЕНИЕМ (если контактов ТГ/Вайбер нет) ---
            // Соединяем всё строго по цепочке: текст вакансии -> textBottom -> пояснение
            const fullSingleText = textMain + `\n\n` + textBottom + textExplanation;
            
            await bot.telegram.sendMessage(process.env.CHANNEL_ID, fullSingleText, {
                parse_mode: 'HTML',
                ...Markup.inlineKeyboard(siteButtons)
            });
        }
        
        return true;
    } catch (e) {
        console.error("ОШИБКА ОТПРАВКИ:", e.message);
        return false;
    }
}




// КНОПКИ В БОТЕ (Оплачено / Удалить)
bot.on('callback_query', async (ctx) => {
    try {
        const [action, adId] = ctx.callbackQuery.data.split('_');
        const ad = await Ad.findOne({ id: adId });
        
        if (action === 'paid' && ad) {
            ad.status = 'active';
            await ad.save();

            const sent = await sendToTelegram(ad);
            if (sent) {
                // Убираем кнопки и пишем статус
                await ctx.editMessageText(ctx.callbackQuery.message.text + '\n\n✅ ОПУБЛІКОВАНО В КАНАЛ', { reply_markup: null });
                
                if (ad.userId && ad.userId !== 'web') {
                    bot.telegram.sendMessage(ad.userId, `🎉 Ваше оголошення "${ad.vacancy}" опубліковано!`).catch(e => console.log("User notify error"));
                }
            } else {
                await ctx.answerCbQuery("❌ Помилка при відправці в канал!", { show_alert: true });
            }
        }

        if (action === 'del' && ad) {
            await Ad.deleteOne({ id: adId });
            await ctx.editMessageText(ctx.callbackQuery.message.text + '\n\n🗑 ВИДАЛЕНО', { reply_markup: null });
        }
    }
    catch (e) { console.log("Callback error:", e); }
});

// --- ЛОГИКА АВТОМАТИЧЕСКОГО РЕПОСТА (BUMP) ---
async function checkAndRunReposts() {
    console.log("--- [BUMP] Проверка очереди репостов ---");
    try {
        const now = new Date();

        // Ищем объявления: активные, с оставшимися репостами, 
        // где текущее время больше, чем (дата последнего репоста + интервал)
        const adsToRepost = await Ad.find({
            status: 'active',
            repostsRemaining: { $gt: 0 }
        });

        for (const ad of adsToRepost) {
            const nextRepostTime = new Date(ad.lastRepostDate.getTime() + ad.repostIntervalHrs * 60 * 60 * 1000);
            
            if (now >= nextRepostTime) {
                console.log(`[BUMP] Публикуем повторно: ${ad.vacancy} (${ad.id})`);
                
                const sent = await sendToTelegram(ad);
                
                if (sent) {
                    ad.repostsRemaining -= 1;
                    ad.lastRepostDate = now;
                    // Обновляем updatedAt, чтобы вакансия поднялась в топ на сайте
                    ad.updatedAt = now; 
                    await ad.save();
                    console.log(`[BUMP] Успешно. Осталось репостов: ${ad.repostsRemaining}`);
                }
            }
        }
    } catch (e) {
        console.error("❌ Ошибка в цикле репостов:", e.message);
    }
}

// Запускаем проверку каждые 15 минут (900 000 мс)
// Этого достаточно, чтобы не нагружать сервер и вовремя делать посты
setInterval(checkAndRunReposts, 900000);


// Запуск сервера
// --- МАРШРУТЫ ДЛЯ СТАТИКИ И РЕДИРЕКТОВ ---

// 1. Редирект для Viber (ДОЛЖЕН БЫТЬ ВЫШЕ СТАТИКИ И '*')
app.get('/viber/:number', (req, res) => {
    const phone = req.params.number;
    console.log(`[Viber Redirect] Открываем чат для: ${phone}`);
    // Перенаправляем на протокол viber. Знак '?' здесь нужен для самого Viber.
    res.redirect(`viber://chat?number=%2B${phone}`);
});

// 2. Раздача статических файлов (твои HTML, CSS, JS в папке public)
app.use(express.static(path.join(__dirname, '..', 'public')));

// 3. Обработка всех остальных запросов (чтобы работал роутинг внутри сайта)
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});


// --- МАРШРУТ ДЛЯ МАСОВОГО РЕПОСТУ (Кнопка "В КАНАЛ") ---
app.post('/api/admin/repost-batch', async (req, res) => {
    // 1. Перевірка пароля адміна
    if (req.headers['x-admin-key'] !== process.env.ADMIN_PASS) return res.status(403).send();

    try {
        const { ids } = req.body; // Отримуємо масив ID (напр. ['v123', 'v456'])
        
        if (!ids || !Array.isArray(ids)) {
            return res.status(400).json({ error: "Невірний формат даних" });
        }

        console.log(`[ADMIN] Початок масового репосту для ${ids.length} оголошень`);

        // Проходимо по кожному ID з масиву
        for (const adId of ids) {
            const ad = await Ad.findOne({ id: adId });
            
            if (ad) {
                // Відправляємо в Телеграм
                const sent = await sendToTelegram(ad);
                
                if (sent) {
                    // Оновлюємо дату, щоб вакансія піднялася вгору на сайті
                    ad.updatedAt = new Date();
                    // Оновлюємо статус на active, якщо він був іншим
                    ad.status = 'active';
                    await ad.save();
                    console.log(`[ADMIN] Успішно відправлено: ${adId}`);
                }
            }
        }

        res.json({ success: true, message: "Оголошення відправлені в чергу" });
    } catch (e) {
        console.error("Помилка масового репосту:", e);
        res.status(500).json({ error: e.message });
    }
});




// --- ЗАПУСК СЕРВЕРА ---

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Сервер запущен на порту ${PORT}`);
    // Запуск бота
    bot.launch()
        .then(() => console.log("🤖 Telegram Bot запущен"))
        .catch(err => console.error("❌ Ошибка запуска бота:", err));
});

// --- ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ---

// Функция очистки текста от спецсимволов HTML
function escapeHTML(str) {
    if (!str) return '';
    return str.replace(/[&<>"']/g, (m) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[m]));
}

// Проверка на запрещенные слова в контактах
function containsForbiddenContact(text) {
    if (!text) return false;
    const forbidden = ['@', 't.me', 'viber', 'http', 'https', 'www'];
    return forbidden.some(item => text.toLowerCase().includes(item));
}


// ANTI-SLEEP (чтобы Render не засыпал)
setInterval(() => { 
    axios.get("https://board-odessa.onrender.com").catch(() => {}); 
}, 800000);
