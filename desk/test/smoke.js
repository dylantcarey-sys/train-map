// Smoke test for the built Desk: loads desk/dist/timetable-desk.html with an in-memory database
// and reports page errors. Usage: node desk/test/smoke.js [seed.json]
// The seed is {"documents": {"<collection>/<doc id>": {fields}}}, e.g. a download of the Desk database.
// Playwright: uses the copy installed in the environment (Chromium is preinstalled; don't run "playwright install").
const path = require("path"), fs = require("fs");
let pw; try { pw = require("playwright"); } catch { pw = require("/opt/npm-tools/node_modules/playwright"); }
const here = __dirname, desk = path.join(here, "..");
const seedFile = process.argv[2] || path.join(here, "seed.json");
const seed = fs.existsSync(seedFile) ? JSON.parse(fs.readFileSync(seedFile)).documents : {};
(async () => {
  const html = `<!doctype html><html><head><meta charset=utf8></head><body><script>window.__SEED=${JSON.stringify(seed)};window.__DELAY=0</script><script>${fs.readFileSync(path.join(here, "mock.js"))}</script>` + fs.readFileSync(path.join(desk, "dist", "timetable-desk.html"), "utf8") + `</body></html>`;
  const b = await pw.chromium.launch(); const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = []; p.on("pageerror", e => errs.push(e.message));
  await p.route(/fonts\./, r => r.abort());
  await p.route("**/stations.json", r => r.fulfill({ path: path.join(desk, "stations.json"), contentType: "application/json" }));
  await p.route("http://desk.test/", r => r.fulfill({ body: html, contentType: "text/html" }));
  await p.goto("http://desk.test/"); await p.waitForTimeout(2500);
  console.log("home:", await p.$$eval(".tile .l", x => x.map(e => e.textContent).join(" | ")));
  await p.click("#btnTrains").catch(() => {}); await p.waitForTimeout(500);
  await p.click("#mtList button, [data-mtsel]").catch(() => {}); await p.waitForTimeout(800);
  console.log("train view:", !!(await p.$("#trProg")) ? "ok" : "not opened");
  if (process.env.SHOT) await p.screenshot({ path: process.env.SHOT });
  console.log(errs.length ? "PAGE ERRORS:\n" + errs.join("\n") : "no page errors");
  await b.close(); process.exit(errs.length ? 1 : 0);
})();
