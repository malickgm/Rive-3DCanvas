// Minimal MCP HTTP client for the Rive editor server.
//   node rive-cli.js tools                 -> list tool names
//   node rive-cli.js schema <name> [...]   -> print inputSchema for tools
//   node rive-cli.js call <name> <argsFile>-> call a tool, args from a JSON file
// Args come from a file to avoid shell-escaping problems.

const fs = require("fs");
const ENDPOINT = "http://127.0.0.1:9791/mcp";

let sessionId = null;

async function rpc(body) {
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  if (sessionId) headers["mcp-session-id"] = sessionId;

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!sessionId) sessionId = res.headers.get("mcp-session-id");

  const text = await res.text();
  if (!text.trim()) return null;
  if (text.trim().startsWith("{")) return JSON.parse(text);
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("data:")) {
      try {
        return JSON.parse(line.slice(5).trim());
      } catch {}
    }
  }
  return { _raw: text.slice(0, 500) };
}

async function connect() {
  await rpc({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "rive-cli", version: "1.0.0" },
    },
  });
  await rpc({ jsonrpc: "2.0", method: "notifications/initialized" });
}

const listTools = async () =>
  (await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" })).result.tools;

function show(v) {
  console.log(typeof v === "string" ? v : JSON.stringify(v, null, 2));
}

(async () => {
  await connect();
  const [cmd, ...rest] = process.argv.slice(2);

  if (cmd === "tools") {
    for (const t of await listTools()) {
      console.log(t.name + " :: " + (t.description || "").split("\n")[0]);
    }
    return;
  }

  if (cmd === "schema") {
    const all = await listTools();
    for (const name of rest) {
      const t = all.find((x) => x.name === name);
      if (!t) {
        console.log("### " + name + " -> NOT FOUND");
        continue;
      }
      console.log("### " + name);
      console.log(t.description || "");
      show(t.inputSchema);
      console.log("");
    }
    return;
  }

  if (cmd === "call") {
    const [name, argsFile] = rest;
    const args = argsFile
      ? JSON.parse(fs.readFileSync(argsFile, "utf8"))
      : {};
    const out = await rpc({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name, arguments: args },
    });
    if (out.error) {
      console.log("ERROR: " + JSON.stringify(out.error, null, 2));
      process.exitCode = 1;
      return;
    }
    for (const c of out.result?.content ?? []) {
      show(c.type === "text" ? c.text : c);
    }
    if (out.result?.isError) process.exitCode = 1;
    return;
  }

  console.log("usage: tools | schema <name...> | call <name> <argsFile>");
})().catch((e) => {
  console.log("FAILED: " + e.message);
  process.exitCode = 1;
});
