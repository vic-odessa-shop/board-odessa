const tg = window.Telegram.WebApp;
tg.ready();

async function initApp() {
    try {
        tg.expand();
        const res = await fetch('/api/init');
        const data = await res.json();
        
        const select = document.getElementById('categorySelect');
        if (data.cats && select) {
            select.innerHTML = '<option value="">Усі категорії 🔍</option>';
            data.cats.forEach(cat => {
                const opt = document.createElement('option');
                opt.value = cat.id;
                opt.innerText = cat.name;
                select.appendChild(opt);
            });
        }
        loadAds();
    } catch (e) { console.error("Init error:", e); }
}

async function loadAds(cat = '') {
    try {
        const res = await fetch(`/api/ads${cat ? '?category='+cat : ''}`);
        const ads = await res.json();
        const main = document.getElementById('adsContainer');
        const vip = document.getElementById('vipContainer');
        
        if(main) main.innerHTML = ''; 
        if(vip) vip.innerHTML = '';

        ads.forEach(ad => {
            if (ad.isVip && vip) vip.appendChild(createVipCard(ad));
            else if(main) main.appendChild(createCard(ad));
        });
    } catch (e) { console.error("Load error:", e); }
}

function createCard(ad) {
    const div = document.createElement('div');
    div.className = 'ad-card';
    div.innerHTML = `<div><h3>${ad.title}</h3><span>📍 Одеса</span></div><p>${ad.salary} ₴</p>`;
    div.onclick = () => showFullAd(ad);
    return div;
}

function createVipCard(ad) {
    const div = document.createElement('div');
    div.className = 'vip-item';
    div.innerHTML = `<h3>${ad.title}</h3><p>${ad.salary} ₴</p><span>⚓ VIP</span>`;
    div.onclick = () => showFullAd(ad);
    return div;
}

function showFullAd(ad) {
    const modal = document.getElementById('modal');
    const body = document.getElementById('modalBody');
    const duties = ad.duties || "Опис відсутній";
    const phone = ad.phone || "********";
    
    body.innerHTML = `
        <h2>${ad.title}</h2>
        <p>💰 <b>Зарплата:</b> ${ad.salary} грн</p>
        <p>📝 ${duties}</p>
        <hr>
        <p>📞 <b>Контакти:</b> ${phone}</p>
        <button class="main-add-btn" onclick="tg.switchInlineQuery('Дивись вакансію: ${ad.title}')">🚀 Поділитись</button>
    `;
    modal.style.display = 'block';
}

function showHelp() {
    tg.showAlert("⚓ Smart Job Odessa\nТут ви можете знайти роботу або подати вакансію. Оголошення публікується в каналі після модерації.");
}

function closeModal() { document.getElementById('modal').style.display = 'none'; }
window.onload = initApp;
