const express = require('express');
const { Telegraf, Markup } = require('telegraf');
const mongoose = require('mongoose');
const path = require('path');
const axios = require('axios');
require('dotenv').config();

const app = express();
const bot = new Telegraf(process.env.BOT_TOKEN);

app.use(express.json());

// ТАРИФЫ (Сопоставляем цены из формы с логикой сервера)
const TARIFFS = {
    '150': { price: 150, days: 7, reposts: 1, label: 'Пробний', vip: false },
    '400': { price: 400, days: 30, reposts: 1, label: 'Стандарт', vip: false },
    '800': { price: 800, days: 30, reposts: 7, label: 'Турбо', vip: true }
};

mongoose.connect(process.env.MONGO_URI);

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
    createdAt: { type: Date, default: Date.now },
    expireAt: Date,
    repostsRemaining: Number,
    lastRepostDate: Date
});
const Ad = mongoose.model('Ad', adSchema);

function hasHiddenPhone(text) {
    if (!text) return false;
    const phoneRegex = /(039|050|063|066|067|068|073|089|091|092|093|094|095|096|097|098|099|048)\d{7}/g;
    return phoneRegex.test(text.replace(/[\s\-\(\)]/g, ''));
}

// API: ПОЛУЧЕНИЕ ОБЪЯВЛЕНИЙ
app.get('/api/ads', async (req, res) => {
    try {
        const ads = await Ad.find({
            status: { $in: ['active', 'pending'] }
        }).sort({ isVip: -1, createdAt: -1 });
        res.json(ads);
    } catch (e) { res.status(500).send(e.message); }
});

