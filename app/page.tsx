"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Anchor,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  CircleGauge,
  ClipboardCheck,
  Database,
  Download,
  Eye,
  HardDrive,
  Leaf,
  Pause,
  Play,
  Radio,
  RotateCcw,
  Satellite,
  ShieldCheck,
  Ship,
  Target,
  Waves,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import llmRunData from "@/data/llm-runs/2026-08-30-codex-seed42.json";
import { type MetricSet, type PolicyKey, runSimulation, type ScenarioKey } from "@/lib/simulation";

type RoleKey = "municipality" | "port" | "fishery" | "rescue" | "observer";
type TrainingPrediction = "missing-context" | "information-overload" | "balanced";
type LlmActionLevel = "monitor" | "prepare" | "restrict" | "respond";

type RecordedLlmDecision = {
  role: string;
  round: number;
  assessment: string;
  action_level: LlmActionLevel;
  decision: string;
  requests: string[];
  messages: { to: string; text: string }[];
  confidence: number;
  uncertainties: string[];
  do_not: string;
  reason: string;
  memory_used?: string[];
  coordination_effect?: string;
};

type RecordedLlmRun = {
  run_id: string;
  created_at: string;
  execution: { provider: string; model: string; mode: string; agent_count: number; round_count: number; coordinator_count: number; note: string };
  scenario: { key: string; label: string; seed: number; policy: string; setting: string; official_warning: string; safety_boundary: string };
  rounds: { round: number; time: string; input: { summary: string; confidence: number; uncertainty: string[]; sensor_health: number; network_capacity_pct: number; packet: string; shared_memory?: string }; outputs: RecordedLlmDecision[] }[];
  audit: {
    summary: string;
    observed_chain: string[];
    emergent_effects: { title: string; evidence: string; why_not_directly_scripted: string }[];
    coordination_gains: string[];
    tensions: string[];
    safety_checks: { passed: string[]; watch: string[] };
    metrics: { round1_prepare_count: number; round2_escalated_count: number; human_authority_preserved_count: number; cross_role_messages: number };
    verdict: string;
    limitations: string[];
  };
};

const recordedLlmRun = llmRunData as unknown as RecordedLlmRun;

type TrainingHistoryRecord = {
  date: string;
  scenario: ScenarioKey;
  seed: number;
  focusRole: RoleKey;
  assignments: Record<RoleKey, PolicyKey>;
  prediction: TrainingPrediction;
  completedAt: string;
};

const policies: Record<PolicyKey, { name: string; description: string; packet: string[]; color: string }> = {
  A: {
    name: "ラベルのみ",
    description: "異常あり／なしだけを送る",
    packet: ["異常ラベル", "時刻"],
    color: "#ff8b78",
  },
  B: {
    name: "詳細を常時送信",
    description: "全特徴・根拠データを毎回送る",
    packet: ["全特徴量", "信頼度", "不確実性", "機器状態", "長い根拠データ"],
    color: "#ffd06c",
  },
  C: {
    name: "適応型安全パケット",
    description: "必要な不確実性だけ常送し、詳細は要求時に取得",
    packet: ["ラベル・信頼度", "不確実性理由", "機器状態", "来歴署名", "詳細取得期限"],
    color: "#63d9ca",
  },
};

const scenarios: Record<ScenarioKey, { label: string; description: string }> = {
  "trust-collapse": { label: "誤警報後に真の異常", description: "反復雑音の誤認後、合成水圧異常が到来" },
  storm: { label: "暴風・通信逼迫", description: "高雑音と衛星回線の帯域低下が同時発生" },
  "node-failure": { label: "複数ノード故障", description: "沿岸側3ノードが故障し、観測空白が発生" },
};

const eventsByScenario: Record<ScenarioKey, { time: string; title: string; detail: string; kind: "normal" | "watch" | "danger" | "action" }[]> = {
  "trust-collapse": [
    { time: "00:00", title: "平常監視", detail: "12ノード正常。基準音響を更新", kind: "normal" },
    { time: "01:15", title: "暴風・船舶雑音", detail: "同一モデル群が異常候補として検出", kind: "watch" },
    { time: "02:15", title: "誤警報評価", detail: "港湾・漁業の情報源信頼が更新される", kind: "watch" },
    { time: "04:10", title: "合成水圧異常", detail: "沖合から沿岸へ複数方式で伝播", kind: "danger" },
    { time: "05:15", title: "組織対応", detail: "段階帰港、避難準備、救助航路を調整", kind: "action" },
  ],
  storm: [
    { time: "01:00", title: "暴風接近", detail: "波浪雑音が基準値を上回る", kind: "watch" },
    { time: "02:40", title: "回線逼迫", detail: "衛星回線の利用可能帯域が25%へ低下", kind: "watch" },
    { time: "04:10", title: "観測競合", detail: "音響データと緊急水圧パケットが競合", kind: "danger" },
    { time: "04:25", title: "帯域介入", detail: "緊急パケットを優先し、詳細転送を遅延", kind: "action" },
    { time: "05:10", title: "判断更新", detail: "組織別に確度付き状況票を配信", kind: "action" },
  ],
  "node-failure": [
    { time: "00:00", title: "自己診断", detail: "全ノードの電源・校正状態を確認", kind: "normal" },
    { time: "03:00", title: "複数電源低下", detail: "S-08〜10の健全性が閾値を下回る", kind: "watch" },
    { time: "03:15", title: "観測空白", detail: "沿岸南部の三重化が失われる", kind: "danger" },
    { time: "03:30", title: "再配置案", detail: "回収可能ノードと臨時ブイを選定", kind: "action" },
    { time: "04:00", title: "保守判断", detail: "回収窓、航路、環境制約を統合", kind: "action" },
  ],
};

const nodes = [
  { id: "S-01", x: 18, y: 21 }, { id: "S-02", x: 35, y: 14 }, { id: "S-03", x: 55, y: 19 },
  { id: "S-04", x: 72, y: 26 }, { id: "S-05", x: 28, y: 42 }, { id: "S-06", x: 48, y: 38 },
  { id: "S-07", x: 67, y: 47 }, { id: "S-08", x: 21, y: 65 }, { id: "S-09", x: 39, y: 61 },
  { id: "S-10", x: 56, y: 70 }, { id: "S-11", x: 74, y: 65 }, { id: "S-12", x: 45, y: 84 },
];

const roleLabels: Record<RoleKey, string> = {
  municipality: "自治体防災", port: "港湾管理", fishery: "漁業連絡", rescue: "救助調整", observer: "観測運用",
};

const roleOrder: RoleKey[] = ["municipality", "port", "fishery", "rescue", "observer"];
const scenarioOrder: ScenarioKey[] = ["trust-collapse", "storm", "node-failure"];
const seedOrder = [42, 84, 126, 168, 210];

const predictionOptions: Record<TrainingPrediction, { label: string; detail: string }> = {
  "missing-context": { label: "文脈不足", detail: "短すぎる情報で理由が消える" },
  "information-overload": { label: "情報過多", detail: "詳細が回線と注意を圧迫する" },
  balanced: { label: "役割ごとに違う", detail: "必要な情報量は職種で変わる" },
};

const trainingGuidance: Record<ScenarioKey, Record<RoleKey, { policy: PolicyKey; reason: string }>> = {
  "trust-collapse": {
    municipality: { policy: "C", reason: "確度・未確認・次回更新を残し、公式情報と分離できるため" },
    port: { policy: "C", reason: "一斉帰港を避ける段階判断に、不確実性と更新期限が必要なため" },
    fishery: { policy: "A", reason: "第一報を定型の出港保留だけに限定する比較を試せるため" },
    rescue: { policy: "C", reason: "待機強化と出動確定を分ける根拠が必要なため" },
    observer: { policy: "B", reason: "誤認原因を調べる場面では詳細特徴と機器状態が必要なため" },
  },
  storm: {
    municipality: { policy: "C", reason: "通信逼迫中も確度付きの短い状況票を保てるため" },
    port: { policy: "A", reason: "既定の航路状態だけを最小帯域で更新する比較を試せるため" },
    fishery: { policy: "A", reason: "定型の出港保留を短く広く伝える比較を試せるため" },
    rescue: { policy: "C", reason: "緊急帯域と追加根拠取得を両立する必要があるため" },
    observer: { policy: "B", reason: "波浪雑音と水圧情報の競合を詳しく監査するため" },
  },
  "node-failure": {
    municipality: { policy: "C", reason: "観測空白と現象の異常を混同しないため" },
    port: { policy: "A", reason: "利用可能航路という既定状態だけを素早く確認する比較のため" },
    fishery: { policy: "A", reason: "新規出港保留の定型連絡を最小情報で試すため" },
    rescue: { policy: "C", reason: "故障中でも救助航路の根拠と期限を保持するため" },
    observer: { policy: "B", reason: "故障診断・電源・校正状態をまとめて調べるため" },
  },
};

