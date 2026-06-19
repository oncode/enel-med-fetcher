const express = require("express");
const fs = require("fs");
const path = require("path");
const { run } = require("./index");

const app = express();
const PORT = process.env.PORT || 3000;
const SETTINGS_FILE = path.join(__dirname, "settings.json");

const DEFAULT_SETTINGS = {
  LOGIN_ID: process.env.LOGIN_ID || "",
  PASSWORD: process.env.PASSWORD || "",
  CITY_ID: 1,
  ENGLISH: false,
  DOCTORS: [],
  SKIP_IMMEDIATE: true,
  SERVICE: "1765",
  SERVICE_TYPE: "13",
  INTERVAL_MINUTES: 5,
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
  isRunning: false,
  nextRunTime: null,
};

let intervalHandle = null;

async function runOnce() {
  if (status.isRunning) return;
  status.isRunning = true;
  status.lastRunTime = new Date().toISOString();
  status.lastRunError = null;
  try {
    const settings = loadSettings();
    status.lastRunResult = await run(settings);
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

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/status", (req, res) => {
  res.json(status);
});

app.get("/api/settings", (req, res) => {
  const settings = loadSettings();
  res.json({ ...settings, PASSWORD: settings.PASSWORD ? "••••••••" : "" });
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
  };

  saveSettings(updated);
  startInterval();
  res.json({ message: "Settings saved" });
});

app.get("/api/run", async (req, res) => {
  if (status.isRunning) {
    return res.json({ message: "Already running" });
  }
  runOnce().then(scheduleNext);
  res.json({ message: "Run started" });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  startInterval();
});
