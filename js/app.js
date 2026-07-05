// ============================================================================
// SürüngenMarket — Uygulama arayüzü (tüm modülleri bağlar)
// ============================================================================
import { supabase } from "./supabase.js";
import * as Auth from "./auth.js";
import * as Listings from "./listings.js";
import * as Favorites from "./favorites.js";
import * as Messages from "./messages.js";
import * as Reports from "./reports.js";
import * as Guides from "./guides.js";

// ---------- yardımcılar ----------
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const tl = n => Number(n).toLocaleString("tr-TR") + " ₺";
const sexHtml = s => s === "m" ? '<span class="sex m">♂</span>' : s === "f" ? '<span class="sex f">♀</span>' : "";
const timeAgo = iso => {
  const d = Math.floor((Date.now() - new Date(iso)) / 86400000);
  return d <= 0 ? "bugün" : d === 1 ? "dün" : d + " gün önce";
};
function toast(m) {
  const t = $("toast"); t.textContent = m; t.style.display = "block";
  clearTimeout(t._h); t._h = setTimeout(() => t.style.display = "none", 2800);
}
const openOv = id => $(id).classList.add("open");
const closeOv = id => $(id).classList.remove("open");

// ---------- durum ----------
let profile = null;        // giriş yapan kullanıcının profili
let categories = [];       // [{id,slug,name}]
let favIds = new Set();
let curRows = [];
let curDetail = null;
let filter = "all", catFilter = "", chatWith = null;

// ============================================================================
// Başlangıç
// ============================================================================
init();
async function init() {
  categories = await loadCategories();
  fillCategorySelects();
  renderCategories();
  await refreshAuth();
  wireEvents();
  loadListings();
  Auth.onAuthChange(async () => { await refreshAuth(); loadListings(); });
  revealOnScroll();
}

async function loadCategories() {
  const { data } = await supabase.from("categories").select("id,slug,name").order("sort");
  return data || [];
}
const catName = slug => (categories.find(c => c.slug === slug) || {}).name || "İlanlar";

// ============================================================================
// Auth arayüzü
// ============================================================================
async function refreshAuth() {
  profile = await Auth.currentProfile();
  favIds = await Favorites.myFavoriteIds();
  $("auth-out").style.display = profile ? "none" : "";
  $("auth-in").style.display = profile ? "" : "none";
  if (profile) $("user-chip").textContent = "👤 " + profile.username + (profile.role === "admin" ? " ⚙" : "");
}

function openAuth(tab, note) {
  switchTab(tab || "login");
  $("auth-note").textContent = note || "SürüngenMarket hesabınla devam et.";
  $("auth-err").style.display = "none";
  openOv("auth-overlay");
}
function switchTab(t) {
  $("tab-login").classList.toggle("on", t === "login");
  $("tab-register").classList.toggle("on", t === "register");
  $("form-login").style.display = t === "login" ? "grid" : "none";
  $("form-register").style.display = t === "register" ? "grid" : "none";
  $("auth-title").textContent = t === "login" ? "Giriş yap" : "Üye ol";
  $("auth-submit").textContent = t === "login" ? "Giriş yap" : "Hesap oluştur";
  $("auth-submit").dataset.mode = t;
}
const authErr = m => { const e = $("auth-err"); e.textContent = m; e.style.display = "block"; };

async function doAuthSubmit() {
  const mode = $("auth-submit").dataset.mode || "login";
  try {
    if (mode === "register") {
      const username = $("r-name").value.trim();
      const email = $("r-email").value.trim().toLowerCase();
      const password = $("r-pass").value;
      if (!username || !email || !password) return authErr("Tüm alanları doldur.");
      if (password.length < 6) return authErr("Şifre en az 6 karakter olmalı.");
      await Auth.signUp({ email, password, username, city: $("r-city").value });
      closeOv("auth-overlay");
      toast("Kaydın alındı — e-postana gönderilen doğrulama bağlantısına tıkla ✉");
    } else {
      const email = $("l-email").value.trim().toLowerCase();
      const password = $("l-pass").value;
      await Auth.signIn({ email, password });
      closeOv("auth-overlay");
      await refreshAuth(); loadListings();
      toast("Giriş yapıldı 👋");
    }
  } catch (e) {
    authErr(turkishAuthError(e.message));
  }
}
function turkishAuthError(m = "") {
  if (/already registered/i.test(m)) return "Bu e-posta ile zaten bir hesap var.";
  if (/Invalid login/i.test(m)) return "E-posta veya şifre hatalı.";
  if (/Email not confirmed/i.test(m)) return "Önce e-postanı doğrula (gelen kutunu kontrol et).";
  return m || "Bir hata oluştu.";
}

