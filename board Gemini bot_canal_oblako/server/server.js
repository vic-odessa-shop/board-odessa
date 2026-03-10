const express = require('express');
const { Telegraf, Markup } = require('telegraf');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

mongoose.connect(process.env.MONGO_URI);

// --- СХЕМЫ ДАННЫХ ---
const AdSchema = new mongoose.Schema({
    id: String, userId: String, title: String, salary: String, city: String,
    content: Object, status: { type: String, default: 'pending' },
    isVip: { type: Boolean, default: false }, 
    createdAt: { type: Date, default: Date.now },
    expireAt: Date
});
const Ad = mongoose.model('Ad', AdSchema);

const WalletSchema = new mongoose.Schema({
    type: String, number: String, label: String, active: { type: Boolean, default: true },
    useCount: { type: Number, default: 0 }
});
const Wallet = mongoose.model('Wallet', WalletSchema);

const PromoSchema = new mongoose.Schema({ imageUrl: String, link: String, active: { type: Boolean, default: true } });
const Promo = mongoose.model('Promo', PromoSchema);

const bot = new Telegraf(process.env.BOT_TOKEN);

// --- ЛОГИКА РОТАТОРА ---
async function getNextWallet() {
    const wallet = await Wallet.findOne({ active: true }).sort({ useCount: 1 });
    if (wallet) {
        wallet.useCount += 1;
        await wallet.save();
        return wallet;
    }
    return { number: "UA0000...", label: "Зверніться до адміна" };
}

// --- API ЭНДПОИНТЫ ---
app.get('/api/init', async (req, res) => {
    const promos = await Promo.find({ active: true });
    const cats = await Ad.aggregate([{ $match: { status: 'active' } }, { $group: { _id: "$title", count: { $sum: 1 } } }]);
    res.json({ promos, cats });
});

app.get('/api/ads', async (req, res) => {
    const { category } = req.query;
    let query = { status: 'active' };
    if (category) query.title = category;
    const ads = await Ad.find(query).sort({ isVip: -1, createdAt: -1 });
    res.json(ads);
});

app.post('/api/ads/create', async (req, res) => {
    const data = req.body;
    const adCode = `ID-${Math.floor(1000 + Math.random() * 9000)}`;
    const wallet = await getNextWallet();

    const newAd = new Ad({
        id: adCode, userId: data.userId, title: data.title, salary: data.salary,
        city: data.city, isVip: data.isVip, content: data,
        expireAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    });
    await newAd.save();

    bot.telegram.sendMessage(process.env.ADMIN_ID, 
        `🆕 ЗАМОВЛЕННЯ: ${adCode}\n💰 ${data.salary}грн | ${data.payMethod}\n👤 ${data.person} ${data.phone}`,
        Markup.inlineKeyboard([
            [Markup.button.callback('✅ АКТИВУВАТИ', `paid_${adCode}`)],
            [Markup.button.callback('🗑 ВИДАЛИТИ', `del_${adCode}`)]
        ])
    );
    res.json({ success: true, id: adCode, wallet });
});

// --- ОБРАБОТКА КНОПОК АДМИНА ---
bot.action(/^paid_(.+)$/, async (ctx) => {
    const adId = ctx.match[1];
    const ad = await Ad.findOneAndUpdate({ id: adId }, { status: 'active' });
    
    // Автопостинг в канал
    const text = `🔥 **${ad.title.toUpperCase()}**\n💰 ЗП: ${ad.salary} грн\n📍 Місто: ${ad.city}\n\n👉 [Відкрити в боті](https://t.me/${ctx.botInfo.username}/app?startapp=${ad.id})`;
    bot.telegram.sendMessage(process.env.CHANNEL_ID, text, { parse_mode: 'Markdown' });

    ctx.editMessageText(`✅ Оголошення ${adId} активовано!`);
});

bot.launch();
app.listen(process.env.PORT || 3000);
