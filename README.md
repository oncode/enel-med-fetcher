# enel-med

A Node.js script that searches for available medical appointments on [online.enel.pl](https://online.enel.pl) for a given service and city.

## What it does

1. Logs into the enel-med patient portal using your credentials
2. Fetches available departments in the selected city
3. Fetches doctors offering the selected service
4. Searches for available appointment slots within the next 14 days
5. Reports the number of found visits

## Configuration

Edit the constants at the top of [index.js](index.js):

| Constant | Default | Description |
|---|---|---|
| `CITY_ID` | `1` (Warszawa) | City to search in |
| `ENGLISH` | `false` | Set to `true` to filter for English-speaking doctors only |
| `DOCTORS` | `[]` | List of specific doctor IDs to search; leave empty for all |
| `SERVICE` | `"1866"` | Service ID (e.g. MR sacroiliac joints) |
| `SERVICE_TYPE` | `"12"` | Service type ID (e.g. Magnetic resonance) |

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create a `.env` file with your login credentials:

```env
LOGIN_ID=your_login
PASSWORD=your_password
```

## Usage

```bash
npm start
```

The script will log in, query available appointments, and print the number of found visits to the console.

To automatically run the script at a specified interval, use a tool like [pm2](https://pm2.keymetrics.io/) or [node-schedule](https://www.npmjs.com/package/node-schedule). Or just a simple while loop in your terminal running the script every 5 minutes:

```bash
while true; do npm start; sleep 300; done
```

## Dependencies

- [axios](https://github.com/axios/axios) — HTTP client
- [axios-cookiejar-support](https://github.com/3846masa/axios-cookiejar-support) — Cookie jar support for axios
- [cheerio](https://cheerio.js.org/) — HTML parsing (for CSRF tokens and result scraping)
- [tough-cookie](https://github.com/salesforce/tough-cookie) — Cookie management