const policyProperties: Record<PolicyKey, { uncertainty: string; health: string; volume: string }> = {
  A: { uncertainty: "含めない", health: "含めない", volume: "最小" },
  B: { uncertainty: "含める", health: "含める", volume: "最大" },
  C: { uncertainty: "含める", health: "含める", volume: "必要時に追加" },
};

const guideChain = [
  { label: "海の観測", detail: "水圧・音響・機器状態" },
  { label: "情報を要約", detail: "限られた回線で送る" },
  { label: "意味が変化", detail: "理由の消失／通信の渋滞" },
  { label: "組織が判断", detail: "5職種が別々に受け取る" },
  { label: "現場へ連鎖", detail: "信頼・反応・港湾負荷" },
];

const judgeCriteria = [
  { number: "01", title: "世界設計", detail: "海況・通信・組織・港湾を一つの状態系にする", status: "実装" },
  { number: "02", title: "連鎖", detail: "海洋センシング×組織判断の変化をログで追う", status: "実装" },
  { number: "03", title: "介入点", detail: "情報を削る場所と、詳細を足す条件を変える", status: "実装" },
  { number: "04", title: "実装品質", detail: "同一seed再現・LLM生ログ・JSON/CSV出力", status: "実装" },
  { number: "05", title: "社会接続", detail: "5職種の訓練仮説。実務者テストはこれから", status: "要検証" },
  { number: "06", title: "拡張性", detail: "独立LLM5役割を実装。実データ接続は次段階", status: "実装" },
];

