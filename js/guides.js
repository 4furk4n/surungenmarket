// Bakım rehberleri — içerik veritabanından okunur (görseller placeholder)
import { supabase, publicImage } from "./supabase.js";

export async function fetchGuides() {
  const { data, error } = await supabase.from("guides")
    .select("slug,name,latin,category_slug,level,image_path,legal_warning,sort")
    .order("sort", { ascending: true });
  if (error) { console.warn(error); return []; }
  return (data || []).map(g => ({ ...g, image: g.image_path ? publicImage(g.image_path) : null }));
}

export async function fetchGuide(slug) {
  const { data, error } = await supabase.from("guides").select("*").eq("slug", slug).single();
  if (error) throw error;
  return { ...data, image: data.image_path ? publicImage(data.image_path) : null };
}
