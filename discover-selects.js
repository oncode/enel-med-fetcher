// Discovery script: logs in, fetches /Visit/New, and extracts
// the city select options + all JS references to API endpoints.
// Run: node --env-file=.env discover-selects.js

const axios = require("axios");
const cheerio = require("cheerio");
const { CookieJar } = require("tough-cookie");
const { wrapper } = require("axios-cookiejar-support");

const BASE_URL = "https://online.enel.pl";

async function main() {
  const LOGIN_ID = process.env.LOGIN_ID;
  const PASSWORD = process.env.PASSWORD;
  if (!LOGIN_ID || !PASSWORD) {
    console.error("Set LOGIN_ID and PASSWORD in .env");
    process.exit(1);
  }

  const jar = new CookieJar();
  const client = wrapper(axios.create({
    baseURL: BASE_URL,
    jar,
    withCredentials: true,
    headers: { "User-Agent": "Mozilla/5.0", "X-Requested-With": "XMLHttpRequest" },
    maxRedirects: 10,
  }));

  // Login
  const loginPage = await client.get("/Account/Login");
  const $l = cheerio.load(loginPage.data);
  const csrf = $l('input[name="__RequestVerificationToken"]').val();

  await client.post(
    "/Account/Login",
    new URLSearchParams({
      "__RequestVerificationToken": csrf,
      MediSpot: "", PersonalDataVerification: "None",
      Login: LOGIN_ID, Password: PASSWORD,
    }),
    { params: { ReturnUrl: "/" }, headers: { "Content-Type": "application/x-www-form-urlencoded" } }
  );
  console.log("✅ Logged in\n");

  // Fetch Visit/New
  const visitPage = await client.get("/Visit/New");
  const $ = cheerio.load(visitPage.data);

  // --- Extract all <select> names and their <option> values ---
  console.log("=== SELECT ELEMENTS ===");
  $("select").each((_, el) => {
    const name = $(el).attr("name") || $(el).attr("id") || "(unnamed)";
    const opts = [];
    $(el).find("option").each((_, o) => {
      opts.push({ val: $(o).val(), text: $(o).text().trim() });
    });
    console.log(`\n[${name}]`);
    opts.slice(0, 20).forEach(o => console.log(`  ${o.val || "(empty)"} => ${o.text}`));
    if (opts.length > 20) console.log(`  ... ${opts.length - 20} more`);
  });

  // --- Find all inline <script> blocks and look for URL patterns ---
  console.log("\n\n=== API URL PATTERNS IN SCRIPTS ===");
  const apiRefs = new Set();
  $("script:not([src])").each((_, el) => {
    const src = $(el).html() || "";
    // capture anything that looks like an API path
    const matches = src.match(/["'`]\/[^"'`\s]{5,}["'`]/g) || [];
    matches.forEach(m => {
      const url = m.replace(/["'`]/g, "");
      if (url.includes("api") || url.includes("Visit") || url.includes("GetS") || url.includes("GetC")) {
        apiRefs.add(url);
      }
    });
    // also look for ajax/fetch/$.get patterns with context
    const ajaxMatches = src.match(/.{0,60}(ajax|fetch|\$\.get|\$\.post|url\s*:).{0,80}/gi) || [];
    ajaxMatches.forEach(m => apiRefs.add("AJAX CTX: " + m.trim().replace(/\s+/g, " ")));
  });
  [...apiRefs].forEach(r => console.log(" ", r));

  // --- External script tags ---
  console.log("\n\n=== EXTERNAL SCRIPTS ===");
  $("script[src]").each((_, el) => console.log(" ", $(el).attr("src")));

  // --- Try known-pattern endpoints to see what they return ---
  console.log("\n\n=== PROBING KNOWN-PATTERN ENDPOINTS ===");

  const probes = [
    "/api/EnelmedApi/GetCities",
    "/api/EnelmedApi/GetAllCities",
    "/api/EnelmedApi/GetServiceTypes",
    "/api/EnelmedApi/GetServiceCategories",
    "/api/EnelmedApi/GetServices",
    "/api/EnelmedApi/GetServicesByServiceType",
    "/api/EnelmedApi/GetServiceTypesByCity",
    "/api/EnelmedApi/GetServiceTypesByCityId",
    "/api/EnelmedApi/GetServiceCategorisByCityId",
    "/api/EnelmedApi/GetCategoriesByCityId",
    "/api/EnelmedApi/GetServicesByCategoryId",
    "/api/EnelmedApi/GetServicesByCategory",
  ];

  for (const url of probes) {
    try {
      const r = await client.get(url, { params: { id: 1 }, validateStatus: () => true });
      const preview = JSON.stringify(r.data).slice(0, 120);
      console.log(`  ${r.status} ${url} => ${preview}`);
    } catch (e) {
      console.log(`  ERR ${url} => ${e.message}`);
    }
  }

  // --- Probe the service-type endpoint with city parameter ---
  console.log("\n\n=== PROBING WITH CITY=1 ===");
  const cityProbes = [
    "/api/EnelmedApi/GetServiceTypesByCityId",
    "/api/EnelmedApi/GetCategoriesByCityId",
    "/api/EnelmedApi/GetServiceCategorisByCityId",
  ];
  for (const url of cityProbes) {
    try {
      const r = await client.get(url, { params: { cityId: 1 }, validateStatus: () => true });
      const preview = JSON.stringify(r.data).slice(0, 200);
      console.log(`  ${r.status} ${url}?cityId=1 => ${preview}`);
    } catch (e) {
      console.log(`  ERR ${url} => ${e.message}`);
    }
  }
}

main().catch(e => { console.error("Fatal:", e.message); process.exit(1); });
