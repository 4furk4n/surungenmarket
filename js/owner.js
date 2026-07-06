// ============================================================================
// "İlanlarım" — kullanıcının kendi ilanlarını düzenlemesi / silmesi
// (js/ klasörüne ek dosya yazılamadığı için kök seviyede ayrı modül;
//  çalışma zamanında js/supabase.js ile aynı Supabase istemcisini paylaşır.)
// ============================================================================
import { supabase, publicImage } from "./js/supabase.js";

const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c]));
const tl = n => Number(n).toLocaleString("tr-TR") + " ₺";
const STATUS_TR = { pending:"Beklemede", active:"Yayında", sold:"Satıldı", removed:"Kaldırıldı" };
let categories = [];
let meId = null;

boot();
async function boot() {
  const { data:{ user } } = await supabase.auth.getUser();
  meId = user ? user.id : null;
  const { data:cats } = await supabase.from("categories").select("id,slug,name").order("sort");
  categories = cats || [];
  injectButton();
  supabase.auth.onAuthStateChange((_e, session) => { meId = session ? session.user.id : null; injectButton(); });
}

// Üst bardaki "Çıkış" butonunun yanına "İlanlarım" ekle
function injectButton() {
  const holder = document.getElementById("auth-in");
  if (!holder) return;
  let btn = document.getElementById("btn-mylistings");
  if (meId && !btn) {
    btn = document.createElement("button");
    btn.id = "btn-mylistings";
    btn.className = "btn btn-ghost";
    btn.textContent = "İlanlarım";
    btn.onclick = openPanel;
    holder.insertBefore(btn, holder.firstChild);
  }
}

// ---- panel (kendi overlay'i) ----
function ensureOverlay() {
  let ov = document.getElementById("my-overlay");
  if (ov) return ov;
  ov = document.createElement("div");
  ov.id = "my-overlay";
  ov.className = "overlay";
  ov.innerHTML = `<div class="modal" style="max-width:640px">
    <h2>İlanlarım</h2>
    <p class="sub">Kendi ilanlarını buradan düzenleyebilir veya silebilirsin.</p>
    <div id="my-list" style="display:flex;flex-direction:column;gap:10px;max-height:60vh;overflow-y:auto;"></div>
    <div class="actions" style="margin-top:18px"><button class="btn btn-cancel" id="my-close">Kapat</button></div>
  </div>`;
  document.body.appendChild(ov);
  ov.addEventListener("click", e => { if (e.target.id === "my-overlay") ov.classList.remove("open"); });
  ov.querySelector("#my-close").onclick = () => ov.classList.remove("open");
  return ov;
}

async function openPanel() {
  const ov = ensureOverlay();
  ov.classList.add("open");
  const list = ov.querySelector("#my-list");
  list.innerHTML = `<p style="color:var(--muted)">Yükleniyor…</p>`;
  const { data, error } = await supabase.from("listings")
    .select("id,title,price,status,city,category_id,sex,age_text,description,images:listing_images(storage_path,position)")
    .eq("user_id", meId).order("created_at", { ascending:false });
  if (error) { list.innerHTML = `<p style="color:var(--red)">Yüklenemedi: ${esc(error.message)}</p>`; return; }
  if (!data.length) { list.innerHTML = `<p style="color:var(--muted)">Henüz ilanın yok. Üstteki "+ İlan ver" ile ekleyebilirsin.</p>`; return; }
  window._my = {}; data.forEach(l => window._my[l.id] = l);
  list.innerHTML = data.map(l => {
    const img = (l.images||[]).sort((a,b)=>a.position-b.position)[0];
    const cover = img ? `<img src="${publicImage(img.storage_path)}" style="width:56px;height:44px;object-fit:cover;border-radius:8px;">`
                      : `<div style="width:56px;height:44px;border-radius:8px;background:var(--bg-3);"></div>`;
    return `<div style="display:flex;align-items:center;gap:12px;background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:10px 12px;">
      ${cover}
      <div style="flex:1;min-width:0">
        <div style="font-size:14px;font-weight:600;">${esc(l.title)}</div>
        <div style="font-size:12px;color:var(--muted);">${l.price===0?"Ücretsiz":tl(l.price)} · ${esc(STATUS_TR[l.status]||l.status)} · ${esc(l.city||"")}</div>
      </div>
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
  toast("İlan silindi");
  openPanel();
  if (window.__reloadListings) window.__reloadListings();
}

// ---- düzenleme modalı ----
function ensureEdit() {
  let ov = document.getElementById("myedit-overlay");
  if (ov) return ov;
  ov = document.createElement("div");
  ov.id = "myedit-overlay";
  ov.className = "overlay";
  ov.innerHTML = `<div class="modal" style="max-width:520px">
    <h2>İlanı düzenle</h2>
    <div class="form-grid">
      <div class="field full"><label>Başlık / tür</label><input id="me-title"></div>
      <div class="field"><label>Kategori</label><select id="me-cat"></select></div>
      <div class="field"><label>Durum</label><select id="me-status">
        <option value="active">Yayında</option><option value="pending">Beklemede</option><option value="sold">Satıldı</option><option value="removed">Kaldırıldı</option>
      </select></div>
      <div class="field"><label>Fiyat (₺, 0 = ücretsiz)</label><input id="me-price" type="number" min="0"></div>
      <div class="field"><label>Şehir</label><input id="me-city"></div>
      <div class="field"><label>Cinsiyet</label><select id="me-sex"><option value="m">Erkek</option><option value="f">Dişi</option><option value="x">Bilinmiyor</option></select></div>
      <div class="field"><label>Yaş</label><input id="me-age"></div>
      <div class="field full"><label>Açıklama</label><textarea id="me-desc" rows="3"></textarea></div>
    </div>
    <div class="actions"><button class="btn btn-cancel" id="me-cancel">Vazgeç</button><button class="btn btn-primary" id="me-save">Kaydet</button></div>
  </div>`;
  document.body.appendChild(ov);
  ov.querySelector("#me-cat").innerHTML = categories.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join("");
  ov.addEventListener("click", e => { if (e.target.id === "myedit-overlay") ov.classList.remove("open"); });
  ov.querySelector("#me-cancel").onclick = () => ov.classList.remove("open");
  return ov;
}

let editId = null;
function openEdit(l) {
  const ov = ensureEdit();
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
    ov.classList.remove("open");
    toast("İlan güncellendi ✓");
    openPanel();
    if (window.__reloadListings) window.__reloadListings();
  };
  ov.classList.add("open");
}

// basit toast (app.js'inki yoksa da çalışsın)
function toast(m) {
  let t = document.getElementById("toast");
  if (!t) { t = document.createElement("div"); t.id = "toast"; t.className = "toast"; document.body.appendChild(t); }
  t.textContent = m; t.style.display = "block";
  clearTimeout(t._h); t._h = setTimeout(() => t.style.display = "none", 2600);
}
