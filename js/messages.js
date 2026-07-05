// Mesajlaşma — gerçek kullanıcılar arası, veritabanına kayıtlı (RLS korumalı)
import { supabase } from "./supabase.js";
import { currentUser } from "./auth.js";

// Bir satıcıya mesaj gönder
export async function sendMessage({ recipientId, listingId, body }) {
  const user = await currentUser();
  if (!user) throw new Error("Giriş gerekli");
  const { error } = await supabase.from("messages").insert({
    sender_id: user.id, recipient_id: recipientId, listing_id: listingId || null, body
  });
  if (error) throw error;
}

// İki kullanıcı arasındaki tüm mesajlar (zaman sıralı)
export async function fetchThread(otherId) {
  const user = await currentUser();
  if (!user) return [];
  const { data, error } = await supabase.from("messages")
    .select("*")
    .or(`and(sender_id.eq.${user.id},recipient_id.eq.${otherId}),and(sender_id.eq.${otherId},recipient_id.eq.${user.id})`)
    .order("created_at", { ascending: true });
  if (error) { console.warn(error); return []; }
  return (data || []).map(m => ({ ...m, me: m.sender_id === user.id }));
}

// Gelen kutusu — konuştuğun kişilerin listesi + son mesaj
export async function fetchInbox() {
  const user = await currentUser();
  if (!user) return [];
  const { data, error } = await supabase.from("messages")
    .select("id, sender_id, recipient_id, body, created_at, read_at, sender:profiles!messages_sender_id_fkey(username), recipient:profiles!messages_recipient_id_fkey(username)")
    .or(`sender_id.eq.${user.id},recipient_id.eq.${user.id}`)
    .order("created_at", { ascending: false }).limit(300);
  if (error) { console.warn(error); return []; }
  const threads = new Map();
  for (const m of data || []) {
    const otherId = m.sender_id === user.id ? m.recipient_id : m.sender_id;
    const otherName = m.sender_id === user.id ? m.recipient?.username : m.sender?.username;
    if (!threads.has(otherId)) {
      threads.set(otherId, {
        otherId, otherName: otherName || "kullanıcı", last: m.body, at: m.created_at,
        unread: 0
      });
    }
    const t = threads.get(otherId);
    if (m.recipient_id === user.id && !m.read_at) t.unread++;
  }
  return [...threads.values()];
}

// Canlı dinleme — yeni mesaj gelince cb çağrılır
export function subscribeMessages(cb) {
  const ch = supabase.channel("messages-live")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, payload => cb(payload.new))
    .subscribe();
  return () => supabase.removeChannel(ch);
}
