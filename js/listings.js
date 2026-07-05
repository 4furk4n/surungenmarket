// ============================================================================
// İlan sistemi — listeleme, detay, oluşturma + Storage'a fotoğraf yükleme
// ============================================================================
import { supabase, publicImage } from "./supabase.js";
import { currentUser } from "./auth.js";

const SELECT = `
  id, title, species, morph, sex, age_text, birth_year, price, city, description,
  whatsapp, instagram, status, created_at, category_id,
  seller:profiles!listings_user_id_fkey ( id, username, city, role ),
  images:listing_images ( storage_path, position )
`;

function shape(row) {
  const imgs = (row.images || []).sort((a, b) => a.position - b.position)
    .map(i => publicImage(i.storage_path));
  return { ...row, photos: imgs, cover: imgs[0] || null };
}

// Yayındaki ilanlar (filtrelerle)
export async function fetchListings({ category = "", city = "", q = "", type = "all", sort = "new", sellerId = "" } = {}) {
  let query = supabase.from("listings").select(SELECT).eq("status", "active");
  if (sellerId) query = query.eq("user_id", sellerId);
  if (city) query = query.eq("city", city);
  if (type === "sahiplendirme") query = query.eq("price", 0);
  if (type === "satis") query = query.gt("price", 0);
  if (category) {
    const { data: cat } = await supabase.from("categories").select("id").eq("slug", category).single();
    if (cat) query = query.eq("category_id", cat.id);
  }
  if (sort === "cheap") query = query.order("price", { ascending: true });
  else if (sort === "exp") query = query.order("price", { ascending: false });
  else query = query.order("created_at", { ascending: false });

  let { data, error } = await query.limit(200);
  if (error) throw error;
  let rows = (data || []).map(shape);
  if (q) {
    const s = q.toLowerCase();
    rows = rows.filter(r => (r.title + " " + (r.city || "") + " " + (r.seller?.username || "")).toLowerCase().includes(s));
  }
  return rows;
}

export async function fetchListing(id) {
  const { data, error } = await supabase.from("listings").select(SELECT).eq("id", id).single();
  if (error) throw error;
  return shape(data);
}

// Yeni ilan oluştur + fotoğrafları Storage'a yükle
// files: File[]  (input[type=file] .files)
export async function createListing(fields, files) {
  const user = await currentUser();
  if (!user) throw new Error("Giriş yapmalısın.");

  // 1) ilan satırını 'pending' olarak ekle
  const { data: listing, error } = await supabase.from("listings").insert({
    user_id: user.id,
    category_id: fields.category_id || null,
    title: fields.title,
    species: fields.species || null,
    morph: fields.morph || null,
    sex: fields.sex || null,
    age_text: fields.age_text || null,
    birth_year: fields.birth_year || null,
    price: fields.price || 0,
    city: fields.city || null,
    description: fields.description || null,
    whatsapp: fields.whatsapp || null,
    instagram: fields.instagram || null,
    status: "pending"
  }).select("id").single();
  if (error) throw error;

  // 2) fotoğrafları uid/listingId/... yoluna yükle, listing_images'a kaydet
  const imageRows = [];
  for (let i = 0; i < files.length && i < 5; i++) {
    const f = files[i];
    const ext = (f.name.split(".").pop() || "jpg").toLowerCase();
    const path = `${user.id}/${listing.id}/${i}-${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage.from("listing-images")
      .upload(path, f, { cacheControl: "3600", upsert: false });
    if (upErr) throw upErr;
    imageRows.push({ listing_id: listing.id, storage_path: path, position: i });
  }
  if (imageRows.length) {
    const { error: imgErr } = await supabase.from("listing_images").insert(imageRows);
    if (imgErr) throw imgErr;
  }
  return listing.id;
}

// Giriş yapan kullanıcının kendi ilanları (her durumda)
export async function myListings() {
  const user = await currentUser();
  if (!user) return [];
  const { data, error } = await supabase.from("listings").select(SELECT)
    .eq("user_id", user.id).order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []).map(shape);
}
