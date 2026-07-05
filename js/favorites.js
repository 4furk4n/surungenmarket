// Favoriler — kullanıcıya özel (RLS ile korunur)
import { supabase } from "./supabase.js";
import { currentUser } from "./auth.js";

export async function myFavoriteIds() {
  const user = await currentUser();
  if (!user) return new Set();
  const { data, error } = await supabase.from("favorites").select("listing_id").eq("user_id", user.id);
  if (error) { console.warn(error); return new Set(); }
  return new Set((data || []).map(r => r.listing_id));
}

export async function toggleFavorite(listingId) {
  const user = await currentUser();
  if (!user) throw new Error("Giriş gerekli");
  const { data: exist } = await supabase.from("favorites")
    .select("listing_id").eq("user_id", user.id).eq("listing_id", listingId).maybeSingle();
  if (exist) {
    await supabase.from("favorites").delete().eq("user_id", user.id).eq("listing_id", listingId);
    return false;
  } else {
    await supabase.from("favorites").insert({ user_id: user.id, listing_id: listingId });
    return true;
  }
}
