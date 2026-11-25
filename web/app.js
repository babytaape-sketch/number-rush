
const tg = window.Telegram?.WebApp;

if (tg) {
    tg.ready();
    tg.expand();
    tg.setHeaderColor("#080b10");
    tg.setBackgroundColor("#080b10");
}

const initData = tg?.initData || "";
const headers = { "Content-Type": "application/json" };

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

const plateLetters = "АВЕКМНОРСТУХ";
const plateDigits = "0123456789";

const rarityColors = {
    Common: "#b9c3d0",
    Uncommon: "#36d477",
    Rare: "#3294ff",
    Epic: "#ae63ff",
    Legendary: "#ffc247",
    Mythic: "#ff563f"
};

const rarityNames = {
    Common: "ОБЫЧНЫЙ",
    Uncommon: "НЕОБЫЧНЫЙ",
    Rare: "РЕДКИЙ",
    Epic: "ЭПИЧЕСКИЙ",
    Legendary: "ЛЕГЕНДАРНЫЙ",
    Mythic: "МИФИЧЕСКИЙ"
};

function setRarityEffect(rarity) {
    const plate = $("plate");
    const rarityLabel = $("rarity");
    const color = rarityColors[rarity] || rarityColors.Common;

    plate.style.setProperty("--rarity-color", color);
    plate.dataset.rarity = rarity;

    plate.classList.remove("rarity-flash");
    void plate.offsetWidth;
    plate.classList.add("rarity-flash");

    rarityLabel.style.color = color;
    rarityLabel.textContent = rarityNames[rarity] || rarity.toUpperCase();
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
    const {
        duration = 2200,
        extraTurns = 0,
        dramatic = false
    } = options;

    const alphabet = plateLetters.includes(finalChar)
        ? plateLetters
        : plateDigits;

    const fontSize = parseFloat(
        getComputedStyle(element.parentElement).fontSize
    ) || 30;

    const rowHeight = fontSize * 1.15;
    const totalSymbols = 28 + extraTurns * 8;

    const windowElement = document.createElement("span");
    windowElement.className = "slot-window";

    const strip = document.createElement("span");
    strip.className = "slot-strip";

    for (let i = 0; i < totalSymbols; i++) {
        const symbol = document.createElement("span");
        symbol.className = "slot-symbol";
        symbol.textContent =
            alphabet[Math.floor(Math.random() * alphabet.length)];

        symbol.style.height = `${rowHeight}px`;
        symbol.style.lineHeight = `${rowHeight}px`;
        strip.appendChild(symbol);
    }

    const finalSymbol = document.createElement("span");
    finalSymbol.className = "slot-symbol";
    finalSymbol.textContent = finalChar;
    finalSymbol.style.height = `${rowHeight}px`;
    finalSymbol.style.lineHeight = `${rowHeight}px`;
    strip.appendChild(finalSymbol);

    windowElement.style.display = "inline-block";
    windowElement.style.height = `${rowHeight}px`;
    windowElement.style.overflow = "hidden";
    windowElement.style.verticalAlign = "middle";

    strip.style.display = "block";
    strip.style.transform = "translateY(0)";
    strip.style.transition = "none";

    windowElement.appendChild(strip);
    element.replaceChildren(windowElement);

    // Даём браузеру отобразить начальное положение барабана.
    await new Promise(resolve =>
        requestAnimationFrame(() =>
            requestAnimationFrame(resolve)
        )
    );

    const targetPosition = totalSymbols * rowHeight;

    strip.style.transition =
        `transform ${duration}ms cubic-bezier(.08,.72,.12,1)`;

    strip.style.transform =
        `translateY(-${targetPosition}px)`;

    await sleep(duration + 100);

    element.textContent = finalChar;
}

