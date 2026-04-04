const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;
const basePath = __dirname;
const usersFilePath = path.join(basePath, "users.json");
const COOKIE_NAME = "moodwave_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 12;
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const USE_SUPABASE = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);

const sessions = new Map();

const mimeTypes = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json"
};

function ensureUsersFile() {
  if (!fs.existsSync(usersFilePath)) {
    fs.writeFileSync(usersFilePath, "[]\n", "utf8");
  }
}

function readUsers() {
  ensureUsersFile();
  const raw = fs.readFileSync(usersFilePath, "utf8");
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

function writeUsers(users) {
  fs.writeFileSync(usersFilePath, `${JSON.stringify(users, null, 2)}\n`, "utf8");
}

function parseCookies(req) {
  const cookieHeader = req.headers.cookie || "";
  const cookies = {};

  cookieHeader
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .forEach((entry) => {
      const idx = entry.indexOf("=");
      if (idx === -1) {
        return;
      }
      const key = entry.slice(0, idx);
      const value = entry.slice(idx + 1);
      cookies[key] = decodeURIComponent(value);
    });

  return cookies;
}

function getCurrentSession(req) {
  const cookies = parseCookies(req);
  const sessionId = cookies[COOKIE_NAME];
  if (!sessionId) {
    return null;
  }

  const session = sessions.get(sessionId);
  if (!session) {
    return null;
  }

  if (Date.now() > session.expiresAt) {
    sessions.delete(sessionId);
    return null;
  }

  return { sessionId, session };
}

function setSessionCookie(res, sessionId) {
  const maxAgeSeconds = Math.floor(SESSION_TTL_MS / 1000);
  const cookie = `${COOKIE_NAME}=${encodeURIComponent(sessionId)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}`;
  res.setHeader("Set-Cookie", cookie);
}

function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 64 * 1024) {
        reject(new Error("Payload too large"));
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function hashPassword(password, saltHex) {
  return crypto.scryptSync(password, Buffer.from(saltHex, "hex"), 64).toString("hex");
}

function verifyPassword(password, saltHex, expectedHashHex) {
  const actual = Buffer.from(hashPassword(password, saltHex), "hex");
  const expected = Buffer.from(expectedHashHex, "hex");
  if (actual.length !== expected.length) {
    return false;
  }
  return crypto.timingSafeEqual(actual, expected);
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

function serveFile(filePath, res) {
  fs.readFile(filePath, (error, content) => {
    if (error) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = mimeTypes[ext] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": contentType });
    res.end(content);
  });
}

function normalizeUsername(input) {
  return String(input || "").trim().toLowerCase();
}

async function findUserByUsername(username) {
  if (!USE_SUPABASE) {
    const users = readUsers();
    return users.find((u) => u.username === username) || null;
  }

  const endpoint = `${SUPABASE_URL}/rest/v1/users?select=username,salt,hash&username=eq.${encodeURIComponent(username)}&limit=1`;
  const response = await fetch(endpoint, {
    method: "GET",
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
    }
  });

  if (!response.ok) {
    throw new Error("Could not query Supabase users");
  }

  const rows = await response.json();
  if (!Array.isArray(rows) || rows.length === 0) {
    return null;
  }

  return rows[0];
}

async function createUserRecord(username, salt, hash) {
  if (!USE_SUPABASE) {
    const users = readUsers();
    users.push({ username, salt, hash, createdAt: new Date().toISOString() });
    writeUsers(users);
    return;
  }

  const endpoint = `${SUPABASE_URL}/rest/v1/users`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal"
    },
    body: JSON.stringify({ username, salt, hash })
  });

  if (!response.ok) {
    throw new Error("Could not write Supabase user");
  }
}

ensureUsersFile();

const server = http.createServer((req, res) => {
  if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
    serveFile(path.join(basePath, "index.html"), res);
    return;
  }

  if (req.method === "GET" && (req.url === "/login" || req.url === "/login.html")) {
    serveFile(path.join(basePath, "login.html"), res);
    return;
  }

  if (req.method === "GET" && req.url === "/api/session") {
    const current = getCurrentSession(req);
    if (!current) {
      sendJson(res, 200, { authenticated: false });
      return;
    }

    sendJson(res, 200, {
      authenticated: true,
      user: { username: current.session.username }
    });
    return;
  }

  if (req.method === "POST" && req.url === "/api/register") {
    readBody(req)
      .then(async (body) => {
        let payload;
        try {
          payload = JSON.parse(body || "{}");
        } catch (error) {
          sendJson(res, 400, { ok: false, error: "Invalid JSON" });
          return;
        }

        const username = normalizeUsername(payload.username);
        const password = String(payload.password || "");

        if (username.length < 3 || username.length > 24) {
          sendJson(res, 400, { ok: false, error: "Username must be 3-24 characters" });
          return;
        }

        if (!/^[a-z0-9_]+$/.test(username)) {
          sendJson(res, 400, { ok: false, error: "Username can only use a-z, 0-9, and _" });
          return;
        }

        if (password.length < 4) {
          sendJson(res, 400, { ok: false, error: "Password must be at least 4 characters" });
          return;
        }

        try {
          const existingUser = await findUserByUsername(username);
          if (existingUser) {
            sendJson(res, 409, { ok: false, error: "Username already exists" });
            return;
          }

          const salt = crypto.randomBytes(16).toString("hex");
          const hash = hashPassword(password, salt);
          await createUserRecord(username, salt, hash);

          const sessionId = crypto.randomBytes(32).toString("hex");
          sessions.set(sessionId, { username, expiresAt: Date.now() + SESSION_TTL_MS });
          setSessionCookie(res, sessionId);

          sendJson(res, 201, { ok: true, user: { username } });
        } catch (error) {
          sendJson(res, 500, { ok: false, error: "Account service unavailable" });
        }
      })
      .catch(() => sendJson(res, 400, { ok: false, error: "Invalid request body" }));
    return;
  }

  if (req.method === "POST" && req.url === "/api/login") {
    readBody(req)
      .then(async (body) => {
        let payload;
        try {
          payload = JSON.parse(body || "{}");
        } catch (error) {
          sendJson(res, 400, { ok: false, error: "Invalid JSON" });
          return;
        }

        const username = normalizeUsername(payload.username);
        const password = String(payload.password || "");

        try {
          const user = await findUserByUsername(username);

          if (!user || !verifyPassword(password, user.salt, user.hash)) {
            sendJson(res, 401, { ok: false, error: "Invalid username or password" });
            return;
          }

          const sessionId = crypto.randomBytes(32).toString("hex");
          sessions.set(sessionId, { username, expiresAt: Date.now() + SESSION_TTL_MS });
          setSessionCookie(res, sessionId);

          sendJson(res, 200, { ok: true, user: { username } });
        } catch (error) {
          sendJson(res, 500, { ok: false, error: "Account service unavailable" });
        }
      })
      .catch(() => sendJson(res, 400, { ok: false, error: "Invalid request body" }));
    return;
  }

  if (req.method === "POST" && req.url === "/api/logout") {
    const current = getCurrentSession(req);
    if (current) {
      sessions.delete(current.sessionId);
    }
    clearSessionCookie(res);
    sendJson(res, 200, { ok: true });
    return;
  }

  const requestedPath = req.url || "/";
  const safePath = path.normalize(requestedPath).replace(/^\.\.(\\|\/|$)/, "");
  const filePath = path.join(basePath, safePath);
  serveFile(filePath, res);
});

server.listen(PORT, () => {
  console.log(`MoodWave running on http://localhost:${PORT}`);
});
