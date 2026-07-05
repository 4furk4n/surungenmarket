// Şikayet — veritabanına kaydedilir (RLS: yalnız kendi şikayetini görürsün)
import { supabase } from "./supabase.js";
import { currentUser } from "./auth.js";

export async function createReport({ listingId, reason, detail }) {
  const user = await currentUser();
  if (!user) throw new Error("Giriş gerekli");
  const { error } = await supabase.from("reports").insert({
    listing_id: listingId || null, reporter_id: user.id, reason, detail: detail || null
  });
  if (error) throw error;
}
