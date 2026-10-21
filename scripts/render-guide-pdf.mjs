import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const source = process.argv[2]
  ? fileURLToPath(new URL(process.argv[2], import.meta.url))
  : fileURLToPath(new URL("../docs/strategy-desk-guide.md", import.meta.url));
const target = process.argv[3]
  ? fileURLToPath(new URL(process.argv[3], import.meta.url))
  : fileURLToPath(new URL("../public/strategy-desk-guide.pdf", import.meta.url));
const banner = process.argv[4] ?? "Strategy Desk 1.4.0";
const subtitle = process.argv[5] ?? "User's guide";
const markdown = readFileSync(source, "utf8");

function escape(text) {
  return text
    .replaceAll("&", "&")
    .replaceAll("<", "<")
    .replaceAll(">", ">");
}

function inline(text) {
  const parts = text.split(/(`[^`]+`)/g);
  return parts
    .map((part) => {
      if (part.startsWith("`") && part.endsWith("`")) return `<code>${escape(part.slice(1, -1))}</code>`;
      return escape(part).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    })
    .join("");
}

function blocks(md) {
  const lines = md.replaceAll("\r\n", "\n").split("\n");
  const out = [];
  let i = 0;
  const para = [];
  const flush = () => {
    if (!para.length) return;
    out.push({ type: "p", text: para.join(" ") });
    para.length = 0;
  };
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith("```")) {
      flush();
      const buf = [];
      i += 1;
      while (i < lines.length && !lines[i].startsWith("```")) {
        buf.push(lines[i]);
        i += 1;
      }
      out.push({ type: "pre", text: buf.join("\n") });
      i += 1;
      continue;
    }
    if (line.trim() === "") {
      flush();
      i += 1;
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      out.push({ type: `h${heading[1].length}`, text: heading[2] });
      i += 1;
      continue;
    }
    if (line.includes("|") && i + 1 < lines.length && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1])) {
      flush();
      const rows = [];
      while (i < lines.length && lines[i].includes("|")) {
        if (!/^\s*\|?\s*:?-{3,}/.test(lines[i])) {
          rows.push(
            lines[i]
              .trim()
              .replace(/^\|/, "")
              .replace(/\|$/, "")
              .split("|")
              .map((cell) => cell.trim()),
          );
        }
        i += 1;
      }
      out.push({ type: "table", rows });
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      flush();
      const items = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^[-*]\s+/, ""));
        i += 1;
      }
      out.push({ type: "ul", items });
      continue;
    }
    if (/^\d+\.\s+/.test(line)) {
      flush();
      const items = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\.\s+/, ""));
        i += 1;
      }
      out.push({ type: "ol", items });
      continue;
    }
    para.push(line.trim());
    i += 1;
  }
  flush();
  return out;
}

function render(md) {
  return blocks(md)
    .map((block) => {
      if (block.type === "pre") return `<pre>${escape(block.text)}</pre>`;
      if (block.type === "ul") return `<ul>${block.items.map((item) => `<li>${inline(item)}</li>`).join("")}</ul>`;
      if (block.type === "ol") return `<ol>${block.items.map((item) => `<li>${inline(item)}</li>`).join("")}</ol>`;
      if (block.type === "table") {
        const [head, ...body] = block.rows;
        const headHtml = head.map((cell) => `<th>${inline(cell)}</th>`).join("");
        const bodyHtml = body
          .map((row) => `<tr>${row.map((cell) => `<td>${inline(cell)}</td>`).join("")}</tr>`)
          .join("");
        return `<table><thead><tr>${headHtml}</tr></thead><tbody>${bodyHtml}</tbody></table>`;
      }
      return `<${block.type}>${inline(block.text)}</${block.type}>`;
    })
    .join("\n");
}

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${banner} — ${subtitle}</title>
<style>
  @page { size: letter; margin: 0.7in 0.75in 0.75in; }
  * { box-sizing: border-box; }
  html { font-size: 11pt; }
  body {
    margin: 0;
    color: #101416;
    background: #f3ecdf;
    font-family: "Liberation Sans", "DejaVu Sans", sans-serif;
    line-height: 1.45;
  }
  h1 { font-size: 22pt; font-weight: 600; letter-spacing: -0.02em; margin: 0 0 0.4em; }
  h2 { font-size: 14pt; font-weight: 600; margin: 1.4em 0 0.4em; break-after: avoid; }
  h3 { font-size: 12pt; font-weight: 600; margin: 1.1em 0 0.3em; break-after: avoid; }
  p { margin: 0.45em 0; }
  strong { font-weight: 600; }
  code {
    font-family: "Liberation Mono", "DejaVu Sans Mono", monospace;
    font-size: 0.92em;
    background: #e7e0d2;
    padding: 0 0.2em;
  }
  pre {
    font-family: "Liberation Mono", "DejaVu Sans Mono", monospace;
    font-size: 9.5pt;
    background: #182023;
    color: #f3ecdf;
    padding: 0.7em 0.85em;
    white-space: pre-wrap;
    break-inside: avoid;
  }
  pre code { background: transparent; color: inherit; padding: 0; }
  ul, ol { margin: 0.4em 0 0.6em; padding-left: 1.3em; }
  li { margin: 0.15em 0; }
  table { width: 100%; border-collapse: collapse; margin: 0.6em 0 0.9em; break-inside: avoid; font-size: 10pt; }
  th, td { text-align: left; vertical-align: top; border-bottom: 1px solid #c9bfae; padding: 0.28em 0.5em 0.28em 0; }
  th { font-weight: 600; border-bottom-color: #101416; }
  a { color: #6e5324; }
</style>
</head>
<body>
${render(markdown)}
</body>
</html>`;

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell",
  headless: true,
});
const page = await browser.newPage();
await page.setContent(html, { waitUntil: "load" });
await page.pdf({
  path: target,
  format: "Letter",
  printBackground: true,
  displayHeaderFooter: true,
  headerTemplate: `<div style="font-size:8px;width:100%;padding:0 0.75in;color:#6e6256;font-family:sans-serif;">${banner} <span style="float:right">${subtitle}</span></div>`,
  footerTemplate: `<div style="font-size:8px;width:100%;padding:0 0.75in;color:#6e6256;font-family:sans-serif;">Play money only. Not a live order. <span style="float:right"><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
  margin: { top: "0.7in", bottom: "0.7in", left: "0.75in", right: "0.75in" },
});
await browser.close();
console.log(target);
