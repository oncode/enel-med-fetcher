// Search apppointment on https://online.enel.pl/ for given service and city

const axios = require("axios");
const cheerio = require("cheerio");
const { CookieJar } = require("tough-cookie");
const { wrapper } = require("axios-cookiejar-support");

const BASE_URL = "https://online.enel.pl";

const LOGIN_ID = process.env.LOGIN_ID;
const PASSWORD = process.env.PASSWORD;

const CITY_ID = 1; // Warszawa
const ENGLISH = false; // if true, less doctors will be available (only english-speaking)
const DOCTORS = []; // leave empty to search all available doctors

const SERVICE = "1866"; // MR sacroiliac joints
const SERVICE_TYPE = "12"; // Magnetic resonance (MR)


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

function extractVisitCount(html) {
  const $ = cheerio.load(html);
  return $(".found-visit-count .count").text().trim();
}

function getPolishDate(offsetDays = 0) {
  const now = new Date();

  // Convert to Poland time using Intl
  const polishDate = new Date(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Warsaw",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(now)
  );

  polishDate.setDate(polishDate.getDate() + offsetDays);

  return polishDate.toISOString().slice(0, 10); // YYYY-MM-DD
}

// ---------- main ----------
(async function main() {
  try {
    // Change language to English
    if (ENGLISH) {
      await client.post(
        "/Home/ChangeCulture",
        new URLSearchParams({
          Culture: "en-US",
          "X-Requested-With": "XMLHttpRequest"
        }),
        {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "X-Requested-With": "XMLHttpRequest",
          }
        }
      );
    }

    // LOGIN PAGE (not needed verify first)
    // const loginPage = await client.get("/Account/Login");
    // const csrf1 = extractCsrf(loginPage.data);

    // await client.post(
    //   "/Account/VerifyLogin",
    //   new URLSearchParams({
    //     "__RequestVerificationToken": csrf1,
    //     Login: LOGIN_ID
    //   }),
    //   { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    // );

    // LOGIN STEP
    const loginPage2 = await client.get("/Account/Login");
    const csrf2 = extractCsrf(loginPage2.data);

    await client.post(
      "/Account/Login",
      new URLSearchParams({
        "__RequestVerificationToken": csrf2,
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

    console.log("✅ Logged in");

    // 3. GET REFERRAL
    const referralRespo = await client.get("/api/EnelmedApi/GetReferralForSearching", {
      params: { id: SERVICE, cancelId: "" }
    });

    // 4. GET DEPARTMENTS
    const departmentsResp = await client.get(
      "/api/EnelmedApi/GetDepartmentsByCityId",
      {
        params: {
          id: CITY_ID,
          serviceLock: SERVICE
        }
      }
    );

    const departments = departmentsResp.data.map(d => d.DepartmentId);
    console.log("🏥 Departments:", departments);

    // 5. GET DOCTORS
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

    // 6. SEARCH VISITS
    const searchPage = await client.get("/Visit/New");
    const searchCsrf = extractSearchCsrf(searchPage.data);

    const VISIT_DATE_FROM = getPolishDate(0);
    const VISIT_DATE_TO = getPolishDate(14);
    const DATE_ISSUED = getPolishDate(0);

    const searchParams = new URLSearchParams({
      "__RequestVerificationToken": searchCsrf,

      CurrentPage: 1,
      PageSize: 0,

      ReferralRequired: true,
      HasReferral: true,
      ServiceLock: SERVICE,
      ServiceTypeLock: SERVICE_TYPE,
      City: CITY_ID,
      VisitDateFrom: VISIT_DATE_FROM,
      VisitDateTo: VISIT_DATE_TO,
      DateIssued: DATE_ISSUED,
      Service: SERVICE,
      ServiceType: 12,
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

    // 7. PARSE RESULT COUNT
    // console.log(searchResp.data);

    const foundCount = extractVisitCount(searchResp.data);
    console.log("📊 Found visit count:", foundCount);

  } catch (err) {
    console.error("❌ Error:", err.message);
  }
})();
