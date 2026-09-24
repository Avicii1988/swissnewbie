#!/usr/bin/env node
/**
 * One-off layout regression check (throwaway, not wired into any build).
 *
 * Serves the repo as a static site on localhost, then for every URL in
 * sitemap.xml and every width in WIDTHS, checks for horizontal overflow
 * and the specific regressions described in the layout-bugs task:
 *   - page-level horizontal scroll
 *   - overflowing elements inside .topic-body/.topic-section/main
 *   - .table-scroll still overflowing at <=600px
 *   - .toc-nav a taller than 40px
 *   - .checklist-simple li / .editorial-disclaimer computed as flex
 *   - .guide-hero with a leftover inline style attribute, or
 *     padding-bottom < 24px
 *
 * Usage: node scripts/layout-check.js [--urls=/path1,/path2] [--widths=390,1280]
 */

const fs = require("fs");
const path = require("path");
const http = require("http");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "..");
const PORT = 8943;
const DEFAULT_WIDTHS = [320, 375, 390, 430, 768, 1024, 1280];
const HEIGHT = 1000;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".xml": "application/xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function startServer() {
  const server = http.createServer((req, res) => {
    let urlPath = decodeURIComponent(req.url.split("?")[0]);
    if (urlPath.endsWith("/")) urlPath += "index.html";
    let filePath = path.join(ROOT, urlPath);
    if (!filePath.startsWith(ROOT)) {
      res.writeHead(403);
      res.end();
      return;
    }
    fs.readFile(filePath, (err, data) => {
      if (err) {
        // try appending /index.html (extensionless clean URL)
        fs.readFile(path.join(filePath, "index.html"), (err2, data2) => {
          if (err2) {
            res.writeHead(404);
            res.end("Not found: " + urlPath);
            return;
          }
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(data2);
        });
        return;
      }
      const ext = path.extname(filePath);
      res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
      res.end(data);
    });
  });
  return new Promise((resolve) => {
    server.listen(PORT, () => resolve(server));
  });
}

function getSitemapPaths() {
  const xml = fs.readFileSync(path.join(ROOT, "sitemap.xml"), "utf-8");
  const locs = [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1]);
  return locs.map((loc) => {
    const u = new URL(loc);
    return u.pathname;
  });
}

function parseArgList(flag) {
  const arg = process.argv.find((a) => a.startsWith(flag + "="));
  if (!arg) return null;
  return arg.slice(flag.length + 1).split(",").filter(Boolean);
}

async function checkPage(page, urlPath, width) {
  const failures = [];
  const url = `http://localhost:${PORT}${urlPath}`;
  const resp = await page.goto(url, { waitUntil: "networkidle" });
  if (!resp || resp.status() >= 400) {
    failures.push(`HTTP ${resp ? resp.status() : "no response"}`);
    return failures;
  }

  // Homepage: open all checklist accordion sections so their tables are
  // visible/measurable, per task instructions.
  if (urlPath === "/" || urlPath === "/de/" || urlPath === "/fr/") {
    await page.evaluate(() => {
      document.querySelectorAll(".acc-item").forEach((el) => el.classList.add("open"));
    });
  }

  const result = await page.evaluate(() => {
    const out = { failures: [] };

    // 1) page-level horizontal scroll
    const docEl = document.documentElement;
    if (docEl.scrollWidth > window.innerWidth + 1) {
      out.failures.push(
        `page scrollWidth ${docEl.scrollWidth} > innerWidth ${window.innerWidth}`
      );
    }

    // 2) overflowing elements inside .topic-body/.topic-section/main,
    //    excluding intentional horizontal-scroll containers.
    const scope = document.querySelectorAll(".topic-body, .topic-section, main");
    const seen = new Set();
    scope.forEach((root) => {
      const all = root.querySelectorAll("*");
      all.forEach((el) => {
        if (seen.has(el)) return;
        seen.add(el);
        if (el.closest(".table-scroll")) return; // intentional scroll container / its contents
        if (el.tagName === "PRE" || el.closest("pre")) return; // pre-wrap text blocks
        if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0) {
          out.failures.push(
            `overflow: <${el.tagName.toLowerCase()} class="${el.className || ""}"> scrollWidth ${el.scrollWidth} > clientWidth ${el.clientWidth}`
          );
        }
      });
    });

    // 3) .table-scroll overflowing at <=600px
    if (window.innerWidth <= 600) {
      document.querySelectorAll(".table-scroll").forEach((el) => {
        if (el.scrollWidth > el.clientWidth + 1) {
          out.failures.push(
            `.table-scroll overflow at <=600px: scrollWidth ${el.scrollWidth} > clientWidth ${el.clientWidth}`
          );
        }
      });
    }

    // 4) .toc-nav a taller than 40px
    document.querySelectorAll(".toc-nav a").forEach((el) => {
      const h = el.getBoundingClientRect().height;
      if (h > 40) {
        out.failures.push(`.toc-nav a height ${h.toFixed(1)}px > 40px`);
      }
    });

    // 5) .checklist-simple li / .editorial-disclaimer must not be flex
    document.querySelectorAll(".checklist-simple li, .editorial-disclaimer").forEach((el) => {
      const d = getComputedStyle(el).display;
      if (d === "flex") {
        out.failures.push(`${el.className} is display:flex (expected block)`);
      }
    });

    // 6) .guide-hero must have no inline style, and padding-bottom >= 24px
    document.querySelectorAll(".guide-hero").forEach((el) => {
      if (el.getAttribute("style")) {
        out.failures.push(`.guide-hero has inline style="${el.getAttribute("style")}"`);
      }
      const pb = parseFloat(getComputedStyle(el).paddingBottom || "0");
      if (pb < 24) {
        out.failures.push(`.guide-hero computed padding-bottom ${pb}px < 24px`);
      }
    });

    return out;
  });

  return result.failures;
}

async function main() {
  const server = await startServer();
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  });
  const context = await browser.newContext();
  const page = await context.newPage();

  const urls = parseArgList("--urls") || getSitemapPaths();
  const widths = (parseArgList("--widths") || DEFAULT_WIDTHS.map(String)).map(Number);

  console.log(`Checking ${urls.length} URLs x ${widths.length} widths = ${urls.length * widths.length} checks\n`);

  let totalFailures = 0;
  const failuresByUrl = {};

  for (const urlPath of urls) {
    for (const width of widths) {
      await page.setViewportSize({ width, height: HEIGHT });
      let failures;
      try {
        failures = await checkPage(page, urlPath, width);
      } catch (e) {
        failures = [`ERROR: ${e.message}`];
      }
      if (failures.length > 0) {
        totalFailures += failures.length;
        failuresByUrl[urlPath] = failuresByUrl[urlPath] || {};
        failuresByUrl[urlPath][width] = failures;
        console.log(`FAIL ${urlPath} @ ${width}px:`);
        failures.forEach((f) => console.log(`   - ${f}`));
      } else {
        console.log(`ok   ${urlPath} @ ${width}px`);
      }
    }
  }

  console.log("\n==== SUMMARY ====");
  console.log(`URLs checked: ${urls.length}`);
  console.log(`Widths checked: ${widths.join(", ")}`);
  console.log(`Total failures: ${totalFailures}`);
  const failingUrls = Object.keys(failuresByUrl);
  console.log(`URLs with at least one failure: ${failingUrls.length}`);
  failingUrls.forEach((u) => {
    console.log(`  ${u}: widths [${Object.keys(failuresByUrl[u]).join(", ")}]`);
  });

  await browser.close();
  server.close();
  process.exit(totalFailures > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
