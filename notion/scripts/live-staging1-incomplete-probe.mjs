#!/usr/bin/env bun
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const PROBE_DIR = join(ROOT, "notion/example/incomplete-reply-probe");
const PROMPTS_META = join(PROBE_DIR, "prompts.json");
const OUT_DIR = join(PROBE_DIR, "runs");
const TAB = "8922";
const SSH = "staging1";
const CONTAINER = "bunbrowser";
const CONTAINER_PROBE = "/root/.bun-browser/claw-bun-mcp/notion/example/incomplete-reply-probe";
const maxPolls = 3;

const plan = [
  { id: "p02-json-guard", file: "prompt-02-json-guard.txt", submitMaxWaitMs: 8000 },
  { id: "p03-streaming-stress", file: "prompt-03-streaming-news.txt", submitMaxWaitMs: 5000 },
  { id: "p05-preamble-edge", file: "prompt-05-preamble-json.txt", submitMaxWaitMs: 8000 },
  { id: "p02-json-guard-short-wait", file: "prompt-02-json-guard.txt", submitMaxWaitMs: 3000 },
];

const meta = JSON.parse(readFileSync(PROMPTS_META, "utf8"));
const metaById = Object.fromEntries(meta.prompts.map((p) => [p.id, p]));

function hashAnswer(text) {
  return createHash("sha256").update(String(text || "")).digest("hex").slice(0, 16);
}

function sshDocker(argv, timeoutMs = 120000) {
  const inner = ["bun-browser", ...argv, "--tab", TAB, "--json"].join(" ");
  const cmd = `docker exec ${CONTAINER} ${inner}`;
  const result = spawnSync("ssh", [SSH, cmd], {
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 50 * 1024 * 1024,
  });
  return {
    cmd,
    stdout: (result.stdout || "").trim(),
    stderr: (result.stderr || "").trim(),
    status: result.status,
    timedOut: result.signal === "SIGTERM",
  };
}

function parseJson(stdout) {
  if (!stdout) return null;
  try {
    const parsed = JSON.parse(stdout);
    if (parsed && typeof parsed === "object" && "success" in parsed) {
      return parsed.success
        ? parsed.data
        : { error: parsed.error, hint: parsed.hint, kind: parsed.kind, action: parsed.action };
    }
    return parsed;
  } catch {
    return { error: "invalid json", raw: stdout.slice(0, 800) };
  }
}

const probeJs = `(function(){var h=globalThis.__notionAiChatHelpers;if(!h)return{error:'helpers not loaded'};var msgs=h.getAssistantMessagesSinceLastUser();var ans=msgs.length?h.getAssistantAnswerSince(msgs,0):'';var parsed=h.parseAnswerJson?h.parseAnswerJson(ans):null;return{helpersVersion:h.version,hasCompletedReplyActions:h.hasCompletedReplyActions(),isGenerating:h.isGenerating(),answerLen:ans.length,looksFinal:h.looksLikeFinalAnswer(ans),hasParsedJson:!!parsed,answerPreview:String(ans||'').slice(0,500),answerFull:ans};})()`;

function resetTab() {
  sshDocker(["tab", "1"], 30000);
  sshDocker(["open", "https://app.notion.com/ai"], 60000);
  spawnSync("sleep", ["10"]);
}

function runChat(promptText, maxWaitMs, mode) {
  const t0 = Date.now();
  let chatRun;
  if (mode === "submit") {
    const sh = `P=$(cat); bun-browser site notion/chat "$P" auto true false false --maxWaitMs ${maxWaitMs} --tab ${TAB} --json`;
    chatRun = spawnSync("ssh", [SSH, `docker exec -i ${CONTAINER} sh -c ${JSON.stringify(sh)}`], {
      input: promptText,
      encoding: "utf8",
      timeout: maxWaitMs + 90000,
      maxBuffer: 50 * 1024 * 1024,
    });
  } else {
    chatRun = sshDocker(
      ["site", "notion/chat", "x", "auto", "true", "false", "true", "--maxWaitMs", String(maxWaitMs)],
      maxWaitMs + 90000,
    );
  }
  const chatData = parseJson((chatRun.stdout || "").trim());
  const probeRun = sshDocker(["eval", probeJs], 45000);
  const probeRaw = parseJson(probeRun.stdout);
  const probe = probeRaw?.result && typeof probeRaw.result === "object" ? probeRaw.result : probeRaw;
  const domAnswer = probe?.answerFull || chatData?.answer || "";
  return {
    mode,
    elapsedMs: Date.now() - t0,
    timedOut: chatRun.signal === "SIGTERM",
    chatError: chatData?.error || null,
    chatKind: chatData?.kind || null,
    answer: chatData?.answer || null,
    answerJson: chatData?.answerJson || null,
    answerLen: domAnswer.length || (chatData?.answer ? String(chatData.answer).length : 0),
    answerHash: hashAnswer(domAnswer || chatData?.answer || ""),
    looksFinal: probe?.looksFinal ?? null,
    hasParsedJson: probe?.hasParsedJson ?? !!chatData?.answerJson,
    helpersVersion: probe?.helpersVersion ?? null,
    isGenerating: probe?.isGenerating ?? null,
    answerPreview: String(chatData?.answer || probe?.answerPreview || "").slice(0, 200),
    answerJson: chatData?.answerJson || null,
    jsonRecovered: chatData?.jsonRecovered || false,
    probe,
  };
}

function shouldContinuePolling(step, expectJson) {
  if (step.chatError !== "Still generating") {
    if (expectJson && step.answerLen > 0 && step.looksFinal === false) return true;
    if (expectJson && step.answer && !step.answerJson && !step.hasParsedJson) return true;
    if (step.answer && !step.chatError) return false;
    return false;
  }
  return true;
}

