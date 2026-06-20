const express = require("express");
const fs = require("fs");
const path = require("path");
const nodemailer = require("nodemailer");
const { run, createEnelClient } = require("./index");

const app = express();
const PORT = process.env.PORT || 3000;
const SETTINGS_FILE = path.join(__dirname, "settings.json");

const DEFAULT_SETTINGS = {
  LOGIN_ID: process.env.LOGIN_ID || "",
  PASSWORD: process.env.PASSWORD || "",
  CITY_ID: parseInt(process.env.CITY_ID || "1", 10),
  ENGLISH: process.env.ENGLISH === "true",
  DOCTORS: process.env.DOCTORS ? process.env.DOCTORS.split(",").map(Number).filter(Boolean) : [],
  SKIP_IMMEDIATE: process.env.SKIP_IMMEDIATE !== "false",
  SERVICE: process.env.SERVICE || "1765",
  SERVICE_TYPE: process.env.SERVICE_TYPE || "13",
  INTERVAL_MINUTES: parseFloat(process.env.INTERVAL_MINUTES || "5"),
  NOTIFY_EMAIL: process.env.NOTIFY_EMAIL || "",
  SMTP_HOST: process.env.SMTP_HOST || "smtp.gmail.com",
  SMTP_PORT: process.env.SMTP_PORT || "587",
  SMTP_USER: process.env.SMTP_USER || "",
  SMTP_PASS: process.env.SMTP_PASS || "",
};

function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf-8")) };
    }
  } catch {}
  return { ...DEFAULT_SETTINGS };
}

function saveSettings(settings) {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
}

const status = {
  lastRunTime: null,
  lastRunResult: null,
  lastRunError: null,
  lastNotifiedAt: null,
  lastEmailError: null,
  isRunning: false,
  nextRunTime: null,
};

let intervalHandle = null;

async function sendEmail(settings, foundCount) {
  if (!settings.NOTIFY_EMAIL || !settings.SMTP_USER || !settings.SMTP_PASS) return;

  const transporter = nodemailer.createTransport({
    host: settings.SMTP_HOST || "smtp.gmail.com",
    port: parseInt(settings.SMTP_PORT || "587", 10),
    secure: false,
    auth: { user: settings.SMTP_USER, pass: settings.SMTP_PASS },
  });

  const slotWord = foundCount === 1 ? "slot" : "slots";
  await transporter.sendMail({
    from: `"Enel-Med Fetcher" <${settings.SMTP_USER}>`,
    to: settings.NOTIFY_EMAIL,
    subject: `🏥 ${foundCount} appointment ${slotWord} available on Enel-Med!`,
    html: `
      <h2>📅 Appointment slots found!</h2>
      <p>There are <strong>${foundCount}</strong> available appointment ${slotWord} on Enel-Med right now.</p>
      <p><a href="https://online.enel.pl/Visit/New" style="background:#3b82f6;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;display:inline-block">Book now →</a></p>
      <p style="color:#888;font-size:12px">Checked at ${new Date().toLocaleString("pl-PL", { timeZone: "Europe/Warsaw" })} (Warsaw time)</p>
    `,
    text: `Found ${foundCount} appointment ${slotWord} on Enel-Med!\n\nBook now: https://online.enel.pl/Visit/New\n\nChecked at ${new Date().toLocaleString()}`,
  });

  console.log(`📧 Notification sent to ${settings.NOTIFY_EMAIL}`);
  status.lastNotifiedAt = new Date().toISOString();
  status.lastEmailError = null;
}

async function runOnce() {
  if (status.isRunning) return;
  status.isRunning = true;
  status.lastRunTime = new Date().toISOString();
  status.lastRunError = null;

  const prevResult = status.lastRunResult;

  try {
    const settings = loadSettings();
    const foundCount = await run(settings);
    status.lastRunResult = foundCount;

    // Send email only when slots newly appear (were 0/null, now > 0)
    if (foundCount > 0 && !prevResult) {
      sendEmail(settings, foundCount).catch(err => {
        console.error("📧 Email error:", err.message);
        status.lastEmailError = err.message;
      });
    }
  } catch (err) {
    console.error("❌ Error:", err.message);
    status.lastRunError = err.message;
    status.lastRunResult = null;
  } finally {
    status.isRunning = false;
  }
}

function scheduleNext() {
  const settings = loadSettings();
  const ms = Math.max(1, settings.INTERVAL_MINUTES) * 60 * 1000;
  status.nextRunTime = new Date(Date.now() + ms).toISOString();
}

