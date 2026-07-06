// ============================================================================
// owner.js  (kök seviyede ek modül)
//   1) Site görsellerini Supabase'den çeker + önbellekler (flash yok)
//   2) Üst menüyü (kategoriler) veritabanından dinamik oluşturur
//   3) "İlanlarım": kullanıcının kendi ilanlarını düzenleme / silme
//   4) İlan vermeden önce ZORUNLU telefon (SMS) doğrulaması
// ============================================================================
import { supabase, publicImage } from "./js/supabase.js";

const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c]));
const tl = n => Number(n).toLocaleString("tr-TR") + " ₺";
const STATUS_TR = { pending:"Beklemede", active:"Yayında", sold:"Satıldı", removed:"Kaldırıldı" };
const siteImg = p => p ? supabase.storage.from("site-assets").getPublicUrl(p).data.publicUrl : null;

let categories = [];
let currentUid = null;
let phoneVerified = false;

applyMap(readCache());   // görselleri en erken anda uygula

boot();
async function boot() {
  await refreshAssets();
  await refresh();
  const { data:cats } = await supabase.from("categories").select("id,slug,name").order("sort");
  categories = cats || [];
  buildNav(categories);
  injectButton();
  supabase.auth.onAuthStateChange(async () => { await refresh(); injectButton(); });
}
async function refresh() {
  const { data:{ user } } = await supabase.auth.getUser();
  currentUid = user ? user.id : null;
  phoneVerified = !!(user && user.phone_confirmed_at);
}

// ---------------------------------------------------------------------------
// Üst menüyü kategorilere göre yeniden kur (rename/sıra/yeni tür yansır)
// ---------------------------------------------------------------------------
function buildNav(cats) {
  const ul = document.getElementById("nav");
  if (!ul || !cats.length) return;
  ul.innerHTML =
    `<li><a href="#" data-cat="">İlanlar</a></li>` +
    cats.map(c => `<li><a href="#" data-cat="${esc(c.slug)}">${esc(c.name)}</a></li>`).join("") +
    `<li><a href="#" data-page="rehberler">Bakım rehberleri</a></li>` +
    `<li><a href="#" data-page="hakkinda">Hakkında</a></li>`;
  // Not: app.js body üzerinde click dinlediği için yeni linkler otomatik çalışır.
}

// ---------------------------------------------------------------------------
// Site görselleri — önbellekli uygulama
// ---------------------------------------------------------------------------
const CACHE_KEY = "sm_site_assets_v1";
function readCache() { try { return JSON.parse(localStorage.getItem(CACHE_KEY)) || {}; } catch { return {}; } }
function writeCache(map) { try { localStorage.setItem(CACHE_KEY, JSON.stringify(map)); } catch {} }
async function refreshAssets() {
  try {
    const { data } = await supabase.from("site_assets").select("key,storage_path");
    const map = {};
    (data || []).forEach(a => { if (a.storage_path) map[a.key] = siteImg(a.storage_path); });
    writeCache(map); applyMap(map);
  } catch (e) {}
}
function applyMap(map) {
  if (!map) return;
  if (map.hero) {
    const img = document.querySelector(".hero-img img");
    if (img && img.src !== map.hero) { img.src = map.hero; img.style.display = "block"; const ph = img.nextElementSibling; if (ph) ph.style.display = "none"; }
  }
  if (map.logo) {
    const holder = document.getElementById("logo");
    if (holder) {
      let im = holder.querySelector("img.logo-img");
      if (!im) {
        const svg = holder.querySelector(".logo-svg");
        im = document.createElement("img"); im.className = "logo-img"; im.alt = "SürüngenMarket";
        im.style.cssText = "width:40px;height:40px;object-fit:contain;border-radius:8px;flex-shrink:0;";
        if (svg) svg.replaceWith(im); else holder.insertBefore(im, holder.firstChild);
      }
      if (im.src !== map.logo) im.src = map.logo;
    }
  }
  applyCats(map);
}
function applyCats(map) {
  const cats = document.getElementById("cats");
  if (!cats) return;
  const doIt = () => {
    cats.querySelectorAll(".cat").forEach(c => {
      const slug = c.getAttribute("data-cat");
      const url = map["cat_" + slug];
      const thumb = c.querySelector(".thumb");
      if (url && thumb && thumb.dataset.url !== url) {
        thumb.dataset.url = url;
        thumb.innerHTML = `<img src="${url}" alt="" style="width:100%;height:170px;object-fit:cover;display:block;">`;
      }
    });
  };
  doIt();
  if (!cats._obs) { cats._obs = new MutationObserver(doIt); cats._obs.observe(cats, { childList: true }); }
}

