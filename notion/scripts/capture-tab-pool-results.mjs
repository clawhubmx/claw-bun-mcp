#!/usr/bin/env bun
/**
 * Capture completed answers from open Notion tabs and write table + responses txt.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const CLI = "/Users/hesdx/Documents/toolings/bun-browser/dist/cli.js";
const OUT = join(ROOT, "notion/example/tab-pool-title-watch-runs");

const tabs = [
  { label: "A", shortId: "35ff", topic: "Protesters block road to Mexican World Cup stadium" },
  { label: "B", shortId: "7550", topic: "Fed interest rate decision June 2026" },
  { label: "C", shortId: "b57a", topic: "Apple WWDC announcements 2026" },
  { label: "D", shortId: "d92d", topic: "SpaceX IPO oversubscribed" },
];

mkdirSync(OUT, { recursive: true });

function runOnTab(tabRef, argv) {
  const full = ["bun", CLI, ...argv, "--tab", tabRef, "--json"];
  const result = spawnSync(full[0], full.slice(1), {
    encoding: "utf8",
    timeout: 120000,
    maxBuffer: 50 * 1024 * 1024,
  });
  return (result.stdout || "").trim();
}

function parseCli(stdout) {
  try {
    const parsed = JSON.parse(stdout);
    return parsed.success ? parsed.data : parsed;
  } catch {
    return null;
  }
}

function tryParseNewsJson(text) {
  if (!text) return null;
  const raw = String(text).trim();
  const start = raw.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < raw.length; i++) {
    if (raw[i] === "{") depth++;
    else if (raw[i] === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(raw.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function extractLoose(answer, topic) {
  const qm = answer.match(/"query"\s*:\s*"((?:\\.|[^"\\])*)"/);
  const tm = answer.match(/"time_period"\s*:\s*"((?:\\.|[^"\\])*)"/);
  const sm = answer.match(/"sources"\s*:\s*"((?:\\.|[^"\\])*)"/);
  const topics = [];
  const arrStart = answer.indexOf('"unique_topics"');
  if (arrStart >= 0) {
    const slice = answer.slice(arrStart);
    const re = /"((?:\\.|[^"\\])*)"/g;
    let inArray = false;
    for (const line of slice.split("\n")) {
      if (line.includes("[")) inArray = true;
      if (!inArray) continue;
      let m;
      while ((m = re.exec(line))) {
        const val = m[1].replace(/\\"/g, '"');
        if (val === "unique_topics") continue;
        if (/^[\[\],{}:\s]*$/.test(val)) continue;
        if (val.startsWith("query") || val.startsWith("time_period") || val.startsWith("sources")) continue;
        if (val.length > 12 && !topics.includes(val)) topics.push(val);
      }
      if (line.includes("]") && topics.length) break;
    }
  }
  return {
    query: qm?.[1]?.replace(/\\"/g, '"') || topic,
    time_period: tm?.[1]?.replace(/\\"/g, '"') || "",
    unique_topics: topics,
    sources: sm?.[1]?.replace(/\\"/g, '"') || "",
    parseMode: "loose",
  };
}

function captureTab(tab) {
  const js = `(function(){
    var h=globalThis.__notionAiChatHelpers;
    var msgs=h.getAssistantMessagesSinceLastUser();
    var ans=msgs.length?h.getAssistantAnswerSince(msgs,0):"";
    return {
      answer: ans,
      conversationId: h.getConversationId(),
      helpersVersion: h.version,
      hasCompleted: h.hasCompletedReplyActions(),
      isGen: h.isGenerating()
    };
  })()`;
  const data = parseCli(runOnTab(tab.shortId, ["eval", js]));
  const result = data?.result || data || {};
  let parsed = tryParseNewsJson(result.answer);
  let parseMode = parsed ? "json" : "none";
  if (!parsed && result.answer) {
    parsed = extractLoose(result.answer, tab.topic);
    parseMode = parsed.unique_topics.length ? "loose" : "none";
  }
  const pass = !!(parsed && Array.isArray(parsed.unique_topics) && parsed.unique_topics.length > 0);
  return { ...tab, ...result, answerJson: parsed, pass, parseMode, topicCount: parsed?.unique_topics?.length || 0 };
}

const startedAt = new Date().toISOString();
const results = tabs.map(captureTab);
const finishedAt = new Date().toISOString();
const passCount = results.filter((r) => r.pass).length;

const tableLines = [
  "# 4-tab pool test2 results",
  `Started: ${startedAt}`,
  `Finished: ${finishedAt}`,
  `Template: grok/example/test2.txt (full)`,
  `Passed: ${passCount}/${results.length}`,
  "",
  "| Tab | Tab ID | Topic | Topics | Parse | Status | Sources (preview) |",
  "| --- | --- | --- | ---: | --- | --- | --- |",
];

for (const r of results) {
  const src = String(r.answerJson?.sources || "").slice(0, 55).replace(/\|/g, "/");
  const topicCell = r.topic.length > 42 ? `${r.topic.slice(0, 41)}…` : r.topic;
  tableLines.push(
    `| ${r.label} | ${r.shortId} | ${topicCell} | ${r.topicCount} | ${r.parseMode} | ${r.pass ? "PASS" : "FAIL"} | ${src} |`,
  );
}

tableLines.push("", "## Unique topics by tab", "");
for (const r of results) {
  tableLines.push(`### Tab ${r.label} — ${r.topic}`);
  tableLines.push(
    `Status: ${r.pass ? "PASS" : "FAIL"} | tab=${r.shortId} | topics=${r.topicCount} | parse=${r.parseMode}`,
  );
  if (r.answerJson?.time_period) tableLines.push(`Time period: ${r.answerJson.time_period}`);
  if (r.answerJson?.sources) tableLines.push(`Sources: ${r.answerJson.sources}`);
  tableLines.push("");
  if (r.answerJson?.unique_topics?.length) {
    r.answerJson.unique_topics.forEach((t, i) => tableLines.push(`${i + 1}. ${t}`));
  } else {
    tableLines.push("(no topics extracted)");
  }
  tableLines.push("");
}

const responseLines = [
  "# tab-pool title-watch responses (4 tabs, test2 full)",
  `Started: ${startedAt}`,
  `Finished: ${finishedAt}`,
  `Template: grok/example/test2.txt`,
  `Passed: ${passCount}/${results.length}`,
  "",
];

for (const r of results) {
  responseLines.push("=".repeat(80));
  responseLines.push(`Tab ${r.label} (${r.shortId})`);
  responseLines.push(`Topic: ${r.topic}`);
  responseLines.push(`Status: ${r.pass ? "PASS" : "FAIL"} | topics=${r.topicCount} | parse=${r.parseMode}`);
  responseLines.push("-".repeat(80));
  responseLines.push(r.answerJson ? JSON.stringify(r.answerJson) : r.answer || "(no answer)");
  responseLines.push("");
}

writeFileSync(join(OUT, "results-table.txt"), `${tableLines.join("\n")}\n`);
writeFileSync(join(OUT, "responses.txt"), `${responseLines.join("\n")}\n`);
writeFileSync(
  join(OUT, "summary.json"),
  JSON.stringify(
    {
      startedAt,
      finishedAt,
      poolSize: 4,
      promptTemplate: "grok/example/test2.txt",
      passCount,
      tabs: results.map(({ answer, ...rest }) => rest),
    },
    null,
    2,
  ),
);

console.log(`Passed: ${passCount}/${results.length}`);
for (const r of results) {
  console.log(`  Tab ${r.label} (${r.shortId}): ${r.pass ? "PASS" : "FAIL"} | topics=${r.topicCount} | parse=${r.parseMode}`);
}
console.log(`Table: ${join(OUT, "results-table.txt")}`);
