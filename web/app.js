
const tg = window.Telegram?.WebApp;

if (tg) {
    tg.ready();
    tg.expand();
    // Не позволяем вертикальному свайпу случайно сворачивать Mini App.
    if (typeof tg.disableVerticalSwipes === "function") {
        tg.disableVerticalSwipes();
    }
    tg.setHeaderColor("#080b10");
    tg.setBackgroundColor("#080b10");
}

// Лёгкий тактильный отклик только после настоящего нажатия.
// Событие click не срабатывает при обычном свайпе/прокрутке.
document.addEventListener("click", event => {
    const target = event.target?.closest(
        "button, [role='button'], .market-item, .collection-item, .achievement-card, .daily-task-card, .shop-package"
    );
    if (!target || target.disabled || target.id === "spin" || target.id === "free-spin-button" || !tg?.HapticFeedback) return;

    try {
        tg.HapticFeedback.impactOccurred("light");
    } catch (_) {
        // Haptic feedback недоступен на некоторых клиентах Telegram.
    }
});

// Вибрация привязана к фактическому прохождению символом очередной позиции.
let lastSlotHapticAt = 0;

function slotStepHaptic(progress) {
    const now = performance.now();
    if (now - lastSlotHapticAt < 48) return;
    lastSlotHapticAt = now;
    try {
        tg?.HapticFeedback?.impactOccurred(progress > 0.82 ? "light" : "soft");
    } catch (_) {}
}

function spinHaptic(useFree) {
    try {
        tg?.HapticFeedback?.impactOccurred(useFree ? "medium" : "heavy");
    } catch (_) {}
}

const initData = tg?.initData || "";
const headers = { "Content-Type": "application/json" };

let marketCache = [];
let collectionCache = [];
let marketFavorites = new Set();
try {
    marketFavorites = new Set(JSON.parse(localStorage.getItem("numberRushMarketFavorites") || "[]").map(String));
} catch (_) {
    marketFavorites = new Set();
}

if (initData) {
    headers.Authorization = "tma " + initData;
}

const $ = id => document.getElementById(id);

async function api(path, options = {}) {
    const res = await fetch(path, {
        ...options,
        headers: { ...headers, ...(options.headers || {}) }
    });

    const data = await res.json().catch(() => ({
        detail: "Server error"
    }));

    if (!res.ok) {
        throw new Error(data.detail || "Request failed");
    }

    return data;
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    }[c]));
}

function formatRubles(value) {
    const amount = Math.floor(Math.abs(Number(value) || 0));
    const lastTwo = amount % 100;
    const last = amount % 10;
    const word = lastTwo >= 11 && lastTwo <= 14 ? "рублей"
        : last === 1 ? "рубль"
        : last >= 2 && last <= 4 ? "рубля"
        : "рублей";
    return amount.toLocaleString("ru-RU") + " " + word;
}

const plateLetters = "АВЕКМНОРСТУХ";
const plateDigits = "0123456789";

const rarityColors = {
    Common: "#b9c3d0",
    Uncommon: "#36d477",
    Rare: "#3294ff",
    Epic: "#ae63ff",
    Legendary: "#ffc247",
};

const rarityNames = {
    Common: "ОБЫЧНЫЙ",
    Uncommon: "НЕОБЫЧНЫЙ",
    Rare: "РЕДКИЙ",
    Epic: "ЭПИЧЕСКИЙ",
    Legendary: "ЛЕГЕНДАРНЫЙ",
    Mythic: "ЛЕГЕНДАРНЫЙ"
};

function setRarityEffect(rarity) {
    const plate = $("plate");
    const rarityLabel = $("rarity");
    const color = rarityColors[rarity] || rarityColors.Common;

    if (!plate || !rarityLabel) return;

    plate.style.setProperty("--rarity-color", color);
    plate.dataset.rarity = rarity;

    if (typeof plate.animate === "function") {
        plate.animate(
            [{ transform: "scale(1)" }, { transform: "scale(1.015)" }, { transform: "scale(1)" }],
            { duration: 420, easing: "ease-out" }
        );
    }

    rarityLabel.style.color = color;
    rarityLabel.classList.remove(
        "rarity-reveal-common", "rarity-reveal-uncommon", "rarity-reveal-rare",
        "rarity-reveal-epic", "rarity-reveal-legendary"
    );
    const rarityClass = ["Common", "Uncommon", "Rare", "Epic", "Legendary"].includes(rarity)
        ? rarity.toLowerCase() : "common";
    rarityLabel.classList.add("rarity-reveal-" + rarityClass);
    rarityLabel.textContent = rarityNames[rarity] || rarity.toUpperCase();
}

function renderPlateAnalysis(analysis) {
    if (!analysis || !analysis.supported) return "";

    const items = [];
    const add = (label, values) => {
        if (!Array.isArray(values) || !values.length) return;
        const unique = [...new Set(values.map(value => String(value || "").trim()).filter(Boolean))];
        if (unique.length) items.push(
            `<p><b>${escapeHtml(label)}:</b> ${unique.map(escapeHtml).join(" · ")}</p>`
        );
    };

    const regionName = String(analysis.region || "").trim();
    const regionCode = String(analysis.region_code || "").trim();
    if (regionName || regionCode) {
        items.push(`<p><b>Регион:</b> ${escapeHtml(regionName || regionCode)}${regionName && regionCode ? ` (${escapeHtml(regionCode)})` : ""}</p>`);
    }

    add("Цифры", analysis.digit_patterns);
    add("Буквы", analysis.letter_patterns);

    if (analysis.lexical && analysis.lexical.reading) {
        const meaning = String(analysis.lexical.meaning || "").trim();
        items.push(`<p><b>Читается:</b> ${escapeHtml(analysis.lexical.reading)}${meaning ? ` — ${escapeHtml(meaning)}` : ""}</p>`);
    }

    const history = (analysis.historical_associations || [])
        .map(item => String(item.association || "").trim())
        .filter(Boolean);
    add("Серия", history);

    const marketLabel = category => {
        if (category === "three_identical_digits") return "Тройные цифры";
        if (category === "three_identical_letters") return "Тройные буквы";
        if (category === "mirror_digits") return "Зеркальные цифры";
        if (category === "round_hundreds") return "Круглая сотня";
        if (category === "first_decade_001_010") return "Число из первой десятки";
        if (category === "word_KOT") return "Читаемое слово «КОТ»";
        if (category.endsWith("_digits")) return "Рыночная комбинация " + category.slice(0, -7);
        if (category.endsWith("_letters")) return "Рыночная серия " + category.slice(0, -8);
        return "";
    };
    if (!items.length) return "";
    return `
        <details class="plate-analysis">
            <summary>Описание номера</summary>
            <div class="plate-analysis-content">
                ${items.join("")}
            </div>
        </details>
    `;
}

function renderTags(tags) {
    if (!Array.isArray(tags) || tags.length === 0) {
        return "";
    }

    return `
        <div class="plate-tags">
            ${tags.map(tag => `
                <span class="plate-tag">${escapeHtml(tag)}</span>
            `).join("")}
        </div>
    `;
}