// API: СОЗДАНИЕ ОБЪЯВЛЕНИЯ
app.post('/api/ads/create', async (req, res) => {
    try {
        const d = req.body;
        if (hasHiddenPhone(d.duties) || hasHiddenPhone(d.vacancy)) {
            return res.status(400).json({ error: "Номер телефону дозволено писати тільки в полі 'Телефон'!" });
        }
        
        const adId = 'v' + Math.floor(10000 + Math.random() * 90000);
        // Берем данные тарифа по цене из формы
        const t = TARIFFS[d.tariff] || TARIFFS['400'];
        
        // VIP статус: если Турбо (800) ИЛИ нажат чекбокс VIP в форме
        const finalVip = (d.tariff === '800' || d.isVip === true);

        const newAd = new Ad({
            ...d,
            id: adId,
            isVip: finalVip,
            status: 'pending',
            repostsRemaining: t.reposts,
            expireAt: new Date(Date.now() + t.days * 24 * 60 * 60 * 1000)
        });
        
        await newAd.save();
        
        if (process.env.ADMIN_ID) {
            bot.telegram.sendMessage(process.env.ADMIN_ID,
                `🆕 *НОВЕ ОГОЛОШЕННЯ: ${adId}*\n\n` +
                `Тариф: ${t.label} (VIP: ${finalVip ? '✅' : '❌'})\n` +
                `Сума: ${parseInt(d.tariff) + (d.isVip ? 150 : 0)} грн\n` +
                `Категорія: ${d.category}\n` +
                `Посада: ${d.vacancy}\n` +
                `Контакт: ${d.person} (${d.phone})`, {
                    parse_mode: 'Markdown',
                    ...Markup.inlineKeyboard([
                        [Markup.button.callback('✅ Оплачено (В ЛЕНТУ)', `paid_${adId}`)],
                        [Markup.button.callback('🗑 Видалити', `del_${adId}`)]
                    ])
                });
        }
        res.json({ id: adId, success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ОБРАБОТКА КНОПОК АДМИНА
bot.on('callback_query', async (ctx) => {
    const [action, adId] = ctx.callbackQuery.data.split('_');
    const ad = await Ad.findOne({ id: adId });
    if (!ad) return ctx.answerCbQuery('Оголошення не знайдено');
    
    if (action === 'paid') {
        ad.status = 'active';
        ad.lastRepostDate = new Date();
        ad.repostsRemaining = Math.max(0, (ad.repostsRemaining || 1) - 1);
        await ad.save();
        await sendToChannel(ad);
        ctx.editMessageText(`✅ Опубліковано ${adId}. Прямі контакти в каналі.`);
    } else if (action === 'del') {
        await Ad.deleteOne({ id: adId });
        ctx.editMessageText(`🗑 Видалено ${adId}`);
    }
});

// ФУНКЦИЯ ОТПРАВКИ В КАНАЛ (ПРЯМЫЕ КОНТАКТЫ)
async function sendToChannel(ad) {
    const text = `⚓ *РОБОТА ОДЕСА* ⚓\n\n` +
        `🗂 *Категорія:* ${ad.category}\n` +
        `👤 *Посада:* ${ad.vacancy}\n` +
        `💰 *Зарплата:* ${ad.salary} грн\n` +
        `📍 *Місто:* ${ad.city}\n` +
        `🏠 *Адреса:* ${ad.address || 'Уточнюйте'}\n` + // Добавили адрес
        `🕘 *Графік:* ${ad.schedule || 'За домовленістю'}\n` + // Добавили график
        `📝 *Опис:* ${ad.duties}\n\n` +
        `📞 *КОНТАКТИ:* \n` +
        `📱 ${ad.phone} (${ad.person})\n` +
        (ad.telegram ? `✈️ TG: @${ad.telegram.replace('@','')}\n` : '') +
        (ad.viber ? `🟣 Viber: ${ad.viber}\n` : '') +
        `\n🚀 [Дивитись всі вакансії на сайті](https://board-odessa.onrender.com)`;

    const channelId = process.env.CHANNEL_ID || '-1003719363779';
    try {
        await bot.telegram.sendMessage(channelId, text, { 
            parse_mode: 'Markdown',
            disable_web_page_preview: true 
        });
    } catch (err) { console.error("Ошибка канала:", err); }
}

// --- API ДЛЯ ВЕБ-АДМИНКИ (УПРАВЛЕНИЕ ИЗ БРАУЗЕРА) ---

// 1. Получить вообще все объявления (для админ-панели)
app.get('/api/admin/all-ads', async (req, res) => {
    const adminKey = req.headers['x-admin-key'];
    if (!adminKey || adminKey !== process.env.ADMIN_PASS) {
        return res.status(403).json({ error: "Доступ заборонено" });
    }
    try {
        const ads = await Ad.find({}).sort({ createdAt: -1 });
        res.json(ads);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// 2. Активация объявления из браузера
app.post('/api/admin/approve/:id', async (req, res) => {
    const adminKey = req.headers['x-admin-key'];
    if (adminKey !== process.env.ADMIN_PASS) return res.status(403).send("Stop");
    try {
        const ad = await Ad.findOne({ id: req.params.id });
        if (!ad) return res.status(404).send("Не знайдено");

        ad.status = 'active';
        ad.lastRepostDate = new Date();
        await ad.save();
        
        // Отправляем в канал при активации
        await sendToChannel(ad);
        
        res.json({ success: true });
    } catch (e) { res.status(500).send(e.message); }
});

// 3. Удаление из браузера
app.delete('/api/admin/delete/:id', async (req, res) => {
    const adminKey = req.headers['x-admin-key'];
    if (adminKey !== process.env.ADMIN_PASS) return res.status(403).send("Stop");
    try {
        await Ad.deleteOne({ id: req.params.id });
        res.json({ success: true });
    } catch (e) { res.status(500).send(e.message); }
});


// АВТО-МЕНЕДЖЕР
setInterval(async () => {
    await Ad.updateMany({ expireAt: { $lt: new Date() }, status: 'active' }, { status: 'expired' });
    const toRepost = await Ad.find({
        status: 'active',
        repostsRemaining: { $gt: 0 },
        lastRepostDate: { $lt: new Date(Date.now() - 22 * 60 * 60 * 1000) }
    });
    for (let ad of toRepost) {
        await sendToChannel(ad);
        ad.repostsRemaining -= 1;
        ad.lastRepostDate = new Date();
        await ad.save();
    }
}, 3600000);

// ANTI-SLEEP
setInterval(() => {
    axios.get("https://board-odessa.onrender.com").catch(() => {});
}, 800000);


// ВНИМАНИЕ: Этот адрес удалит ВСЕ объявления. 
// Запустите его один раз в браузере: адрес-вашего-сайта.com/api/admin/clear-database
app.get('/api/admin/clear-database', async (req, res) => {
    try {
        console.log("Запрос на очистку базы...");
        const result = await Ad.deleteMany({});
        res.send(`
            <h1>Результат очистки:</h1>
            <p>Видалено документів: ${result.deletedCount}</p>
            <a href="/">Повернутися на головну</a>
        `);
    } catch (e) {
        console.error("Помилка очистки:", e);
        res.status(500).send("Помилка: " + e.message);
    }
});

// 4. ОБНОВЛЕНИЕ ОБЪЯВЛЕНИЯ (Редактирование из браузера)
app.post('/api/admin/update/:id', async (req, res) => {
    const adminKey = req.headers['x-admin-key'];
    if (adminKey !== process.env.ADMIN_PASS) return res.status(403).send("Stop");
    
    try {
        const id = req.params.id;
        const newData = req.body; // Получаем всё, что прислал админ
        
        // Находим и обновляем в базе
        const ad = await Ad.findOneAndUpdate(
            { id: id }, 
            { $set: newData }, // Обновляем только присланные поля
            { new: true }      // Возвращаем обновленный объект
        );

        if (!ad) return res.status(404).send("Не знайдено");
        
        console.log(`✅ Адмін оновив оголошення ${id}`);
        res.json({ success: true, ad });
    } catch (e) { 
        res.status(500).json({ error: e.message }); 
    }
});



app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));





app.listen(process.env.PORT || 3000, () => {
    console.log('Server live');
    bot.launch().catch(err => console.error("TG Error:", err));
});
