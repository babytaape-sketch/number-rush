from fastapi import FastAPI,Header,HTTPException
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel,Field
from app.auth import telegram_user
from app.db import init_db,connect
from app.game import generate_plate,roll_rarity
app=FastAPI(title="NUMBER RUSH API")
@app.on_event("startup")
async def startup(): await init_db()
def who(data):
    try: return telegram_user(data)
    except Exception as e: raise HTTPException(401,str(e))
async def ensure(u):
    async with await connect() as db:
        await db.execute("INSERT OR IGNORE INTO users(user_id,username) VALUES(?,?)",(u["id"],u.get("username","")))
        await db.commit()
@app.get("/api/me")
async def me(x_telegram_init_data:str=Header(default="")):
    u=who(x_telegram_init_data); await ensure(u)
    async with await connect() as db:
        r=await (await db.execute("SELECT user_id,username,spins,coins FROM users WHERE user_id=?",(u["id"],))).fetchone()
    return dict(r)
@app.post("/api/spin")
async def spin(x_telegram_init_data:str=Header(default="")):
    u=who(x_telegram_init_data); await ensure(u); rarity,emoji=roll_rarity(); plate=generate_plate()
    async with await connect() as db:
        await db.execute("BEGIN IMMEDIATE")
        cur=await db.execute("UPDATE users SET spins=spins-1 WHERE user_id=? AND spins>0",(u["id"],))
        if cur.rowcount!=1: await db.rollback(); raise HTTPException(409,"No spins left")
        cur=await db.execute("INSERT INTO plates(owner_id,plate,rarity) VALUES(?,?,?)",(u["id"],plate,rarity))
        pid=cur.lastrowid
        await db.execute("UPDATE users SET coins=coins+10 WHERE user_id=?",(u["id"],)); await db.commit()
    return {"id":pid,"plate":plate,"rarity":rarity,"emoji":emoji}
@app.get("/api/collection")
async def collection(x_telegram_init_data:str=Header(default="")):
    u=who(x_telegram_init_data); await ensure(u)
    async with await connect() as db:
        rows=await (await db.execute("SELECT id,plate,rarity,created_at FROM plates WHERE owner_id=? ORDER BY id DESC",(u["id"],))).fetchall()
    return [dict(x) for x in rows]
class Listing(BaseModel):
    plate_id:int
    price:int=Field(gt=0,le=10000000)
@app.post("/api/market/list")
async def list_plate(p:Listing,x_telegram_init_data:str=Header(default="")):
    u=who(x_telegram_init_data)
    async with await connect() as db:
        await db.execute("BEGIN IMMEDIATE")
        owned=await (await db.execute("SELECT id FROM plates WHERE id=? AND owner_id=?",(p.plate_id,u["id"]))).fetchone()
        if not owned: await db.rollback(); raise HTTPException(404,"Not your plate")
        try: await db.execute("INSERT INTO listings(plate_id,seller_id,price) VALUES(?,?,?)",(p.plate_id,u["id"],p.price))
        except Exception: await db.rollback(); raise HTTPException(409,"Already listed")
        await db.commit()
    return {"ok":True}
@app.get("/api/market")
async def market():
    async with await connect() as db:
        rows=await (await db.execute("SELECT l.id listing_id,l.price,p.id plate_id,p.plate,p.rarity,u.username FROM listings l JOIN plates p ON p.id=l.plate_id JOIN users u ON u.user_id=l.seller_id WHERE l.status='active' ORDER BY l.id DESC LIMIT 100")).fetchall()
    return [dict(x) for x in rows]
@app.post("/api/market/{listing_id}/buy")
async def buy(listing_id:int,x_telegram_init_data:str=Header(default="")):
    u=who(x_telegram_init_data); await ensure(u)
    async with await connect() as db:
        await db.execute("BEGIN IMMEDIATE")
        l=await (await db.execute("SELECT * FROM listings WHERE id=? AND status='active'",(listing_id,))).fetchone()
        if not l: await db.rollback(); raise HTTPException(404,"Listing unavailable")
        if l["seller_id"]==u["id"]: await db.rollback(); raise HTTPException(400,"Own listing")
        buyer=await (await db.execute("SELECT coins FROM users WHERE user_id=?",(u["id"],))).fetchone()
        if buyer["coins"]<l["price"]: await db.rollback(); raise HTTPException(409,"Not enough coins")
        cur=await db.execute("UPDATE listings SET status='sold' WHERE id=? AND status='active'",(listing_id,))
        if cur.rowcount!=1: await db.rollback(); raise HTTPException(409,"Already sold")
        await db.execute("UPDATE users SET coins=coins-? WHERE user_id=?",(l["price"],u["id"]))
        await db.execute("UPDATE users SET coins=coins+? WHERE user_id=?",(l["price"],l["seller_id"]))
        await db.execute("UPDATE plates SET owner_id=? WHERE id=?",(u["id"],l["plate_id"]))
        await db.commit()
    return {"ok":True}
app.mount("/",StaticFiles(directory="web",html=True),name="web")
