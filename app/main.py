import hashlib
import hmac
import json
import os
import random
import sqlite3
import time
import threading
from pathlib import Path
from urllib.parse import parse_qsl
from urllib.request import Request, urlopen
from dotenv import load_dotenv
from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

load_dotenv()
BASE_DIR = Path(__file__).resolve().parent.parent
WEB_DIR = BASE_DIR / "web"
DB_PATH = os.getenv("DATABASE_PATH", str(BASE_DIR / "number_rush.db"))
DEV_MODE = os.getenv("DEV_MODE", "true").lower() == "true"
BOT_TOKEN = os.getenv("BOT_TOKEN", "")

app = FastAPI(title="NUMBER RUSH API")

RARITIES = [
    ("Common", 60.0, 10),
    ("Uncommon", 25.0, 25),
    ("Rare", 10.0, 60),
    ("Epic", 4.0, 150),
    ("Legendary", 0.9, 500),
    ("Mythic", 0.1, 2000),
]

def db():
    con = sqlite3.connect(DB_PATH, timeout=20)
    con.row_factory = sqlite3.Row
    return con

def init_db():
    Path(DB_PATH).parent.mkdir(parents=True, exist_ok=True)
    with db() as con:
        con.executescript("""
        CREATE TABLE IF NOT EXISTS users (
    user_id TEXT PRIMARY KEY,
    username TEXT NOT NULL DEFAULT 'Player',
    coins INTEGER NOT NULL DEFAULT 100,
    spins INTEGER NOT NULL DEFAULT 5,
    created_at INTEGER NOT NULL,
    last_free_spin_at INTEGER NOT NULL DEFAULT 0
);

        CREATE TABLE IF NOT EXISTS plates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            owner_id TEXT NOT NULL,
            number TEXT NOT NULL,
            rarity TEXT NOT NULL,
            created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS listings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            plate_id INTEGER NOT NULL UNIQUE,
            seller_id TEXT NOT NULL,
            price INTEGER NOT NULL,
            created_at INTEGER NOT NULL
        );
        """)
init_db()
with db() as con:
    columns = [row["name"] for row in con.execute(
        "PRAGMA table_info(users)"
    ).fetchall()]

    if "last_free_spin_at" not in columns:
        con.execute(
            "ALTER TABLE users ADD COLUMN last_free_spin_at INTEGER NOT NULL DEFAULT 0"
        )

