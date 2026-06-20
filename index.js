// Search appointments on https://online.enel.pl/ for given service and city

const axios = require("axios");
const cheerio = require("cheerio");
const { CookieJar } = require("tough-cookie");
const { wrapper } = require("axios-cookiejar-support");

const BASE_URL = "https://online.enel.pl";

// ---------- helpers ----------
function extractCsrf(html) {
  const $ = cheerio.load(html);
  const token = $('input[name="__RequestVerificationToken"]').val();
  if (!token) throw new Error("CSRF token not found");
  return token;
}

function extractSearchCsrf(html) {
  const $ = cheerio.load(html);
  const token = $('#SearchVisitForm input[name="__RequestVerificationToken"]').val();
  if (!token) throw new Error("CSRF token not found");
  return token;
}

function extractVisitCount(html, skipImmediate = true) {
  const $ = cheerio.load(html);

  if (!skipImmediate) {
    return parseInt($(".found-visit-count .count").text().trim(), 10) || 0;
  } else {
    // count only appointments that are not within the next 1 hour
    // TODO: make the count work if there would be .pagination active
    let visitCount = 0;

    $("#visit-result .visit-box .date-time").each((i, el) => {
      const dateStr = $(el).find(".date span").first().text().trim();
      const timeStr = $(el).find(".time span").first().text().trim();

      const dateTime = new Date(`${dateStr} ${timeStr}`.replace(/(\d{2})\.(\d{2})\.(\d{4}) (\d{2}):(\d{2})/, "$3-$2-$1T$4:$5:00"));
      const diffHours = (dateTime - new Date()) / (1000 * 60 * 60);

      if (diffHours > 1) visitCount++;
    });

    return visitCount;
  }
}

function getPolishDate(offsetDays = 0) {
  const now = new Date();
  const polishDate = new Date(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Warsaw",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(now)
  );
  polishDate.setDate(polishDate.getDate() + offsetDays);
  return polishDate.toISOString().slice(0, 10);
}

// ---------- auth ----------
async function createEnelClient(settings = {}) {
  const { LOGIN_ID, PASSWORD, ENGLISH = false } = settings;

  const jar = new CookieJar();
  const client = wrapper(
    axios.create({
      baseURL: BASE_URL,
      jar,
      withCredentials: true,
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Accept": "*/*",
        "X-Requested-With": "XMLHttpRequest"
      }
    })
  );

  if (ENGLISH) {
    await client.post(
      "/Home/ChangeCulture",
      new URLSearchParams({ Culture: "en-US", "X-Requested-With": "XMLHttpRequest" }),
      { headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", "X-Requested-With": "XMLHttpRequest" } }
    );
  }

  const loginPage = await client.get("/Account/Login");
  const csrf = extractCsrf(loginPage.data);

  const loginResp = await client.post(
    "/Account/Login",
    new URLSearchParams({
      "__RequestVerificationToken": csrf,
      MediSpot: "",
      PersonalDataVerification: "None",
      Login: LOGIN_ID,
      Password: PASSWORD
    }),
    {
      params: { ReturnUrl: "/" },
      headers: { "Content-Type": "application/x-www-form-urlencoded" }
    }
  );

  const $login = cheerio.load(loginResp.data);
  if ($login('input[name="Login"]').length > 0) {
    throw new Error("Authentication failed — check LOGIN_ID and PASSWORD");
  }

  return client;
}

// ---------- main ----------
async function run(settings = {}) {
  const {
    CITY_ID = 1,
    ENGLISH = false,
    DEPARTMENTS = [],
    DOCTORS = [],
    SKIP_IMMEDIATE = true,
    SERVICE = "1765",
    SERVICE_TYPE = "13",
    VISIT_WEEKS = 2,
  } = settings;

  const client = await createEnelClient(settings);
  console.log("✅ Logged in");

  // GET REFERRAL
  await client.get("/api/EnelmedApi/GetReferralForSearching", {
    params: { id: SERVICE, cancelId: "" }
  });

  // GET DEPARTMENTS
  const departmentsResp = await client.get("/api/EnelmedApi/GetDepartmentsByCityId", {
    params: { id: CITY_ID, serviceLock: SERVICE }
  });
  const allDepartmentIds = departmentsResp.data.map(d => d.DepartmentId);
  const departments = DEPARTMENTS.length > 0
    ? allDepartmentIds.filter(id => DEPARTMENTS.includes(id))
    : allDepartmentIds;
  console.log("🏥 Departments:", departments);

  // GET DOCTORS
  const doctorParams = new URLSearchParams({
    ServiceId: SERVICE,
    ForeignLanguage: ENGLISH ? true : false,
  });
  departments.forEach(id => doctorParams.append("DepartmentsId[]", id));

  const doctorsResp = await client.post(
    "/api/EnelmedApi/GetDoctorsByDepartmentIdAndByServiceId",
    doctorParams,
    { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
  );
  const doctors = doctorsResp.data.map(d => d.DoctorId);
  console.log("👨‍⚕️ Doctors:", doctors);

  // SEARCH VISITS
  const searchPage = await client.get("/Visit/New");
  const searchCsrf = extractSearchCsrf(searchPage.data);

  const searchParams = new URLSearchParams({
    "__RequestVerificationToken": searchCsrf,
    CurrentPage: 1,
    PageSize: 0,
    ReferralRequired: true,
    HasReferral: true,
    ServiceLock: SERVICE,
    ServiceTypeLock: SERVICE_TYPE,
    City: CITY_ID,
    VisitDateFrom: getPolishDate(0),
    VisitDateTo: getPolishDate(Math.max(1, VISIT_WEEKS) * 7),
    DateIssued: getPolishDate(0),
    Service: SERVICE,
    ServiceType: SERVICE_TYPE,
    EVisit: true,
    StationaryVisit: true,
    ChangeDate: false,
    ReferralMandatory: false,
    ReferralMandatoryText: "",
    DepartmentLock: "",
    SearchPremium: false,
    CanSearchPremium: false,
    ContactTypeFilterVisible: false,
    EVisitPhone: true,
    EVisitChat: true,
    EVisitVideo: true,
    CheckedReasons: "",
    VisitToCancelId: "",
    BookWithoutReferral: false,
    TaxNumber: "",
    IssuedBy: "",
    IssuingDoctor: "",
    FiltersVisible: true,
    'X-Requested-With': 'XMLHttpRequest'
  });

  departments.forEach(id => searchParams.append("Department", id));
  (DOCTORS.length > 0 ? DOCTORS : doctors).forEach(id => searchParams.append("Doctor", id));

  const searchResp = await client.post(
    "/Visit/Search?Length=5",
    searchParams,
    { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
  );

  const foundCount = extractVisitCount(searchResp.data, SKIP_IMMEDIATE);
  console.log("📊 Found visit count:", foundCount);

  if (foundCount > 0) {
    console.log("\x07"); // beep
  }

  return foundCount;
}

module.exports = { run, createEnelClient };

// Run directly when invoked as main script
if (require.main === module) {
  run({
    LOGIN_ID: process.env.LOGIN_ID,
    PASSWORD: process.env.PASSWORD,
  }).catch(err => {
    console.error("❌ Error:", err.message);
    process.exit(1);
  });
}