// ============================================================================
// Kategoriler
// ============================================================================
function renderCategories() {
  $("cats").innerHTML = categories.map(c => `
    <a class="cat" href="#" data-cat="${c.slug}">
      <div class="thumb"><div style="width:100%;height:140px;background:var(--bg-3);display:flex;align-items:center;justify-content:center;color:var(--muted);font-size:12px;">Görsel yakında</div></div>
      <div class="name">${esc(c.name)}</div>
    </a>`).join("");
}
function fillCategorySelects() {
  $("f-cat").innerHTML = categories.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join("");
}

// ============================================================================
// İlan listesi
// ============================================================================
async function loadListings() {
  const grid = $("grid");
  grid.innerHTML = `<p style="color:var(--muted);padding:20px 4px;">Yükleniyor…</p>`;
  try {
    const rows = await Listings.fetchListings({
      category: catFilter, city: $("city").value, q: $("q").value.trim(),
      type: filter, sort: $("sort").value
    });
    curRows = rows;
    $("listings-title").textContent = catFilter ? catName(catFilter) : "Güncel ilanlar";
    if (!rows.length) {
      grid.innerHTML = `<div style="color:var(--muted);padding:28px 4px;grid-column:1/-1;text-align:center;">
        Henüz yayında ilan yok.${profile ? " İlk ilanı sen ver!" : " Üye olup ilk ilanı verebilirsin."}</div>`;
      return;
    }
    grid.innerHTML = rows.map((l, i) => cardHtml(l, i)).join("");
  } catch (e) {
    grid.innerHTML = `<p style="color:var(--red);padding:20px 4px;">İlanlar yüklenemedi. Supabase bağlantısını kontrol et.</p>`;
    console.error(e);
  }
}
function cardHtml(l, i) {
  const free = l.price === 0;
  const cover = l.cover
    ? `<img src="${l.cover}" alt="${esc(l.title)}" loading="lazy">`
    : `<div style="width:100%;height:100%;background:var(--bg-3);display:flex;align-items:center;justify-content:center;color:var(--muted);font-size:13px;">Görsel yok</div>`;
  return `<div class="card" data-i="${i}">
    <div class="photo">${cover}<div class="fav ${favIds.has(l.id) ? "liked" : ""}" data-fav="${l.id}">♥</div></div>
    <div class="body">
      <div class="title">${esc(l.title)}</div>
      <div class="seller">${esc(l.seller?.username || "")}</div>
      <div class="row">
        <div class="info">${sexHtml(l.sex)}<span>${esc(l.age_text || "")}</span></div>
        <div class="price ${free ? "free" : ""}">${free ? "Ücretsiz" : tl(l.price)}</div>
      </div>
      <div class="foot"><span>${esc(l.city || "")} · ${timeAgo(l.created_at)}</span>
        <span class="badge ${free ? "sahiplendirme" : "satis"}">${free ? "Sahiplendirme" : "Satılık"}</span></div>
    </div>
  </div>`;
}