function randomSymbol(finalChar) {
    const alphabet = plateLetters.includes(finalChar)
        ? plateLetters
        : plateDigits;

    return alphabet[Math.floor(Math.random() * alphabet.length)];
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function rollSlot(element, finalChar, options = {}) {
    const duration = options.duration || 2600;
    const delay = options.delay || 0;
    const fontSize = parseFloat(getComputedStyle(element).fontSize) || 36;
    const symbolHeight = fontSize;

    const strip = document.createElement("span");
    strip.className = "slot-strip";

    const windowElement = document.createElement("span");
    windowElement.className = "slot-window";
    windowElement.style.height = `${symbolHeight}px`;
    windowElement.style.overflow = "hidden";

    const totalSymbols = options.totalSymbols || 10;
    for (let i = 0; i < totalSymbols; i++) {
        const symbol = document.createElement("span");
        symbol.className = "slot-symbol";
        symbol.textContent = randomSymbol(finalChar);
        symbol.style.height = `${symbolHeight}px`;
        symbol.style.flexBasis = `${symbolHeight}px`;
        strip.appendChild(symbol);
    }

    const finalSymbol = document.createElement("span");
    finalSymbol.className = "slot-symbol";
    finalSymbol.textContent = finalChar;
    finalSymbol.style.height = `${symbolHeight}px`;
    finalSymbol.style.flexBasis = `${symbolHeight}px`;
    strip.appendChild(finalSymbol);

    windowElement.appendChild(strip);
    element.replaceChildren(windowElement);
    strip.style.transform = "translate3d(0, 0, 0)";
    strip.style.willChange = "transform";

    if (delay) await sleep(delay);

    const distance = totalSymbols * symbolHeight;
    const start = performance.now();
    let lastCrossedSymbol = 0;

    await new Promise(resolve => {
        function frame(now) {
            const elapsed = Math.min(1, (now - start) / duration);
            const fastPhaseEnd = 0.68;
            const fastDistance = 0.82;
            let progress;

            if (elapsed <= fastPhaseEnd) {
                progress = (elapsed / fastPhaseEnd) * fastDistance;
            } else {
                const brakeProgress = (elapsed - fastPhaseEnd) / (1 - fastPhaseEnd);
                progress = fastDistance + (1 - fastDistance) *
                    (1 - Math.pow(1 - brakeProgress, 2));
            }

            strip.style.transform = `translate3d(0, -${distance * progress}px, 0)`;

            const crossedSymbol = Math.min(
                totalSymbols,
                Math.floor(progress * totalSymbols + 0.0001)
            );
            if (crossedSymbol > lastCrossedSymbol) {
                slotStepHaptic(elapsed);
                lastCrossedSymbol = crossedSymbol;
            }

            if (elapsed < 1) {
                requestAnimationFrame(frame);
            } else {
                strip.style.transform = `translate3d(0, -${distance}px, 0)`;
                resolve();
            }
        }
        requestAnimationFrame(frame);
    });

    strip.style.willChange = "auto";
    element.textContent = finalChar;
}

function chooseSpinMood() {
    const roll = Math.random();
    if (roll < 0.01) return "cinematic";
    if (roll < 0.07) return "showtime";
    if (roll < 0.25) return "suspense";
    return "normal";
}

function isBeautifulPlate(number) {
    const main = String(number).trim().split(/\s+/)[0] || "";
    const digits = main.replace(/[А-ЯЁ]/g, "");
    if (digits.length < 3) return false;

    if (/^(\d)\1+$/.test(digits)) return true;
    if (/012|123|234|345|456|567|678|789|987|876|765|654|543|432|321|210/.test(digits)) return true;
    if (digits.length >= 4 && digits === digits.split("").reverse().join("")) return true;
    return false;
}

async function animatePlate(finalPlate, rarity, mood = "normal") {
    const main = document.querySelector(".plate-main");
    const region = document.querySelector(".region-code");
    const plate = $("plate");
    if (!main || !region) return;

    if (plate) {
        plate.classList.remove("spin-reveal", "spin-active", "spin-rarity-common", "spin-rarity-uncommon", "spin-rarity-rare", "spin-rarity-epic", "spin-rarity-legendary");
        void plate.offsetWidth;
        plate.classList.add("spin-active");
    }

    const parts = finalPlate.trim().split(/\s+/);
    const mainChars = Array.from(parts[0] || "");
    const regionChars = Array.from(parts[1] || "77");

    const mainSlots = mainChars.map(() => {
        const slot = document.createElement("span");
        slot.className = "slot-cell";
        return slot;
    });
    const regionSlots = regionChars.map(() => {
        const slot = document.createElement("span");
        slot.className = "slot-cell";
        return slot;
    });

    main.replaceChildren(...mainSlots);
    region.replaceChildren(...regionSlots);

    // Сначала останавливается регион.
    await Promise.all(regionSlots.map((slot, index) =>
        rollSlot(slot, regionChars[index], { duration: 2100, totalSymbols: 19 })
    ));

    const rarityLevel = {
        Common: 0, Uncommon: 1, Rare: 2, Epic: 3, Legendary: 4, Mythic: 4
    }[rarity] ?? 0;

    const moodScale = mood === "cinematic" ? 1.12
        : mood === "showtime" ? 1.08
        : mood === "suspense" ? 1.04 : 1;
    const baseDuration = (2200 + rarityLevel * 140) * moodScale;
    const stopInterval = (260 + rarityLevel * 25) * moodScale;
    const regularDurations = mainSlots.map((_, index) =>
        baseDuration + index * stopInterval
    );
    const latestRegularStop = Math.max(...regularDurations);

    // Два разных случайных разряда выбираются при каждом спине.
    const lateIndexes = [];
    while (lateIndexes.length < Math.min(2, mainSlots.length)) {
        const candidate = Math.floor(Math.random() * mainSlots.length);
        if (!lateIndexes.includes(candidate)) lateIndexes.push(candidate);
    }
    const moodPause = mood === "cinematic" ? 900
        : mood === "showtime" ? 600
        : mood === "suspense" ? 320 : 0;
    const beautiful = isBeautifulPlate(finalPlate);
    if (plate) {
        plate.classList.remove("spin-mood-suspense", "spin-mood-showtime", "spin-mood-cinematic", "spin-beautiful");
        if (mood !== "normal") plate.classList.add("spin-mood-" + mood);
        if (beautiful) plate.classList.add("spin-beautiful");
    }
    const lateDurations = new Map([
        [lateIndexes[0], latestRegularStop + 1900 + rarityLevel * 180],
        [lateIndexes[1], latestRegularStop + 3400 + rarityLevel * 220]
    ]);

    // Эти два случайных символа гарантированно остановятся последними.
    await Promise.all(mainSlots.map((slot, index) =>
        rollSlot(slot, mainChars[index], {
            duration: lateDurations.get(index) || regularDurations[index],
            delay: index === lateIndexes[1] ? moodPause : 0,
            totalSymbols: 19
        })
    ));

    setRarityEffect(rarity);
    const rarityClass = "spin-rarity-" + (["Common", "Uncommon", "Rare", "Epic", "Legendary"].includes(rarity) ? rarity.toLowerCase() : "common");
    if (plate) {
        plate.classList.remove("spin-active");
        plate.classList.add("spin-reveal", rarityClass);
        plate.classList.remove("spin-mood-suspense", "spin-mood-showtime", "spin-mood-cinematic", "spin-beautiful");
        if (mood === "cinematic" || beautiful) {
            try { tg?.HapticFeedback?.notificationOccurred("success"); } catch (_) {}
        }
    }
    const revealDuration = rarity === "Legendary" ? 2600
        : rarity === "Epic" ? 2100
        : rarity === "Rare" ? 1250
        : rarity === "Uncommon" ? 950 : 750;
    // Возвращаем кнопку генерации на секунду раньше после раскрытия номера.
    await sleep(Math.max(0, Math.max(
        revealDuration,
        mood === "cinematic" ? 1050 : mood === "showtime" ? 850 : 650
    ) - 1000));
    if (plate) plate.classList.remove("spin-reveal", rarityClass);
}

// =========================================================
// БЕСПЛАТНЫЕ ПРОКРУТКИ
// =========================================================

let freeSpinTimer = null;
let freeSpinSeconds = 0;
let bonusSpinProgress = 0;
let bonusSpinsPending = 0;
let currentCoins = 0;
let spinInProgress = false;

function updateSpinAvailability() {
    const button = $("spin");
    const notice = $("spin-cost-notice");
    const insufficient = currentCoins < 1000;
    if (button) button.disabled = spinInProgress || insufficient;
    if (notice) notice.hidden = !insufficient;
}

function updateFreeSpinTimer() {
    const button = $("free-spin-button");
    if (!button) return;

    if (spinInProgress) {
        button.disabled = true;
        return;
    }

    const bonusPending = Number(bonusSpinsPending || 0);
    const bonusProgress = Number(bonusSpinProgress || 0);
    const dailyReady = freeSpinSeconds <= 0;
    const available = bonusPending + (dailyReady ? 1 : 0);

    if (available > 0) {
        button.textContent = available > 1
            ? `🎁 ЗАБРАТЬ ${available} БЕСПЛАТНЫХ СПИНА`
            : (bonusPending > 0
                ? "🎰 БОНУСНЫЙ СПИН ГОТОВ"
                : "🎁 БЕСПЛАТНЫЙ СПИН");
        button.disabled = false;
        return;
    }

    button.disabled = true;
    const hours = Math.floor(freeSpinSeconds / 3600);
    const minutes = Math.floor((freeSpinSeconds % 3600) / 60);
    const seconds = freeSpinSeconds % 60;
    button.textContent = `🎁 ${bonusProgress}/20 · ${hours}ч ${minutes}м ${seconds}с`;
    freeSpinSeconds = Math.max(0, freeSpinSeconds - 1);
}


// =========================================================
// МИНИАТЮРА НОМЕРА
// =========================================================

function createMiniPlate(number, rarity = "Common") {
    const parts = String(number).split(" ");
    const main = parts[0] || "";
    const region = parts[1] || "";

    return `
        <div class="mini-plate" data-rarity="${escapeHtml(rarity)}">
            <div class="mini-plate-main">${escapeHtml(main)}</div>
            <div class="mini-plate-region">
                <div class="mini-region-code">${escapeHtml(region)}</div>
                <div class="mini-region-country">RUS</div>
                <div class="mini-region-flag">
                    <span></span><span></span><span></span>
                </div>
            </div>
        </div>
    `;
}


// =========================================================
// ФИЛЬТРЫ И ИЗБРАННОЕ РЫНКА
// =========================================================

function renderMarket() {
    const root = $("market-items");
    if (!root) return;

    const query = ($("market-search")?.value || "").trim().toLowerCase();
    const rarity = $("market-rarity")?.value || "all";
    const sort = $("market-sort")?.value || "newest";
    const favoritesOnly = $("market-favorites-only")?.classList.contains("active");

    let rows = marketCache.filter(p => {
        const matchesSearch = !query ||
            String(p.number).toLowerCase().includes(query) ||
            String(p.rarity_ru || p.rarity).toLowerCase().includes(query) ||
            (p.tags || []).some(tag => String(tag).toLowerCase().includes(query));
        const matchesRarity = rarity === "all" || p.rarity === rarity || (rarity === "Legendary" && p.rarity === "Mythic");
        const matchesFavorite = !favoritesOnly || marketFavorites.has(String(p.listing_id));
        return matchesSearch && matchesRarity && matchesFavorite;
    });

    if (sort === "cheap") rows.sort((a,b) => a.price - b.price);
    if (sort === "expensive") rows.sort((a,b) => b.price - a.price);
    if (sort === "rarity") {
        const rank = {Common:0,Uncommon:1,Rare:2,Epic:3,Legendary:4,Mythic:4};
        rows.sort((a,b) => (rank[b.rarity] || 0) - (rank[a.rarity] || 0));
    }

    const count = $("market-count");
    if (count) count.textContent = rows.length + " предложений";

    root.innerHTML = rows.length
        ? rows.map(p => {
            const favorite = marketFavorites.has(String(p.listing_id));
            return `
                <div class="item market-item">
                    <div class="market-item-info">
                        <div class="market-plate-wrap">${createMiniPlate(p.number, p.rarity)}</div>
                        <div class="market-meta">
                            <span class="market-rarity" data-rarity="${escapeHtml(p.rarity)}">${escapeHtml(rarityNames[p.rarity] || p.rarity)}</span>
                            ${renderTags(p.tags)}
                            ${renderPlateAnalysis(p.analysis)}
                        </div>
                    </div>
                    <div class="market-price">
                        <strong>${formatRubles(p.price)}</strong>
                        <button class="market-action favorite ${favorite ? "is-favorite" : ""}" data-favorite-listing="${p.listing_id}" aria-label="Избранное">${favorite ? "★" : "☆"}</button>
                        ${p.is_mine
                            ? `<button class="market-action cancel" data-cancel-listing="${p.listing_id}">СНЯТЬ</button>`
                            : `<button class="market-action" data-buy-listing="${p.listing_id}">КУПИТЬ</button>`}
                    </div>
                </div>
            `;
        }).join("")
        : '<div class="empty">Ничего не найдено. Измени фильтры или поисковый запрос.</div>';
}

function toggleMarketFavorite(id) {
    const key = String(id);
    if (marketFavorites.has(key)) marketFavorites.delete(key);
    else marketFavorites.add(key);
    try {
        localStorage.setItem("numberRushMarketFavorites", JSON.stringify([...marketFavorites]));
    } catch (_) {}
    renderMarket();
}

["market-search", "market-rarity", "market-sort"].forEach(id => {
    $(id)?.addEventListener("input", renderMarket);
    $(id)?.addEventListener("change", renderMarket);
});
$("market-favorites-only")?.addEventListener("click", () => {
    $("market-favorites-only").classList.toggle("active");
    renderMarket();
});

// =========================================================
// ДЕЙСТВИЯ НА РЫНКЕ
// =========================================================

async function marketAction(action, listingId) {
    try {
        await api(`/api/market/${listingId}/${action}`, {
            method: "POST"
        });

        await refresh();
    } catch (e) {
        alert(e.message);
    }
}

function askMarketPrice() {
    return new Promise(resolve => {
        let value = "";
        const overlay = document.createElement("div");
        overlay.className = "price-keypad-overlay";
        overlay.innerHTML = `
            <div class="price-keypad">
                <div class="price-keypad-title">ЦЕНА НОМЕРА</div>
                <div class="price-keypad-display">${formatRubles(0)}</div>
                <div class="price-keypad-grid">
                    ${[1,2,3,4,5,6,7,8,9].map(n => `<button type="button" data-digit="${n}">${n}</button>`).join("")}
                    <button type="button" class="keypad-clear" data-clear="1">⌫</button>
                    <button type="button" data-digit="0">0</button>
                    <button type="button" class="keypad-cancel" data-cancel="1">ОТМЕНА</button>
                </div>
                <button type="button" class="price-keypad-submit" data-submit="1">ВЫСТАВИТЬ</button>
            </div>`;
        const display = overlay.querySelector(".price-keypad-display");
        const finish = result => {
            overlay.remove();
            resolve(result);
        };
        overlay.addEventListener("click", event => {
            if (event.target === overlay || event.target.closest("[data-cancel]")) {
                finish(null);
                return;
            }
            const digit = event.target.closest("[data-digit]");
            if (digit) {
                if (value.length < 8) value += digit.dataset.digit;
                display.innerHTML = `${formatRubles(value || 0)}`;
            }
            if (event.target.closest("[data-clear]")) {
                value = value.slice(0, -1);
                display.innerHTML = `${formatRubles(value || 0)}`;
            }
            if (event.target.closest("[data-submit]")) {
                const price = Number(value);
                if (Number.isInteger(price) && price >= 1 && price <= 10000000) finish(price);
            }
        });
        document.body.appendChild(overlay);
    });
}

async function listPlate(plateId) {
    const price = await askMarketPrice();
    if (price === null) return;
    try {
        await api("/api/market/list", {
            method: "POST",
            body: JSON.stringify({ plate_id: plateId, price })
        });
        await refresh();
    } catch (e) {
        alert(e.message);
    }
}

// Кнопки коллекции
async function quickSellPlate(plateId) {
    if (!confirm("Продать этот номер и убрать его из коллекции?")) return;
    try {
        const result = await api(`/api/plates/${plateId}/quick-sell`, {
            method: "POST"
        });
        await refresh();
    } catch (e) {
        alert(e.message);
    }
}

$("items").addEventListener("click", event => {
    const quickButton = event.target.closest("[data-quick-sell]");
    const listButton = event.target.closest("[data-list-plate]");
    if (quickButton) {
        quickSellPlate(Number(quickButton.dataset.quickSell));
        return;
    }
    if (listButton) listPlate(Number(listButton.dataset.listPlate));
});

// Кнопки рынка
$("market-items").addEventListener("click", event => {
    const buyButton = event.target.closest("[data-buy-listing]");
    const cancelButton = event.target.closest("[data-cancel-listing]");

    if (buyButton) {
        marketAction("buy", Number(buyButton.dataset.buyListing));
    }

    if (cancelButton) {
        marketAction("cancel", Number(cancelButton.dataset.cancelListing));
    }
});


function renderCollection() {
    const root = $("items");
    if (!root) return;
    const query = ($("collection-search")?.value || "").trim().toLowerCase();
    const rarity = $("collection-rarity")?.value || "all";
    const sort = $("collection-sort")?.value || "newest";

    let rows = collectionCache.filter(p => {
        const matchesSearch = !query ||
            String(p.number).toLowerCase().includes(query) ||
            String(rarityNames[p.rarity] || p.rarity).toLowerCase().includes(query) ||
            (p.tags || []).some(tag => String(tag).toLowerCase().includes(query));
        const matchesRarity = rarity === "all" || p.rarity === rarity || (rarity === "Legendary" && p.rarity === "Mythic");
        return matchesSearch && matchesRarity;
    });

    if (sort === "cheap") rows.sort((a,b) => Number(a.market_value || 0) - Number(b.market_value || 0));
    if (sort === "expensive") rows.sort((a,b) => Number(b.market_value || 0) - Number(a.market_value || 0));
    if (sort === "rarity") {
        const rank = {Common:0,Uncommon:1,Rare:2,Epic:3,Legendary:4,Mythic:4};
        rows.sort((a,b) => (rank[b.rarity] || 0) - (rank[a.rarity] || 0));
    }
    if (sort === "newest") rows.sort((a,b) => Number(b.id) - Number(a.id));

    const count = $("collection-count");
    if (count) count.textContent = rows.length + " из " + collectionCache.length + " номеров";

    root.innerHTML = rows.length
        ? rows.map(p => `
            <div class="item collection-item">
                <div class="collection-plate-wrap">
                    ${createMiniPlate(p.number, p.rarity)}
                    <small>${escapeHtml(rarityNames[p.rarity] || p.rarity)}</small>
                    ${renderTags(p.tags)}
                    ${renderPlateAnalysis(p.analysis)}
                </div>
                <small class="collection-value">Оценка: ${formatRubles(p.market_value || 0)}</small>
                ${p.is_listed
                    ? '<span class="collection-sale-status">НА ПРОДАЖЕ</span>'
                    : `<div class="collection-actions">
                        <button class="market-action quick-sell" data-quick-sell="${p.id}">ПРОДАТЬ ЗА ${formatRubles(p.quick_sell_price || 0)}</button>
                        <button class="market-action" data-list-plate="${p.id}">ВЫСТАВИТЬ</button>
                      </div>`}
            </div>
        `).join("")
        : '<div class="empty">По этим фильтрам номеров нет.</div>';
}

["collection-search", "collection-rarity", "collection-sort"].forEach(id => {
    $(id)?.addEventListener("input", renderCollection);
    $(id)?.addEventListener("change", renderCollection);
});

// =========================================================
// ГАРАЖ
// =========================================================

let garageData = null;

function garageCarArt(car) {
    const type = String(car.class || "sedan");
    const body = type === "vaz2107"
      ? "M34 88 L39 65 Q41 59 51 57 L89 55 L111 31 Q117 25 128 25 L205 25 Q214 26 220 34 L239 57 L275 61 Q286 63 290 73 L294 88 L282 96 L42 96 Z"
      : type === "sport"
      ? "M30 88 L42 72 Q48 65 65 63 L111 55 L145 34 Q153 28 170 29 L225 42 L254 62 L282 68 Q292 72 294 87 L282 96 L42 96 Z"
      : type === "suv"
      ? "M30 88 L35 57 Q37 48 49 47 L84 46 L105 27 Q111 22 123 22 L220 22 Q232 23 239 34 L251 49 L278 54 Q290 57 294 72 L296 88 L282 97 L42 97 Z"
      : type === "supercar"
      ? "M27 88 L45 73 Q54 66 76 64 L126 55 L158 38 Q169 31 188 33 L231 45 L259 64 L284 69 Q294 73 296 87 L282 96 L42 96 Z"
      : "M34 88 L40 64 Q43 57 55 56 L92 54 L116 31 Q122 25 135 25 L207 25 Q218 26 225 36 L243 57 L278 62 Q290 65 293 76 L294 88 L282 96 L42 96 Z";
    const windows = type === "vaz2107"
      ? "M96 54 L116 33 Q120 29 130 29 L155 29 L155 54 Z M162 29 L202 29 Q210 30 216 38 L230 54 L162 54 Z"
      : "M99 55 L119 34 Q125 29 137 29 L166 30 L160 55 Z M174 31 L205 36 Q214 38 222 55 L168 55 Z";
    const paint = type === "vaz2107" ? "#d7dce2" : type === "sport" ? "#d93c36" : type === "suv" ? "#647d58" : type === "supercar" ? "#e3b52e" : "#4c86bd";
    return `<div class="garage-car-art garage-car-${escapeHtml(type)}">
      <svg class="garage-car-svg" viewBox="0 0 320 140" role="img" aria-label="${escapeHtml(car.name)}">
        <defs>
          <linearGradient id="carpaint-${escapeHtml(type)}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity=".55"/><stop offset=".35" stop-color="${paint}"/><stop offset="1" stop-color="#17202b"/></linearGradient>
          <linearGradient id="glass-${escapeHtml(type)}" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#b8d7e8"/><stop offset="1" stop-color="#253c53"/></linearGradient>
        </defs>
        <ellipse cx="164" cy="111" rx="126" ry="10" fill="#000" opacity=".42"/>
        <path d="${body}" fill="url(#carpaint-${escapeHtml(type)})" stroke="#101820" stroke-width="2.5" stroke-linejoin="round"/>
        <path d="${windows}" fill="url(#glass-${escapeHtml(type)})" stroke="#263746" stroke-width="2"/>
        <path d="M158 29 L158 89 M235 58 L239 88 M91 57 L85 88" stroke="#273746" stroke-width="2" opacity=".8"/>
        <path d="M42 79 L78 79 M246 78 L282 79" stroke="#fff" stroke-width="2" opacity=".28"/>
        <path d="M37 83 L52 83 L50 90 L35 89 Z" fill="#f7f1d0" stroke="#6e7780"/>
        <path d="M280 76 L292 78 L292 85 L281 85 Z" fill="#e64b3d"/>
        <path d="M48 91 L278 91" stroke="#111923" stroke-width="3"/>
        <rect x="151" y="63" width="15" height="3" rx="1.5" fill="#202a33"/>
        <rect x="218" y="63" width="12" height="3" rx="1.5" fill="#202a33"/>
        <path d="M286 84 L292 84 L292 88 L286 88 Z" fill="#cbd5df"/>
        <g fill="#18212b" stroke="#090e14" stroke-width="2">
          <circle cx="88" cy="91" r="20"/><circle cx="246" cy="91" r="20"/>
        </g>
        <g fill="#aeb8c1" stroke="#3a4651" stroke-width="3">
          <circle cx="88" cy="91" r="11"/><circle cx="246" cy="91" r="11"/>
        </g>
        <g fill="#4b5965"><circle cx="88" cy="91" r="4"/><circle cx="246" cy="91" r="4"/></g>
        <path d="M68 91 A20 20 0 0 1 108 91 M226 91 A20 20 0 0 1 266 91" fill="none" stroke="#d5dce2" stroke-width="2" opacity=".6"/>
        <path d="M55 103 L274 103" stroke="#fff" stroke-width="1" opacity=".18"/>
      </svg>
    </div>`;
}

function garageSceneCar(car) {
    const plate = car.plate_number ? escapeHtml(car.plate_number) : "";
    return `
      <div class="garage-real-car-wrap">
        <svg class="garage-real-car" viewBox="0 0 800 470" role="img" aria-label="Белый ВАЗ-2107, вид спереди">
          <defs>
            <linearGradient id="vaz-paint" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#fff"/><stop offset=".45" stop-color="#e9e9e6"/><stop offset=".78" stop-color="#c7c9c9"/><stop offset="1" stop-color="#85898b"/></linearGradient>
            <linearGradient id="vaz-glass" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#29333b"/><stop offset=".55" stop-color="#101820"/><stop offset="1" stop-color="#3b4850"/></linearGradient>
            <linearGradient id="vaz-chrome" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#fff"/><stop offset=".28" stop-color="#858b90"/><stop offset=".55" stop-color="#f4f5f5"/><stop offset="1" stop-color="#666d72"/></linearGradient>
            <linearGradient id="vaz-lamp" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#fff"/><stop offset=".55" stop-color="#d9e1e3"/><stop offset="1" stop-color="#929da1"/></linearGradient>
          </defs>
          <ellipse cx="400" cy="425" rx="300" ry="25" fill="#000" opacity=".58"/>
          <path d="M105 333 Q75 350 80 425 L155 435 L188 355Z M695 333 Q725 350 720 425 L645 435 L612 355Z" fill="#15191d" stroke="#050607" stroke-width="8"/>
          <path d="M104 370 L151 382 M95 394 L149 405 M93 416 L147 426 M696 370 L649 382 M705 394 L651 405 M707 416 L653 426" stroke="#596067" stroke-width="5"/>
          <path d="M125 150 L63 130 Q48 128 43 143 L43 178 Q45 190 62 184 L137 172Z M675 150 L737 130 Q752 128 757 143 L757 178 Q755 190 738 184 L663 172Z" fill="#171d22" stroke="#080b0e" stroke-width="6"/>
          <path d="M55 143 L116 158 L60 173Z M745 143 L684 158 L740 173Z" fill="#202a31"/>
          <path d="M154 54 Q170 25 213 22 L587 22 Q630 25 646 54 L681 185 L119 185Z" fill="url(#vaz-chrome)" stroke="#5e6468" stroke-width="5"/>
          <path d="M174 61 Q188 39 218 38 L582 38 Q612 39 626 61 L653 170 L147 170Z" fill="url(#vaz-glass)" stroke="#10161b" stroke-width="7"/>
          <path d="M400 39 L400 170 M168 165 Q270 176 400 170 Q530 176 632 165" fill="none" stroke="#6c7479" stroke-width="4"/>
          <path d="M210 46 L190 162 M590 46 L610 162" stroke="#a9b0b3" stroke-width="3" opacity=".35"/>
          <rect x="366" y="49" width="68" height="30" rx="7" fill="#111820" stroke="#555d62" stroke-width="3"/>
          <path d="M245 174 L555 174" stroke="#11171c" stroke-width="5" stroke-linecap="round"/>
          <path d="M130 182 Q146 174 180 174 L620 174 Q654 174 670 182 L729 315 Q739 341 714 359 L86 359 Q61 341 71 315Z" fill="url(#vaz-paint)" stroke="#777d80" stroke-width="5"/>
          <path d="M177 185 Q400 173 623 185 L670 300 Q400 318 130 300Z" fill="#f7f7f4" opacity=".45"/>
          <path d="M165 202 Q400 190 635 202" stroke="#fff" stroke-width="5" opacity=".65"/>
          <path d="M115 305 Q400 322 685 305" stroke="#9da2a4" stroke-width="3" opacity=".55"/>
          <rect x="89" y="274" width="196" height="91" rx="7" fill="#171b1e" stroke="#050708" stroke-width="7"/>
          <rect x="515" y="274" width="196" height="91" rx="7" fill="#171b1e" stroke="#050708" stroke-width="7"/>
          <rect x="99" y="283" width="176" height="72" rx="4" fill="url(#vaz-lamp)" stroke="#8c9498" stroke-width="3"/>
          <rect x="525" y="283" width="176" height="72" rx="4" fill="url(#vaz-lamp)" stroke="#8c9498" stroke-width="3"/>
          <path d="M145 285 L145 353 M228 285 L228 353 M572 285 L572 353 M655 285 L655 353" stroke="#7c878c" stroke-width="3" opacity=".8"/>
          <path d="M105 290 L270 290 M530 290 L695 290" stroke="#fff" stroke-width="3" opacity=".7"/>
          <rect x="289" y="260" width="222" height="112" rx="5" fill="url(#vaz-chrome)" stroke="#62696d" stroke-width="5"/>
          <rect x="300" y="270" width="200" height="92" fill="#141a1e" stroke="#d4d7d7" stroke-width="3"/>
          <g stroke="#c4c8c9" stroke-width="5"><path d="M302 285 H498 M302 303 H498 M302 321 H498 M302 339 H498 M302 356 H498"/></g>
          <rect x="386" y="297" width="28" height="42" rx="3" fill="#bfc4c5" stroke="#42494d" stroke-width="3"/>
          <path d="M392 329 L400 306 L408 329Z" fill="#353d42"/>
          <path d="M77 365 Q400 380 723 365 L733 394 Q400 411 67 394Z" fill="url(#vaz-chrome)" stroke="#5c6367" stroke-width="4"/>
          <path d="M69 395 Q400 414 731 395 L724 424 Q400 444 76 424Z" fill="#171b1e" stroke="#050607" stroke-width="5"/>
          <path d="M79 398 Q400 417 721 398" stroke="#747b7f" stroke-width="4"/>
          <rect x="325" y="389" width="150" height="43" rx="4" fill="#f9f9f6" stroke="#25292c" stroke-width="5"/>
          <rect x="331" y="394" width="138" height="33" rx="2" fill="#fff" stroke="#c7cbcd" stroke-width="1.5"/>
          <text x="400" y="416" text-anchor="middle" font-family="Arial,sans-serif" font-size="21" font-weight="700" letter-spacing="1.2" fill="#111">${plate || " "}</text>
          <path d="M190 438 L610 438" stroke="#171b1e" stroke-width="4"/>
        </svg>
      </div>`;
}

function renderGarage(data = garageData) {
    const root = $("garage-content");
    if (!root || !data) return;
    garageData = data;
    const owned = data.cars || [];
    const shop = data.shop || [];
    const plates = data.plates || [];
    const mainCar = owned.find(car => car.key === "sedan") || owned[0];
    const otherCars = owned.filter(car => !mainCar || car.id !== mainCar.id);
    root.innerHTML = `
      <div class="garage-balance">Баланс: <b>${formatRubles(data.coins)}</b></div>
      <div class="garage-scene">
        <div class="garage-scene-ceiling"><span></span><span></span><span></span></div>
        <div class="garage-scene-sign">NUMBER RUSH <small>PRIVATE MOTOR GARAGE</small></div>
        <div class="garage-scene-backwall"><div class="garage-toolwall"></div></div>
        <div class="garage-scene-floor"><div class="garage-floor-lines"></div></div>
        ${mainCar ? `
          <div class="garage-scene-car-name"><b>${escapeHtml(mainCar.name)}</b><span>ВАШ АВТОМОБИЛЬ</span></div>
          <div class="garage-car-platform">${garageSceneCar(mainCar)}</div>
          <div class="garage-scene-controls">
            <label for="garage-plate-${mainCar.id}">ГОСУДАРСТВЕННЫЙ НОМЕР</label>
            <select class="market-select garage-plate-select" id="garage-plate-${mainCar.id}" data-garage-plate="${mainCar.id}">
              <option value="">Снять номер</option>
              ${mainCar.plate_id ? '<option value="' + mainCar.plate_id + '" selected>' + escapeHtml(mainCar.plate_number || "Текущий номер") + '</option>' : ''}
              ${plates.map(p => `<option value="${p.id}">${escapeHtml(p.number)} · ${escapeHtml(rarityNames[p.rarity] || p.rarity)}</option>`).join("")}
            </select>
            <small>Номер устанавливается прямо на передний бампер автомобиля</small>
          </div>` : '<div class="garage-no-car">Машина появится здесь автоматически</div>'}
      </div>
      ${otherCars.length ? '<h3 class="garage-subtitle">Другие автомобили</h3><div class="garage-grid">' + otherCars.map(car => `
        <article class="garage-car-card">
          ${garageCarArt(car)}
          <div class="garage-car-info"><b>${escapeHtml(car.name)}</b><small>В вашем гараже</small></div>
          <div class="garage-mounted-plate">${car.plate_number ? createMiniPlate(car.plate_number, car.plate_rarity) : '<span>Номер не установлен</span>'}</div>
          <label class="garage-select-label" for="garage-plate-${car.id}">Установить номер</label>
          <select class="market-select garage-plate-select" id="garage-plate-${car.id}" data-garage-plate="${car.id}">
            <option value="">Снять номер</option>
            ${plates.map(p => `<option value="${p.id}">${escapeHtml(p.number)} · ${escapeHtml(rarityNames[p.rarity] || p.rarity)}</option>`).join("")}
            ${car.plate_id ? '<option value="' + car.plate_id + '" selected>Текущий номер</option>' : ''}
          </select>
        </article>`).join("") + '</div>' : ''}
      <h3 class="garage-subtitle">Автосалон</h3>
      <div class="garage-grid">
        ${shop.filter(car => car.key !== "sedan").map(car => `
          <article class="garage-car-card garage-shop-card">
            ${garageCarArt(car)}
            <div class="garage-car-info"><b>${escapeHtml(car.name)}</b><small>${formatRubles(car.price)}</small></div>
            <button class="market-action garage-buy" data-buy-car="${escapeHtml(car.key)}" ${car.owned ? "disabled" : ""}>${car.owned ? "КУПЛЕНО" : "КУПИТЬ"}</button>
          </article>`).join("")}
      </div>`;
}

async function loadGarage() {
    const data = await api("/api/garage");
    renderGarage(data);
}

$("garage-content")?.addEventListener("click", async event => {
    const button = event.target.closest("[data-buy-car]");
    if (!button || button.disabled) return;
    button.disabled = true;
    try {
        await api("/api/garage/buy", {method:"POST", body:JSON.stringify({car_key:button.dataset.buyCar})});
        await refresh();
        await loadGarage();
    } catch (error) {
        alert(error.message);
        button.disabled = false;
    }
});

$("garage-content")?.addEventListener("change", async event => {
    const select = event.target.closest("[data-garage-plate]");
    if (!select) return;
    select.disabled = true;
    try {
        await api("/api/garage/" + select.dataset.garagePlate + "/plate", {
            method:"POST", body:JSON.stringify({plate_id:select.value ? Number(select.value) : null})
        });
        await loadGarage();
    } catch (error) {
        alert(error.message);
        await loadGarage();
    }
    select.disabled = false;
});

// =========================================================
// ОБНОВЛЕНИЕ ИГРЫ
// =========================================================

function renderProfile(me) {
    const root = $("profile-content");
    if (!root) return;
    const u = tg?.initDataUnsafe?.user || {};
    const name = u.first_name ? [u.first_name, u.last_name].filter(Boolean).join(" ") : me.username;
    const avatar = u.photo_url
        ? '<img class="profile-avatar" src="' + escapeHtml(u.photo_url) + '" alt="">'
        : '<div class="profile-avatar profile-avatar-placeholder">👤</div>';
    const date = me.created_at ? new Date(me.created_at * 1000).toLocaleDateString("ru-RU") : "—";
    const rarest = me.rarest_plate ? createMiniPlate(me.rarest_plate.number) + '<small>' + escapeHtml(rarityNames[me.rarest_plate.rarity] || me.rarest_plate.rarity) + '</small>' : '<small>Пока нет номеров</small>';
    root.innerHTML = '<div class="profile-heading">' + avatar + '<div><strong>' + escapeHtml(name || "Игрок") + '</strong><small>ID: ' + escapeHtml(me.id) + '</small></div></div>' +
      '<div class="profile-stats">' +
      '<div><small>Баланс</small><b>' + formatRubles(me.coins) + '</b></div>' +
      '<div><small>Номеров сейчас</small><b>' + me.collection_count + '</b></div>' +
      '<div><small>Всего спинов</small><b>' + me.total_spins + '</b></div>' +
      '<div><small>Покупки</small><b>' + me.purchases_count + '</b></div>' +
      '<div><small>Продажи</small><b>' + me.sales_count + '</b></div>' +
      '<div><small>В игре с</small><b>' + date + '</b></div></div>' +
      '<div class="profile-rarest"><small>Самый редкий номер</small><div class="profile-rarest-plate">' + rarest + '</div></div>';
}
let dailyStreakBonusReady = false;

function renderDailyStreak(data) {
    const root = $("daily-streak");
    if (!root) return;
    const rewards = data.rewards || [1000, 1500, 2000, 2500, 3000, 3500, 5000];
    const nextDay = Number(data.next_day || 1);
    const claimed = Boolean(data.claimed_today);
    dailyStreakBonusReady = !claimed;
    root.innerHTML = `
        <div class="streak-card">
            <div class="streak-heading">
                <div>
                    <strong>🔥 Серия ежедневных входов</strong>
                    <p>Заходи каждый день и получай всё больше рублей. Пропуск дня обнулит серию.</p>
                </div>
                <span class="streak-count">${Number(data.streak || 0)} дн.</span>
            </div>
            <div class="streak-rewards">
                ${rewards.map((reward, index) => `
                    <div class="streak-day ${claimed && index + 1 === Number(data.streak) % 7 || claimed && Number(data.streak) % 7 === 0 && index === 6 ? "is-earned" : ""} ${!claimed && index + 1 === nextDay ? "is-next" : ""}">
                        <small>ДЕНЬ ${index + 1}</small>
                        <b>+${formatRubles(reward)}</b>
                    </div>
                `).join("")}
            </div>
            <button class="daily-task-claim streak-claim" id="claim-daily-streak" ${claimed ? "disabled" : ""}>
                ${claimed ? "НАГРАДА СЕГОДНЯ ПОЛУЧЕНА" : "ЗАБРАТЬ +" + formatRubles(data.reward)}
            </button>
            <small class="streak-footnote">${claimed ? "Возвращайся завтра за следующей наградой." : "Награда доступна один раз в день."}</small>
        </div>
    `;
    const button = $("claim-daily-streak");
    button?.addEventListener("click", async () => {
        button.disabled = true;
        try {
            await api("/api/daily-streak/claim", { method: "POST" });
            await refresh();
        } catch (error) {
            alert(error.message);
            button.disabled = false;
        }
    });
}

function renderDailyTasks(data) {
    const root = $("daily-task-list");
    if (!root) return;
    const readyCount = (data.tasks || []).filter(task => task.completed && !task.claimed).length;
    const notificationCount = readyCount + (dailyStreakBonusReady ? 1 : 0);
    const badge = $("daily-task-badge");
    if (badge) {
        badge.textContent = notificationCount > 9 ? "9+" : String(notificationCount);
        badge.hidden = notificationCount === 0;
    }
    root.innerHTML = (data.tasks || []).map(task => {
        const progress = Math.min(Number(task.progress || 0), Number(task.target || 1));
        const percent = Math.round(progress / Math.max(1, Number(task.target)) * 100);
        return `
            <article class="daily-task-card ${task.completed ? "is-completed" : ""} ${task.claimed ? "is-claimed" : ""}">
                <div class="daily-task-top">
                    <div>
                        <strong>${escapeHtml(task.title)}</strong>
                        <p>${escapeHtml(task.description)}</p>
                    </div>
                    <span class="daily-task-reward">+${formatRubles(task.reward)}</span>
                </div>
                <div class="daily-task-progress"><span style="width:${percent}%"></span></div>
                <div class="daily-task-bottom">
                    <small>${progress} / ${task.target}</small>
                    <b>${task.claimed ? "НАГРАДА ПОЛУЧЕНА" : task.completed ? "ГОТОВО К ПОЛУЧЕНИЮ" : progress > 0 ? "В ПРОЦЕССЕ" : "НЕ НАЧАТО"}</b>
                </div>
                ${task.completed && !task.claimed ? `<button class="daily-task-claim" data-claim-task="${escapeHtml(task.key)}">ЗАБРАТЬ НАГРАДУ</button>` : ""}
            </article>
        `;
    }).join("");
}

async function claimDailyTask(taskKey, button) {
    if (button) button.disabled = true;
    try {
        await api(`/api/daily-tasks/${encodeURIComponent(taskKey)}/claim`, { method: "POST" });
        await refresh();
    } catch (e) {
        alert(e.message);
        if (button) button.disabled = false;
    }
}

$("daily-task-list")?.addEventListener("click", event => {
    const button = event.target.closest("[data-claim-task]");
    if (button) claimDailyTask(button.dataset.claimTask, button);
});


function renderAchievements(data) {
    const root = $("achievement-list");
    if (!root) return;

    const achievements = data.achievements || [];
    const readyCount = achievements.filter(item => item.completed && !item.claimed).length;
    const badge = $("achievement-badge");
    if (badge) {
        badge.textContent = readyCount > 9 ? "9+" : String(readyCount);
        badge.hidden = readyCount === 0;
    }

    root.innerHTML = achievements.map(item => {
        const progress = Math.min(Number(item.progress || 0), Number(item.target || 1));
        const percent = Math.round(progress / Math.max(1, Number(item.target)) * 100);
        return `
            <article class="daily-task-card achievement-card ${item.completed ? "is-completed" : ""} ${item.claimed ? "is-claimed" : ""}">
                <div class="daily-task-top">
                    <div>
                        <strong>🏆 ${escapeHtml(item.title)}</strong>
                        <p>${escapeHtml(item.description)}</p>
                    </div>
                    <span class="daily-task-reward">+${formatRubles(item.reward)}</span>
                </div>
                <div class="daily-task-progress"><span style="width:${percent}%"></span></div>
                <div class="daily-task-bottom">
                    <small>${progress.toLocaleString("ru-RU")} / ${Number(item.target).toLocaleString("ru-RU")}</small>
                    <b>${item.claimed ? "НАГРАДА ПОЛУЧЕНА" : item.completed ? "ГОТОВО К ПОЛУЧЕНИЮ" : progress > 0 ? "В ПРОЦЕССЕ" : "НЕ НАЧАТО"}</b>
                </div>
                ${item.completed && !item.claimed ? `<button class="daily-task-claim" data-claim-achievement="${escapeHtml(item.key)}">ЗАБРАТЬ НАГРАДУ</button>` : ""}
            </article>
        `;
    }).join("");
}

async function claimAchievement(key, button) {
    if (button) button.disabled = true;
    try {
        await api(`/api/achievements/${encodeURIComponent(key)}/claim`, { method: "POST" });
        await refresh();
    } catch (e) {
        alert(e.message);
        if (button) button.disabled = false;
    }
}

$("achievement-list")?.addEventListener("click", event => {
    const button = event.target.closest("[data-claim-achievement]");
    if (button) claimAchievement(button.dataset.claimAchievement, button);
});


function renderShop(packages) {
    const rublesRoot = $("shop-packages");
    const platesRoot = $("shop-plate-packages");
    if (!rublesRoot || !platesRoot) return;

    const rublePackages = (packages || []).filter(pack => pack.type !== "plate");
    const platePackages = (packages || []).filter(pack => pack.type === "plate");

    rublesRoot.innerHTML = rublePackages.map((pack, index) => `
        <article class="shop-package shop-ruble-card">
            <div class="shop-ruble-art" aria-hidden="true"><span>${index === 0 ? "₽" : index === 1 ? "₽₽" : "₽₽₽"}</span></div>
            <strong>${formatRubles(pack.coins)}</strong>
            <span class="shop-package-price">⭐ ${Number(pack.stars)} Stars</span>
            <button class="shop-buy-button" data-buy-package="${escapeHtml(pack.id)}">КУПИТЬ</button>
        </article>
    `).join("");

    platesRoot.innerHTML = platePackages.map(pack => {
        const title = "ЛЕГЕНДАРНЫЙ";
        const plateLetters = "А777МР";
        const region = "77";
        return `
            <article class="shop-plate-card is-legendary">
                <div class="shop-plate-copy">
                    <span class="shop-rarity-label">◆ ЛЕГЕНДАРНАЯ СЕРИЯ</span>
                    <h4>${title} НОМЕР</h4>
                    <p>Гарантированная редкость</p>
                    <div class="shop-plate-price">⭐ <b>${Number(pack.stars)} Stars</b></div>
                    <button class="shop-buy-button" data-buy-package="${escapeHtml(pack.id)}">КУПИТЬ НОМЕР</button>
                </div>
                <div class="shop-plate-visual" aria-label="Пример российского номерного знака">
                    <div class="shop-real-plate">${createMiniPlate(`${plateLetters} ${region}`)}</div>
                    <span class="shop-plate-caption">ПРИМЕР НОМЕРА</span>
                </div>
            </article>
        `;
    }).join("");
}

$("shop")?.addEventListener("click", event => {
    const tab = event.target.closest("[data-shop-view]");
    if (tab) {
        const view = tab.dataset.shopView;
        document.querySelectorAll("[data-shop-view]").forEach(button => {
            const active = button === tab;
            button.classList.toggle("active", active);
            button.setAttribute("aria-selected", String(active));
        });
        $("shop-rubles-view")?.classList.toggle("hidden", view !== "rubles");
        $("shop-plates-view")?.classList.toggle("hidden", view !== "plates");
        return;
    }
    const buyButton = event.target.closest("[data-buy-package]");
    if (buyButton) buyStarPackage(buyButton.dataset.buyPackage, buyButton);
});

async function buyStarPackage(packageId, button) {
    if (!tg || typeof tg.openInvoice !== "function") {
        alert("Покупка Stars доступна только внутри Telegram.");
        return;
    }
    button.disabled = true;
    try {
        const invoice = await api(`/api/shop/${encodeURIComponent(packageId)}/invoice`, { method: "POST" });
        tg.openInvoice(invoice.invoice_url, async status => {
            if (status === "paid") {
                alert("Оплата принята! Покупка будет добавлена в игру после обработки платежа.");
                await refresh();
            } else if (status === "failed") {
                alert("Не удалось провести оплату. Попробуй ещё раз.");
            }
            button.disabled = false;
        });
    } catch (error) {
        alert(error.message);
        button.disabled = false;
    }
}

$("shop-packages")?.addEventListener("click", event => {
    const button = event.target.closest("[data-buy-package]");
    if (button) buyStarPackage(button.dataset.buyPackage, button);
});

function renderLeaderboard(data) {
    const root = $("leaderboard-content");
    if (!root) return;

    const renderTable = (title, ranking, suffix, icon) => {
        const mine = ranking?.my_rank;
        const rows = ranking?.top || [];
        return `
            <section class="leaderboard-section">
                <h3>${icon} ${title}</h3>
                ${mine ? `<div class="leaderboard-me"><strong>ТВОЁ МЕСТО</strong><b>№${mine.rank}</b><small>${Number(mine.value).toLocaleString("ru-RU")} ${suffix}</small></div>` : ""}
                <div class="leaderboard-list">
                    ${rows.map(player => {
                        const place = player.rank === 1 ? "🥇" : player.rank === 2 ? "🥈" : player.rank === 3 ? "🥉" : `#${player.rank}`;
                        return `
                            <article class="leaderboard-player ${player.is_me ? "is-me" : ""}">
                                <span class="leaderboard-place">${place}</span>
                                <strong class="leaderboard-name">${escapeHtml(player.username || "Player")}${player.is_me ? " · Вы" : ""}</strong>
                                <b class="leaderboard-score">${Number(player.value).toLocaleString("ru-RU")} <small>${suffix}</small></b>
                            </article>
                        `;
                    }).join("") || '<p class="daily-tasks-note">Пока здесь никого нет.</p>'}
                </div>
            </section>
        `;
    };

    root.innerHTML =
        renderTable("По балансу", data.money, "руб.", "💰") +
        renderTable("По прокруткам", data.spins, "спинов", "🎰");
}

async function refresh() {
    const me = await api("/api/me");
    renderProfile(me);

    freeSpinSeconds = Number(me.free_spin_seconds ?? 0);
    bonusSpinProgress = Number(me.bonus_spin_progress ?? 0);
    bonusSpinsPending = Number(me.bonus_spins_pending ?? 0);
    currentCoins = Number(me.coins ?? 0);
    updateSpinAvailability();

    if (freeSpinTimer) {
        clearInterval(freeSpinTimer);
    }

    updateFreeSpinTimer();
    freeSpinTimer = setInterval(updateFreeSpinTimer, 1000);

    const coinsElement = $("coins");
    const spinsElement = $("spins");

    if (coinsElement) {
        coinsElement.textContent = formatRubles(me.coins);
    }

    if (spinsElement) {
        spinsElement.textContent = me.spins;
    }

   
    // КОЛЛЕКЦИЯ
    collectionCache = await api("/api/collection");
    renderCollection();

    // РЫНОК
    marketCache = await api("/api/market");
    renderMarket();

    const leaderboard = await api("/api/leaderboard");
    renderLeaderboard(leaderboard);

    const dailyStreak = await api("/api/daily-streak");
    renderDailyStreak(dailyStreak);

    const dailyTasks = await api("/api/daily-tasks");
    renderDailyTasks(dailyTasks);

    const achievements = await api("/api/achievements");
    renderAchievements(achievements);

    const shopPackages = await api("/api/shop");
    renderShop(shopPackages);

    await loadGarage();
}

// =========================================================
// КНОПКА СПИНА
// =========================================================

async function runSpin(spinType = "paid") {
    const useFree = spinType === "daily" || spinType === "bonus";
    if (spinInProgress) return;
    spinInProgress = true;
    spinHaptic(useFree);
    const spinButton = $("spin");
    const freeButton = $("free-spin-button");
    updateSpinAvailability();
    updateFreeSpinTimer();
    if (spinButton) spinButton.disabled = true;
    if (freeButton) freeButton.disabled = true;
    if ($("hint")) $("hint").textContent = "🎰 Барабаны вращаются...";

    try {
        const spinUrl = spinType === "daily" ? "/api/spin?free=true" : spinType === "bonus" ? "/api/spin?bonus=true" : "/api/spin";
        const result = await api(spinUrl, {
            method: "POST"
        });

        const coinsElement = $("coins");
        const spinsElement = $("spins");
        currentCoins = Number(result.coins ?? currentCoins);
        updateSpinAvailability();
        if (coinsElement) coinsElement.textContent = formatRubles(result.coins);
        if (spinsElement) spinsElement.textContent = result.spins;

        const spinMood = chooseSpinMood();
        await animatePlate(result.plate.number, result.plate.rarity, spinMood);
        await refresh();

        const rarityText = rarityNames[result.plate.rarity] || result.plate.rarity.toUpperCase();
        const tags = result.plate.tags || [];
        const analysisRoot = $("plate-analysis");
        if (analysisRoot) analysisRoot.innerHTML = renderPlateAnalysis(result.plate_analysis);
        let message = rarityText;
        if (tags.length > 0) message += " • " + tags.join(" • ");
        $("rarity").textContent = message;
        if ($("hint")) $("hint").textContent = tags.length > 0 ? "✨ " + tags.join(" • ") : "Номер добавлен в коллекцию!";
    } catch (e) {
        if ($("hint")) $("hint").textContent = e.message;
        await refresh().catch(() => {});
    } finally {
        spinInProgress = false;
        updateSpinAvailability();
        updateFreeSpinTimer();
    }
}

$("spin").addEventListener("click", () => runSpin(false));
$("free-spin-button").addEventListener("click", () => {
    if (bonusSpinsPending > 0) runSpin("bonus");
    else if (freeSpinSeconds <= 0) runSpin("daily");
});


// =========================================================
// ПЕРЕКЛЮЧЕНИЕ ВКЛАДОК
// =========================================================

document.querySelectorAll(".tab").forEach(btn => {
    btn.addEventListener("click", () => {
        document.querySelectorAll(".tab").forEach(b =>
            b.classList.toggle("active", b === btn)
        );

        ["collection", "market", "garage", "leaderboard", "daily-tasks", "achievements", "shop", "profile"].forEach(id => {
            $(id).classList.toggle("hidden", btn.dataset.tab !== id);
        });
    });
});


// =========================================================
// ПЕРВАЯ ЗАГРУЗКА
// =========================================================

refresh().catch(e => {
    if ($("items")) {
        $("items").textContent = e.message;
    }

    if ($("hint")) {
        if ($("hint")) $("hint").textContent = e.message;
    }
});
