const API_BASE = 'https://ВАШ_URL.onrender.com';
const tg = window.Telegram.WebApp;

async function initApp() {
    tg.expand();
    const res = await fetch(`${API_BASE}/api/init`);
    const data = await res.json();
    renderCategories(data.cats);
    renderPromos(data.promos);
    loadAds();
}

async function loadAds(cat = '') {
    const res = await fetch(`${API_BASE}/api/ads${cat ? '?category='+cat : ''}`);
    const ads = await res.json();
    const main = document.getElementById('adsContainer');
    const vip = document.getElementById('vipContainer');
    
    main.innerHTML = ''; vip.innerHTML = '';

    ads.forEach(ad => {
        const card = createCard(ad);
        if (ad.isVip) vip.appendChild(createVipCard(ad));
        main.appendChild(card);
    });
}

function createCard(ad) {
    const div = document.createElement('div');
    div.className = 'ad-card';
    div.innerHTML = `<div><h3>${ad.title}</h3><span>📍 ${ad.city}</span></div><p>${ad.salary} ₴</p>`;
    div.onclick = () => showFullAd(ad);
    return div;
}

function createVipCard(ad) {
    const div = document.createElement('div');
    div.className = 'vip-item';
    div.innerHTML = `<h3>${ad.title}</h3><p>${ad.salary} ₴</p><span>⚓ Одеса</span>`;
    div.onclick = () => showFullAd(ad);
    return div;
}

function showFullAd(ad) {
    const modal = document.getElementById('modal');
    const body = document.getElementById('modalBody');
    const shareUrl = `https://t.me/${tg.botInfo?.username || 'bot'}/app?startapp=${ad.id}`;
    
    body.innerHTML = `
        <h2>${ad.title}</h2>
        <p>💰 <b>Зарплата:</b> ${ad.salary} грн</p>
        <p>📝 ${ad.content.duties}</p>
        <hr>
        <p>📞 <b>Контакти:</b> ${ad.status==='active' ? ad.content.phone : '********'}</p>
        <button class="main-add-btn" onclick="tg.switchInlineQuery('Дивись вакансію: ${ad.title}\\n${shareUrl}')">🚀 Поділитись</button>
    `;
    modal.style.display = 'block';
}

function closeModal() { document.getElementById('modal').style.display = 'none'; }
function renderCategories(cats) { /* ... заполнение селекта ... */ }
window.onload = initApp;
