// Shared server logic for BOTH Netlify and Vercel.
// handle(route, body) -> [statusCode, jsonBody]
const crypto = require("crypto");

const hash = s => crypto.createHash("sha256").update(String(s ?? "")).digest("hex");
const tokenSecret = () => process.env.ADMIN_TOKEN_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const CAT_ORDER = ["Personality", "Wild / Funny", "Inspirational"];
const sortAwards = list => [...(list || [])].sort((a, b) => {
  const d = CAT_ORDER.indexOf(a.category) - CAT_ORDER.indexOf(b.category);
  return d || (a.sort_order - b.sort_order);
});

let _db;
function getDb() {
  if (_db) return _db;
  const { createClient } = require("@supabase/supabase-js");
  // Be forgiving: remove spaces, trailing slashes and a pasted "/rest/v1"
  const url = (process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "").replace(/\/rest\/v1$/, "");
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url) throw new Error("Server setup problem: SUPABASE_URL is missing");
  if (!key) throw new Error("Server setup problem: SUPABASE_SERVICE_ROLE_KEY is missing");
  _db = createClient(url, key, { auth: { persistSession: false } });
  return _db;
}

function adminTokenValid(t) {
  if (!t || typeof t !== "string") return false;
  try {
    const [p, h] = t.split(".");
    const good = hash(p + "." + tokenSecret());
    if (!tokenSecret() || !h || h.length !== good.length) return false;
    if (!crypto.timingSafeEqual(Buffer.from(h), Buffer.from(good))) return false;
    return JSON.parse(Buffer.from(p, "base64url").toString()).exp > Date.now();
  } catch (e) { return false; }
}
function makeToken() {
  if (!tokenSecret()) throw new Error("Server setup problem: ADMIN_TOKEN_SECRET is missing");
  const p = Buffer.from(JSON.stringify({ exp: Date.now() + 1000 * 60 * 60 * 6 })).toString("base64url");
  return p + "." + hash(p + "." + tokenSecret());
}

// throw if a database call failed (so the page shows a real message)
async function must(q) { const r = await q; if (r.error) throw r.error; return r.data; }

async function event(db) {
  const settings = await must(db.from("event_settings").select("*").eq("id", 1).single());
  const people = (await must(db.from("people").select("*").order("created_at"))) || [];
  const awards = sortAwards(await must(db.from("awards").select("*").order("sort_order")));
  const voters = (await must(db.from("voters").select("person_id,submitted"))) || [];
  const now = Date.now();
  const open = settings.opening_at ? new Date(settings.opening_at).getTime() : 0;
  const close = settings.closing_at ? new Date(settings.closing_at).getTime() : 0;
  return {
    event_name: settings.event_name, opening_at: settings.opening_at, closing_at: settings.closing_at,
    closed: !!close && now >= close, not_open: !!open && now < open,
    people: people.map(p => ({ ...p, voted: !!voters.find(v => v.person_id === p.id)?.submitted })),
    awards, voted_count: voters.filter(v => v.submitted).length
  };
}

async function isClosed(db) {
  const s = await must(db.from("event_settings").select("closing_at").eq("id", 1).single());
  return !!s.closing_at && Date.now() >= new Date(s.closing_at).getTime();
}

async function authVoter(db, b) {
  const { data: p } = await db.from("people").select("id").eq("name", b.voter).maybeSingle();
  if (!p) return { err: [404, { error: "Person not found" }] };
  const { data: v } = await db.from("voters").select("id,password_hash").eq("person_id", p.id).maybeSingle();
  if (!v || v.password_hash !== hash(b.password)) return { err: [401, { error: "Incorrect password" }] };
  return { v };
}

const ADMIN_EXPIRED = [401, { error: "Admin session expired" }];

