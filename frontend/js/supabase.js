// ── Supabase Client — Auth, DB, Realtime, Storage ─────────────────────────────

const SUPABASE_URL     = 'https://eiqlvbylkcmgvksrxqld.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVpcWx2Ynlsa2NtZ3Zrc3J4cWxkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg5NTI4NjgsImV4cCI6MjA5NDUyODg2OH0.PcGDHYlajqwnZ7c3ZPtssG534kd3sKwE8aT1ROlFpo8';

let _sbSingleton = null;

function getSupabaseClient() {
  if (_sbSingleton) return _sbSingleton;
  // Allow per-instance override via localStorage (e.g. dev against a local stack)
  const url = localStorage.getItem('hype_sb_url') || SUPABASE_URL;
  const key = localStorage.getItem('hype_sb_key') || SUPABASE_ANON_KEY;
  _sbSingleton = supabase.createClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: 'hype_auth' },
    realtime: { params: { eventsPerSecond: 10 } },
  });
  return _sbSingleton;
}

// ── Auth ──────────────────────────────────────────────────────────────────────

async function sbSignIn(email, password) {
  const { data, error } = await getSupabaseClient().auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

async function sbSignUp(email, password) {
  const { data, error } = await getSupabaseClient().auth.signUp({ email, password });
  if (error) throw error;
  return data;
}

async function sbSignOut() {
  const { error } = await getSupabaseClient().auth.signOut();
  if (error) throw error;
  _sbSingleton = null; // reset so next call re-initialises
}

async function sbGetUser() {
  const { data: { user } } = await getSupabaseClient().auth.getUser();
  return user;
}

function sbOnAuthChange(callback) {
  return getSupabaseClient().auth.onAuthStateChange(callback);
}

// ── Realtime ──────────────────────────────────────────────────────────────────

/**
 * Subscribe to INSERT/UPDATE/DELETE on a table.
 * @param {string} table
 * @param {function} callback  — receives the postgres_changes payload
 * @param {string} [filter]   — e.g. "coin=eq.BTC"
 * @returns channel            — call channel.unsubscribe() to clean up
 */
function sbSubscribe(table, callback, filter = null) {
  const client = getSupabaseClient();
  const opts   = { event: '*', schema: 'public', table };
  if (filter) opts.filter = filter;
  const channel = client
    .channel(`rt:${table}:${filter || 'all'}`)
    .on('postgres_changes', opts, callback)
    .subscribe();
  return channel;
}

// ── Storage ───────────────────────────────────────────────────────────────────

/**
 * Upload a File or Blob to a storage bucket.
 * @param {string} bucket
 * @param {string} path    — e.g. "reports/backtest-2025.csv"
 * @param {File|Blob} file
 */
async function sbUpload(bucket, path, file) {
  const { data, error } = await getSupabaseClient()
    .storage.from(bucket)
    .upload(path, file, { upsert: true });
  if (error) throw error;
  return data;
}

/** Get the public URL for a file in a storage bucket. */
function sbGetPublicUrl(bucket, path) {
  const { data } = getSupabaseClient().storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}

/** Download a file from storage as a Blob. */
async function sbDownload(bucket, path) {
  const { data, error } = await getSupabaseClient().storage.from(bucket).download(path);
  if (error) throw error;
  return data;
}

// ── DB shorthand ──────────────────────────────────────────────────────────────

/** Returns a Supabase query builder for the given table. */
function sbFrom(table) {
  return getSupabaseClient().from(table);
}

// ── Auth UI ───────────────────────────────────────────────────────────────────
// Minimal modal — shown when a feature that requires auth is accessed by a guest.

let _authResolve = null;

function sbRequireAuth() {
  return new Promise((resolve) => {
    sbGetUser().then(user => {
      if (user) { resolve(user); return; }
      _authResolve = resolve;
      document.getElementById('sb-auth-modal')?.classList.remove('hidden');
    });
  });
}

function _sbAuthSubmit(isSignUp) {
  const email    = document.getElementById('sb-auth-email')?.value.trim();
  const password = document.getElementById('sb-auth-password')?.value;
  const errEl    = document.getElementById('sb-auth-error');
  if (!email || !password) { if (errEl) errEl.textContent = 'Email and password required.'; return; }

  const fn = isSignUp ? sbSignUp : sbSignIn;
  fn(email, password)
    .then(data => {
      document.getElementById('sb-auth-modal')?.classList.add('hidden');
      if (_authResolve) { _authResolve(data.user || data.session?.user); _authResolve = null; }
      _updateAuthBadge();
    })
    .catch(err => { if (errEl) errEl.textContent = err.message; });
}

function _updateAuthBadge() {
  sbGetUser().then(user => {
    const badge = document.getElementById('sb-auth-badge');
    if (!badge) return;
    badge.textContent   = user ? (user.email?.split('@')[0] || 'Logged in') : 'Login';
    badge.title         = user ? `Signed in as ${user.email}` : 'Sign in to sync data';
    badge.onclick       = user ? () => sbSignOut().then(_updateAuthBadge) : () => sbRequireAuth();
  });
}

// Initialise badge after DOM is ready
document.addEventListener('DOMContentLoaded', _updateAuthBadge);