function dateKeyInJapan(offsetDays = 0) {
  const date = new Date(Date.now() + offsetDays * 86_400_000);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function dailyMissionFor(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  const dayNumber = Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
  const index = ((dayNumber % 75) + 75) % 75;
  return {
    date,
    number: index + 1,
    scenario: scenarioOrder[index % scenarioOrder.length],
    seed: seedOrder[Math.floor(index / scenarioOrder.length) % seedOrder.length],
    focusRole: roleOrder[Math.floor(index / (scenarioOrder.length * seedOrder.length)) % roleOrder.length],
  };
}

function nodeModality(id: string) {
  const index = Number(id.split("-")[1]);
  if (index % 3 === 1) return "水圧";
  if (index % 3 === 2) return "音響";
  return "融合";
}

const roleBriefs: Record<RoleKey, { objective: string; confirmed: string; unknown: string; action: string; owner: string; avoid: string }> = {
  municipality: {
    objective: "公式情報を待つ間に、住民保護の準備を前倒しする",
    confirmed: "複数水圧系の変化とセンサー健全性を確認",
    unknown: "沿岸到達時刻、浸水範囲、公式警報",
    action: "避難所・要支援者連絡の準備可否を判断",
    owner: "危機管理責任者",
    avoid: "本システム単独で避難指示を発令しない",
  },
  port: {
    objective: "一斉帰港を避け、救助用航路と港の処理能力を守る",
    confirmed: "入港予定18隻、緊急航路1本、係留余力34%",
    unknown: "沖合7隻の到着順と燃料余力",
    action: "帰港を3群に分け、東航路を救助用に確保",
    owner: "港湾運用責任者",
    avoid: "確度不明の異常だけで全船一斉帰港を促さない",
  },
  fishery: {
    objective: "理由、確度、次回更新を短く伝え、受信を確認する",
    confirmed: "船舶音は検出。水圧変化との因果は未確認",
    unknown: "音源の意図・船籍は判定対象外",
    action: "新規出港を保留し、次回更新時刻を共有",
    owner: "漁協連絡責任者",
    avoid: "エンジン音から敵意や船籍を推定しない",
  },
  rescue: {
    objective: "誤出動を抑えながら、必要時の初動時間を短縮する",
    confirmed: "救助艇2隻、医療搬送1枠、東航路は利用可能",
    unknown: "要救助者の発生・位置は未確認",
    action: "1隊を待機強化し、救助航路の開放を確認",
    owner: "救助調整責任者",
    avoid: "AI推論だけで出動・配備を確定しない",
  },
  observer: {
    objective: "現象、機器故障、雑音を切り分け、来歴を保全する",
    confirmed: "同一モデル群の相関誤認可能性を確認",
    unknown: "詳細データ未取得の音源分類は暫定",
    action: "異種モデルへ照会し、短い根拠データを取得",
    owner: "観測運用責任者",
    avoid: "単一ノードの分類を確定事実にしない",
  },
};

function nodeState(id: string, step: number, scenario: ScenarioKey) {
  if (step === 0) return "normal";
  if (scenario === "node-failure" && ["S-08", "S-09", "S-10"].includes(id)) return step >= 2 ? "offline" : "watch";
  if (scenario === "storm" && ["S-03", "S-04", "S-07"].includes(id)) return step >= 2 ? "danger" : "watch";
  if (scenario === "trust-collapse" && ["S-04", "S-05"].includes(id) && step >= 1 && step < 3) return "watch";
  if (scenario === "trust-collapse" && ["S-01", "S-02", "S-03"].includes(id) && step >= 3) return "danger";
  return "normal";
}

function MetricCard({ label, value, suffix, tone = "aqua" }: { label: string; value: string | number; suffix?: string; tone?: "aqua" | "blue" | "coral" }) {
  return <div className={`metric-card metric-${tone}`}><p>{label}</p><strong>{value}<span>{suffix}</span></strong></div>;
}

function buildLlmReport(run: RecordedLlmRun) {
  const roundOne = run.rounds[0]!;
  const roundTwo = run.rounds[1]!;
  const rows = roundTwo.outputs.map((item) => {
    const before = roundOne.outputs.find((previous) => previous.role === item.role);
    return `| ${item.role} | ${before?.action_level ?? "-"} | ${item.action_level} | ${Math.round(item.confidence * 100)}% | ${item.decision.replaceAll("|", "／")} |`;
  });
  const effects = run.audit.emergent_effects.map((item, index) => `${index + 1}. **${item.title}**\n   - 観測根拠：${item.evidence}\n   - 個別指定ではない点：${item.why_not_directly_scripted}`).join("\n");
  const limits = run.audit.limitations.map((item) => `- ${item}`).join("\n");
  const safety = run.audit.safety_checks.passed.map((item) => `- ${item}`).join("\n");
  return `# BLUE BRIEF｜LLMマルチエージェント実験 結果報告書

## 1. 結論

5つの役割別LLMは、Round 1では全役割が「prepare」を選択し、異種観測の一致と他役割の判断要約を共有したRound 2では、自治体が「respond」、他4役割が「restrict」へ移行しました。港湾の救助航路確保と救助側の2艇即応が、共有bulletinを介して整合しました。

これは架空湾・合成データ上の1条件・1回の観測です。実環境性能、因果性、再現性を証明する結果ではありません。

## 2. 実験条件

- Run ID：${run.run_id}
- 実行日時：${run.created_at}
- 実行環境：${run.execution.provider}
- モデル識別子：${run.execution.model}
- シナリオ：${run.scenario.label}
- seed：${run.scenario.seed}
- 情報方式：${run.scenario.policy}
- 役割：${run.execution.agent_count}
- ラウンド：${run.execution.round_count}
- 監査LLM：${run.execution.coordinator_count}

## 3. 観測事実

| 指標 | 結果 |
|---|---:|
| Round 1でprepareを選択 | ${run.audit.metrics.round1_prepare_count}/5役割 |
| Round 2でrespond/restrictへ移行 | ${run.audit.metrics.round2_escalated_count}/5役割 |
| 生成された宛先付きメッセージ | ${run.audit.metrics.cross_role_messages}件 |
| 人の最終権限を明示的に維持 | ${run.audit.metrics.human_authority_preserved_count}役割 |

### 役割別の判断変化

| 役割 | Round 1 | Round 2 | 確信度 | Round 2の判断 |
|---|---|---|---:|---|
${rows.join("\n")}

## 4. 監査LLMによる推論：創発候補

${effects}

創発を断定しません。オーケストレータが情報配送と共有bulletinを設計しているため、LLMの局所判断が生んだ行動の収束と、基盤側で与えた効果を分離して評価する必要があります。

## 5. 安全確認

${safety}

## 6. 限界

${limits}

## 7. 再実行

記録済みログの検証：\`npm run agents:verify\`

OpenAI Responses APIで再実行：\`OPENAI_API_KEY=... OPENAI_MODEL=gpt-5.6 npm run agents:run\`

API実行ではStructured Outputsを使用し、\`store: false\`を指定します。
`;
}

export default function Home() {
  const [activeTab, setActiveTab] = useState("guide");
  const [scenario, setScenario] = useState<ScenarioKey>("trust-collapse");
  const [policy, setPolicy] = useState<PolicyKey>("C");
  const [role, setRole] = useState<RoleKey>("municipality");
  const [seed, setSeed] = useState(42);
  const [step, setStep] = useState(0);
  const [running, setRunning] = useState(false);
  const [rawOnDemand, setRawOnDemand] = useState(true);
  const [budget, setBudget] = useState([62]);
  const [ecology, setEcology] = useState([84]);
  const [retrieval, setRetrieval] = useState([91]);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [dailyDate] = useState(() => dateKeyInJapan());
  const [dailyActive, setDailyActive] = useState(false);
  const [dailyAssignments, setDailyAssignments] = useState<Partial<Record<RoleKey, PolicyKey>>>({});
  const [dailyPrediction, setDailyPrediction] = useState<TrainingPrediction | null>(null);
  const [dailyReviewComplete, setDailyReviewComplete] = useState(false);
  const [trainingHistory, setTrainingHistory] = useState<TrainingHistoryRecord[]>([]);
  const [llmRound, setLlmRound] = useState(2);
  const [llmRole, setLlmRole] = useState("自治体防災");

  const events = eventsByScenario[scenario];
  const result = useMemo(() => runSimulation(policy, scenario, seed, rawOnDemand), [policy, scenario, seed, rawOnDemand]);
  const comparisons = useMemo(() => Object.fromEntries((["A", "B", "C"] as PolicyKey[]).map((item) => [item, runSimulation(item, scenario, seed)])) as Record<PolicyKey, ReturnType<typeof runSimulation>>, [scenario, seed]);
  const metrics = result.metrics;
  const brief = roleBriefs[role];
  const optimizedNodes = Math.round(8 + budget[0] * 0.16 + ecology[0] * 0.025);
  const coverage = Math.min(97, Math.round(55 + budget[0] * 0.38 + ecology[0] * 0.12));
  const lifecycleCost = Math.round(32 + budget[0] * 0.58 + retrieval[0] * 0.1);
  const optimizedRecovery = Math.min(99, Math.round(61 + retrieval[0] * 0.35 + ecology[0] * 0.05));
  const dailyMission = useMemo(() => dailyMissionFor(dailyDate), [dailyDate]);
  const tomorrowMission = useMemo(() => dailyMissionFor(dateKeyInJapan(1)), []);
  const assignedCount = roleOrder.filter((item) => dailyAssignments[item]).length;
  const todayRecord = trainingHistory.find((item) => item.date === dailyDate);
  const exploredPairs = new Set(trainingHistory.flatMap((record) => roleOrder.map((item) => `${item}-${record.assignments[item]}`))).size;
  const guidance = trainingGuidance[dailyMission.scenario];
  const reviewDifferenceCount = roleOrder.filter((item) => dailyAssignments[item] && dailyAssignments[item] !== guidance[item].policy).length;
  const selectedNodeState = selectedNode ? nodeState(selectedNode, step, scenario) : null;
  const selectedLlmRound = recordedLlmRun.rounds.find((item) => item.round === llmRound) ?? recordedLlmRun.rounds[0]!;
  const selectedLlmDecision = selectedLlmRound.outputs.find((item) => item.role === llmRole) ?? selectedLlmRound.outputs[0]!;

  useEffect(() => {
    if (!running) return;
    const timer = window.setTimeout(() => {
      if (step >= events.length - 1) setRunning(false);
      else setStep((current) => current + 1);
    }, step >= events.length - 1 ? 0 : 950);
    return () => window.clearTimeout(timer);
  }, [running, step, events.length]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const stored = window.localStorage.getItem("blue-brief-training-history-v1");
        if (!stored) return;
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) setTrainingHistory(parsed.slice(-90));
      } catch {
        setTrainingHistory([]);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  function resetSimulation(nextScenario?: ScenarioKey) {
    setDailyActive(false); setSelectedNode(null); setRunning(false); setStep(0); if (nextScenario) setScenario(nextScenario);
  }

  function runOrRestart() {
    if (step >= events.length - 1) setStep(0);
    setRunning((value) => !value || step >= events.length - 1);
  }

  function startDailyTraining(restart = false) {
    const saved = restart ? undefined : todayRecord;
    setActiveTab("live");
    setScenario(dailyMission.scenario);
    setSeed(dailyMission.seed);
    setRole(dailyMission.focusRole);
    setPolicy(saved?.assignments[dailyMission.focusRole] ?? "C");
    setStep(saved ? eventsByScenario[dailyMission.scenario].length - 1 : 1);
    setRunning(false);
    setSelectedNode(null);
    setDailyAssignments(saved?.assignments ?? {});
    setDailyPrediction(saved?.prediction ?? null);
    setDailyReviewComplete(Boolean(saved));
    setDailyActive(true);
  }

  function selectDailyMethod(roleKey: RoleKey, nextPolicy: PolicyKey) {
    setDailyAssignments((current) => ({ ...current, [roleKey]: nextPolicy }));
    setDailyReviewComplete(false);
    setRole(roleKey);
    setPolicy(nextPolicy);
    setRunning(false);
    setStep(Math.min(eventsByScenario[dailyMission.scenario].length - 1, Math.max(1, roleOrder.indexOf(roleKey) + 1)));
  }

  function runDailyReview() {
    if (assignedCount !== roleOrder.length || !dailyPrediction) return;
    const assignments = Object.fromEntries(roleOrder.map((item) => [item, dailyAssignments[item]])) as Record<RoleKey, PolicyKey>;
    const record: TrainingHistoryRecord = {
      date: dailyDate,
      scenario: dailyMission.scenario,
      seed: dailyMission.seed,
      focusRole: dailyMission.focusRole,
      assignments,
      prediction: dailyPrediction,
      completedAt: new Date().toISOString(),
    };
    const nextHistory = [...trainingHistory.filter((item) => item.date !== dailyDate), record].slice(-90);
    setTrainingHistory(nextHistory);
    try {
      window.localStorage.setItem("blue-brief-training-history-v1", JSON.stringify(nextHistory));
    } catch {
      // The drill remains usable when device-local storage is unavailable.
    }
    setPolicy(assignments[dailyMission.focusRole]);
    setStep(eventsByScenario[dailyMission.scenario].length - 1);
    setDailyReviewComplete(true);
  }

  function reviseDailyTraining() {
    setDailyReviewComplete(false);
    setStep(1);
  }

  function downloadResult() {
    const payload = {
      product: "BLUE BRIEF", notice: "synthetic_scenario_no_real_coordinates", result,
      visible_state: { step, event: events[step], role, decision_brief: brief, raw_on_demand: rawOnDemand },
      daily_training: dailyActive && dailyReviewComplete ? {
        date: dailyDate,
        scenario: dailyMission.scenario,
        seed: dailyMission.seed,
        assignments: dailyAssignments,
        prediction: dailyPrediction,
        notice: "device_local_synthetic_calibration_record",
      } : null,
      generated_at: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = `blue-brief-${result.runId}.json`; anchor.click(); URL.revokeObjectURL(url);
  }

  function downloadComparisonCsv() {
    const headers = ["policy", "seed", "scenario", "trust_end", "true_alert_latency_min", "false_alerts", "port_peak_load_pct", "bandwidth_index", "recovery_pct"];
    const rows = (["A", "B", "C"] as PolicyKey[]).map((item) => {
      const value = comparisons[item].metrics;
      return [item, seed, scenario, value.trust, value.response, value.falseAlerts, value.traffic, value.bandwidth, value.recovery];
    });
    const csv = [headers, ...rows].map((row) => row.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = `blue-brief-${scenario}-seed${seed}.csv`; anchor.click(); URL.revokeObjectURL(url);
  }

  function downloadLlmRun() {
    const blob = new Blob([JSON.stringify(recordedLlmRun, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = `${recordedLlmRun.run_id}.json`; anchor.click(); URL.revokeObjectURL(url);
  }

  function downloadLlmReport() {
    const blob = new Blob([buildLlmReport(recordedLlmRun)], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = `0156_HiroPa_BLUE_BRIEF_LLM_Result_Report.md`; anchor.click(); URL.revokeObjectURL(url);
  }

  return (
    <main className="min-h-screen bg-[#07161d] text-[#eaf8f7]">
      <header className="topbar">
        <div className="brand-lockup"><div className="brand-mark"><Waves aria-hidden="true" /></div><div><p className="eyebrow">META SECURITY DECISION LAB</p><h1>BLUE BRIEF</h1></div></div>
        <div className="header-status"><Badge className="border border-emerald-300/30 bg-emerald-300/10 text-emerald-200"><span className="status-dot" />訓練用・合成データ</Badge><Badge variant="outline" className="border-white/15 text-slate-300">公式警報ではありません</Badge></div>
      </header>

      <section className="workspace-shell">
        <div className="workspace-intro">
          <div><p className="kicker">海洋情報の量と、組織判断の質を同時に検証する</p><p className="subcopy">既存観測網を置き換えず、自治体・港湾・漁業・救助・観測運用が同じ根拠を見て判断できる訓練環境です。</p></div>
          <div className="source-strip" aria-label="情報の流れ"><span><Database />海底</span><i /><span><Radio />ブイ</span><i /><span><Satellite />通信</span><i /><span><ShieldCheck />判断</span></div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="product-tabs">
          <TabsList className="main-tabs"><TabsTrigger value="guide">60秒ガイド</TabsTrigger><TabsTrigger value="agents">LLM実験</TabsTrigger><TabsTrigger value="live">インシデント室</TabsTrigger><TabsTrigger value="compare">事後比較</TabsTrigger><TabsTrigger value="placement">配置・回収</TabsTrigger></TabsList>

          <TabsContent value="guide" className="mt-0">
            <section className="judge-guide" aria-labelledby="guide-title">
              <div className="guide-hero">
                <div className="guide-hero-copy">
                  <div className="guide-label-row"><Badge>審査員の方はここから</Badge><span>約60秒</span><Badge variant="outline" className="llm-run-badge">LLM実行済み</Badge></div>
                  <p className="guide-overline">THE QUESTION</p>
                  <h2 id="guide-title">海の情報を、小さくしても<br /><em>「判断に必要な意味」</em>は残せるか？</h2>
                  <p className="guide-lead">海底センサーの情報は、そのままでは大きすぎます。しかし短くしすぎると「なぜ怪しいか」が消え、全部送ると回線が詰まります。BLUE BRIEFは、<strong>情報の出し方だけを変えたとき、現場の判断がどう変わるか</strong>を同じ合成条件で比べるシミュレーターです。</p>
                  <div className="guide-actions"><Button onClick={() => setActiveTab("agents")} className="run-button"><Eye />LLM実行結果を見る</Button><Button variant="outline" onClick={() => startDailyTraining(false)} className="guide-secondary"><Play />4分演習を始める</Button><Button variant="outline" onClick={() => setActiveTab("compare")} className="guide-secondary">A/B/C比較<ChevronRight /></Button></div>
                </div>
                <aside className="guide-definition" aria-label="BLUE BRIEFの定義">
                  <span>一言でいうと</span>
                  <strong>海底センサーの情報を、<br />人の判断につなぐ練習用システム</strong>
                  <p>操作するのは海そのものではなく、<b>「誰に、何を、どこまで伝えるか」</b>です。</p>
                  <dl><div><dt>舞台</dt><dd>架空の青凪湾</dd></div><div><dt>入力</dt><dd>12センサー・2ゲートウェイの合成データ</dd></div><div><dt>比較</dt><dd>同じシナリオ・同じseedのA/B/C</dd></div><div><dt>出力</dt><dd>信頼・反応・誤警報・港湾負荷・通信量</dd></div></dl>
                </aside>
              </div>

              <Card className="panel guide-chain-card">
                <CardHeader><div><CardTitle>このプロジェクトが観測する連鎖</CardTitle><CardDescription>海の変化ではなく、情報の要約が組織の行動へ届くまでを追います。</CardDescription></div><Badge variant="outline" className="border-white/15 text-slate-300">架空湾・合成データ</Badge></CardHeader>
                <CardContent><div className="guide-chain">{guideChain.map((item, index) => <div className="guide-chain-item" key={item.label}><span>{String(index + 1).padStart(2, "0")}</span><strong>{item.label}</strong><small>{item.detail}</small>{index < guideChain.length - 1 && <ChevronRight aria-hidden="true" />}</div>)}</div></CardContent>
              </Card>

              <div className="guide-two-column">
                <Card className="panel guide-policy-card">
                  <CardHeader><CardTitle>変えるのは、情報の出し方</CardTitle><CardDescription>「多いほど良い」とは限りません。</CardDescription></CardHeader>
                  <CardContent><div className="guide-policies">{(Object.keys(policies) as PolicyKey[]).map((key) => <button key={key} onClick={() => { setPolicy(key); setDailyActive(false); setActiveTab("live"); }}><b style={{ borderColor: policies[key].color, color: policies[key].color }}>{key}</b><div><strong>{policies[key].name}</strong><p>{key === "A" ? "軽い。しかし理由や機器故障が消える。" : key === "B" ? "詳しい。しかし通信が詰まり、重要情報が遅れる。" : "意味を残して短く送り、必要時だけ詳細を足す。"}</p></div><ChevronRight /></button>)}</div></CardContent>
                </Card>
                <Card className="panel guide-fun-card">
                  <CardHeader><CardTitle>触るから、違いが分かる</CardTitle><CardDescription>見るだけではなく、予測してから結果を開きます。</CardDescription></CardHeader>
                  <CardContent><ol><li><span>1</span><div><strong>5職種にA/B/Cを割り当てる</strong><p>自治体・港湾・漁業・救助・観測運用をタップで選択</p></div></li><li><span>2</span><div><strong>何が壊れるか予測する</strong><p>文脈不足、情報過多、役割差から一つ選ぶ</p></div></li><li><span>3</span><div><strong>同一条件で反実仮想を見る</strong><p>判断根拠・通信遅延・港湾負荷まで比較する</p></div></li></ol><p className="guide-fun-note"><CalendarDays />毎日変わる75通りの合成条件。履歴はこの端末だけに保存されます。</p></CardContent>
                </Card>
              </div>

              <Card className="panel judge-map-card">
                <CardHeader><div><CardTitle>6つの審査観点への対応</CardTitle><CardDescription>できていることと、次に実装することを分けています。</CardDescription></div><a href="https://singulab.jp/news/202607_hackathon2" target="_blank" rel="noreferrer">公式募集要項</a></CardHeader>
                <CardContent><div className="judge-map">{judgeCriteria.map((item) => <div key={item.number} className="judge-map-item"><span>{item.number}</span><div><strong>{item.title}</strong><p>{item.detail}</p></div><Badge variant="outline" className={item.status === "実装" ? "implemented" : item.status === "要検証" ? "validation" : "pending"}>{item.status}</Badge></div>)}</div></CardContent>
              </Card>

              <div className="guide-boundary">
                <ShieldCheck /><div><strong>現在地を正確に表示</strong><p>物理・通信は決定論、組織判断は独立した5つのLLMコンテキストで実行しました。現在は1条件・1回の観測で、実務者テストは未実施です。公式警報の代替、実船の識別、実座標の利用は行いません。</p></div><Button onClick={() => setActiveTab("agents")} variant="outline" className="guide-secondary">生ログを見る<ChevronRight /></Button>
              </div>
            </section>
          </TabsContent>

          <TabsContent value="agents" className="mt-0">
            <section className="llm-lab" aria-labelledby="llm-lab-title">
              <div className="llm-lab-hero">
                <div>
                  <div className="guide-label-row"><Badge className="llm-live-badge"><span className="status-dot" />実行済み</Badge><span>{recordedLlmRun.scenario.setting}</span></div>
                  <p className="guide-overline">RECORDED MULTI-AGENT EPISODE</p>
                  <h2 id="llm-lab-title">5つのLLMが、<br /><em>役割ごとに別の判断</em>をした。</h2>
                  <p>決定論シミュレーターが同じ観測情報を作り、自治体・港湾・漁業・救助・観測運用のLLMへ配信。1回目の判断を共有bulletinとして渡し、2回目に判断がどう変化するかを観測しました。</p>
                </div>
                <div className="llm-run-metrics">
                  <div><span>独立役割</span><strong>{recordedLlmRun.execution.agent_count}</strong><small>LLM contexts</small></div>
                  <div><span>判断ラウンド</span><strong>{recordedLlmRun.execution.round_count}</strong><small>rounds</small></div>
                  <div><span>宛先付き通信</span><strong>{recordedLlmRun.audit.metrics.cross_role_messages}</strong><small>generated messages</small></div>
                  <div><span>監査役</span><strong>{recordedLlmRun.execution.coordinator_count}</strong><small>LLM auditor</small></div>
                </div>
              </div>

              <Card className="panel llm-architecture-card">
                <CardHeader><div><CardTitle>実装した分担</CardTitle><CardDescription>環境計算と自然言語判断を分離し、再実行可能にする</CardDescription></div><div className="llm-export-actions"><Button variant="outline" onClick={downloadLlmReport} className="guide-secondary"><Download />結果レポート</Button><Button variant="outline" onClick={downloadLlmRun} className="guide-secondary"><Download />生ログJSON</Button></div></CardHeader>
                <CardContent><div className="llm-architecture">{[
                  ["01", "決定論環境", "センサー・通信・港湾状態"],
                  ["02", "安全パケットC", "確度・不確実性・機器状態"],
                  ["03", "5役割LLM", "目的・権限・禁止事項を分離"],
                  ["04", "共有bulletin", "前ラウンドの判断を配送"],
                  ["05", "監査LLM", "連鎖・緊張・限界を評価"],
                ].map(([number, title, detail], index) => <div key={number}><span>{number}</span><strong>{title}</strong><small>{detail}</small>{index < 4 && <ChevronRight />}</div>)}</div></CardContent>
              </Card>

              <div className="llm-controls" aria-label="LLM実験の表示条件">
                <div><span>ラウンド</span><div>{recordedLlmRun.rounds.map((item) => <button key={item.round} onClick={() => setLlmRound(item.round)} className={llmRound === item.round ? "selected" : ""}>ROUND {item.round}<small>{item.time}</small></button>)}</div></div>
                <div><span>役割</span><div>{recordedLlmRun.rounds[0].outputs.map((item) => <button key={item.role} onClick={() => setLlmRole(item.role)} className={llmRole === item.role ? "selected" : ""}>{item.role}</button>)}</div></div>
              </div>

              <div className="llm-decision-grid">
                <Card className="panel llm-input-card">
                  <CardHeader><CardTitle>LLMへ渡した入力</CardTitle><CardDescription>ground truthと公式警報は渡していません。</CardDescription></CardHeader>
                  <CardContent><div className="llm-input-event"><Radio /><div><span>{selectedLlmRound.time} · ROUND {selectedLlmRound.round}</span><strong>{selectedLlmRound.input.summary}</strong></div></div><dl><div><dt>受信確度</dt><dd>{Math.round(selectedLlmRound.input.confidence * 100)}%</dd></div><div><dt>機器健全性</dt><dd>{Math.round(selectedLlmRound.input.sensor_health * 100)}%</dd></div><div><dt>通信容量</dt><dd>{selectedLlmRound.input.network_capacity_pct}%</dd></div><div><dt>未確認</dt><dd>{selectedLlmRound.input.uncertainty.join("・")}</dd></div></dl><p>{selectedLlmRound.input.packet}</p></CardContent>
                </Card>

                <Card className="panel llm-decision-card">
                  <CardHeader><div><CardTitle>{selectedLlmDecision.role}の判断</CardTitle><CardDescription>独立LLM出力 · 内部思考ではなく短い根拠を記録</CardDescription></div><Badge variant="outline" className={`action-${selectedLlmDecision.action_level}`}>{selectedLlmDecision.action_level}</Badge></CardHeader>
                  <CardContent><div className="llm-assessment"><span>評価 · confidence {Math.round(selectedLlmDecision.confidence * 100)}%</span><p>{selectedLlmDecision.assessment}</p></div><div className="llm-primary-decision"><Target /><div><span>判断</span><strong>{selectedLlmDecision.decision}</strong></div></div>{selectedLlmDecision.coordination_effect && <div className="llm-coordination"><Radio /><div><span>他役割との調整で変わったこと</span><p>{selectedLlmDecision.coordination_effect}</p></div></div>}<div className="llm-detail-columns"><div><span>残した不確実性</span><ul>{selectedLlmDecision.uncertainties.map((item) => <li key={item}>{item}</li>)}</ul></div><div><span>禁止したこと</span><p>{selectedLlmDecision.do_not}</p></div></div><div className="llm-reason"><span>短い判断根拠</span><p>{selectedLlmDecision.reason}</p></div></CardContent>
                </Card>
              </div>

              <Card className="panel llm-messages-card">
                <CardHeader><div><CardTitle>{selectedLlmDecision.role}が生成した連絡</CardTitle><CardDescription>生成数は実配送成功数ではありません。</CardDescription></div><Badge variant="outline" className="border-white/15 text-slate-300">{selectedLlmDecision.messages.length} messages</Badge></CardHeader>
                <CardContent>{selectedLlmDecision.messages.map((message, index) => <div className="llm-message" key={`${message.to}-${index}`}><span>TO</span><strong>{message.to}</strong><p>{message.text}</p></div>)}</CardContent>
              </Card>

              <div className="llm-all-roles">
                {selectedLlmRound.outputs.map((item) => <button key={item.role} onClick={() => setLlmRole(item.role)} className={llmRole === item.role ? "selected" : ""}><span>{item.role}</span><Badge variant="outline" className={`action-${item.action_level}`}>{item.action_level}</Badge><strong>{item.decision}</strong><small>confidence {Math.round(item.confidence * 100)}%</small></button>)}
              </div>

              <div className="llm-audit-grid">
                <Card className="panel llm-audit-card"><CardHeader><CardTitle>観測された創発候補</CardTitle><CardDescription>監査LLMの評価。創発を断定しません。</CardDescription></CardHeader><CardContent>{recordedLlmRun.audit.emergent_effects.map((effect, index) => <div key={effect.title}><span>{String(index + 1).padStart(2, "0")}</span><strong>{effect.title}</strong><p>{effect.evidence}</p><small>個別指定ではない点：{effect.why_not_directly_scripted}</small></div>)}</CardContent></Card>
                <Card className="panel llm-limit-card"><CardHeader><CardTitle>この1回で言えないこと</CardTitle><CardDescription>提出で誇張しないための境界</CardDescription></CardHeader><CardContent><p className="llm-verdict">{recordedLlmRun.audit.verdict}</p><ul>{recordedLlmRun.audit.limitations.map((item) => <li key={item}><AlertTriangle />{item}</li>)}</ul><div className="llm-repro"><HardDrive /><div><span>再実行</span><code>npm run agents:run</code><small>OPENAI_API_KEY / OPENAI_MODELでモデルを差し替え</small></div></div></CardContent></Card>
              </div>
            </section>
          </TabsContent>

          <TabsContent value="live" className="mt-0">
            <Card className={`panel daily-mission-card ${dailyActive ? "is-active" : ""}`}>
              <CardHeader className="daily-mission-header">
                <div className="daily-title-lockup">
                  <div className="daily-icon"><CalendarDays /></div>
                  <div><p>DAILY DECISION DRILL · 端末内記録</p><CardTitle>今日の4分演習</CardTitle><CardDescription>{dailyDate} · 合成条件 {String(dailyMission.number).padStart(2, "0")} / 75</CardDescription></div>
                </div>
                <div className="daily-stats" aria-label="演習履歴">
                  <div><span>演習記録</span><strong>{trainingHistory.length}</strong><small>回</small></div>
                  <div><span>方式探索</span><strong>{exploredPairs}</strong><small>/ 15</small></div>
                  <div><span>本日</span><strong>{todayRecord ? "済" : "未"}</strong><small>この端末</small></div>
                </div>
              </CardHeader>
              <CardContent>
                {!dailyActive ? (
                  <div className="daily-start">
                    <div>
                      <p>毎日変わる合成条件で、5職種にA/B/Cを割り当てます。同じ情報を「誰に、どの量で見せるか」をタップで決め、反実仮想を確認します。</p>
                      <div className="daily-tags"><span><Target />重点：{roleLabels[dailyMission.focusRole]}</span><span>{scenarios[dailyMission.scenario].label}</span><span>seed {dailyMission.seed}</span></div>
                    </div>
                    <Button onClick={() => startDailyTraining(false)} className="run-button daily-start-button">{todayRecord ? "今日の結果を見る" : "今日の演習を始める"}<ChevronRight /></Button>
                  </div>
                ) : !dailyReviewComplete ? (
                  <div className="daily-workspace">
                    <div className="daily-brief-line">
                      <div><span>本日の合成シナリオ</span><strong>{scenarios[dailyMission.scenario].label}</strong><p>{scenarios[dailyMission.scenario].description}</p></div>
                      <div><span>重点役割</span><strong>{roleLabels[dailyMission.focusRole]}</strong><p>全5職種を選び、重点役割は事後比較で深掘りします。</p></div>
                      <Badge variant="outline" className="border-amber-300/25 text-amber-200">実運用には使用しない</Badge>
                    </div>

                    <div className="assignment-list" aria-label="役割ごとの情報送信方式">
                      {roleOrder.map((roleKey, index) => {
                        const selected = dailyAssignments[roleKey];
                        return (
                          <div className={`assignment-row ${roleKey === dailyMission.focusRole ? "focus" : ""}`} key={roleKey}>
                            <div className="assignment-role"><span>{String(index + 1).padStart(2, "0")}</span><div><strong>{roleLabels[roleKey]}</strong><small>{roleBriefs[roleKey].objective}</small></div></div>
                            <div className="assignment-methods" role="group" aria-label={`${roleLabels[roleKey]}の方式`}>
                              {(Object.keys(policies) as PolicyKey[]).map((key) => <button key={key} onClick={() => selectDailyMethod(roleKey, key)} className={selected === key ? "selected" : ""} aria-pressed={selected === key}><b>{key}</b><span>{policies[key].name}</span>{selected === key && <CheckCircle2 />}</button>)}
                            </div>
                            <div className="assignment-preview" aria-live="polite">
                              {selected ? <><span>不確実性：{policyProperties[selected].uncertainty}</span><span>機器状態：{policyProperties[selected].health}</span><strong>通信 {comparisons[selected].metrics.bandwidth}×</strong></> : <p>方式をタップして受信内容を確認</p>}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    <div className="prediction-block">
                      <div><span>結果を見る前の予測</span><strong>今回、最も大きく出そうな問題は？</strong></div>
                      <div className="prediction-options" role="group" aria-label="結果の予測">{(Object.keys(predictionOptions) as TrainingPrediction[]).map((key) => <button key={key} className={dailyPrediction === key ? "selected" : ""} onClick={() => setDailyPrediction(key)} aria-pressed={dailyPrediction === key}><span>{predictionOptions[key].label}</span><small>{predictionOptions[key].detail}</small></button>)}</div>
                    </div>

                    <div className="daily-run-row">
                      <div><div><span>入力進捗</span><strong>{assignedCount}/5役割{dailyPrediction ? "＋予測済み" : ""}</strong></div><Progress value={((assignedCount + (dailyPrediction ? 1 : 0)) / 6) * 100} /></div>
                      <Button onClick={runDailyReview} disabled={assignedCount !== roleOrder.length || !dailyPrediction} className="run-button"><ClipboardCheck />5職種を同一条件で比較</Button>
                    </div>
                  </div>
                ) : (
                  <div className="daily-review" aria-live="polite">
                    <div className="review-hero"><div className="review-check"><ClipboardCheck /></div><div><span>DAILY CALIBRATION COMPLETE</span><h3>5職種の比較が完了しました</h3><p>あなたの予測：{dailyPrediction ? predictionOptions[dailyPrediction].label : "未選択"}。基準案との差は不正解ではなく、次に根拠を確認するための論点です。</p></div><div className="review-count"><strong>{reviewDifferenceCount}</strong><span>件の別仮説</span></div></div>
                    <div className="review-list">
                      {roleOrder.map((roleKey) => {
                        const selected = dailyAssignments[roleKey] ?? "C";
                        const baseline = guidance[roleKey];
                        const same = selected === baseline.policy;
                        const estimate = comparisons[selected].metrics;
                        return <div className="review-row" key={roleKey}><div><strong>{roleLabels[roleKey]}</strong><small>{roleKey === dailyMission.focusRole ? "本日の重点" : "役割レンズ"}</small></div><div className="review-policy"><span style={{ color: policies[selected].color }}>{selected} · {policies[selected].name}</span><small>方式単独の合成値：通信 {estimate.bandwidth}× / 反応 {estimate.response}分</small></div><div className="review-reason"><Badge variant="outline" className={same ? "match" : "alternative"}>{same ? "比較基準と一致" : `基準案 ${baseline.policy}`}</Badge><p>{baseline.reason}</p></div></div>;
                      })}
                    </div>
                    <div className="review-actions"><div><span>次回予告</span><strong>{scenarios[tomorrowMission.scenario].label} · 重点 {roleLabels[tomorrowMission.focusRole]}</strong><small>履歴・探索状況はこの端末だけに保存されます。</small></div><Button variant="outline" onClick={reviseDailyTraining} className="border-white/15 bg-transparent text-white hover:bg-white/10 hover:text-white">選択を1件見直す</Button><Button onClick={() => setActiveTab("compare")} className="run-button">A/B/C全体比較へ<ChevronRight /></Button></div>
                  </div>
                )}
              </CardContent>
            </Card>

            <div className="free-lab-label"><span>自由演習</span><p>条件を変え、時間経過と配置を手動で確認</p>{dailyActive && <button onClick={() => setDailyActive(false)}><X />今日の演習を閉じる</button>}</div>
            <section className="control-bar" aria-label="訓練条件">
              <div className="control-field"><label htmlFor="scenario-select">訓練シナリオ</label><Select value={scenario} onValueChange={(value) => resetSimulation(value as ScenarioKey)}><SelectTrigger id="scenario-select" className="w-full border-white/15 bg-white/[0.04] text-white"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(scenarios).map(([key, item]) => <SelectItem key={key} value={key}>{item.label}</SelectItem>)}</SelectContent></Select></div>
              <div className="policy-switcher" role="group" aria-label="情報送信方式"><label>情報送信方式</label><div>{(Object.keys(policies) as PolicyKey[]).map((key) => <button key={key} className={policy === key ? "active" : ""} onClick={() => { setDailyActive(false); setPolicy(key); }} aria-pressed={policy === key}><b>{key}</b><span>{policies[key].name}</span></button>)}</div></div>
              <div className="control-field seed-field"><label htmlFor="seed-select">再現seed</label><Select value={String(seed)} onValueChange={(value) => { setSeed(Number(value)); resetSimulation(); }}><SelectTrigger id="seed-select" className="w-full border-white/15 bg-white/[0.04] text-white"><SelectValue /></SelectTrigger><SelectContent>{[42, 84, 126, 168, 210].map((item) => <SelectItem key={item} value={String(item)}>{item}</SelectItem>)}</SelectContent></Select></div>
              <div className="switch-field"><div><label htmlFor="raw-switch">不一致時だけ詳細取得</label><span>{policy === "C" ? "通常時は安全パケット" : "方式Cで有効"}</span></div><Switch id="raw-switch" checked={rawOnDemand} onCheckedChange={setRawOnDemand} disabled={policy !== "C"} /></div>
              <div className="run-actions"><Button variant="outline" size="icon" onClick={() => resetSimulation()} aria-label="リセット" className="border-white/15 bg-transparent text-white hover:bg-white/10 hover:text-white"><RotateCcw /></Button><Button onClick={() => { setDailyActive(false); runOrRestart(); }} className="run-button">{running ? <Pause /> : <Play />}{running ? "一時停止" : step > 0 && step < events.length - 1 ? "再開" : step === events.length - 1 ? "再実行" : "訓練開始"}</Button></div>
            </section>

            <div className="authority-strip"><div><ShieldCheck /><span>気象庁等の公式情報</span><strong>未接続（訓練）</strong></div><p>独自観測・AI推論・公式情報を混同しない</p><Badge variant="outline" className="border-amber-300/25 text-amber-200">最終判断：権限者</Badge></div>

            <div className="live-grid">
              <Card className="panel map-panel">
                <CardHeader className="panel-header"><div><CardTitle>青凪湾デジタルツイン</CardTitle><CardDescription>{scenarios[scenario].description}</CardDescription></div><Badge variant="outline" className="border-white/15 text-slate-300">架空湾・実座標なし</Badge></CardHeader>
                <CardContent className="map-content">
                  <div className="bay-map" aria-label="架空湾のセンサーノード配置図">
                    <div className="coast coast-one" /><div className="coast coast-two" /><div className="port-label"><Anchor />東港</div>
                    <div className="gateway gateway-one"><Radio /><span>GW-A</span></div><div className="gateway gateway-two"><Radio /><span>GW-B</span></div>
                    {nodes.map((node) => { const state = nodeState(node.id, step, scenario); const isSelected = selectedNode === node.id; return <button key={node.id} className={`sensor-node ${state} ${isSelected ? "selected" : ""}`} style={{ left: `${node.x}%`, top: `${node.y}%` }} title={`${node.id}: ${state}`} aria-label={`${node.id} ${state}。タップして合成状態を確認`} aria-pressed={isSelected} onClick={() => setSelectedNode(isSelected ? null : node.id)}><span /><small>{node.id}</small></button>; })}
                    <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" className="signal-lines"><path d="M18 21 C30 30 35 30 45 46" /><path d="M72 26 C65 37 60 40 45 46" /><path d="M21 65 C28 57 33 53 45 46" /><path d="M74 65 C66 60 60 55 45 46" /></svg>
                    {step >= 3 && scenario === "trust-collapse" && <><div className="pressure-wave wave-one" /><div className="pressure-wave wave-two" /></>}
                    <div className="map-legend"><span><i className="normal" />正常</span><span><i className="watch" />要確認</span><span><i className="danger" />異常</span><span><i className="offline" />故障</span></div>
                    {selectedNode && <div className="node-inspector" role="status"><div><span>合成ノード</span><button onClick={() => setSelectedNode(null)} aria-label="ノード詳細を閉じる"><X /></button></div><strong>{selectedNode}</strong><dl><div><dt>方式</dt><dd>{nodeModality(selectedNode)}</dd></div><div><dt>現在状態</dt><dd>{selectedNodeState === "normal" ? "正常" : selectedNodeState === "watch" ? "要確認" : selectedNodeState === "danger" ? "異常候補" : "故障"}</dd></div><div><dt>時点</dt><dd>{events[step].time}</dd></div></dl><small>実センサー値・実座標ではありません。</small></div>}
                  </div>
                  <div className="timeline-progress"><div><span>訓練時刻</span><strong>{events[step].time}</strong></div><Progress value={(step / (events.length - 1)) * 100} /><div className="step-dots">{events.map((event, index) => <button key={event.time} onClick={() => { setRunning(false); setStep(index); }} className={index <= step ? `done ${event.kind}` : ""} aria-label={`${event.time} ${event.title}`} />)}</div></div>
                </CardContent>
              </Card>

              <Card className="panel brief-panel">
                <CardHeader className="panel-header role-header"><div><CardTitle>今、決めること</CardTitle><CardDescription>事実・不明・責任者を分離</CardDescription></div><Select value={role} onValueChange={(value) => setRole(value as RoleKey)}><SelectTrigger className="role-select border-white/15 bg-white/[0.04] text-white"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(roleLabels).map(([key, label]) => <SelectItem key={key} value={key}>{label}</SelectItem>)}</SelectContent></Select></CardHeader>
                <CardContent className="brief-content">
                  <div className="current-alert"><div className={`event-icon ${events[step].kind}`}><AlertTriangle /></div><div><span>現在のイベント · {events[step].time}</span><strong>{events[step].title}</strong><p>{events[step].detail}</p></div></div>
                  <div className="brief-objective"><CircleGauge /><div><span>判断目的</span><p>{brief.objective}</p></div></div>
                  <dl className="fact-grid"><div className="confirmed"><dt><CheckCircle2 />確認済み</dt><dd>{brief.confirmed}</dd></div><div className="unknown"><dt><AlertTriangle />未確認</dt><dd>{brief.unknown}</dd></div></dl>
                  <div className="recommended-action"><span>判断候補 01</span><strong>{brief.action}</strong><small>担当：{brief.owner}　｜　次回更新：{step < events.length - 1 ? events[step + 1].time : "訓練終了"}</small></div>
                  <div className="decision-row"><div><span>判断候補 02</span><strong>情報の受信確認と未回答先への再送</strong></div><div><span>判断候補 03</span><strong>次の判断時刻まで保留条件を記録</strong></div></div>
                  <div className="do-not"><ShieldCheck /><div><span>しないこと</span><p>{brief.avoid}</p></div></div>
                  <Sheet>
                    <SheetTrigger asChild><Button variant="outline" className="evidence-button"><Eye />判断根拠を確認</Button></SheetTrigger>
                    <SheetContent className="evidence-sheet">
                      <SheetHeader><SheetTitle>観測エビデンス</SheetTitle><SheetDescription>ground truthは組織エージェントへ見せません。</SheetDescription></SheetHeader>
                      <div className="evidence-body">
                        <div className="evidence-status"><Badge>独自観測</Badge><span>公式警報：未接続</span></div>
                        <h3>受信パケット</h3>
                        <dl><div><dt>方式</dt><dd>{policy} · {policies[policy].name}</dd></div><div><dt>データ経過</dt><dd>1 tick（5分）以内</dd></div><div><dt>機器状態</dt><dd>{policy === "A" ? "送信されない" : "0.97 / 正常"}</dd></div><div><dt>不確実理由</dt><dd>{policy === "A" ? "送信されない" : "波浪雑音、同一モデル相関"}</dd></div><div><dt>来歴</dt><dd>{policy === "A" ? "簡易IDのみ" : `seed-${seed} / provenance hash`}</dd></div></dl>
                        <h3>シミュレーション実行値</h3>
                        <div className="evidence-metrics"><span>最大配信遅延 <b>{result.summary.maxDeliveryDelayTicks * 5}分</b></span><span>総通信量 <b>{Math.round(result.summary.totalBytes / 1024)}KB</b></span><span>港湾最大待機 <b>{result.summary.peakQueue}隻</b></span></div>
                        <h3>監査可能な判断</h3>
                        {result.logs.length ? result.logs.map((log) => <div className="sheet-log" key={`${log.tick}-${log.event}`}><time>{log.time}</time><div><strong>{log.event}</strong><span>{log.actor} · evidence {log.evidence.length}件</span></div></div>) : <p className="empty-log">現在のseedでは重大判断ログなし</p>}
                      </div>
                    </SheetContent>
                  </Sheet>
                </CardContent>
              </Card>
            </div>

            <div className="metrics-grid"><MetricCard label="組織間の信頼" value={metrics.trust} suffix="%" /><MetricCard label="真の異常への反応" value={metrics.response} suffix="分" tone="blue" /><MetricCard label="誤警報" value={metrics.falseAlerts} suffix="回" tone="coral" /><MetricCard label="港湾ピーク負荷" value={metrics.traffic} suffix="%" tone="coral" /><MetricCard label="通信量指数" value={metrics.bandwidth} suffix="×" tone="blue" /><MetricCard label="回収見込み" value={metrics.recovery} suffix="%" /></div>

            <div className="lower-grid">
              <Card className="panel event-log"><CardHeader className="panel-header"><div><CardTitle>判断監査ログ</CardTitle><CardDescription>入力と判断候補を追跡可能にする</CardDescription></div><div className="export-actions"><Button variant="outline" size="sm" onClick={downloadResult} className="border-white/15 bg-transparent text-white hover:bg-white/10 hover:text-white"><Download />監査JSON</Button><Button variant="outline" size="sm" onClick={downloadComparisonCsv} className="border-white/15 bg-transparent text-white hover:bg-white/10 hover:text-white"><Download />比較CSV</Button></div></CardHeader><CardContent>{events.slice(0, step + 1).map((event, index) => <div className="log-row" key={`${event.time}-${event.title}`}><time>{event.time}</time><i className={event.kind} /><div><strong>{event.title}</strong><span>{event.detail}</span></div><Badge variant="outline" className="border-white/10 text-slate-400">{index === 0 ? "観測" : index < 3 ? "推論" : "判断候補"}</Badge></div>)}</CardContent></Card>
              <Card className="panel packet-card"><CardHeader><CardTitle>現在の情報パケット</CardTitle><CardDescription>{policies[policy].description}</CardDescription></CardHeader><CardContent><div className="packet-size"><HardDrive /><div><span>1 tickの送信量（仮定）</span><strong>{policy === "A" ? "1.5" : policy === "B" ? "48" : "9–17"} KB</strong></div></div><ul>{policies[policy].packet.map((item) => <li key={item}><CheckCircle2 />{item}</li>)}</ul><p className="packet-note">少なすぎるAと、多すぎるBの双方を同一seedで比較します。Cは不一致時だけ短い根拠データを取得します。</p></CardContent></Card>
            </div>
          </TabsContent>

          <TabsContent value="compare" className="mt-0">
            <div className="comparison-grid">
              <Card className="panel comparison-main"><CardHeader><CardTitle>同一seedの介入比較</CardTitle><CardDescription>数値は決定論的状態遷移から実行時に集計</CardDescription></CardHeader><CardContent><Table><TableHeader><TableRow><TableHead>指標</TableHead><TableHead>A ラベルのみ</TableHead><TableHead>B 詳細常送</TableHead><TableHead>C 適応型</TableHead></TableRow></TableHeader><TableBody>{[["組織間の信頼", "%", "trust"], ["反応時間", "分", "response"], ["誤警報", "回", "falseAlerts"], ["港湾ピーク負荷", "%", "traffic"], ["通信量指数", "×", "bandwidth"], ["回収見込み", "%", "recovery"]].map(([label, suffix, key]) => <TableRow key={label}><TableCell className="font-medium text-slate-200">{label}</TableCell>{(["A", "B", "C"] as PolicyKey[]).map((item) => <TableCell key={item}><strong style={{ color: policies[item].color }}>{comparisons[item].metrics[key as keyof MetricSet]}</strong><span className="unit">{suffix}</span></TableCell>)}</TableRow>)}</TableBody></Table></CardContent></Card>
              <Card className="panel chain-card"><CardHeader><CardTitle>検証する連鎖</CardTitle><CardDescription>結果を直接脚本化せず、限定情報と組織状態から生成</CardDescription></CardHeader><CardContent>{["不確実性を削除", "相関誤認", "誤警報", "情報源の信頼低下", "真の異常で確認遅延", "一斉帰港・救助遅延"].map((item, index) => <div className="chain-step" key={item}><span>{String(index + 1).padStart(2, "0")}</span><p>{item}</p>{index < 5 && <i />}</div>)}</CardContent></Card>
            </div>
            <div className="intervention-cards">{(Object.keys(policies) as PolicyKey[]).map((key) => { const item = comparisons[key].metrics; return <Card key={key} className={`panel intervention ${policy === key ? "selected" : ""}`} onClick={() => setPolicy(key)}><CardHeader><div className="policy-letter" style={{ borderColor: policies[key].color, color: policies[key].color }}>{key}</div><div><CardTitle>{policies[key].name}</CardTitle><CardDescription>{policies[key].description}</CardDescription></div></CardHeader><CardContent><div><span>信頼</span><Progress value={item.trust} /><strong>{item.trust}%</strong></div><div><span>港湾負荷</span><Progress value={item.traffic} /><strong>{item.traffic}%</strong></div><Button variant={policy === key ? "default" : "outline"} onClick={(event) => { event.stopPropagation(); setPolicy(key); setDailyActive(false); setActiveTab("live"); }} className={policy === key ? "run-button w-full" : "w-full border-white/15 bg-transparent text-white hover:bg-white/10 hover:text-white"}>{policy === key ? "この方式でインシデント室へ" : "インシデント室で試す"}</Button></CardContent></Card>; })}</div>
          </TabsContent>

          <TabsContent value="placement" className="mt-0">
            <div className="placement-grid">
              <Card className="panel optimizer-controls"><CardHeader><CardTitle>配置・回収オプティマイザー</CardTitle><CardDescription>合成候補点の相対評価。主シミュレーションとは分離</CardDescription></CardHeader><CardContent><div className="slider-field"><div><label>導入可能コスト</label><strong>{budget[0]} pt</strong></div><Slider value={budget} onValueChange={setBudget} min={20} max={100} step={1} /></div><div className="slider-field"><div><label>生態系回避の重み</label><strong>{ecology[0]}%</strong></div><Slider value={ecology} onValueChange={setEcology} min={20} max={100} step={1} /></div><div className="slider-field"><div><label>回収可能性の重み</label><strong>{retrieval[0]}%</strong></div><Slider value={retrieval} onValueChange={setRetrieval} min={20} max={100} step={1} /></div><div className="constraint-list"><p><Leaf />生態系重要区域を除外</p><p><Ship />船舶回収窓を確保</p><p><Radio />通信経路を二重化</p><p><Database />水圧・音響を分離</p></div></CardContent></Card>
              <Card className="panel optimizer-result"><CardHeader><CardTitle>Pareto候補 #04</CardTitle><CardDescription>検知範囲とライフサイクル負荷の均衡案</CardDescription></CardHeader><CardContent><div className="optimizer-metrics"><MetricCard label="推奨ノード" value={optimizedNodes} suffix="基" /><MetricCard label="合成カバレッジ" value={coverage} suffix="%" tone="blue" /><MetricCard label="総費用指数" value={lifecycleCost} suffix="pt" tone="coral" /><MetricCard label="回収見込み" value={optimizedRecovery} suffix="%" /></div><div className="lifecycle-line">{["設計", "設置", "運用", "保守", "回収", "再利用"].map((item, index) => <div key={item}><span>{index + 1}</span><p>{item}</p></div>)}</div><div className="recovery-warning"><AlertTriangle /><p><strong>100%回収は保証しません。</strong>紛失確率、浮上失敗、回収船費用を目的関数に含めます。</p></div></CardContent></Card>
            </div>
            <Card className="panel lifecycle-table"><CardHeader><CardTitle>ライフサイクル費用</CardTitle><CardDescription>実価格ではなく相対ポイント。実配備には海底地形、雑音、許認可、船舶見積が必要</CardDescription></CardHeader><CardContent><Table><TableHeader><TableRow><TableHead>項目</TableHead><TableHead>評価内容</TableHead><TableHead>今回の扱い</TableHead></TableRow></TableHeader><TableBody>{[["機器", "水圧・音響・健全性・電源", "異種センサーを優先"], ["設置", "船舶・係留・海底条件", "合成距離で代替"], ["通信", "音響モデム・衛星・携帯", "緊急帯域を確保"], ["保守", "電池・故障・再校正", "自己診断を常時送信"], ["回収", "浮上・位置発信・回収船", "成功確率を明示"], ["廃棄", "素材台帳・再利用・紛失", "未回収へ強い罰則"]].map((row) => <TableRow key={row[0]}>{row.map((cell) => <TableCell key={cell}>{cell}</TableCell>)}</TableRow>)}</TableBody></Table></CardContent></Card>
          </TabsContent>
        </Tabs>

        <footer><p>BLUE BRIEF · AUTOMATA participant 0156</p><p>実務者要件に基づく仮説プロトタイプ。満足度は職種別テスト前のため未検証です。</p></footer>
      </section>
    </main>
  );
}
