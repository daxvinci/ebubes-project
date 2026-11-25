// Shared server logic for BOTH Netlify and Vercel.
// handle(route, body) -> [statusCode, jsonBody]
const crypto = require("crypto");

const hash = s => crypto.createHash("sha256").update(String(s ?? "")).digest("hex");
const tokenSecret = () => process.env.ADMIN_TOKEN_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const CAT_ORDER = ["Personality", "Wild / Funny", "Inspirational"];
const AUDIENCES = ["all", "male", "female"], SEXES = ["male", "female"];
const audOf = a => (a && a.audience) || "all";
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
    const awards = (await must(db.from("awards").select("*"))) || [];
    const people = (await must(db.from("people").select("*"))) || [];
    const awardById = Object.fromEntries(awards.map(x => [x.id, x]));
    const personByName = Object.fromEntries(people.map(p => [p.name, p]));
    const validFor = (aw, answer) => {
      if (!answer) return false;
      if (aw.type === "duo") return String(answer).trim().length > 0 && String(answer).length <= 200;
      const p = personByName[answer];
      return !!p && (audOf(aw) === "all" || p.sex === audOf(aw));
    };
    const now = new Date().toISOString();
    const rows = Object.entries(b.answers || {})
      .filter(([id, ans]) => awardById[id] && validFor(awardById[id], ans))
      .map(([award_id, answer]) => ({ voter_id: v.id, award_id, answer: String(answer), updated_at: now }));
    if (rows.length) await must(db.from("votes").upsert(rows, { onConflict: "voter_id,award_id" }));
    if (b.submitted) {
      const saved = (await must(db.from("votes").select("award_id,answer").eq("voter_id", v.id))) || [];
      const have = Object.fromEntries(saved.map(x => [x.award_id, x.answer]));
      const missing = awards.filter(aw => !validFor(aw, have[aw.id])).length;
      if (missing) return [400, { error: `Please answer all ${missing} remaining question${missing > 1 ? "s" : ""}.` }];
    }
    await must(db.from("voters").update({ submitted: !!b.submitted, updated_at: now }).eq("id", v.id));
    return [200, { ok: true }];
  }

  if (route === "admin") {
    const s = (await db.from("event_settings").select("admin_password_hash").eq("id", 1).single()).data;
    if (!s || s.admin_password_hash !== hash(b.password)) return [401, { error: "Incorrect admin password" }];
    return [200, { token: makeToken() }];
  }

  // ---- everything below needs a valid admin token ----
  const adminRoutes = ["admin-data", "admin-save", "award-add", "award-delete", "award-audience", "person-photo", "person-sex", "results"];
  if (!adminRoutes.includes(route)) return [404, { error: "Not found" }];
  if (!adminTokenValid(b.token)) return ADMIN_EXPIRED;

  if (route === "admin-data") return [200, { event: await event(db) }];

  if (route === "admin-save") {
    const upd = {};
    if (b.event_name !== undefined) upd.event_name = b.event_name;
    if (b.opening_at !== undefined) upd.opening_at = b.opening_at;
    if (b.closing_at !== undefined) upd.closing_at = b.closing_at;
    if (b.close_now) upd.closing_at = new Date(Date.now() - 1000).toISOString();
    if (b.reopen) upd.closing_at = null;
    if (Object.keys(upd).length) await must(db.from("event_settings").update(upd).eq("id", 1));
    return [200, { ok: true }];
  }

  if (route === "award-add") {
    const title = String(b.title || "").trim();
    if (!title) return [400, { error: "Enter an award title" }];
    if (!CAT_ORDER.includes(b.category)) return [400, { error: "Unknown category" }];
    const type = b.type === "duo" ? "duo" : "person";
    const audience = AUDIENCES.includes(b.audience) ? b.audience : "all";
    const top = (await must(db.from("awards").select("sort_order").order("sort_order", { ascending: false }).limit(1)))?.[0]?.sort_order || 0;
    const row = { sort_order: top + 1, category: b.category, title, type };
    if (audience !== "all") row.audience = audience; // only touch the new column when needed
    await must(db.from("awards").insert(row));
    return [200, { ok: true }];
  }

  if (route === "award-delete") {
    await must(db.from("awards").delete().eq("id", b.id));
    return [200, { ok: true }];
  }

  if (route === "award-audience") {
    if (!AUDIENCES.includes(b.audience)) return [400, { error: "Unknown audience" }];
    await must(db.from("awards").update({ audience: b.audience }).eq("id", b.id));
    return [200, { ok: true }];
  }

  if (route === "person-sex") {
    if (!SEXES.includes(b.sex)) return [400, { error: "Sex must be male or female" }];
    await must(db.from("people").update({ sex: b.sex }).eq("name", b.name));
    return [200, { ok: true }];
  }

  if (route === "person-photo") {
    if (typeof b.photo !== "string" || !b.photo.startsWith("data:image/")) return [400, { error: "That is not a valid image" }];
    if (b.photo.length > 1500000) return [413, { error: "Photo is too large" }];
    await must(db.from("people").update({ photo: b.photo }).eq("name", b.name));
    return [200, { ok: true }];
  }

  if (route === "results") {
    const settings = await must(db.from("event_settings").select("event_name,closing_at").eq("id", 1).single());
    if (!settings.closing_at || Date.now() < new Date(settings.closing_at).getTime()) return [403, { error: "Close voting before viewing results" }];
    const awards = sortAwards(await must(db.from("awards").select("*").order("sort_order")));
    const people = (await must(db.from("people").select("*"))) || [];
    const votes = (await must(db.from("votes").select("award_id,answer"))) || [];
    const voters = (await must(db.from("voters").select("submitted"))) || [];
    const personByName = Object.fromEntries(people.map(p => [p.name, p]));
    const personByLower = Object.fromEntries(people.map(p => [p.name.toLowerCase(), p]));

    // "ada and tunde", "Tunde & Ada" and "ada, tunde" all become the same pair
    const duoKey = text => {
      const parts = String(text).split(/\s*(?:&|\+|,|\/|\band\b)\s*/i).map(x => x.trim()).filter(Boolean)
        .map(x => personByLower[x.toLowerCase()]?.name || x.replace(/(^|\s)\S/g, c => c.toUpperCase()));
      const uniq = [...new Set(parts)].sort((x, y) => x.toLowerCase().localeCompare(y.toLowerCase()));
      return { key: uniq.map(x => x.toLowerCase()).join("|"), label: uniq.join(" & ") };
    };

    const out = awards.map(a => {
      const tally = {};
      for (const v of votes.filter(x => x.award_id === a.id)) {
        let key, label;
        if (a.type === "duo") { const d = duoKey(v.answer); if (!d.key) continue; key = d.key; label = d.label; }
        else {
          const p = personByName[v.answer];
          if (!p) continue;
          if (audOf(a) !== "all" && p.sex !== audOf(a)) continue; // ignore votes that no longer fit the award
          key = label = p.name;
        }
        tally[key] = tally[key] || { name: label, votes: 0 };
        tally[key].votes++;
      }
      const all = Object.values(tally).sort((x, y) => y.votes - x.votes || x.name.localeCompare(y.name));
      const total = all.reduce((n, x) => n + x.votes, 0);
      const best = all.length ? all[0].votes : 0;
      const winners = all.filter(x => x.votes === best).length;
      const top = all.slice(0, Math.max(3, winners));
      return {
        category: a.category, title: a.title, type: a.type, audience: audOf(a), total_votes: total,
        nominees: top.map(x => {
          const p = a.type === "duo" ? null : personByName[x.name];
          return { name: x.name, votes: x.votes, percent: total ? Math.round(x.votes / total * 100) : 0, winner: x.votes === best, color: p?.color || "#ffffff", photo: p?.photo || "" };
        })
      };
    });
    return [200, { event_name: settings.event_name, generated_at: new Date().toISOString(), voters_submitted: voters.filter(x => x.submitted).length, voters_total: people.length, results: out }];
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
