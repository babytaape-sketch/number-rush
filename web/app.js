const tg = window.Telegram?.WebApp;

console.log("Telegram theme:", tg?.colorScheme);
console.log("Background:", tg?.backgroundColor);
console.log("Version:", tg?.version);

if (tg) {
    tg.ready();
    tg.expand();
    tg.setHeaderColor("#f2f4f8");
    tg.setBackgroundColor("#f2f4f8");
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
        "'": "'"
    }[c]));
}

const plateLetters = "АВЕКМНОРСТУХ";
const plateDigits = "0123456789";

function randomPlateFrame(finalPlate) {
    return Array.from(finalPlate, char => {
        if (plateLetters.includes(char)) {
            return plateLetters[Math.floor(Math.random() * plateLetters.length)];
        }

        if (plateDigits.includes(char)) {
            return plateDigits[Math.floor(Math.random() * plateDigits.length)];
        }

        return char;
    }).join("");
}

async function animatePlate(finalPlate) {
    const main = document.querySelector(".plate-main");
    const region = document.querySelector(".region-code");
    const parts = finalPlate.split(" ");
    const mainFinal = parts[0];
    const regionFinal = parts[1] || "77";

    const frames = 28;

    for (let i = 0; i < frames; i++) {
        main.textContent = randomPlateFrame(mainFinal);
        region.textContent = randomPlateFrame(regionFinal);

        const delay = 35 + i * 7;
        await new Promise(resolve => setTimeout(resolve, delay));
    }

    main.textContent = mainFinal;
    region.textContent = regionFinal;
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
            <div class="item">
                <div>
                    <b>${escapeHtml(p.number)}</b>
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
    $(").textContent = "🎰 Крутим номер...";

    try {
        const result = await api("/api/spin", {
            method: "POST"
        });

        await animatePlate(result.plate.number);

        $("rarity").textContent =
            result.plate.rarity.toUpperCase() +
            " • +" + result.reward + " COINS";

        await refresh();

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
});"hint
