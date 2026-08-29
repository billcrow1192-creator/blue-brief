import { readFile } from "node:fs/promises";

const file = process.argv[2];
if (!file) {
  console.error("Usage: node scripts/verify-llm-run.mjs <run.json>");
  process.exit(1);
}

const run = JSON.parse(await readFile(file, "utf8"));
const errors = [];

if (run.execution?.agent_count !== 5) errors.push("agent_count must be 5");
if (!Array.isArray(run.rounds) || run.rounds.length !== 2) errors.push("exactly two rounds are required");

for (const round of run.rounds || []) {
  if (!Array.isArray(round.outputs) || round.outputs.length !== 5) {
    errors.push(`round ${round.round} must contain five role outputs`);
    continue;
  }
  const uniqueRoles = new Set(round.outputs.map((item) => item.role));
  if (uniqueRoles.size !== 5) errors.push(`round ${round.round} roles must be unique`);
  for (const output of round.outputs) {
    if (!output.decision || !output.action_level || !Array.isArray(output.messages)) {
      errors.push(`round ${round.round} ${output.role} is missing decision fields`);
    }
  }
}

const messageCount = (run.rounds || []).flatMap((round) => round.outputs || []).reduce((sum, output) => sum + output.messages.length, 0);
const roundOnePrepare = run.rounds?.[0]?.outputs?.filter((item) => item.action_level === "prepare").length || 0;
const roundTwoEscalated = run.rounds?.[1]?.outputs?.filter((item) => ["restrict", "respond"].includes(item.action_level)).length || 0;

if (run.audit?.metrics?.cross_role_messages !== undefined && run.audit.metrics.cross_role_messages !== messageCount) {
  errors.push(`audit message count ${run.audit.metrics.cross_role_messages} does not match raw count ${messageCount}`);
}

if (errors.length) {
  for (const error of errors) console.error(`ERROR: ${error}`);
  process.exit(1);
}

console.log(JSON.stringify({ run_id: run.run_id, roles: 5, rounds: 2, round_one_prepare: roundOnePrepare, round_two_escalated: roundTwoEscalated, messages: messageCount, valid: true }, null, 2));