function detectIdenticalStuck(steps) {
  const hashes = steps.map((s) => s.answerHash);
  const uniqueHashes = new Set(hashes.filter((h) => h && h !== hashAnswer("")));
  if (uniqueHashes.size !== 1 || steps.length < 2) return { stuck: false, hash: null, count: steps.length };
  const allStillOrIncomplete = steps.every(
    (s) =>
      s.chatError === "Still generating" ||
      s.looksFinal === false ||
      (s.answerLen > 0 && !s.hasParsedJson),
  );
  if (!allStillOrIncomplete) return { stuck: false, hash: hashes[0], count: steps.length };
  return { stuck: true, hash: hashes[0], count: steps.length };
}

mkdirSync(OUT_DIR, { recursive: true });
const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const outPath = join(OUT_DIR, `live-staging1-${ts}.json`);

const doc = {
  startedAt: new Date().toISOString(),
  host: "staging1 (hub.msbit.cn)",
  container: CONTAINER,
  tabId: TAB,
  helpersVersionTarget: 36,
  selectedPrompts: plan.map((p) => p.id),
  skippedPrompts: ["p01-control", "p04-prose-control"],
  method: "short submit maxWaitMs + up to 3 waitOnly polls (pollMaxWaitMs 30000)",
  runs: [],
};

for (const item of plan) {
  const metaItem = metaById[item.id.replace("-short-wait", "")] || {};
  const expectJson = metaItem.expectJson !== false;
  const pollMaxWaitMs = metaItem.pollMaxWaitMs ?? 30000;
  console.log(`\n--- ${item.id} submitMaxWaitMs=${item.submitMaxWaitMs} ---`);
  resetTab();
  const steps = [];
  const promptText = readFileSync(join(PROBE_DIR, item.file), "utf8").trim();
  const initial = runChat(promptText, item.submitMaxWaitMs, "submit");
  steps.push({ ...initial, pollIndex: null, submitMaxWaitMs: item.submitMaxWaitMs, pollMaxWaitMs: null });
  console.log(
    `  submit: error=${initial.chatError || "none"} len=${initial.answerLen} hash=${initial.answerHash} looksFinal=${initial.looksFinal} helpers=${initial.helpersVersion}`,
  );

  let polls = 0;
  while (polls < maxPolls && shouldContinuePolling(steps[steps.length - 1], expectJson)) {
    polls++;
    spawnSync("sleep", ["1"]);
    const poll = runChat(promptText, pollMaxWaitMs, "waitOnly");
    steps.push({ ...poll, pollIndex: polls, submitMaxWaitMs: null, pollMaxWaitMs });
    console.log(
      `  poll ${polls}: error=${poll.chatError || "none"} len=${poll.answerLen} hash=${poll.answerHash} looksFinal=${poll.looksFinal}`,
    );
    if (poll.answer && poll.chatError !== "Still generating") break;
  }

  const stuck = detectIdenticalStuck(steps);
  doc.runs.push({
    id: item.id,
    promptFile: item.file,
    expectJson,
    identicalAnswerStuck: stuck.stuck,
    identicalAnswerHash: stuck.hash,
    identicalPollCount: stuck.count,
    steps: steps.map((s) => ({
      mode: s.mode,
      pollIndex: s.pollIndex,
      submitMaxWaitMs: s.submitMaxWaitMs,
      pollMaxWaitMs: s.pollMaxWaitMs,
      elapsedMs: s.elapsedMs,
      timedOut: s.timedOut,
      chatError: s.chatError,
      chatKind: s.chatKind,
      answerLen: s.answerLen,
      answerHash: s.answerHash,
      looksFinal: s.looksFinal,
      hasParsedJson: s.hasParsedJson,
      helpersVersion: s.helpersVersion,
      isGenerating: s.isGenerating,
      answerPreview: s.answerPreview,
    })),
  });
  console.log(`  identicalStuck=${stuck.stuck} hash=${stuck.hash || "n/a"}`);
}

doc.finishedAt = new Date().toISOString();
doc.stuckCount = doc.runs.filter((r) => r.identicalAnswerStuck).length;
writeFileSync(outPath, JSON.stringify(doc, null, 2));

const summaryPath = outPath.replace(/\.json$/, "-summary.md");
const lines = [
  `# Live staging1 incomplete-reply probe`,
  "",
  `- Started: ${doc.startedAt}`,
  `- Finished: ${doc.finishedAt}`,
  `- Tab: ${TAB}`,
  `- Stuck count: ${doc.stuckCount}/${doc.runs.length}`,
  "",
];
for (const r of doc.runs) {
  lines.push(`## ${r.id}`);
  lines.push(`- **identicalStuck**: ${r.identicalAnswerStuck}`);
  if (r.identicalAnswerHash) lines.push(`- stuck hash: \`${r.identicalAnswerHash}\``);
  for (const s of r.steps) {
    const label = s.mode === "waitOnly" ? `poll ${s.pollIndex}` : "submit";
    lines.push(
      `  - ${label}: error=${s.chatError ?? "none"} | len=${s.answerLen} | hash=\`${s.answerHash}\` | looksFinal=${s.looksFinal} | helpers=${s.helpersVersion}`,
    );
  }
  lines.push("");
}
writeFileSync(summaryPath, lines.join("\n"));
console.log(`\nWrote ${outPath}`);
console.log(`Wrote ${summaryPath}`);
process.exit(doc.stuckCount > 0 ? 2 : 0);