def validate_init_data(raw: str):
    if DEV_MODE:
        return {"id": 10001, "first_name": "Demo Player", "username": "demo"}
    if not BOT_TOKEN:
        raise HTTPException(500, "BOT_TOKEN is not configured")
    try:
        pairs = dict(parse_qsl(raw, keep_blank_values=True))
        received_hash = pairs.pop("hash")
        auth_date = int(pairs.get("auth_date", "0"))
        if time.time() - auth_date > 86400:
            raise ValueError("initData expired")
        data_check = "\n".join(f"{k}={v}" for k, v in sorted(pairs.items()))
        secret_key = hmac.new(b"WebAppData", BOT_TOKEN.encode(), hashlib.sha256).digest()
        calculated = hmac.new(secret_key, data_check.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(calculated, received_hash):
            raise ValueError("bad signature")
        return json.loads(pairs["user"])
    except Exception:
        raise HTTPException(401, "Invalid Telegram initData")

def current_user(authorization: str | None):
    raw = (authorization or "").removeprefix("tma ").strip()
    if not raw and not DEV_MODE:
        raise HTTPException(401, "Open this app from Telegram")
    user = validate_init_data(raw)
    uid = str(user.get("id", "demo"))
    username = user.get("username") or user.get("first_name") or "Player"
    with db() as con:
        con.execute(
            "INSERT OR IGNORE INTO users(user_id, username, coins, spins, created_at) VALUES(?,?,?,?,?)",
            (uid, username, 100, 5, int(time.time()))
        )
        con.execute("UPDATE users SET username=? WHERE user_id=?", (username, uid))
        row = con.execute("SELECT * FROM users WHERE user_id=?", (uid,)).fetchone()
    return row

def weighted_rarity():
    roll = random.random() * 100
    total = 0
    for name, chance, reward in RARITIES:
        total += chance
        if roll <= total:
            return name
    return "Common"

def generate_plate():
    letters = "".join(random.choice("ABCDEFGHJKLMNPRSTUVWXYZ") for _ in range(3))
    digits = "".join(random.choice("0123456789") for _ in range(3))
    return f"{letters} {digits}"

@app.get("/")
def home():
    return FileResponse(WEB_DIR / "index.html")

@app.get("/health")
def health():
    return {"ok": True, "service": "NUMBER RUSH"}

app.mount("/static", StaticFiles(directory=WEB_DIR), name="static")

@app.get("/api/me")
def me(authorization: str | None = Header(default=None)):
    user = current_user(authorization)
    now = int(time.time())

    with db() as con:
        count = con.execute(
            "SELECT COUNT(*) n FROM plates WHERE owner_id=?",
            (user["user_id"],)
        ).fetchone()["n"]

        row = con.execute(
            "SELECT last_free_spin_at FROM users WHERE user_id=?",
            (user["user_id"],)
        ).fetchone()

    seconds_left = max(
        0,
        86400 - (now - row["last_free_spin_at"])
    )

    return {
        "id": user["user_id"],
        "username": user["username"],
        "coins": user["coins"],
        "spins": user["spins"],
        "collection_count": count,
        "free_spin_available": seconds_left == 0,
        "free_spin_seconds": seconds_left
    }

@app.post("/api/spin")
@app.post("/api/spin")
def spin(authorization: str | None = Header(default=None)):
    user = current_user(authorization)
    uid = user["user_id"]
    now = int(time.time())

    with db() as con:
        con.execute("BEGIN IMMEDIATE")

        row = con.execute(
            "SELECT coins, spins, last_free_spin_at FROM users WHERE user_id=?",
            (uid,)
        ).fetchone()

        free_spin_ready = (
            row["last_free_spin_at"] == 0
            or now - row["last_free_spin_at"] >= 86400
        )

        used_free_spin = False

        if free_spin_ready:
            used_free_spin = True
            con.execute(
                "UPDATE users SET last_free_spin_at=? WHERE user_id=?",
                (now, uid)
            )
        elif row["spins"] > 0:
            con.execute(
                "UPDATE users SET spins=spins-1 WHERE user_id=?",
                (uid,)
            )
        else:
            con.rollback()
            raise HTTPException(400, "No spins left. Free spin is not ready yet.")

        rarity = weighted_rarity()
        reward = next(r for n, c, r in RARITIES if n == rarity)
        number = generate_plate()

        con.execute(
            "UPDATE users SET coins=coins+? WHERE user_id=?",
            (reward, uid)
        )

        cur = con.execute(
            "INSERT INTO plates(owner_id, number, rarity, created_at) VALUES(?,?,?,?)",
            (uid, number, rarity, now)
        )

        plate_id = cur.lastrowid

        updated = con.execute(
            "SELECT coins, spins, last_free_spin_at FROM users WHERE user_id=?",
            (uid,)
        ).fetchone()

        con.commit()

    seconds_left = max(0, 86400 - (now - updated["last_free_spin_at"]))

    return {
        "plate": {
            "id": plate_id,
            "number": number,
            "rarity": rarity
        },
        "reward": reward,
        "coins": updated["coins"],
        "spins": updated["spins"],
        "used_free_spin": used_free_spin,
        "free_spin_available": seconds_left == 0,
        "free_spin_seconds": seconds_left
    }
    return {"plate": {"id": plate_id, "number": number, "rarity": rarity}, "reward": reward, "coins": updated["coins"], "spins": updated["spins"]}

@app.get("/api/collection")
def collection(authorization: str | None = Header(default=None)):
    user = current_user(authorization)
    with db() as con:
        rows = con.execute("SELECT id, number, rarity, created_at FROM plates WHERE owner_id=? ORDER BY id DESC", (user["user_id"],)).fetchall()
    return [dict(r) for r in rows]

@app.get("/api/market")
def market(authorization: str | None = Header(default=None)):
    current_user(authorization)
    with db() as con:
        rows = con.execute("""SELECT l.id AS listing_id, l.price, p.number, p.rarity, p.id AS plate_id
                              FROM listings l JOIN plates p ON p.id=l.plate_id
                              ORDER BY l.id DESC""").fetchall()
    return [dict(r) for r in rows]

class ListingRequest(BaseModel):
    plate_id: int
    price: int

@app.post("/api/market/list")
def list_plate(payload: ListingRequest, authorization: str | None = Header(default=None)):
    user = current_user(authorization)
    if payload.price < 1 or payload.price > 1000000:
        raise HTTPException(400, "Price must be between 1 and 1,000,000 coins")
    with db() as con:
        con.execute("BEGIN IMMEDIATE")
        plate = con.execute("SELECT id FROM plates WHERE id=? AND owner_id=?", (payload.plate_id, user["user_id"])).fetchone()
        if not plate:
            con.rollback()
            raise HTTPException(404, "Plate not found in your collection")
        try:
            con.execute("INSERT INTO listings(plate_id, seller_id, price, created_at) VALUES(?,?,?,?)",
                        (payload.plate_id, user["user_id"], payload.price, int(time.time())))
            con.commit()
        except sqlite3.IntegrityError:
            con.rollback()
            raise HTTPException(409, "This plate is already listed")
    return {"ok": True}

@app.post("/api/market/{listing_id}/buy")
def buy_listing(listing_id: int, authorization: str | None = Header(default=None)):
    user = current_user(authorization)
    uid = user["user_id"]
    with db() as con:
        con.execute("BEGIN IMMEDIATE")
        listing = con.execute("SELECT * FROM listings WHERE id=?", (listing_id,)).fetchone()
        if not listing:
            con.rollback()
            raise HTTPException(404, "Listing not found")
        if listing["seller_id"] == uid:
            con.rollback()
            raise HTTPException(400, "You cannot buy your own listing")
        buyer = con.execute("SELECT coins FROM users WHERE user_id=?", (uid,)).fetchone()
        if buyer["coins"] < listing["price"]:
            con.rollback()
            raise HTTPException(400, "Not enough coins")
        con.execute("UPDATE users SET coins=coins-? WHERE user_id=?", (listing["price"], uid))
        con.execute("UPDATE users SET coins=coins+? WHERE user_id=?", (listing["price"], listing["seller_id"]))
        con.execute("UPDATE plates SET owner_id=? WHERE id=?", (uid, listing["plate_id"]))
        con.execute("DELETE FROM listings WHERE id=?", (listing_id,))
        con.commit()
    return {"ok": True}

TELEGRAM_API = f"https://api.telegram.org/bot{BOT_TOKEN}"
WEB_APP_URL = "https://number-rush-5jne.onrender.com"


def telegram_request(method, payload):
    request = Request(
        f"{TELEGRAM_API}/{method}",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urlopen(request, timeout=35) as response:
        return json.loads(response.read().decode("utf-8"))


def telegram_polling():
    if not BOT_TOKEN or DEV_MODE:
        return

    offset = 0

    while True:
        try:
            result = telegram_request(
                "getUpdates",
                {"offset": offset, "timeout": 25}
            )

            for update in result.get("result", []):
                offset = update["update_id"] + 1
                message = update.get("message")

                if not message:
                    continue

                chat_id = message["chat"]["id"]
                text = message.get("text", "")

                if text.startswith("/start"):
                    keyboard = {
                        "inline_keyboard": [[
                            {
                                "text": "🎮 Играть в NUMBER RUSH",
                                "web_app": {"url": WEB_APP_URL}
                            }
                        ]]
                    }

                    telegram_request("sendMessage", {
                        "chat_id": chat_id,
                        "text": "Добро пожаловать в NUMBER RUSH! Готов испытать удачу?",
                        "reply_markup": keyboard
                    })

        except Exception:
            time.sleep(5)


@app.on_event("startup")
def start_telegram_bot():
    if not BOT_TOKEN or DEV_MODE:
        print("Telegram bot is disabled")
        return

    try:
        telegram_request("deleteWebhook", {})
        print("Telegram webhook removed")
    except Exception as exc:
        print(f"Webhook error: {exc}")

    threading.Thread(
        target=telegram_polling,
        daemon=True
    ).start()
