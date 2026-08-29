export type PolicyKey = "A" | "B" | "C";
export type ScenarioKey = "trust-collapse" | "storm" | "node-failure";

export type MetricSet = {
  trust: number;
  response: number;
  falseAlerts: number;
  traffic: number;
  bandwidth: number;
  recovery: number;
};

export type SimulationLog = {
  tick: number;
  time: string;
  actor: string;
  event: string;
  evidence: string[];
  truth: "safe" | "hazard" | "fault";
};

export type SimulationResult = {
  runId: string;
  seed: number;
  policy: PolicyKey;
  scenario: ScenarioKey;
  metrics: MetricSet;
  logs: SimulationLog[];
  summary: {
    responseTick: number | null;
    peakQueue: number;
    totalBytes: number;
    maxDeliveryDelayTicks: number;
    faultDetected: boolean;
  };
};

type Delivery = {
  sourceTick: number;
  risk: number;
  truth: boolean;
  evidence: string[];
};

function clamp(value: number, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function rounded(value: number, digits = 3) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function clock(tick: number) {
  const total = tick * 5;
  const hour = Math.floor(total / 60);
  const minute = total % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function stableNoise(seed: number, tick: number, sensor: number) {
  const input = `${seed}|${tick}|${sensor}`;
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (((hash >>> 0) % 21) - 10) / 100;
}

function truePressureAt(sensor: number, tick: number) {
  if (tick < 50 || tick > 65) return 0;
  const zone = sensor <= 4 ? 0 : sensor <= 8 ? 1 : 2;
  const arrival = 50 + zone * 3;
  if (tick < arrival) return 0;
  return clamp(0.72 + (tick - arrival) * 0.055, 0, 1);
}

function scenarioFlags(scenario: ScenarioKey, tick: number) {
  const storm = scenario === "storm" ? tick >= 12 && tick <= 42 : tick >= 12 && tick <= 23;
  const commLoss = scenario === "storm" ? tick >= 32 && tick <= 58 : tick >= 48 && tick <= 55;
  const nodeFailure = scenario === "node-failure" && tick >= 36;
  return { storm, commLoss, nodeFailure };
}

export function runSimulation(policy: PolicyKey, scenario: ScenarioKey, seed = 42, detailOnDemand = true): SimulationResult {
  const deliveries = new Map<number, Delivery[]>();
  const logs: SimulationLog[] = [];
  let trust = 0.9;
  let queuedBytes = 0;
  let totalBytes = 0;
  let falseAlerts = 0;
  let falseAlertActive = false;
  let responseTick: number | null = null;
  let riskStreak = 0;
  let portQueue = 0;
  let peakQueue = 0;
  let returningVessels = 0;
  let remainingVessels = 30;
  let maxDeliveryDelayTicks = 0;
  let faultDetected = false;
  let latestDelivery: Delivery = { sourceTick: 0, risk: 0, truth: false, evidence: [] };

  for (let tick = 0; tick < 96; tick += 1) {
    const flags = scenarioFlags(scenario, tick);
    const observations: Array<{
      id: string;
      modality: "pressure" | "acoustic" | "fusion";
      family: "alpha" | "beta" | "gamma";
      score: number;
      health: number;
      anomaly: boolean;
      trueSignal: boolean;
    }> = [];

    for (let sensor = 1; sensor <= 12; sensor += 1) {
      const modality = sensor % 3 === 1 ? "pressure" : sensor % 3 === 2 ? "acoustic" : "fusion";
      const family = sensor % 3 === 1 ? "alpha" : sensor % 3 === 2 ? "beta" : "gamma";
      const failed = flags.nodeFailure && [8, 9, 10].includes(sensor);
      const drift = scenario === "trust-collapse" && sensor === 6 && tick >= 36 ? 0.58 : 0;
      const health = failed ? 0 : drift > 0 ? 0.35 : 0.97;
      const truePressure = modality === "acoustic" ? 0 : truePressureAt(sensor, tick);
      const stormBias = flags.storm && [4, 5, 7].includes(sensor) ? 0.68 : flags.storm ? 0.19 : 0;
      const acousticTraffic = modality !== "pressure" && tick >= 14 && tick <= 20 ? 0.37 : 0;
      const score = rounded(clamp(0.08 + truePressure + stormBias + acousticTraffic + drift + stableNoise(seed, tick, sensor)));
      observations.push({
        id: `S-${String(sensor).padStart(2, "0")}`,
        modality,
        family,
        score,
        health,
        anomaly: score >= 0.65,
        trueSignal: truePressure >= 0.65,
      });
    }

    const healthy = observations.filter((item) => item.health >= 0.5);
    const anomalies = observations.filter((item) => item.anomaly);
    const healthyAnomalies = healthy.filter((item) => item.anomaly);
    const pressureVotes = healthyAnomalies.filter((item) => item.modality !== "acoustic");
    const modelFamilies = new Set(healthyAnomalies.map((item) => item.family));
    const truth = observations.filter((item) => item.trueSignal).length >= 2;

    let risk = 0;
    let bytesGenerated = 0;
    let evidence: string[] = [];

    if (policy === "A") {
      risk = clamp(anomalies.length / 4);
      bytesGenerated = observations.length * 128;
      evidence = anomalies.map((item) => `${item.id}:ANOMALY`);
    } else if (policy === "B") {
      const weighted = healthyAnomalies.reduce((sum, item) => sum + item.score * item.health, 0);
      risk = pressureVotes.length >= 2 ? clamp(weighted / 3.1) : clamp(weighted / 5.2);
      bytesGenerated = observations.length * 4096;
      evidence = healthyAnomalies.map((item) => `${item.id}:${item.score.toFixed(2)}:${item.health.toFixed(2)}`);
    } else {
      const weighted = healthyAnomalies.reduce((sum, item) => sum + item.score * item.health, 0);
      const crossConfirmed = pressureVotes.length >= 2 && modelFamilies.size >= 2;
      risk = crossConfirmed ? clamp(weighted / 2.8) : clamp(weighted / 6.8);
      const disagreement = anomalies.length !== healthyAnomalies.length || (healthyAnomalies.length > 0 && modelFamilies.size < 2);
      if (disagreement && !detailOnDemand) risk *= 0.75;
      bytesGenerated = observations.length * 768 + (disagreement && detailOnDemand ? 2 * 4096 : 0);
      evidence = healthyAnomalies.map((item) => `${item.id}:${item.family}:${item.score.toFixed(2)}`);
    }

    // Detailed policies preserve the reason "storm overlap"; label-only A cannot.
    // This is a scenario rule, not hidden ground truth disclosed to organizations.
    if (flags.storm && !truth && policy !== "A") risk *= 0.35;

    if (observations.some((item) => item.health < 0.5) && policy !== "A") {
      faultDetected = true;
    }

    const capacity = flags.commLoss ? 2048 : 8192;
    totalBytes += bytesGenerated;
    const emergencyLane = policy === "C" && truth;
    const ordinaryLoad = emergencyLane ? Math.max(0, bytesGenerated - capacity * 0.4) : bytesGenerated;
    queuedBytes = Math.max(0, queuedBytes + ordinaryLoad - capacity);
    const calculatedDelay = emergencyLane ? 0 : Math.min(12, Math.ceil(queuedBytes / capacity));
    maxDeliveryDelayTicks = Math.max(maxDeliveryDelayTicks, calculatedDelay);
    const deliveryTick = Math.min(95, tick + calculatedDelay);
    const delivery: Delivery = { sourceTick: tick, risk: rounded(risk), truth, evidence };
    deliveries.set(deliveryTick, [...(deliveries.get(deliveryTick) ?? []), delivery]);

    const arriving = deliveries.get(tick);
    if (arriving?.length) latestDelivery = arriving[arriving.length - 1];

    const effectiveRisk = rounded(latestDelivery.risk * trust);
    riskStreak = effectiveRisk >= 0.6 ? riskStreak + 1 : effectiveRisk < 0.35 ? 0 : riskStreak;
    const actionThresholdMet = riskStreak >= 2;

    if (actionThresholdMet && !latestDelivery.truth && !falseAlertActive) {
      falseAlerts += 1;
      falseAlertActive = true;
      trust = clamp(trust - (policy === "A" ? 0.22 : 0.12), 0.3, 0.95);
      returningVessels = Math.max(returningVessels, 12);
      logs.push({
        tick,
        time: clock(tick),
        actor: "CENTRAL/PORT",
        event: "FALSE_ALERT_ACTION",
        evidence: latestDelivery.evidence,
        truth: "safe",
      });
    }
    if (effectiveRisk < 0.35) falseAlertActive = false;

    if (actionThresholdMet && latestDelivery.truth && responseTick === null) {
      responseTick = tick;
      trust = clamp(trust + 0.04, 0.3, 0.95);
      const responseLatency = tick - 50;
      returningVessels = remainingVessels;
      logs.push({
        tick,
        time: clock(tick),
        actor: "CENTRAL/PORT/RESCUE",
        event: "TRUE_EVENT_COORDINATION",
        evidence: latestDelivery.evidence,
        truth: "hazard",
      });
      if (responseLatency <= 3) returningVessels = Math.min(returningVessels, 15);
    }

    if (returningVessels > 0) {
      const latency = responseTick === null ? 99 : responseTick - 50;
      const arrivalRate = responseTick !== null && latency <= 3 ? 5 : 12;
      const arrivals = Math.min(arrivalRate, returningVessels);
      returningVessels -= arrivals;
      remainingVessels = Math.max(0, remainingVessels - arrivals);
      portQueue = Math.max(0, portQueue + arrivals - 6);
    } else {
      portQueue = Math.max(0, portQueue - 6);
    }
    peakQueue = Math.max(peakQueue, portQueue);
  }

  if (responseTick === null) {
    logs.push({ tick: 95, time: clock(95), actor: "SYSTEM", event: "TRUE_EVENT_MISSED", evidence: [], truth: "hazard" });
  }

  const aBaselineBytes = 12 * 128 * 96;
  const recoveryBase = policy === "A" ? 72 : policy === "B" ? 88 : 94;
  const recoveryPenalty = scenario === "node-failure" ? 8 : 0;
  const responseMinutes = responseTick === null ? 230 : Math.max(0, (responseTick - 50) * 5);
  const trafficPercent = Math.min(100, Math.round((peakQueue / 24) * 100));

  return {
    runId: `seed${seed}-${scenario}-${policy}`,
    seed,
    policy,
    scenario,
    metrics: {
      trust: Math.round(trust * 100),
      response: responseMinutes,
      falseAlerts,
      traffic: trafficPercent,
      bandwidth: rounded(totalBytes / aBaselineBytes, 1),
      recovery: Math.max(0, recoveryBase - recoveryPenalty),
    },
    logs,
    summary: {
      responseTick,
      peakQueue,
      totalBytes,
      maxDeliveryDelayTicks,
      faultDetected,
    },
  };
}
