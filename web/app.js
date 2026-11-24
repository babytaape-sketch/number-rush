const tg = window.Telegram?.WebApp;
if (tg) { tg.ready(); tg.expand(); }
const initData = tg?.initData || "";
const headers = {"Content-Type":"application/json"};
if (initData) headers.Authorization = "tma " + initData;
const $ = id => document.getElementById(id);
async function api(path, options={}) {
  const res = await fetch(path, {...options, headers:{...headers,...(options.headers||{})}});
  const data = await res.json().catch(()=>({detail:"Server error"}));
  if (!res.ok) throw new Error(data.detail || "Request failed");
  return data;
}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
async function refresh(){
  const me = await api("/api/me");
  $("coins").textContent = me.coins.toLocaleString("ru-RU");
  $("spins").textContent = me.spins;
  const plates = await api("/api/collection");
  $("items").innerHTML = plates.length ? plates.map(p=>`<div class="item"><div><b>${escapeHtml(p.number)}</b><small>${escapeHtml(p.rarity)}</small></div><strong>#${p.id}</strong></div>`).join("") : '<div class="empty">Пока нет номеров. Сделай первый спин!</div>';
  const market = await api("/api/market");
  $("market-items").innerHTML = market.length ? market.map(p=>`<div class="item"><div><b>${escapeHtml(p.number)}</b><small>${escapeHtml(p.rarity)}</small></div><strong>${p.price} 🪙</strong></div>`).join("") : '<div class="empty">На рынке пока пусто.</div>';
}
$("spin").addEventListener("click", async()=>{
  $("spin").disabled=true; $("hint").textContent="Генерируем номер...";
  try{
    const result=await api("/api/spin",{method:"POST"});
    $("plate").textContent=result.plate.number;
    $("rarity").textContent=result.plate.rarity.toUpperCase()+" • +"+result.reward+" COINS";
    await refresh();
    $("hint").textContent="Номер добавлен в коллекцию!";
  }catch(e){$("hint").textContent=e.message;}
  finally{$("spin").disabled=false;}
});
document.querySelectorAll(".tab").forEach(btn=>btn.addEventListener("click",()=>{
  document.querySelectorAll(".tab").forEach(b=>b.classList.toggle("active",b===btn));
  $("collection").classList.toggle("hidden",btn.dataset.tab!=="collection");
  $("market").classList.toggle("hidden",btn.dataset.tab!=="market");
}));
refresh().catch(e=>{$("items").textContent=e.message;$("hint").textContent=e.message;});
