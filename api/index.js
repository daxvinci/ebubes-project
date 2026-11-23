// Vercel function. vercel.json rewrites /api/<name> to this file with ?route=<name>
const { handle } = require("../lib/core");

module.exports = async (req, res) => {
  let route = req.query && req.query.route;
  if (Array.isArray(route)) route = route[0];
  if (!route) route = new URL(req.url, "http://x").pathname.replace(/\/+$/, "").split("/").pop();

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }

  const [status, data] = await handle(route, body || {});
  res.setHeader("Cache-Control", "no-store");
  res.status(status).json(data);
};
