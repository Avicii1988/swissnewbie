#!/usr/bin/env node
/**
 * One-off script: add data-label="<column header>" to every <td> inside
 * every .provider-table / .data-table across the site, so the mobile
 * "stacked card" CSS (see style.css, .table-scroll td::before) can show
 * a label next to each value.
 *
 * Usage: node scripts/add-table-data-labels.js [--dry-run]
 *
 * Assumptions verified against this codebase before writing this script:
 *   - every <table class="provider-table|data-table"> has both a <thead>
 *     and a <tbody>
 *   - no table in the site uses colspan/rowspan
 * The script still degrades safely (skips, warns) if it ever encounters
 * a table that breaks those assumptions, rather than emitting wrong
 * labels.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DRY_RUN = process.argv.includes("--dry-run");

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".git")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
    } else if (entry.name === "index.html") {
      out.push(full);
    }
  }
  return out;
}

function stripTags(html) {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeAttr(text) {
  return text.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function getColspan(tagOpen) {
  const m = tagOpen.match(/colspan=["']?(\d+)["']?/i);
  return m ? parseInt(m[1], 10) : 1;
}

// Extract top-level <tag ...>...</tag> cells from a row/section string.
// Safe here because cell content never contains a literal "</TAGNAME>"
// substring before its own close (verified: no nested tables, no th/td
// text containing "</th"/"</td").
function extractCells(rowHtml, tagName) {
  const cells = [];
  const re = new RegExp(`<${tagName}([^>]*)>([\\s\\S]*?)</${tagName}>`, "gi");
  let m;
  while ((m = re.exec(rowHtml)) !== null) {
    cells.push({ attrs: m[1], inner: m[2], full: m[0] });
  }
  return cells;
}

function buildHeaderLabels(theadHtml) {
  const headerRow = theadHtml.match(/<tr[^>]*>([\s\S]*?)<\/tr>/i);
  if (!headerRow) return null;
  const ths = extractCells(headerRow[1], "th");
  if (ths.length === 0) return null;
  const labels = [];
  for (const th of ths) {
    const span = getColspan(th.attrs);
    const label = stripTags(th.inner);
    for (let i = 0; i < span; i++) labels.push(label);
  }
  return labels;
}

function processTable(tableHtml) {
  const theadMatch = tableHtml.match(/<thead>([\s\S]*?)<\/thead>/i);
  const tbodyMatch = tableHtml.match(/<tbody>([\s\S]*?)<\/tbody>/i);
  if (!theadMatch || !tbodyMatch) {
    return { html: tableHtml, changed: false, skipped: true };
  }

  const labels = buildHeaderLabels(theadMatch[1]);
  if (!labels) {
    return { html: tableHtml, changed: false, skipped: true };
  }

  const tbodyInner = tbodyMatch[1];
  let changed = false;
  let cellCount = 0;

  // Single pass: replace each <tr>...</tr>, and within that callback,
  // replace each <td ...> opening tag. Avoids ever re-locating a row or
  // cell by its (possibly non-unique) string content.
  const newTbodyInner = tbodyInner.replace(/<tr[^>]*>[\s\S]*?<\/tr>/gi, (rowHtml) => {
    let colIndex = 0;
    return rowHtml.replace(/<td([^>]*)>/gi, (fullTag, attrs) => {
      const span = getColspan(attrs);
      const label = labels[Math.min(colIndex, labels.length - 1)] || "";
      colIndex += span;
      if (/data-label=/i.test(attrs)) {
        return fullTag; // already labeled, idempotent re-run
      }
      changed = true;
      cellCount++;
      return `<td data-label="${escapeAttr(label)}"${attrs}>`;
    });
  });

  if (!changed) {
    return { html: tableHtml, changed: false, skipped: false };
  }

  const newTableHtml =
    tableHtml.slice(0, tbodyMatch.index) +
    "<tbody>" + newTbodyInner + "</tbody>" +
    tableHtml.slice(tbodyMatch.index + tbodyMatch[0].length);

  return { html: newTableHtml, changed: true, cellCount };
}

function processFile(filePath) {
  const original = fs.readFileSync(filePath, "utf-8");
  const tableRe = /<table\s+class="(?:provider-table|data-table)"[^>]*>[\s\S]*?<\/table>/gi;

  let totalCells = 0;
  let tablesChanged = 0;
  let tablesSkipped = 0;
  let totalTables = 0;

  // Single pass over the whole file: replace-by-callback, never by
  // re-locating a possibly-duplicated string.
  const content = original.replace(tableRe, (tableHtml) => {
    totalTables++;
    const result = processTable(tableHtml);
    if (result.skipped) {
      tablesSkipped++;
      return tableHtml;
    }
    if (result.changed) {
      totalCells += result.cellCount;
      tablesChanged++;
      return result.html;
    }
    return tableHtml;
  });

  if (totalTables === 0 || content === original) return null;

  if (!DRY_RUN) {
    fs.writeFileSync(filePath, content, "utf-8");
  }

  return { tablesChanged, tablesSkipped, totalCells, totalTables };
}

function main() {
  const files = walk(ROOT, []);
  let filesChanged = 0;
  let grandTotalCells = 0;
  let grandTotalTables = 0;
  let grandSkipped = 0;

  for (const f of files) {
    const rel = path.relative(ROOT, f);
    const res = processFile(f);
    if (res) {
      filesChanged++;
      grandTotalCells += res.totalCells;
      grandTotalTables += res.totalTables;
      grandSkipped += res.tablesSkipped;
      console.log(
        `${rel}: ${res.tablesChanged}/${res.totalTables} tables, ${res.totalCells} <td> labeled` +
          (res.tablesSkipped ? ` (${res.tablesSkipped} skipped - no thead/tbody)` : "")
      );
    }
  }

  console.log("----");
  console.log(`${DRY_RUN ? "[dry-run] " : ""}Done. Files changed: ${filesChanged}, tables labeled: ${grandTotalTables - grandSkipped}, cells labeled: ${grandTotalCells}, tables skipped: ${grandSkipped}`);
}

main();
