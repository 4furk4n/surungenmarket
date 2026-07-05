// ============================================================================
// Authentication — Supabase Auth (e-posta + şifre, e-posta doğrulama, sıfırlama)
// ============================================================================
import { supabase } from "./supabase.js";

let _profile = null;

// Oturumdaki kullanıcı (yoksa null)
export async function currentUser() {
  const { data } = await supabase.auth.getUser();
  return data.user || null;
}

// Giriş yapan kullanıcının profil satırı (username, city, role...)
export async function currentProfile() {
  const user = await currentUser();
  if (!user) { _profile = null; return null; }
  if (_profile && _profile.id === user.id) return _profile;
  const { data, error } = await supabase
    .from("profiles").select("*").eq("id", user.id).single();
  if (error) { console.warn(error); return null; }
  _profile = data;
  return data;
}

export function isAdmin(profile) {
  return !!profile && profile.role === "admin";
}

// Üye ol — e-posta doğrulama maili Supabase tarafından gönderilir
export async function signUp({ email, password, username, city }) {
  const { data, error } = await supabase.auth.signUp({
    email, password,
    options: {
      data: { username, city },
      emailRedirectTo: window.location.origin + window.location.pathname
    }
  });
  if (error) throw error;
  return data;
}

export async function signIn({ email, password }) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  _profile = null;
  return data;
}

export async function signOut() {
  await supabase.auth.signOut();
  _profile = null;
}

// Şifre sıfırlama maili gönder
export async function sendPasswordReset(email) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + "/reset-password.html"
  });
  if (error) throw error;
}

// Yeni şifre belirle (reset-password.html sayfasında, mail linkinden gelince)
export async function updatePassword(newPassword) {
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw error;
}

// Oturum değişimini dinle (giriş/çıkış olunca arayüzü güncellemek için)
export function onAuthChange(cb) {
  supabase.auth.onAuthStateChange((_event, session) => {
    _profile = null;
    cb(session ? session.user : null);
  });
}