// ---------------------------------------------------------------------------
// "İlanlarım" + düzenle/sil
// ---------------------------------------------------------------------------
function injectButton() {
  const holder = document.getElementById("auth-in");
  if (!holder) return;
  if (currentUid && !document.getElementById("btn-mylistings")) {
    const btn = document.createElement("button");
    btn.id = "btn-mylistings"; btn.className = "btn btn-ghost"; btn.textContent = "İlanlarım";
    btn.onclick = openPanel;
    holder.insertBefore(btn, holder.firstChild);
  }
}
function ensureOverlay(id, inner) {
  let ov = document.getElementById(id);
  if (ov) return ov;
  ov = document.createElement("div");
  ov.id = id; ov.className = "overlay"; ov.innerHTML = inner;
  document.body.appendChild(ov);
  ov.addEventListener("click", e => { if (e.target.id === id) ov.classList.remove("open"); });
  return ov;
}
async function openPanel() {
  const ov = ensureOverlay("my-overlay", `<div class="modal" style="max-width:640px">
    <h2>İlanlarım</h2>
    <p class="sub">Kendi ilanlarını buradan düzenleyebilir veya silebilirsin.</p>
    <div id="my-list" style="display:flex;flex-direction:column;gap:10px;max-height:60vh;overflow-y:auto;"></div>
    <div class="actions" style="margin-top:18px"><button class="btn btn-cancel" id="my-close">Kapat</button></div>
  </div>`);
  ov.querySelector("#my-close").onclick = () => ov.classList.remove("open");
  ov.classList.add("open");
  const list = ov.querySelector("#my-list");
  list.innerHTML = `<p style="color:var(--muted)">Yükleniyor…</p>`;
  const { data, error } = await supabase.from("listings")
    .select("id,title,price,status,city,category_id,sex,age_text,description,images:listing_images(storage_path,position)")
    .eq("user_id", currentUid).order("created_at", { ascending:false });
  if (error) { list.innerHTML = `<p style="color:var(--red)">Yüklenemedi: ${esc(error.message)}</p>`; return; }
  if (!data || !data.length) { list.innerHTML = `<p style="color:var(--muted)">Henüz ilanın yok.</p>`; return; }
  window._my = {}; data.forEach(l => window._my[l.id] = l);
  list.innerHTML = data.map(l => {
    const img = (l.images||[]).sort((a,b)=>a.position-b.position)[0];
    const cover = img ? `<img src="${publicImage(img.storage_path)}" style="width:56px;height:44px;object-fit:cover;border-radius:8px;">`
                      : `<div style="width:56px;height:44px;border-radius:8px;background:var(--bg-3);"></div>`;
    return `<div style="display:flex;align-items:center;gap:12px;background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:10px 12px;">
      ${cover}
      <div style="flex:1;min-width:0"><div style="font-size:14px;font-weight:600;">${esc(l.title)}</div>
        <div style="font-size:12px;color:var(--muted);">${l.price===0?"Ücretsiz":tl(l.price)} · ${esc(STATUS_TR[l.status]||l.status)} · ${esc(l.city||"")}</div></div>
      <button class="btn btn-ghost" data-edit="${l.id}" style="font-size:12.5px;padding:6px 12px;">Düzenle</button>
      <button class="btn" data-del="${l.id}" style="font-size:12.5px;padding:6px 12px;background:transparent;color:#ff6b6b;border:1px solid rgba(255,107,107,.4);">Sil</button>
    </div>`;
  }).join("");
  list.querySelectorAll("[data-edit]").forEach(b => b.onclick = () => openEdit(window._my[b.dataset.edit]));
  list.querySelectorAll("[data-del]").forEach(b => b.onclick = () => removeListing(window._my[b.dataset.del]));
}
async function removeListing(l) {
  if (!confirm(`"${l.title}" ilanı kalıcı olarak silinecek. Emin misin?`)) return;
  const { error } = await supabase.from("listings").delete().eq("id", l.id);
  if (error) return toast("Silinemedi: " + error.message);
  toast("İlan silindi"); openPanel();
}
let editId = null;
function openEdit(l) {
  const ov = ensureOverlay("myedit-overlay", `<div class="modal" style="max-width:520px">
    <h2>İlanı düzenle</h2>
    <div class="form-grid">
      <div class="field full"><label>Başlık / tür</label><input id="me-title"></div>
      <div class="field"><label>Kategori</label><select id="me-cat"></select></div>
      <div class="field"><label>Durum</label><select id="me-status">
        <option value="active">Yayında</option><option value="pending">Beklemede</option><option value="sold">Satıldı</option><option value="removed">Kaldırıldı</option></select></div>
      <div class="field"><label>Fiyat (₺, 0 = ücretsiz)</label><input id="me-price" type="number" min="0"></div>
      <div class="field"><label>Şehir</label><input id="me-city"></div>
      <div class="field"><label>Cinsiyet</label><select id="me-sex"><option value="m">Erkek</option><option value="f">Dişi</option><option value="x">Bilinmiyor</option></select></div>
      <div class="field"><label>Yaş</label><input id="me-age"></div>
      <div class="field full"><label>Açıklama</label><textarea id="me-desc" rows="3"></textarea></div>
    </div>
    <div class="actions"><button class="btn btn-cancel" id="me-cancel">Vazgeç</button><button class="btn btn-primary" id="me-save">Kaydet</button></div>
  </div>`);
  if (!ov.querySelector("#me-cat").options.length)
    ov.querySelector("#me-cat").innerHTML = categories.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join("");
  ov.querySelector("#me-cancel").onclick = () => ov.classList.remove("open");
  editId = l.id;
  ov.querySelector("#me-title").value = l.title || "";
  ov.querySelector("#me-cat").value = l.category_id || (categories[0]?.id ?? "");
  ov.querySelector("#me-status").value = l.status || "active";
  ov.querySelector("#me-price").value = l.price ?? 0;
  ov.querySelector("#me-city").value = l.city || "";
  ov.querySelector("#me-sex").value = l.sex || "x";
  ov.querySelector("#me-age").value = l.age_text || "";
  ov.querySelector("#me-desc").value = l.description || "";
  ov.querySelector("#me-save").onclick = async () => {
    const patch = {
      title: ov.querySelector("#me-title").value.trim(),
      category_id: parseInt(ov.querySelector("#me-cat").value) || null,
      status: ov.querySelector("#me-status").value,
      price: parseInt(ov.querySelector("#me-price").value) || 0,
      city: ov.querySelector("#me-city").value.trim() || null,
      sex: ov.querySelector("#me-sex").value,
      age_text: ov.querySelector("#me-age").value.trim() || null,
      description: ov.querySelector("#me-desc").value.trim() || null
    };
    const { error } = await supabase.from("listings").update(patch).eq("id", editId);
    if (error) return toast("Kaydedilemedi: " + error.message);
    ov.classList.remove("open"); toast("İlan güncellendi ✓"); openPanel();
  };
  ov.classList.add("open");
}

