import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const run = JSON.parse(await readFile(new URL("../data/llm-runs/2026-08-30-codex-seed42.json", import.meta.url), "utf8"));

test("records five independent role outputs across two rounds", () => {
  assert.equal(run.execution.agent_count, 5);
  assert.equal(run.rounds.length, 2);
  for (const round of run.rounds) {
    assert.equal(round.outputs.length, 5);
    assert.equal(new Set(round.outputs.map((output) => output.role)).size, 5);
  }
});

test("derives audit counts from raw agent messages", () => {
  const messages = run.rounds.flatMap((round) => round.outputs).reduce((sum, output) => sum + output.messages.length, 0);
  assert.equal(messages, 27);
  assert.equal(run.audit.metrics.cross_role_messages, messages);
  assert.equal(run.rounds[0].outputs.filter((output) => output.action_level === "prepare").length, 5);
  assert.equal(run.rounds[1].outputs.filter((output) => ["restrict", "respond"].includes(output.action_level)).length, 5);
});

test("preserves explicit human authority boundaries", () => {
  const finalText = run.rounds[1].outputs.map((output) => `${output.decision} ${output.do_not}`).join(" ");
  assert.match(finalText, /権限者/);
  assert.match(finalText, /有人/);
  assert.doesNotMatch(finalText, /公式警報を発令/);
});
