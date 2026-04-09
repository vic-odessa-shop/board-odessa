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

// --- СХЕМА ТАРИФОВ (Новое!) ---
// Позволяет менять цену, дни и количество репостов через админку
const tariffSchema = new mongoose.Schema({
    id: String, // Ключ тарифа (например, '150')
    price: Number, // Сумма к оплате
    days: Number, // Сколько дней висит на сайте
    reposts: Number, // Сколько раз летит в канал
    label: String, // Название (Пробний, Стандарт...)
    isVip: Boolean // Дает ли статус VIP автоматически
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
bot.start((ctx) => {
    return ctx.reply('⚓ Вітаємо в Одеса-Борд!\nНатисніть кнопку нижче, щоб відкрити сайт:',
        Markup.keyboard([
            [Markup.button.webApp('🌍 Відкрити Одеса-Борд', 'https://board-odessa.onrender.com')]
        ]).resize().persistent()
    );
});

// --- API ДЛЯ САЙТА ---
app.get('/api/ads', async (req, res) => {
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
app.post('/api/ads/view/:id', async (req, res) => {
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
app.post('/api/ads/create', async (req, res) => {
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
            repostIntervalHrs: t.id === '800' ? 12 : 24,
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

app.get('/api/admin/tariffs', async (req, res) => {
    if (req.headers['x-admin-key'] !== process.env.ADMIN_PASS) return res.status(403).send();
    res.json(await Tariff.find({}));
});

app.post('/api/admin/tariffs/save', async (req, res) => {
    if (req.headers['x-admin-key'] !== process.env.ADMIN_PASS) return res.status(403).send();
    const { id, price, days, reposts } = req.body;
    await Tariff.findOneAndUpdate({ id }, { price, days, reposts });
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
        // 1. Очистка данных
        const tgContact = ad.telegram ? ad.telegram.replace(/[@\s]/g, '').trim() : '';
        const viberContact = ad.viber ? ad.viber.replace(/[^0-9]/g, '').trim() : '';

        // 2. Используем HTML вместо Markdown для стабильности ссылок
        const text = `⚓ <b>${ad.isVip ? '⭐ ТОП ВАКАНСІЯ' : (ad.vacancyInOut || 'НОВА ВАКАНСІЯ')}</b> ⚓\n\n` +
            `👤 <b>Посада:</b> ${ad.vacancy}\n` +
            `📝 <b>Опис:</b> ${ad.duties}\n\n` +
            `🕘 <b>Графік:</b> ${ad.schedule}\n\n` +
            `💰 <b>Зарплата:</b> ${ad.salary}\n` +
            `📍 <b>Місто/Район:</b> ${ad.city}, ${ad.address}\n` +
            `📞 <b>Контакти:</b> ${ad.phone} (${ad.person})`;

        const row1 = [];
        if (tgContact) {
            // Прямая ссылка без лишних знаков
            row1.push(Markup.button.url('💬 Telegram', `https://t.me/${tgContact}`));
        }
        if (viberContact) {
            // Прямой протокол - в кнопках канала он обычно разрешен
            row1.push(Markup.button.url('🟣 Viber', `viber://chat?number=%2B${viberContact}`));
        }

        const keyboard = Markup.inlineKeyboard([
            row1, 
            [Markup.button.url('🚀 Відкрити Одеса-Борд', 'https://board-odessa.onrender.com')]
        ]);

        await bot.telegram.sendMessage(process.env.CHANNEL_ID, text, { 
            parse_mode: 'HTML', // Переключили на HTML
            ...keyboard 
        });
        
        return true;
    } catch (e) {
        console.error("Помилка відправки:", e);
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
                await ctx.editMessageText(ctx.callbackQuery.message.text + '\n\n✅ ОПУБЛІКОВАНО');

                // Уведомляем клиента (если это не 'web' пользователь)
                if (ad.userId && ad.userId !== 'web') {
                    bot.telegram.sendMessage(ad.userId, `🎉 Ваше оголошення "${ad.vacancy}" активовано та опубліковано в каналі!`).catch(e => console.log("User notify error:", e));
                }
            }
        }

    }
    catch (e) { console.log(e); }
});


// Запуск сервера
app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

// ФУНКЦИЯ ПРОВЕРКИ ОЧЕРЕДИ (АВТОПИЛОТ)
async function checkScheduledReposts() {
    const now = new Date();
    try {
        const ads = await Ad.find({
            status: 'active',
            repostsRemaining: { $gt: 0 },
            repostIntervalHrs: { $gt: 0 }
        });

        for (let ad of ads) {
            const lastPost = new Date(ad.lastRepostDate);
            const diffInMs = now - lastPost;
            const intervalInMs = ad.repostIntervalHrs * 60 * 60 * 1000;

            if (diffInMs >= intervalInMs) {
                console.log(`[AUTO] Время репоста для ${ad.id}`);
                
                // Вызов твоей функции отправки в ТГ
                const result = await sendToTelegram(ad); 
                
                if (result) {
                    ad.repostsRemaining -= 1;
                    ad.lastRepostDate = now;
                    // save() обновит updatedAt, и карточка всплывет на сайте
                    await ad.save(); 
                }
            }
        }
    } catch (e) {
        console.error("Ошибка автопостинга:", e);
    }
}

// Запускаем проверку каждые 30 минут
setInterval(checkScheduledReposts, 30 * 60 * 1000);


app.listen(process.env.PORT || 3000, () => {
    bot.launch().catch(err => console.error("TG Error:", err));
});


// Улучшенная проверка на номера телефонов (UA-коды)
function containsForbiddenContact(text) {
    if (!text) return false;

    // 1. Поиск украинских мобильных и городских кодов (067, 050, 093, 048 и т.д.)
    // Ищет комбинации: код + 7 цифр в разных форматах (+380..., 067..., 80...)
    const phoneRegex = /(?:0|380|\+380|8)\s?\(?(?:50|66|95|99|67|68|96|97|98|63|73|93|44|48)\)?[\s\-]?\d{3}[\s\-]?\d{2}[\s\-]?\d{2}/g;

    // 2. Поиск ссылок (http, https, www, .com, .ua, .net и т.д.)
    // Если решишь запретить ссылки, это выражение их поймает
    const linkRegex = /(https?:\/\/|www\.|[\w.-]+\.(?:com|ua|net|org|biz|info|me|io))/gi;

    return phoneRegex.test(text) || linkRegex.test(text);
}

// ANTI-SLEEP
setInterval(() => { axios.get("https://board-odessa.onrender.com").catch(() => {}); }, 800000);