function startInterval() {
  if (intervalHandle) clearInterval(intervalHandle);
  const settings = loadSettings();
  const ms = Math.max(1, settings.INTERVAL_MINUTES) * 60 * 1000;
  status.nextRunTime = new Date(Date.now() + ms).toISOString();
  intervalHandle = setInterval(async () => {
    await runOnce();
    scheduleNext();
  }, ms);
}

// ── Enel-Med session cache (shared across option proxy routes) ──
let _enelClient = null;
let _enelSessionExpiry = 0;

async function getEnelClient() {
  if (_enelClient && Date.now() < _enelSessionExpiry) return _enelClient;
  const settings = loadSettings();
  if (!settings.LOGIN_ID || !settings.PASSWORD) throw new Error("No credentials configured");
  _enelClient = await createEnelClient(settings);
  _enelSessionExpiry = Date.now() + 25 * 60 * 1000;
  return _enelClient;
}

function invalidateEnelClient() {
  _enelClient = null;
  _enelSessionExpiry = 0;
}

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/status", (req, res) => res.json(status));

app.get("/api/settings", (req, res) => {
  const settings = loadSettings();
  res.json({
    ...settings,
    PASSWORD: settings.PASSWORD ? "••••••••" : "",
    SMTP_PASS: settings.SMTP_PASS ? "••••••••" : "",
  });
});

app.post("/api/settings", (req, res) => {
  const current = loadSettings();
  const body = req.body;

  const updated = {
    ...current,
    LOGIN_ID: body.LOGIN_ID ?? current.LOGIN_ID,
    PASSWORD: (body.PASSWORD && body.PASSWORD !== "••••••••") ? body.PASSWORD : current.PASSWORD,
    CITY_ID: parseInt(body.CITY_ID, 10) || current.CITY_ID,
    ENGLISH: Boolean(body.ENGLISH),
    DOCTORS: Array.isArray(body.DOCTORS) ? body.DOCTORS : current.DOCTORS,
    SKIP_IMMEDIATE: Boolean(body.SKIP_IMMEDIATE),
    SERVICE: String(body.SERVICE ?? current.SERVICE),
    SERVICE_TYPE: String(body.SERVICE_TYPE ?? current.SERVICE_TYPE),
    INTERVAL_MINUTES: parseFloat(body.INTERVAL_MINUTES) || current.INTERVAL_MINUTES,
    NOTIFY_EMAIL: body.NOTIFY_EMAIL ?? current.NOTIFY_EMAIL,
    SMTP_HOST: body.SMTP_HOST ?? current.SMTP_HOST,
    SMTP_PORT: body.SMTP_PORT ?? current.SMTP_PORT,
    SMTP_USER: body.SMTP_USER ?? current.SMTP_USER,
    SMTP_PASS: (body.SMTP_PASS && body.SMTP_PASS !== "••••••••") ? body.SMTP_PASS : current.SMTP_PASS,
  };

  saveSettings(updated);
  invalidateEnelClient();
  startInterval();
  res.json({ message: "Settings saved" });
});

// ── Option proxy routes (cascade selects in UI) ──

app.get("/api/options/cities", async (req, res) => {
  try {
    const client = await getEnelClient();
    const r = await client.get("/api/EnelmedApi/GetAllCities");
    res.json(r.data);
  } catch (err) {
    _enelClient = null;
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/options/service-types", async (req, res) => {
  const { cityId } = req.query;
  if (!cityId) return res.status(400).json({ error: "cityId required" });
  try {
    const client = await getEnelClient();
    const depsResp = await client.get("/api/EnelmedApi/GetDepartmentsByCityId", { params: { id: cityId } });
    const depIds = depsResp.data.map(d => d.DepartmentId);
    const typesResp = await client.post(
      "/api/EnelmedApi/GetServiceTypesByDepartmentId",
      JSON.stringify(depIds),
      { headers: { "Content-Type": "application/json" } }
    );
    res.json(typesResp.data);
  } catch (err) {
    _enelClient = null;
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/options/services", async (req, res) => {
  const { cityId, typeId } = req.query;
  if (!cityId || !typeId) return res.status(400).json({ error: "cityId and typeId required" });
  try {
    const client = await getEnelClient();
    const depsResp = await client.get("/api/EnelmedApi/GetDepartmentsByCityId", { params: { id: cityId } });
    const depIds = depsResp.data.map(d => d.DepartmentId);
    const params = new URLSearchParams({ typeId });
    depIds.forEach(id => params.append("departments", id));
    const servicesResp = await client.get(`/api/EnelmedApi/GetServicesByTypeDepartmentId?${params}`);
    res.json(servicesResp.data);
  } catch (err) {
    _enelClient = null;
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/run", async (req, res) => {
  if (status.isRunning) return res.json({ message: "Already running" });
  runOnce().then(scheduleNext);
  res.json({ message: "Run started" });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  startInterval();
});