// ---------------------------------------------------------------------------
// İlan vermeden önce ZORUNLU telefon (SMS) doğrulaması
// ---------------------------------------------------------------------------
document.addEventListener("click", e => {
  const b = e.target.closest && e.target.closest("#btn-new");
  if (!b) return;
  if (!currentUid) return;
  if (phoneVerified) return;
  e.stopImmediatePropagation(); e.preventDefault();
  openPhoneVerify();
}, true);
function toE164(raw) {
  let d = (raw || "").replace(/[^\d]/g, "");
  if (d.startsWith("90")) d = d.slice(2);
  if (d.startsWith("0")) d = d.slice(1);
  return { e164: "+90" + d, ok: /^5\d{9}$/.test(d) };
}
function openPhoneVerify() {
  const ov = ensureOverlay("phone-overlay", `<div class="modal" style="max-width:420px">
    <h2>Telefon doğrulama</h2>
    <p class="sub">İlan verebilmek için telefon numaranı bir kez SMS ile doğrulaman gerekiyor.</p>
    <div id="pv-step1">
      <div class="field"><label>Cep telefonu</label><input id="pv-phone" type="tel" placeholder="05XX XXX XX XX"></div>
      <button class="btn btn-primary" id="pv-send" style="width:100%;margin-top:12px;">SMS kodu gönder</button>
    </div>
    <div id="pv-step2" style="display:none">
      <div class="field"><label>SMS ile gelen 6 haneli kod</label><input id="pv-code" maxlength="6" placeholder="______" style="text-align:center;letter-spacing:6px;font-size:18px;"></div>
      <button class="btn btn-primary" id="pv-verify" style="width:100%;margin-top:12px;">Doğrula</button>
    </div>
    <div class="form-err" id="pv-err" style="display:none"></div>
    <div class="actions" style="margin-top:14px"><button class="btn btn-cancel" id="pv-cancel">Vazgeç</button></div>
  </div>`);
  ov.querySelector("#pv-cancel").onclick = () => ov.classList.remove("open");
  const err = m => { const e = ov.querySelector("#pv-err"); e.textContent = m; e.style.display = m ? "block" : "none"; };
  err(""); ov.querySelector("#pv-step1").style.display = ""; ov.querySelector("#pv-step2").style.display = "none";
  let e164 = "";
  ov.querySelector("#pv-send").onclick = async () => {
    const p = toE164(ov.querySelector("#pv-phone").value);
    if (!p.ok) return err("Geçerli bir cep numarası gir (05XX XXX XX XX).");
    e164 = p.e164; err("");
    const btn = ov.querySelector("#pv-send"); btn.disabled = true; btn.textContent = "Gönderiliyor…";
    const { error } = await supabase.auth.updateUser({ phone: e164 });
    btn.disabled = false; btn.textContent = "SMS kodu gönder";
    if (error) return err("Kod gönderilemedi: " + error.message + " (Supabase'de SMS sağlayıcı ayarlı mı?)");
    ov.querySelector("#pv-step1").style.display = "none"; ov.querySelector("#pv-step2").style.display = ""; ov.querySelector("#pv-code").focus();
  };
  ov.querySelector("#pv-verify").onclick = async () => {
    const token = ov.querySelector("#pv-code").value.trim();
    if (token.length < 6) return err("6 haneli kodu gir.");
    err("");
    const btn = ov.querySelector("#pv-verify"); btn.disabled = true; btn.textContent = "Doğrulanıyor…";
    const { error } = await supabase.auth.verifyOtp({ phone: e164, token, type: "phone_change" });
    btn.disabled = false; btn.textContent = "Doğrula";
    if (error) return err("Kod hatalı ya da süresi dolmuş.");
    phoneVerified = true; ov.classList.remove("open");
    toast("Telefonun doğrulandı ✓ Artık ilan verebilirsin.");
    const nb = document.getElementById("btn-new"); if (nb) nb.click();
  };
  ov.classList.add("open");
}

function toast(m) {
  let t = document.getElementById("toast");
  if (!t) { t = document.createElement("div"); t.id = "toast"; t.className = "toast"; document.body.appendChild(t); }
  t.textContent = m; t.style.display = "block";
  clearTimeout(t._h); t._h = setTimeout(() => t.style.display = "none", 3000);
}
