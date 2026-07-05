// Supabase istemcisi — tüm modüller buradan içe aktarır.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

if (SUPABASE_URL.startsWith("BURAYA") || SUPABASE_ANON_KEY.startsWith("BURAYA")) {
  console.warn("[SürüngenMarket] js/config.js içindeki Supabase bilgilerini doldurmalısın.");
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});

// 'listing-images' bucket'ındaki bir yolu tam public URL'ye çevirir
export function publicImage(path) {
  if (!path) return null;
  return supabase.storage.from("listing-images").getPublicUrl(path).data.publicUrl;
}