async function run(db, route, b) {
  if (route === "event") return [200, await event(db)];

  if (route === "voter") {
    const { data: p } = await db.from("people").select("*").eq("name", b.name).maybeSingle();
    if (!p) return [404, { error: "Person not found" }];
    const { data: v } = await db.from("voters").select("*").eq("person_id", p.id).maybeSingle();
    if (b.create) {
      if (v) return [409, { error: "Already created" }];
      if (!b.password) return [400, { error: "Enter a password" }];
      await must(db.from("voters").insert({ person_id: p.id, password_hash: hash(b.password) }));
      return [200, { ok: true }];
    }
    if (b.login) {
      if (!v || v.password_hash !== hash(b.password)) return [401, { error: "Incorrect password" }];
      const vs = (await must(db.from("votes").select("award_id,answer").eq("voter_id", v.id))) || [];
      return [200, { answers: Object.fromEntries(vs.map(x => [x.award_id, x.answer])) }];
    }
    return [200, { exists: !!v }];
  }

  if (route === "questions") {
    if (await isClosed(db)) return [403, { error: "Voting is closed" }];
    const { v, err } = await authVoter(db, b); if (err) return err;
    const qs = sortAwards(await must(db.from("awards").select("*").order("sort_order")));
    const vs = (await must(db.from("votes").select("award_id,answer").eq("voter_id", v.id))) || [];
    return [200, { questions: qs, answers: Object.fromEntries(vs.map(x => [x.award_id, x.answer])) }];
  }

  if (route === "save") {
    if (await isClosed(db)) return [403, { error: "Voting is closed" }];
    const { v, err } = await authVoter(db, b); if (err) return err;
    const now = new Date().toISOString();
    const rows = Object.entries(b.answers || {}).filter(([, a]) => a)
      .map(([award_id, answer]) => ({ voter_id: v.id, award_id, answer: String(answer), updated_at: now }));
    if (rows.length) await must(db.from("votes").upsert(rows, { onConflict: "voter_id,award_id" }));
    await must(db.from("voters").update({ submitted: !!b.submitted, updated_at: now }).eq("id", v.id));
    return [200, { ok: true }];
  }

  if (route === "admin") {
    const s = (await db.from("event_settings").select("admin_password_hash").eq("id", 1).single()).data;
    if (!s || s.admin_password_hash !== hash(b.password)) return [401, { error: "Incorrect admin password" }];
    return [200, { token: makeToken() }];
  }

  // ---- everything below needs a valid admin token ----
  const adminRoutes = ["admin-data", "admin-save", "award-add", "award-delete", "person-photo", "results"];
  if (!adminRoutes.includes(route)) return [404, { error: "Not found" }];
  if (!adminTokenValid(b.token)) return ADMIN_EXPIRED;

  if (route === "admin-data") return [200, { event: await event(db) }];

  if (route === "admin-save") {
    const upd = {};
    if (b.event_name !== undefined) upd.event_name = b.event_name;
    if (b.opening_at !== undefined) upd.opening_at = b.opening_at;
    if (b.closing_at !== undefined) upd.closing_at = b.closing_at;
    if (b.close_now) upd.closing_at = new Date(Date.now() - 1000).toISOString();
    if (Object.keys(upd).length) await must(db.from("event_settings").update(upd).eq("id", 1));
    return [200, { ok: true }];
  }

  if (route === "award-add") {
    const title = String(b.title || "").trim();
    if (!title) return [400, { error: "Enter an award title" }];
    if (!CAT_ORDER.includes(b.category)) return [400, { error: "Unknown category" }];
    const type = b.type === "duo" ? "duo" : "person";
    const top = (await must(db.from("awards").select("sort_order").order("sort_order", { ascending: false }).limit(1)))?.[0]?.sort_order || 0;
    await must(db.from("awards").insert({ sort_order: top + 1, category: b.category, title, type }));
    return [200, { ok: true }];
  }

  if (route === "award-delete") {
    await must(db.from("awards").delete().eq("id", b.id));
    return [200, { ok: true }];
  }

  if (route === "person-photo") {
    if (typeof b.photo !== "string" || !b.photo.startsWith("data:image/")) return [400, { error: "That is not a valid image" }];
    if (b.photo.length > 1500000) return [413, { error: "Photo is too large" }];
    await must(db.from("people").update({ photo: b.photo }).eq("name", b.name));
    return [200, { ok: true }];
  }

  if (route === "results") {
    const s = await must(db.from("event_settings").select("closing_at").eq("id", 1).single());
    if (!s.closing_at || Date.now() < new Date(s.closing_at).getTime()) return [403, { error: "Close voting before viewing results" }];
    const awards = sortAwards(await must(db.from("awards").select("*").order("sort_order")));
    const people = (await must(db.from("people").select("*"))) || [];
    const votes = (await must(db.from("votes").select("award_id,answer"))) || [];
    const out = awards.map(a => {
      const m = {};
      votes.filter(v => v.award_id === a.id).forEach(v => { m[v.answer] = (m[v.answer] || 0) + 1; });
      const arr = Object.entries(m).filter(x => x[1] > 0).sort((x, y) => y[1] - x[1]).slice(0, 3);
      return {
        category: a.category, title: a.title, type: a.type,
        nominees: arr.map(([name, n]) => { const p = people.find(x => x.name === name); return { name, votes: n, color: p?.color || "#fff", photo: p?.photo || "" }; })
      };
    });
    return [200, { results: out }];
  }
}

async function handle(route, body, opts = {}) {
  try {
    const db = opts.db || getDb();
    return await run(db, route, body || {});
  } catch (err) {
    console.error(err);
    return [500, { error: (err && err.message) || "Server error" }];
  }
}

module.exports = { handle };