async function animatePlate(finalPlate, rarity) {
    const main = document.querySelector(".plate-main");
    const region = document.querySelector(".region-code");

    const parts = finalPlate.split(" ");
    const mainFinal = parts[0];
    const regionFinal = parts[1] || "77";

    const color = rarityColors[rarity] || rarityColors.Common;
    $("plate").style.setProperty("--rarity-color", color);

    main.replaceChildren();
    region.replaceChildren();

    const mainSlots = Array.from(mainFinal, () => {
        const slot = document.createElement("span");
        slot.className = "slot-cell";
        main.appendChild(slot);
        return slot;
    });

    const regionSlots = Array.from(regionFinal, () => {
        const slot = document.createElement("span");
        slot.className = "slot-cell";
        region.appendChild(slot);
        return slot;
    });

    const rare = rarity === "Legendary" || rarity === "Mythic";
    const epic = rarity === "Epic";

    const allSlots = [
        ...Array.from(mainFinal, (char, index) => ({
            element: mainSlots[index],
            char
        })),
        ...Array.from(regionFinal, (char, index) => ({
            element: regionSlots[index],
            char
        }))
    ];

    for (let i = 0; i < allSlots.length; i++) {
        const slot = allSlots[i];
        const isLast = i === allSlots.length - 1;

        await rollSlot(slot.element, slot.char, {
            duration: isLast
                ? (rare ? 4200 : epic ? 3400 : 2400)
                : 1100 + i * 180,
            extraTurns: isLast
                ? (rare ? 7 : epic ? 4 : 2)
                : 0
        });
    }

    main.textContent = mainFinal;
    region.textContent = regionFinal;

    setRarityEffect(rarity);
    await sleep(rarity === "Mythic" ? 1300 : 550);
}


let freeSpinTimer = null;
let freeSpinSeconds = 0;

function updateFreeSpinTimer() {
    const status = $("free-spin-status");

    if (!status) return;

    if (freeSpinSeconds <= 0) {
        status.textContent = "🎁 Бесплатный спин доступен!";
        return;
    }

    const hours = Math.floor(freeSpinSeconds / 3600);
    const minutes = Math.floor((freeSpinSeconds % 3600) / 60);
    const seconds = freeSpinSeconds % 60;

    status.textContent =
        `🎁 Бесплатный спин через ${hours}ч ${minutes}м ${seconds}с`;

    freeSpinSeconds--;
}

function createMiniPlate(number) {
    const parts = String(number).split(" ");
    const main = parts[0] || "";
    const region = parts[1] || "";

    return `
        <div class="mini-plate">
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

async function refresh() {
    const me = await api("/api/me");

    freeSpinSeconds = Number(me.free_spin_seconds ?? 0);

    if (freeSpinTimer) {
        clearInterval(freeSpinTimer);
    }

    updateFreeSpinTimer();
    freeSpinTimer = setInterval(updateFreeSpinTimer, 1000);

    $("coins").textContent = me.coins.toLocaleString("ru-RU");
    $("spins").textContent = me.spins;

    const plates = await api("/api/collection");

    $("items").innerHTML = plates.length
        ? plates.map(p => `
            <div class="item collection-item">
                <div class="collection-plate-wrap">
                    ${createMiniPlate(p.number)}
                    <small>${escapeHtml(p.rarity)}</small>
                </div>
                <strong>#${p.id}</strong>
            </div>
        `).join("")
        : '<div class="empty">Пока нет номеров. Сделай первый спин!</div>';

    const market = await api("/api/market");

    $("market-items").innerHTML = market.length
        ? market.map(p => `
            <div class="item">
                <div>
                    <b>${escapeHtml(p.number)}</b>
                    <small>${escapeHtml(p.rarity)}</small>
                </div>
                <strong>${p.price} 🪙</strong>
            </div>
        `).join("")
        : '<div class="empty">На рынке пока пусто.</div>';
}

$("spin").addEventListener("click", async () => {
    $("spin").disabled = true;
    $("hint").textContent = "🎰 Барабаны вращаются...";

    try {
        const result = await api("/api/spin", {
            method: "POST"
        });

        // Сервер уже сохранил номер. Обновляем коллекцию сразу.
        await refresh();

        await animatePlate(
            result.plate.number,
            result.plate.rarity
        );

        $("rarity").textContent =
            (rarityNames[result.plate.rarity] ||
                result.plate.rarity.toUpperCase()) +
            " • +" + result.reward + " COINS";

        $("hint").textContent = "Номер добавлен в коллекцию!";
    } catch (e) {
        $("hint").textContent = e.message;
    } finally {
        $("spin").disabled = false;
    }
});

document.querySelectorAll(".tab").forEach(btn => {
    btn.addEventListener("click", () => {
        document.querySelectorAll(".tab").forEach(b =>
            b.classList.toggle("active", b === btn)
        );

        $("collection").classList.toggle(
            "hidden", btn.dataset.tab !== "collection"
        );

        $("market").classList.toggle(
            "hidden", btn.dataset.tab !== "market"
        );
    });
});

refresh().catch(e => {
    $("items").textContent = e.message;
    $("hint").textContent = e.message;
});
