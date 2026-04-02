const express = require('express');
const { Telegraf, Markup } = require('telegraf');
const mongoose = require('mongoose');
const path = require('path');
const axios = require('axios');
require('dotenv').config();

const app = express();
const bot = new Telegraf(process.env.BOT_TOKEN);

app.use(express.json());

mongoose.connect(process.env.MONGO_URI);

// --- СХЕМА ОБЪЯВЛЕНИЙ ---
const adSchema = new mongoose.Schema({
    id: String,
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
        const ads = await Ad.find({ status: 'active' })
                            .sort({ updatedAt: -1 }) // Свежие и репостнутые — сверху
                            .limit(25);              // Только первые 25 штук
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
        // 1. Ищем настройки тарифа в базе
        const t = await Tariff.findOne({ id: d.tariff });
        if (!t) return res.status(400).json({ error: "Невірний тариф" });
        
        // 2. Получаем карту из ротатора
        const paymentDetail = await getNextPaymentDetail();
        
        const adId = 'v' + Math.floor(10000 + Math.random() * 90000);
        const newAd = new Ad({
            ...d,
            id: adId,
            isVip: t.isVip,
            status: 'pending',
            repostsRemaining: t.reposts,
            repostIntervalHrs: t.id === '800' ? 12 : 24, // Например: Турбо - каждые 12ч, остальные - 24ч
            expireAt: new Date(Date.now() + t.days * 24 * 60 * 60 * 1000)
        });
        await newAd.save();
        
        // 3. Уведомление админу с ценой и картой
        if (process.env.ADMIN_ID) {
            bot.telegram.sendMessage(process.env.ADMIN_ID,
                `🆕 ЗАМОВЛЕННЯ: ${adId}\n💰 До сплати: ${t.price} грн\n💳 Карта: ${paymentDetail}`, {
                    ...Markup.inlineKeyboard([
                        [Markup.button.callback('✅ Оплачено', `paid_${adId}`)],
                        [Markup.button.callback('🗑 Видалити', `del_${adId}`)]
                    ])
                });
        }
        // Возвращаем на сайт реквизиты для клиента
        res.json({ id: adId, success: true, payment: paymentDetail, price: t.price });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Отдает только те типы оплаты, которые включены в админке
// Новый маршрут (API), чтобы сайт знал, что показывать
app.get('/api/active-pay-methods', async (req, res) => {
    try {
        // Ищем все активные реквизиты и вынимаем из них уникальные названия (Картка, Телефон и т.д.)
        const activeMethods = await Payment.distinct('label', { isActive: true });
        res.json(activeMethods);
    } catch (e) {
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
        const text = `⚓ *${ad.isVip ? '⭐ ТОП ВАКАНСІЯ' : `${ ad.vacancyInOut }`}* ⚓\n\n` +
            `👤 *Посада:* ${ad.vacancy}\n` +
            `📝 *Опис:* ${ad.duties}\n\n` +
            `🕘 *Графік:* ${ad.schedule}\n\n` +
            `💰 *Зарплата:* ${ad.salary}\n` +
            `📍 *Місто/Район:* ${ad.city}, ${ad.address}\n` +
            `📞 *Контакти:* ${ad.phone} (${ad.person})\n\n` +
            `🚀 [Відкрити в Mini App](https://board-odessa.onrender.com)\n\n`;

        await bot.telegram.sendMessage(process.env.CHANNEL_ID, text, { parse_mode: 'Markdown' });
        return true;
    } catch (e) {
        console.error("Ошибка отправки в канал:", e);
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
            ad.lastRepostDate = new Date(); // Засекаем время первого поста
            await ad.save();

            const sent = await sendToTelegram(ad);
            if (sent) {
                await ctx.editMessageText(ctx.callbackQuery.message.text + '\n\n✅ ОПУБЛІКОВАНО ТА АКТИВОВАНО');
            }
        }
    } catch (e) { console.log(e); }
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

// ANTI-SLEEP
setInterval(() => { axios.get("https://board-odessa.onrender.com").catch(() => {}); }, 800000);