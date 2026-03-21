const express = require('express');
const { Telegraf, Markup } = require('telegraf');
const mongoose = require('mongoose');
const path = require('path');
const axios = require('axios');
require('dotenv').config();

const app = express();
const bot = new Telegraf(process.env.BOT_TOKEN);

app.use(express.json());

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

// Вспомогательная функция проверки телефона
function hasHiddenPhone(text) {
    if (!text) return false;
    const phoneRegex = /(039|050|063|066|067|068|073|089|091|092|093|094|095|096|097|098|099|048)\d{7}/g;
    return phoneRegex.test(text.replace(/[\s\-\(\)]/g, ''));
}

// ОТПРАВКА В КАНАЛ
async function sendToChannel(ad) {
    const text = `⚓ *РОБОТА ОДЕСА* ⚓\n\n` +
        `🗂 *Категорія:* ${ad.category}\n` +
        `👤 *Посада:* ${ad.vacancy}\n` +
        `💰 *Зарплата:* ${ad.salary} грн\n` +
        `📍 *Місто:* ${ad.city}\n` +
        `🏠 *Адреса:* ${ad.address || 'Уточнюйте'}\n` +
        `🕘 *Графік:* ${ad.schedule || 'За домовленістю'}\n` +
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

// API: ПУБЛИЧНЫЙ СПИСОК (Сайт)
app.get('/api/ads', async (req, res) => {
    try {
        const ads = await Ad.find({ status: 'active' }).sort({ isVip: -1, createdAt: -1 });
        res.json(ads);
    } catch (e) { res.status(500).send(e.message); }
});

// API: СОЗДАНИЕ
app.post('/api/ads/create', async (req, res) => {
    try {
        const d = req.body;
        if (hasHiddenPhone(d.duties) || hasHiddenPhone(d.vacancy)) {
            return res.status(400).json({ error: "Телефон тільки в полі 'Телефон'!" });
        }
        const adId = 'v' + Math.floor(10000 + Math.random() * 90000);
        const t = TARIFFS[d.tariff] || TARIFFS['400'];
        const finalVip = (d.tariff === '800' || d.isVip === true);

        const newAd = new Ad({
            ...d, id: adId, isVip: finalVip, status: 'pending',
            repostsRemaining: t.reposts,
            expireAt: new Date(Date.now() + t.days * 24 * 60 * 60 * 1000)
        });
        await newAd.save();
        
        if (process.env.ADMIN_ID) {
            bot.telegram.sendMessage(process.env.ADMIN_ID, `🆕 НОВЕ: ${adId}`, {
                ...Markup.inlineKeyboard([
                    [Markup.button.callback('✅ Оплачено', `paid_${adId}`)],
                    [Markup.button.callback('🗑 Видалити', `del_${adId}`)]
                ])
            });
        }
        res.json({ id: adId, success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- АДМИН-МАРШРУТЫ ---

app.get('/api/admin/all-ads', async (req, res) => {
    if (req.headers['x-admin-key'] !== process.env.ADMIN_PASS) return res.status(403).send();
    const ads = await Ad.find({}).sort({ createdAt: -1 });
    res.json(ads);
});

app.post('/api/admin/update/:id', async (req, res) => {
    if (req.headers['x-admin-key'] !== process.env.ADMIN_PASS) return res.status(403).send();
    const ad = await Ad.findOneAndUpdate({ id: req.params.id }, { $set: req.body }, { new: true });
    res.json({ success: !!ad });
});

app.post('/api/admin/repost-batch', async (req, res) => {
    if (req.headers['x-admin-key'] !== process.env.ADMIN_PASS) return res.status(403).send();
    const { ids } = req.body;
    for (const id of ids) {
        const ad = await Ad.findOne({ id });
        if (ad) {
            await sendToChannel(ad);
            ad.lastRepostDate = new Date();
            await ad.save();
            await new Promise(r => setTimeout(r, 1200));
        }
    }
    res.json({ success: true });
});

app.delete('/api/admin/delete/:id', async (req, res) => {
    if (req.headers['x-admin-key'] !== process.env.ADMIN_PASS) return res.status(403).send();
    await Ad.deleteOne({ id: req.params.id });
    res.json({ success: true });
});

// Остальное (бот, статика, listen)
bot.on('callback_query', async (ctx) => {
    const [action, adId] = ctx.callbackQuery.data.split('_');
    const ad = await Ad.findOne({ id: adId });
    if (!ad) return;
    if (action === 'paid') {
        ad.status = 'active'; ad.lastRepostDate = new Date();
        await ad.save(); await sendToChannel(ad);
        ctx.answerCbQuery('Опубліковано');
    } else if (action === 'del') {
        await Ad.deleteOne({ id: adId });
        ctx.answerCbQuery('Видалено');
    }
});

app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

app.listen(process.env.PORT || 3000, () => {
    console.log('Server live');
    bot.launch().catch(err => console.error("TG Error:", err));
});
