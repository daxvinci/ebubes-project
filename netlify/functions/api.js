const { handle } = require("../../lib/core");

exports.handler = async event => {
  const route = event.path.replace(/\/+$/, "").split("/").pop();
  let body = {};
  try { body = event.body ? JSON.parse(event.body) : {}; } catch (e) {}
  const [status, data] = await handle(route, body);
  return {
    statusCode: status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    body: JSON.stringify(data)
  };
};