// ============================================================================
// İlan detay
// ============================================================================
function openDetail(i) {
  const l = curRows[i]; if (!l) return; curDetail = l;
  const free = l.price === 0;
  const ph = l.photos.length ? l.photos : [null];
  const sx = l.sex === "m" ? '<span class="sex m">♂ Erkek</span>' : l.sex === "f" ? '<span class="sex f">♀ Dişi</span>' : "Bilinmiyor";
  const mainImg = ph[0] ? `<img id="d-main" src="${ph[0]}" alt="${esc(l.title)}">`
    : `<div id="d-main" style="height:460px;display:flex;align-items:center;justify-content:center;color:var(--muted);">Görsel yok</div>`;
  $("detail").innerHTML = `
    <div class="crumb"><span class="back" id="d-back">← Geri</span> › <span style="color:#fff">${esc(l.title)}</span></div>
    <div class="d-grid">
      <div>
        <div class="d-photo">${mainImg}</div>
        ${ph.length > 1 ? `<div class="d-thumbs">${ph.map((p, j) => `<img src="${p}" class="${j === 0 ? "on" : ""}" data-src="${p}">`).join("")}</div>` : ""}
        <div class="d-desc">${l.description ? "<b>Açıklama:</b> " + esc(l.description) : "Satıcı açıklama eklememiş. Sorularını mesajla iletebilirsin."}</div>
        <div class="d-actions">
          <span id="d-fav" class="${favIds.has(l.id) ? "liked-act" : ""}"><span class="i">♥</span>Favori</span>
          <span id="d-report"><span class="i">⚑</span>Şikayet et</span>
        </div>
      </div>
      <div class="d-info">
        <h1>${esc(l.title)}</h1>
        ${l.species ? `<div class="lat">${esc(l.species)}</div>` : ""}
        <div class="d-price ${free ? "free" : ""}">${free ? "Ücretsiz sahiplendirme" : tl(l.price)}</div>
        <button class="btn btn-primary" id="d-msg">💬 Mesaj gönder</button>
        ${l.whatsapp ? `<button class="btn btn-ghost" id="d-wa"><span style="color:#25D366;font-weight:800">✆</span> WhatsApp'tan yaz</button>` : ""}
        ${l.instagram ? `<button class="btn btn-ghost" id="d-ig"><span style="color:#E1306C;font-weight:800">◉</span> Instagram · @${esc(l.instagram)}</button>` : ""}
        <button class="btn btn-ghost" id="d-fav2">${favIds.has(l.id) ? "♥ Favorilerde" : "♥ Favorilere ekle"}</button>
        <div class="d-specs">
          <div class="sp"><span class="k">Cinsiyet</span><span class="v">${sx}</span></div>
          <div class="sp"><span class="k">Yaş</span><span class="v">${esc(l.age_text || "—")}</span></div>
          ${l.morph ? `<div class="sp"><span class="k">Morph</span><span class="v">${esc(l.morph)}</span></div>` : ""}
          <div class="sp"><span class="k">Konum</span><span class="v">${esc(l.city || "—")}</span></div>
          <div class="sp"><span class="k">Yayın</span><span class="v">${timeAgo(l.created_at)}</span></div>
        </div>
        <div class="seller-card">
          <div class="avatar" id="d-seller-av">${esc((l.seller?.username || "?").slice(0, 2).toUpperCase())}</div>
          <div style="cursor:pointer" id="d-seller"><div class="sn">${esc(l.seller?.username || "")}</div><div class="sl">${esc(l.seller?.city || "")} · profili gör →</div></div>
        </div>
      </div>
    </div>`;
  show("detail");
  // olaylar
  $("d-back").onclick = goHome;
  $("d-report").onclick = () => openReport(l);
  $("d-msg").onclick = () => openChat(l.seller?.id, l.seller?.username, l.title);
  $("d-fav").onclick = $("d-fav2").onclick = () => toggleFav(l);
  const wa = $("d-wa"); if (wa) wa.onclick = () => window.open("https://wa.me/" + l.whatsapp.replace(/[^\d]/g, "").replace(/^0/, "90") + "?text=" + encodeURIComponent(l.title + " ilanı hakkında"), "_blank");
  const ig = $("d-ig"); if (ig) ig.onclick = () => window.open("https://instagram.com/" + l.instagram, "_blank");
  $("d-seller").onclick = () => openProfile(l.seller?.id, l.seller?.username);
  document.querySelectorAll("#detail .d-thumbs img").forEach(im => im.onclick = () => {
    $("d-main").src = im.dataset.src;
    document.querySelectorAll("#detail .d-thumbs img").forEach(x => x.classList.remove("on")); im.classList.add("on");
  });
}

// ============================================================================
// Favori
// ============================================================================
async function toggleFav(l) {
  if (!profile) return openAuth("login", "Favorilere eklemek için giriş yapmalısın.");
  try {
    const nowFav = await Favorites.toggleFavorite(l.id);
    if (nowFav) favIds.add(l.id); else favIds.delete(l.id);
    toast(nowFav ? "Favorilere eklendi ♥" : "Favorilerden çıkarıldı");
    if ($("detail").classList.contains("open")) openDetail(curRows.indexOf(l));
    document.querySelectorAll(`[data-fav="${l.id}"]`).forEach(el => el.classList.toggle("liked", nowFav));
  } catch (e) { toast("İşlem başarısız"); }
}

// ============================================================================
// İlan ver
// ============================================================================
let photos = [], selSex = "";
function openNew() {
  if (!profile) return openAuth("register", "İlan vermek için önce üye olmalısın.");
  openOv("overlay");
}
function pickSex(v, btn) { selSex = v; document.querySelectorAll("#f-sex button").forEach(b => b.className = ""); btn.className = "sel-" + v; }
function addPhotos(files) {
  for (const f of files) { if (photos.length >= 5) break; if (f.type.startsWith("image/")) photos.push(f); }
  drawPreviews();
}
function drawPreviews() {
  $("previews").innerHTML = photos.map((f, i) => `<div class="pv"><img src="${URL.createObjectURL(f)}"><div class="rm" data-rm="${i}">✕</div></div>`).join("");
}
async function submitListing() {
  const title = $("f-title").value.trim(), age = $("f-age").value.trim();
  const err = $("f-err");
  if (!title || !age || !selSex || !photos.length) { err.textContent = "Tür, cinsiyet, yaş ve en az bir fotoğraf zorunlu."; err.style.display = "block"; return; }
  err.style.display = "none";
  const btn = $("f-submit"); btn.disabled = true; btn.textContent = "Gönderiliyor…";
  try {
    const yr = /^\d{4}$/.test(age) ? parseInt(age) : null;
    await Listings.createListing({
      category_id: parseInt($("f-cat").value),
      title, species: title, sex: selSex, age_text: age, birth_year: yr,
      price: parseInt($("f-price").value) || 0, city: $("f-city").value,
      description: $("f-desc").value.trim(),
      whatsapp: $("f-wa").checked ? $("f-wanum").value.trim() : null,
      instagram: $("f-ig").value.trim().replace(/^@/, "") || null
    }, photos);
    closeOv("overlay");
    photos = []; selSex = ""; drawPreviews();
    ["f-title", "f-age", "f-price", "f-desc", "f-wanum", "f-ig"].forEach(id => $(id).value = "");
    $("f-wa").checked = false; document.querySelectorAll("#f-sex button").forEach(b => b.className = "");
    toast("İlanın alındı ✓ Moderasyon onayından sonra yayınlanacak.");
  } catch (e) {
    err.textContent = "Gönderilemedi: " + (e.message || "hata"); err.style.display = "block"; console.error(e);
  } finally { btn.disabled = false; btn.textContent = "İlanı gönder"; }
}

// ============================================================================
// Şikayet
// ============================================================================
function openReport(l) {
  if (!profile) return openAuth("login", "Şikayet için giriş yapmalısın.");
  $("report-overlay").dataset.lid = l.id;
  $("report-sub").textContent = `"${l.title}" ilanını şikayet ediyorsun.`;
  openOv("report-overlay");
}
async function submitReport() {
  try {
    await Reports.createReport({ listingId: $("report-overlay").dataset.lid, reason: $("rp-reason").value, detail: $("rp-desc").value.trim() });
    closeOv("report-overlay"); $("rp-desc").value = "";
    toast("Şikayetin alındı ⚑");
  } catch (e) { toast("Gönderilemedi"); }
}

// ============================================================================
// Mesajlaşma
// ============================================================================
async function openInbox() {
  if (!profile) return openAuth("login", "Mesajların için giriş yap.");
  chatWith = null;
  $("chat-body").style.display = "none"; $("chat-input-row").style.display = "none";
  $("inbox").style.display = "block";
  $("chat-head").innerHTML = `<div><div class="cn">Mesajlar</div><div class="cl">Site içi güvenli mesajlaşma</div></div><span class="x" id="ch-x">✕</span>`;
  $("ch-x").onclick = () => closeOv("chat") || $("chat").classList.remove("open");
  const inbox = await Messages.fetchInbox();
  $("inbox").innerHTML = inbox.length ? inbox.map(t => `
    <div class="ib-row" data-oid="${t.otherId}" data-oname="${esc(t.otherName)}">
      <div class="avatar">${esc(t.otherName.slice(0, 2).toUpperCase())}</div>
      <div><div class="ibn">${esc(t.otherName)}</div><div class="ibl">${esc(t.last)}</div></div>
      ${t.unread ? `<div class="ibu">${t.unread}</div>` : ""}
    </div>`).join("") : `<div class="ib-empty">Henüz mesajın yok.<br>Bir ilana girip "Mesaj gönder" ile başla.</div>`;
  $("inbox").querySelectorAll(".ib-row").forEach(r => r.onclick = () => openChat(r.dataset.oid, r.dataset.oname));
  $("chat").classList.add("open");
}
async function openChat(otherId, otherName, listingTitle) {
  if (!profile) return openAuth("login", "Mesaj göndermek için giriş yap.");
  if (!otherId) return toast("Satıcı bilgisi bulunamadı");
  if (otherId === profile.id) return toast("Kendine mesaj gönderemezsin");
  chatWith = { id: otherId, name: otherName || "kullanıcı", listingTitle };
  $("inbox").style.display = "none"; $("chat-body").style.display = "flex"; $("chat-input-row").style.display = "flex";
  $("chat-head").innerHTML = `<span class="bk" id="ch-back">←</span><div class="avatar">${esc((otherName || "?").slice(0, 2).toUpperCase())}</div>
    <div><div class="cn">${esc(otherName || "")}</div><div class="cl">${esc(listingTitle || "")}</div></div><span class="x" id="ch-x">✕</span>`;
  $("ch-back").onclick = openInbox;
  $("ch-x").onclick = () => $("chat").classList.remove("open");
  await drawThread();
  $("chat").classList.add("open");
  $("chat-input").focus();
}
async function drawThread() {
  const msgs = await Messages.fetchThread(chatWith.id);
  const body = $("chat-body");
  body.innerHTML = (chatWith.listingTitle ? `<div class="ctx">İlan: ${esc(chatWith.listingTitle)}</div>` : "")
    + msgs.map(m => `<div class="bubble ${m.me ? "me" : "them"}">${esc(m.body)}<span class="bt">${new Date(m.created_at).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}</span></div>`).join("");
  body.scrollTop = body.scrollHeight;
}
async function sendChat() {
  const inp = $("chat-input"), txt = inp.value.trim();
  if (!txt || !chatWith) return;
  inp.value = "";
  try { await Messages.sendMessage({ recipientId: chatWith.id, listingId: null, body: txt }); await drawThread(); }
  catch (e) { toast("Mesaj gönderilemedi"); }
}

// ============================================================================
// Satıcı profili
// ============================================================================
async function openProfile(sellerId, sellerName) {
  if (!sellerId) return;
  const rows = await Listings.fetchListings({ sellerId });
  curRows = rows;
  const { data: revs } = await supabase.from("reviews")
    .select("rating, body, created_at, author:profiles!reviews_author_id_fkey(username)")
    .eq("seller_id", sellerId).order("created_at", { ascending: false });
  const avg = revs && revs.length ? (revs.reduce((a, r) => a + r.rating, 0) / revs.length) : 0;
  const stars = n => "★".repeat(n) + "☆".repeat(5 - n);
  $("page").innerHTML = `
    <div class="crumb"><span class="back" id="p-back">← Geri</span> › <span style="color:#fff">${esc(sellerName || "")}</span></div>
    <div class="profile-head">
      <div class="avatar">${esc((sellerName || "?").slice(0, 2).toUpperCase())}</div>
      <div><div class="pn">${esc(sellerName || "")}</div><div class="pl">${revs?.length || 0} yorum</div></div>
      <div class="profile-stats"><div class="ps"><div class="v">${rows.length}</div><div class="l">Aktif ilan</div></div>
        <div class="ps"><div class="v">${revs?.length ? avg.toFixed(1) : "—"} <span class="stars">★</span></div><div class="l">puan</div></div></div>
    </div>
    <h2 style="font-size:20px;margin:26px 0 14px;">İlanları (${rows.length})</h2>
    <div class="grid">${rows.length ? rows.map((l, i) => cardHtml(l, i)).join("") : '<p style="color:var(--muted)">Aktif ilanı yok.</p>'}</div>
    <h2 style="font-size:20px;margin:20px 0 14px;">Yorumlar</h2>
    ${(revs || []).map(r => `<div class="review"><div class="stars">${stars(r.rating)}</div><div class="rt">${esc(r.body || "")}</div><div style="font-size:12px;color:var(--muted);margin-top:4px;">${esc(r.author?.username || "")}</div></div>`).join("") || '<p style="color:var(--muted);font-size:14px;">Henüz yorum yok.</p>'}
    ${profile && profile.id !== sellerId ? `<div class="rv-form">
      <div style="font-weight:700;">Yorum yaz</div>
      <select id="rv-stars"><option value="5">★★★★★</option><option value="4">★★★★☆</option><option value="3">★★★☆☆</option><option value="2">★★☆☆☆</option><option value="1">★☆☆☆☆</option></select>
      <textarea id="rv-text" rows="3" placeholder="Deneyimini yaz..."></textarea>
      <button class="btn btn-primary" id="rv-send" style="align-self:flex-start">Gönder</button></div>` : ""}`;
  show("page");
  $("p-back").onclick = goHome;
  const rs = $("rv-send"); if (rs) rs.onclick = async () => {
    const body = $("rv-text").value.trim(); if (!body) return toast("Yorum boş olamaz");
    const { error } = await supabase.from("reviews").insert({ seller_id: sellerId, author_id: profile.id, rating: parseInt($("rv-stars").value), body });
    if (error) return toast("Gönderilemedi (belki daha önce yorum yaptın)");
    toast("Yorumun eklendi ★"); openProfile(sellerId, sellerName);
  };
}

// ============================================================================
// Bakım rehberleri + statik sayfalar
// ============================================================================
async function openGuides() {
  const gs = await Guides.fetchGuides();
  const groups = [["Kertenkeleler & geckolar", "kertenkele"], ["Yılanlar", "yilan"], ["Kaplumbağalar", "kaplumbaga"], ["Amfibiler", "amfibi"], ["Eklem bacaklılar", "eklem"], ["Egzotik memeliler", "memeli"], ["Egzotik kuşlar", "kus"]];
  let html = `<div class="crumb"><span class="back" id="g-back">← Ana sayfa</span> › <span style="color:#fff">Bakım rehberleri</span></div>
    <div class="article"><h1>Egzotik Hayvan Bakım Rehberleri</h1>
    <p class="lead"><b>${gs.length} türün</b> beslenmesi, teraryum/kafes kurulumu, sıcaklık-nem ihtiyaçları, ömrü ve yasal durumu. Görseller yakında eklenecek.</p>`;
  for (const [title, key] of groups) {
    const items = gs.filter(g => g.category_slug === key);
    if (!items.length) continue;
    html += `<h2 style="font-size:19px;margin:28px 0 4px;">${title} <span style="font-size:14px;color:var(--muted);font-weight:400;">(${items.length})</span></h2><div class="guide-grid">`;
    html += items.map(g => `<div class="g-card" data-guide="${g.slug}">
      <div class="gp">${g.image ? `<img src="${g.image}" alt="${esc(g.name)}">` : `<div style="width:100%;height:130px;background:var(--bg-3);display:flex;align-items:center;justify-content:center;color:var(--muted);font-size:12px;">Görsel yakında</div>`}</div>
      <div class="gb"><div class="gn">${esc(g.name)}</div><div class="gl">${esc(g.latin || "")}</div><span class="lvl ${/İleri|Yasak/.test(g.level || "") ? "ileri" : ""}">${esc(g.level || "")}</span></div>
    </div>`).join("");
    html += `</div>`;
  }
  $("page").innerHTML = html + `</div>`;
  show("page");
  $("g-back").onclick = goHome;
  $("page").querySelectorAll("[data-guide]").forEach(c => c.onclick = () => openGuide(c.dataset.guide));
}
async function openGuide(slug) {
  const g = await Guides.fetchGuide(slug);
  const body = (Array.isArray(g.body) ? g.body : []).map(p => `<p>${esc(p)}</p>`).join("");
  const tips = (Array.isArray(g.tips) ? g.tips : []).map(t => `<li>${esc(t)}</li>`).join("");
  $("page").innerHTML = `
    <div class="crumb"><span class="back" id="g-back">← Rehberler</span> › <span style="color:#fff">${esc(g.name)}</span></div>
    <div class="article">
      <h1>${esc(g.name)} Bakımı</h1>
      <p class="lead"><i>${esc(g.latin || "")}</i> · Zorluk: <span class="lvl ${/İleri|Yasak/.test(g.level || "") ? "ileri" : ""}">${esc(g.level || "")}</span></p>
      <div class="d-photo" style="max-width:800px">${g.image ? `<img src="${g.image}" style="height:320px;width:100%;object-fit:cover;">` : `<div style="height:260px;display:flex;align-items:center;justify-content:center;color:var(--muted);">Görsel yakında eklenecek</div>`}</div>
      <table class="spec-table">
        <tr><td>Bilimsel adı</td><td><i>${esc(g.latin || "—")}</i></td></tr>
        <tr><td>Ömür</td><td>${esc(g.lifespan || "—")}</td></tr>
        <tr><td>Boy</td><td>${esc(g.size || "—")}</td></tr>
        <tr><td>Yaşam alanı</td><td>${esc(g.habitat || "—")}</td></tr>
        <tr><td>Sıcaklık</td><td>${esc(g.temperature || "—")}</td></tr>
        <tr><td>Nem</td><td>${esc(g.humidity || "—")}</td></tr>
        <tr><td>Beslenme</td><td>${esc(g.diet || "—")}</td></tr>
      </table>
      <h2>Tür hakkında</h2>${body}
      <h2>Püf noktaları</h2><ul>${tips}</ul>
      <div class="note">Bu rehber genel bilgilendirme amaçlıdır, veteriner tavsiyesi değildir.</div>
    </div>`;
  show("page");
  $("g-back").onclick = openGuides;
  window.scrollTo({ top: 0 });
}

const STATIC = {
  hakkinda: ["Hakkımızda", "<p>SürüngenMarket, Türkiye'nin egzotik hayvan topluluğunu güvenli ve yasal bir çatı altında buluşturmak için kuruldu. Her ilan moderasyondan geçer; ücretsiz sahiplendirme her zaman önceliklidir.</p>"],
  guvenlik: ["Güvenlik İpuçları", "<ul><li>Hayvanı görmeden ödeme yapma.</li><li>Elden teslimi tercih et, güvenli noktada buluş.</li><li>Sağlık kontrolü ve üretim belgesi iste.</li><li>Site içi mesajlaşmada kal.</li></ul>"],
  iletisim: ["İletişim", "<p>Soru ve önerilerin için: <a href='mailto:destek@surungenmarket.com'>destek@surungenmarket.com</a></p>"],
  kosullar: ["Kullanım Koşulları", "<p>SürüngenMarket ilan yayınlayan bir aracı platformdur; taraflar arası işlemlerin tarafı değildir. Yasaklı ve izne tabi türlerin ilanı yayınlanamaz. Üyeler 18 yaşından büyük olmalıdır.</p>"],
  gizlilik: ["Gizlilik Politikası", "<p>Kişisel verilerin 6698 sayılı KVKK kapsamında korunur. Toplanan veriler yalnızca hizmetin işleyişi ve güvenlik için kullanılır, pazarlama amacıyla üçüncü taraflara satılmaz.</p>"],
  yasakli: ["Yasaklı ve İzne Tabi Türler", "<p>Zehirli yılanlar, timsahlar, doğadan toplanmış yerli türler (ör. Yunan/çizgili kaplumbağa) ve istilacı türler (kırmızı yanaklı su kaplumbağası) yasaktır. CITES kapsamındaki türler (jako papağanı, birçok kaplumbağa) izne tabidir.</p><div class='note warn'>Bu sayfa genel bilgilendirme amaçlıdır, hukuki danışmanlık değildir.</div>"]
};
function openStatic(key) {
  const s = STATIC[key]; if (!s) return;
  $("page").innerHTML = `<div class="crumb"><span class="back" id="s-back">← Ana sayfa</span> › <span style="color:#fff">${s[0]}</span></div><div class="article"><h1>${s[0]}</h1>${s[1]}</div>`;
  show("page");
  $("s-back").onclick = goHome;
}

// ============================================================================
// Görünüm yönetimi
// ============================================================================
function show(which) {
  $("home").style.display = which === "home" ? "" : "none";
  $("detail").classList.toggle("open", which === "detail");
  $("page").classList.toggle("open", which === "page");
  window.scrollTo({ top: 0 });
}
function goHome() { show("home"); $("ilanlar")?.scrollIntoView({ behavior: "smooth" }); }

// ============================================================================
// Olaylar
// ============================================================================
function wireEvents() {
  $("btn-login").onclick = () => openAuth("login");
  $("btn-register").onclick = $("hero-register").onclick = () => openAuth("register");
  $("btn-logout").onclick = async () => { await Auth.signOut(); await refreshAuth(); loadListings(); toast("Çıkış yapıldı"); };
  $("btn-new").onclick = openNew;
  $("msg-btn").onclick = openInbox;
  $("logo").onclick = () => show("home");
  $("hero-browse").onclick = () => $("ilanlar").scrollIntoView({ behavior: "smooth" });
  $("user-chip").onclick = () => profile && openProfile(profile.id, profile.username);

  // auth modal
  $("tab-login").onclick = () => switchTab("login");
  $("tab-register").onclick = () => switchTab("register");
  $("auth-cancel").onclick = () => closeOv("auth-overlay");
  $("auth-submit").onclick = doAuthSubmit;
  $("l-pass").addEventListener("keydown", e => e.key === "Enter" && doAuthSubmit());
  $("r-pass").addEventListener("keydown", e => e.key === "Enter" && doAuthSubmit());
  $("forgot").onclick = async e => {
    e.preventDefault();
    const email = $("l-email").value.trim();
    if (!email) return authErr("Önce e-posta adresini yaz.");
    try { await Auth.sendPasswordReset(email); toast("Şifre sıfırlama bağlantısı e-postana gönderildi ✉"); closeOv("auth-overlay"); }
    catch { authErr("Gönderilemedi."); }
  };

  // ilan ver modal
  $("f-cancel").onclick = () => closeOv("overlay");
  $("f-submit").onclick = submitListing;
  document.querySelectorAll("#f-sex button").forEach(b => b.onclick = () => pickSex(b.dataset.v, b));
  $("upload").onclick = () => $("f-photos").click();
  $("f-photos").onchange = e => { addPhotos(e.target.files); e.target.value = ""; };
  $("upload").addEventListener("dragover", e => { e.preventDefault(); $("upload").classList.add("drag"); });
  $("upload").addEventListener("dragleave", () => $("upload").classList.remove("drag"));
  $("upload").addEventListener("drop", e => { e.preventDefault(); $("upload").classList.remove("drag"); addPhotos(e.dataTransfer.files); });
  $("previews").onclick = e => { const i = e.target.dataset?.rm; if (i != null) { photos.splice(+i, 1); drawPreviews(); } };

  // şikayet
  $("rp-cancel").onclick = () => closeOv("report-overlay");
  $("rp-submit").onclick = submitReport;

  // chat send
  $("chat-send").onclick = sendChat;
  $("chat-input").addEventListener("keydown", e => e.key === "Enter" && sendChat());

  // filtreler
  document.querySelectorAll(".chip").forEach(c => c.onclick = () => {
    document.querySelectorAll(".chip").forEach(x => x.classList.remove("active"));
    c.classList.add("active"); filter = c.dataset.f; loadListings();
  });
  $("city").onchange = loadListings;
  $("sort").onchange = loadListings;
  let qTimer; $("q").addEventListener("input", () => { clearTimeout(qTimer); qTimer = setTimeout(loadListings, 350); });

  // grid tıklama (kart / favori)
  $("grid").addEventListener("click", e => {
    const fav = e.target.closest("[data-fav]");
    if (fav) { const l = curRows.find(x => x.id === fav.dataset.fav); if (l) toggleFav(l); return; }
    const card = e.target.closest(".card"); if (card) openDetail(+card.dataset.i);
  });
  $("page").addEventListener("click", e => {
    const card = e.target.closest(".card"); if (card) openDetail(+card.dataset.i);
  });

  // kategori & sayfa linkleri (nav, footer, kategori kartları)
  document.body.addEventListener("click", e => {
    const a = e.target.closest("[data-cat],[data-page]");
    if (!a) return;
    e.preventDefault();
    if (a.dataset.page === "rehberler") return openGuides();
    if (a.dataset.page) return openStatic(a.dataset.page);
    if (a.dataset.cat !== undefined) { catFilter = a.dataset.cat; show("home"); loadListings(); $("ilanlar").scrollIntoView({ behavior: "smooth" }); }
  });

  // overlay dışına tıklayınca kapat
  ["overlay", "auth-overlay", "report-overlay"].forEach(id => $(id).addEventListener("click", e => { if (e.target.id === id) closeOv(id); }));
  document.addEventListener("keydown", e => { if (e.key === "Escape") { ["overlay", "auth-overlay", "report-overlay"].forEach(closeOv); $("chat").classList.remove("open"); } });
}

function revealOnScroll() {
  const io = new IntersectionObserver(es => es.forEach(x => { if (x.isIntersecting) { x.target.classList.add("in"); io.unobserve(x.target); } }), { threshold: .08 });
  document.querySelectorAll(".reveal").forEach(el => io.observe(el));
}
