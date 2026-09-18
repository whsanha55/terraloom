"use client";

import { Dices } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { SimulationClient } from "@/simulation/client";
import { computeLandRatio } from "@/world/generation/elevation";
import type { SettlementGen, RouteGen } from "@/world/generation/settlements";
import { createDefaultWorldConfig } from "@/world/model/worldConfig";
import type { WorldMap } from "@/world/model/worldMap";
import type {
  CityDetail,
  MigrationFlow,
  SettlementSnapshot,
  SimSpeed,
  StatsPoint,
  WorldSummary,
} from "@/workers/protocol";
import type { EventNotice } from "@/simulation/events/engine";
import type { EventDetailData } from "@/simulation/events/detail";
import { EventTimeline } from "@/ui/timeline/EventTimeline";
import { EventDetailPanel } from "@/ui/events/EventDetailPanel";
import { CityDetailPanel, type CitySeriesPoint } from "@/ui/events/CityDetailPanel";
import { RecommendationPanel, type LLMAutomation } from "@/ui/llm/RecommendationPanel";
import { SnapshotPanel, type SnapshotEntry } from "@/ui/branches/SnapshotPanel";
import { InterventionPanel, type InterventionLogEntry } from "@/ui/interventions/InterventionPanel";
import type { BranchComparison, LLMPolicy } from "@/simulation/core/branch";
import { MockLLMProvider, OpenAICompatibleProvider } from "@/llm/gateway/provider";
import {
  requestRecommendations,
  requestChainRecommendations,
  type GatewayResult,
  type ChainGatewayResult,
  type GatewayCandidate,
  type ChainGatewayCandidate,
} from "@/llm/gateway/gateway";
import { PROMPT_VERSION } from "@/llm/gateway/prompt";
import { CHAIN_PROMPT_VERSION } from "@/llm/gateway/chain";
import { classifySafety } from "@/llm/validation/safety";
import { CellInspector } from "./CellInspector";
import { MapCanvas, type MapLayer } from "./MapCanvas";
import { StatsChart } from "./StatsChart";
import { TimeControls } from "./TimeControls";

const RESOLUTIONS = [256, 512] as const;
const LAYERS: Array<{ id: MapLayer; label: string }> = [
  { id: "elevation", label: "고도" },
  { id: "temperature", label: "온도" },
  { id: "moisture", label: "습도" },
  { id: "biome", label: "바이옴" },
];

/** 시드 자체는 결정론 대상이 아니므로 crypto로 생성한다(Math.random 미사용) */
function randomSeed(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** 도시별 시계열 버퍼 상한 — 240 지점(약 20년) (§34 UI 변경 사항만 전달) */
const CITY_SERIES_CAP = 240;

/** worker 시스템 상태(§22.1) — 최근 3건만 노출 */
interface SystemStatusEntry {
  id: number;
  level: "info" | "warning" | "error";
  message: string;
}

interface WorldView {
  seed: string;
  map: WorldMap;
  settlements: SettlementGen[];
  routes: RouteGen[];
  seaLevel: number;
  attempts: number;
  seaLevelCompensated: boolean;
}

/** 토큰 추정 — 모의 제공자 기준(글자 수/4). 기록은 추정치로 남는다(§23 usage) */
function estimateUsage(chars: number) {
  const tokens = Math.ceil(chars / 4);
  return { promptTokens: tokens, outputTokens: tokens };
}

const INITIAL_SUMMARY: WorldSummary = {
  tick: 0,
  year: 0,
  month: 0,
  season: "winter",
  totalPopulation: 0,
  totalFoodStock: 0,
  migrationTotal: 0,
  paused: true,
  speed: 1,
  interventionPoints: 2000,
};

export function GeneratorPanel() {
  const [seed, setSeed] = useState("");
  const [resolution, setResolution] = useState<number>(256);
  const [seaLevel, setSeaLevel] = useState(0.5);
  const [layer, setLayer] = useState<MapLayer>("elevation");
  const [selectedCell, setSelectedCell] = useState<{ x: number; y: number } | null>(null);
  const [world, setWorld] = useState<WorldView | null>(null);
  const [summary, setSummary] = useState<WorldSummary>(INITIAL_SUMMARY);
  const [stats, setStats] = useState<StatsPoint[]>([]);
  const [liveSettlements, setLiveSettlements] = useState<Record<string, SettlementSnapshot>>({});
  const [migrations, setMigrations] = useState<MigrationFlow[]>([]);
  const [eventLog, setEventLog] = useState<EventNotice[]>([]);
  const [majorEvent, setMajorEvent] = useState<EventNotice | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [eventDetail, setEventDetail] = useState<EventDetailData | null>(null);
  const [selectedSettlementId, setSelectedSettlementId] = useState<string | null>(null);
  const [cityDetail, setCityDetail] = useState<CityDetail | null>(null);
  const [citySeries, setCitySeries] = useState<Record<string, CitySeriesPoint[]>>({});
  const [watchMode, setWatchMode] = useState(false);
  const [majorThreshold, setMajorThreshold] = useState(80);
  const [pauseReason, setPauseReason] = useState<string | null>(null);
  const [llmStatus, setLlmStatus] = useState<"idle" | "loading" | "ok" | "fallback">("idle");
  const [llmResult, setLlmResult] = useState<GatewayResult | null>(null);
  const [llmInputHash, setLlmInputHash] = useState<string | null>(null);
  const [approvedTemplateIds, setApprovedTemplateIds] = useState<Set<string>>(new Set());
  const [providerMode, setProviderMode] = useState<"mock" | "byok">("mock");
  const [apiKey, setApiKey] = useState(""); // 세션 메모리만 (§30 — 저장 금지)
  const [automation, setAutomation] = useState<LLMAutomation>("manual");
  const [chainStatus, setChainStatus] = useState<"idle" | "loading" | "ok" | "fallback">("idle");
  const [chainResult, setChainResult] = useState<ChainGatewayResult | null>(null);
  const [chainHash, setChainHash] = useState<string | null>(null);
  const [chainParentName, setChainParentName] = useState<string | null>(null);
  const [snapshots, setSnapshots] = useState<SnapshotEntry[]>([]);
  const [llmPolicy, setLlmPolicy] = useState<LLMPolicy>("reuse");
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [comparison, setComparison] = useState<BranchComparison | null>(null);
  const [compareAId, setCompareAId] = useState("");
  const [compareBId, setCompareBId] = useState("");
  const [interventionLog, setInterventionLog] = useState<InterventionLogEntry[]>([]);
  const [systemStatuses, setSystemStatuses] = useState<SystemStatusEntry[]>([]);
  const [eventTemplates, setEventTemplates] = useState<Array<{ id: string; name: string }>>([]);
  const clientRef = useRef<SimulationClient | null>(null);
  const initSeqRef = useRef(0);
  const statusSeqRef = useRef(0);
  const mapRef = useRef<HTMLDivElement | null>(null);
  const citySeriesRef = useRef<Record<string, CitySeriesPoint[]>>({});
  const watchModeRef = useRef(false);
  const providerModeRef = useRef<"mock" | "byok">("mock");
  const apiKeyRef = useRef("");
  const automationRef = useRef<LLMAutomation>("manual");
  const lastAutoLLMTickRef = useRef(-Infinity); // §17 호출 빈도 제한 (5년)
  const summaryRef = useRef(INITIAL_SUMMARY);
  useEffect(() => {
    summaryRef.current = summary;
  }, [summary]);
  useEffect(() => {
    watchModeRef.current = watchMode;
  }, [watchMode]);
  useEffect(() => {
    providerModeRef.current = providerMode;
  }, [providerMode]);
  useEffect(() => {
    apiKeyRef.current = apiKey;
  }, [apiKey]);
  useEffect(() => {
    automationRef.current = automation;
  }, [automation]);

  useEffect(() => {
    const client = new SimulationClient({
      onTickBatch: (notification) => {
        setSummary(notification.summary);
        setMigrations(notification.migrations);
        setLiveSettlements((prev) => {
          const next = { ...prev };
          for (const snapshot of notification.settlements) {
            next[snapshot.id] = snapshot;
          }
          return next;
        });
        // 도시별 시계열 누적 (§27.4 미니 시계열) — UI 메모리에서만 유지
        const tick = notification.summary.tick;
        const nextSeries = { ...citySeriesRef.current };
        for (const snapshot of notification.settlements) {
          const series = nextSeries[snapshot.id] ?? [];
          if (series.length === 0 || series[series.length - 1]?.tick !== tick) {
            nextSeries[snapshot.id] = [
              ...series,
              { tick, population: snapshot.population, foodStock: snapshot.foodStock },
            ].slice(-CITY_SERIES_CAP);
          }
        }
        citySeriesRef.current = nextSeries;
        setCitySeries(nextSeries);
        if (notification.events.length > 0) {
          setEventLog((prev) => [...notification.events, ...prev].slice(0, 200));
        }
      },
      onStatsUpdate: (series) => setStats((prev) => [...prev, ...series]),
      onMajorEvent: (notice) => {
        setMajorEvent(notice);
        setPauseReason(`사건 정지: ${notice.name}`);
        // §17 호출 조건 — 중요 사건 직후 자동 연쇄 추천 (자동화 켜짐 + 빈도 제한 60틱)
        if (
          automationRef.current !== "manual" &&
          notice.scope === "settlement" &&
          notice.startedTick - lastAutoLLMTickRef.current >= 60
        ) {
          lastAutoLLMTickRef.current = notice.startedTick;
          clientRef.current?.requestLLMChain(notice.id);
        }
        // Watch Mode — 카메라 이동(자동 선택) + 상세 패널 open (§25)
        if (watchModeRef.current) {
          setSelectedEventId(notice.id);
          clientRef.current?.requestEventDetail(notice.id);
          if (notice.scope === "settlement") {
            setSelectedSettlementId(notice.targetId);
            clientRef.current?.requestCityDetail(notice.targetId);
            mapRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
          }
        }
      },
      onEventDetail: (detail) => setEventDetail(detail),
      onCityDetail: (detail) => setCityDetail(detail),
      onLLMRequest: async (input, inputHash, registeredNames, _tick, chain) => {
        const provider =
          providerModeRef.current === "byok" && apiKeyRef.current.trim() !== ""
            ? new OpenAICompatibleProvider({
                baseUrl: "https://api.openai.com/v1",
                apiKey: apiKeyRef.current.trim(),
                model: "gpt-4o-mini",
              })
            : new MockLLMProvider();
        if (chain) {
          // 연쇄 추천 (Step 12) — 후보 등록 후 규칙 엔진이 발생 확률을 계산한다
          setChainStatus("loading");
          setChainParentName(chain.context.parent.name);
          const chainResult = await requestChainRecommendations(
            provider,
            chain.context,
            new Set(registeredNames),
          );
          setChainHash(chain.contextHash);
          setChainResult(chainResult);
          setChainStatus(chainResult.status);
          // 자동 승인 (§21.2) — semi는 낮은 영향만, auto는 검증된 후보 전부
          const mode = automationRef.current;
          if (chainResult.status === "ok" && mode !== "manual") {
            for (const candidate of chainResult.candidates) {
              const template = candidate.validation.template;
              if (!template || !candidate.validation.scheduled) continue;
              if (mode === "semi" && classifySafety(template) !== "low") continue;
              clientRef.current?.registerChainTemplate({
                template,
                scheduled: candidate.validation.scheduled,
                inputHash: chain.contextHash,
                rawOutput: chainResult.rawOutput,
                provider: chainResult.provider,
                model: chainResult.model,
                promptVersion: CHAIN_PROMPT_VERSION,
                approvedBy: "automatic",
                usage: estimateUsage(chainResult.rawOutput.length * 4),
              });
            }
          }
          return;
        }
        setLlmInputHash(inputHash);
        setLlmStatus("loading");
        const result = await requestRecommendations(provider, input, new Set(registeredNames));
        setLlmResult(result);
        setLlmStatus(result.status);
      },
      onLLMRegistered: (result) => {
        if (result.ok && result.templateId) {
          setApprovedTemplateIds((prev) => new Set([...prev, result.templateId!]));
          clientRef.current?.listEventTemplates(); // 개입 대상 목록에도 등록된다
        }
      },
      onSnapshotSaved: () => {
        setLastSavedAt(Date.now());
        clientRef.current?.listSnapshots();
      },
      onSnapshotList: (list) => {
        setSnapshots(list);
        setCompareAId((prev) => (prev === "" && list.length > 0 ? list[0]!.id : prev));
        setCompareBId((prev) => (prev === "" && list.length > 1 ? list[list.length - 1]!.id : prev));
      },
      onEventTemplateList: (templates) => setEventTemplates(templates),
      onSystemStatus: (notification) => {
        // §22.1 — worker 오류·거부를 사용자에게 보인다 (swallow 금지)
        if (notification.code === "llm_chain_no_context") {
          setChainStatus("idle"); // 요청이 성립하지 않았다 — 로딩 상태 해제
        }
        setSystemStatuses((prev) => [
          ...prev.slice(-2),
          { id: ++statusSeqRef.current, level: notification.level, message: notification.message },
        ]);
      },
      onWorldRestored: (result) => {
        setEventLog([]);
        setStats([]);
        setLiveSettlements({});
        setMigrations([]);
        citySeriesRef.current = {};
        setCitySeries({});
        setApprovedTemplateIds(new Set());
        setMajorEvent(null);
        setPauseReason(null);
        setLlmStatus("idle");
        setLlmResult(null);
        setSystemStatuses([]);
        clientRef.current?.listSnapshots();
        clientRef.current?.listEventTemplates();
        void result;
      },
      onBranchComparison: (result) => setComparison(result),
      onInterventionResult: (result) => {
        setInterventionLog((prev) => [
          ...prev,
          {
            id: `log:${result.description}:${prev.length}`,
            ok: result.ok,
            description: result.ok ? result.description : (result.reason ?? "알 수 없는 실패"),
            tick: summaryRef.current.tick,
          },
        ]);
      },
    });
    clientRef.current = client;
    return () => {
      client.dispose();
      clientRef.current = null;
    };
  }, []);

  const initWorld = useCallback(
    async (seedValue: string, options?: { seaLevel?: number; revealSeed?: boolean }) => {
      const client = clientRef.current;
      if (!client) return;
      const seq = ++initSeqRef.current;
      const config = createDefaultWorldConfig(seedValue);
      config.resolution = resolution;
      const payload = await client.init(config, options?.seaLevel ?? seaLevel);
      if (seq !== initSeqRef.current) return; // 이후 재요청이 있으면 폐기
      setWorld({
        seed: seedValue,
        map: payload.map,
        settlements: payload.settlements,
        routes: payload.routes,
        seaLevel: payload.seaLevel,
        attempts: payload.attempts,
        seaLevelCompensated: payload.seaLevelCompensated,
      });
      setSelectedCell(null);
      setStats([]);
      setLiveSettlements({});
      setMigrations([]);
      setEventLog([]);
      setMajorEvent(null);
      setSelectedEventId(null);
      setEventDetail(null);
      setSelectedSettlementId(null);
      setCityDetail(null);
      citySeriesRef.current = {};
      setCitySeries({});
      setPauseReason(null);
      setLlmStatus("idle");
      setLlmResult(null);
      setLlmInputHash(null);
      setApprovedTemplateIds(new Set());
      setChainStatus("idle");
      setChainResult(null);
      setChainHash(null);
      setChainParentName(null);
      lastAutoLLMTickRef.current = -Infinity;
      setSnapshots([]);
      setLastSavedAt(null);
      setComparison(null);
      setCompareAId("");
      setCompareBId("");
      setInterventionLog([]);
      setSystemStatuses([]);
      client.listEventTemplates(); // 개입(사건 직접 발생) 대상 — worker 레지스트리 기준
      if (options?.revealSeed) setSeed(seedValue);
    },
    [resolution, seaLevel],
  );

  const generate = useCallback(() => {
    const effectiveSeed = seed.trim() === "" ? randomSeed() : seed.trim();
    void initWorld(effectiveSeed, { revealSeed: seed.trim() === "" });
  }, [initWorld, seed]);

  // 해수면 변경 → Worker에서 전체 재생성(같은 시드 → 같은 고도, 새 기후) 후 즉시 반영
  const handleSeaLevelChange = (value: number) => {
    setSeaLevel(value);
    if (world) {
      void initWorld(world.seed, { seaLevel: value });
    }
  };

  const handleSetSpeed = (speed: SimSpeed) => {
    if (speed === 0) {
      setPauseReason(watchModeRef.current ? "수동 정지" : null);
    } else {
      setPauseReason(null);
    }
    clientRef.current?.setSpeed(speed);
  };

  const handleStep = (ticks: 1 | 12) => {
    clientRef.current?.step(ticks);
  };

  const handleWatchModeChange = (enabled: boolean) => {
    setWatchMode(enabled);
    if (!enabled) setPauseReason(null);
    // 관찰 모드 진입 시 정지 상태면 빠른 탐색(100x)으로 재생해 다음 중요 사건까지 진행한다 (§25)
    if (enabled) clientRef.current?.setSpeed(100);
  };

  const handleMajorThresholdChange = (threshold: number) => {
    setMajorThreshold(threshold);
    clientRef.current?.setMajorThreshold(threshold);
  };

  const handleSelectEvent = (eventId: string) => {
    setSelectedEventId(eventId);
    clientRef.current?.requestEventDetail(eventId);
  };

  const handleSelectSettlement = (settlementId: string) => {
    setSelectedSettlementId(settlementId);
    setSelectedCell(null);
    clientRef.current?.requestCityDetail(settlementId);
  };

  const handleIntervene = (intervention: {
    id: string;
    tick: number;
    type: string;
    targetIds: string[];
    parameters: Record<string, number | string | boolean>;
  }) => {
    clientRef.current?.intervene(intervention);
  };

  const handleSave = () => {
    clientRef.current?.saveSnapshot();
  };

  const handleRestore = (snapshotId: string, asBranch: boolean) => {
    clientRef.current?.restoreSnapshot(snapshotId, { llmPolicy, asBranch });
  };

  const handleCompare = () => {
    if (compareAId && compareBId) {
      clientRef.current?.compareSnapshots(compareAId, compareBId);
    }
  };

  /** §23 늦은 응답 폐기 방지 — 수동 추천 검토 중엔 세계가 바뀌지 않게 자동 정지 */
  const pauseForReview = () => {
    if (!summaryRef.current.paused) {
      clientRef.current?.setSpeed(0);
      setPauseReason("추천 검토 중 — 승인·거부 후 재생해 주세요");
    }
  };

  const handleLLMRequest = () => {
    setLlmStatus("loading");
    pauseForReview();
    clientRef.current?.requestLLM();
  };

  const handleChainRequest = (eventId: string) => {
    setChainStatus("loading");
    pauseForReview();
    clientRef.current?.requestLLMChain(eventId);
  };

  const handleChainApprove = (candidate: ChainGatewayCandidate) => {
    const template = candidate.validation.template;
    const scheduled = candidate.validation.scheduled;
    if (!template || !scheduled || !chainHash || !chainResult) return;
    clientRef.current?.registerChainTemplate({
      template,
      scheduled,
      inputHash: chainHash,
      rawOutput: chainResult.rawOutput,
      provider: chainResult.provider,
      model: chainResult.model,
      promptVersion: CHAIN_PROMPT_VERSION,
      approvedBy: "user",
      usage: estimateUsage(chainResult.rawOutput.length * 4),
    });
  };

  const handleLLMApprove = (candidate: GatewayCandidate) => {
    const template = candidate.validation.template;
    if (!template || !llmInputHash || !llmResult) return;
    clientRef.current?.registerLLMTemplate({
      template,
      inputHash: llmInputHash,
      rawOutput: llmResult.rawOutput,
      provider: llmResult.provider,
      model: llmResult.model,
      promptVersion: PROMPT_VERSION,
    });
  };

  const landRatio = world ? computeLandRatio(world.map.elevation, world.seaLevel) : null;

  return (
    <section className="w-full max-w-3xl rounded-lg border border-border bg-surface p-xl shadow-panel">
      <div className="flex flex-col gap-md sm:flex-row sm:items-end">
        <label className="min-w-0 flex-1">
          <span className="mb-xs block font-medium text-text-muted">세계 시드</span>
          <input
            value={seed}
            onChange={(e) => setSeed(e.target.value)}
            placeholder="비우면 무작위 생성"
            className="w-full rounded-md border border-border bg-surface px-md py-sm text-text placeholder:text-text-muted/60 focus:border-primary focus:outline-none"
          />
        </label>
        <label>
          <span className="mb-xs block font-medium text-text-muted">해상도</span>
          <select
            value={resolution}
            onChange={(e) => setResolution(Number(e.target.value))}
            className="rounded-md border border-border bg-surface px-md py-sm text-text focus:border-primary focus:outline-none"
          >
            {RESOLUTIONS.map((r) => (
              <option key={r} value={r}>
                {r}×{r}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={generate}
          className="rounded-md bg-primary px-lg py-sm font-medium text-on-primary hover:bg-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          세계 생성
        </button>
        <button
          type="button"
          onClick={() => setSeed(randomSeed())}
          aria-label="무작위 시드"
          title="무작위 시드"
          className="rounded-md border border-border bg-surface p-sm text-text-muted hover:bg-accent hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <Dices size={16} aria-hidden />
        </button>
      </div>

      <label className="mt-lg block">
        <span className="flex items-baseline justify-between font-medium text-text-muted">
          <span>해수면</span>
          <span className="font-numeric tnum">{seaLevel.toFixed(2)}</span>
        </span>
        <input
          type="range"
          min={0.05}
          max={0.95}
          step={0.01}
          value={seaLevel}
          onChange={(e) => handleSeaLevelChange(Number(e.target.value))}
          className="mt-xs w-full accent-primary"
        />
      </label>

      {world ? (
        <>
          <TimeControls
            summary={summary}
            onSetSpeed={handleSetSpeed}
            onStep={handleStep}
            watchMode={watchMode}
            onWatchModeChange={handleWatchModeChange}
            majorThreshold={majorThreshold}
            onMajorThresholdChange={handleMajorThresholdChange}
          />

          {pauseReason && summary.paused && (
            <p
              data-testid="pause-reason-badge"
              className="mt-sm rounded-md bg-accent px-md py-xs text-sm font-medium text-text"
            >
              {pauseReason}
            </p>
          )}
          {majorEvent && (
            <p
              data-testid="major-event-banner"
              className="mt-sm rounded-md bg-[#FFF7ED] px-md py-sm text-sm font-medium text-warning"
            >
              사건 정지: {majorEvent.name} — {majorEvent.targetName} (중요도{" "}
              <span className="font-numeric tnum">{majorEvent.importance}</span>) · 재생으로 계속
            </p>
          )}

          {systemStatuses.length > 0 && (
            <ul data-testid="system-status" aria-live="polite" className="mt-sm space-y-xs">
              {systemStatuses.map((status) => (
                <li
                  key={status.id}
                  className={
                    status.level === "error"
                      ? "rounded-md bg-[#FEF2F2] px-md py-xs text-sm text-error"
                      : status.level === "warning"
                        ? "rounded-md bg-[#FFF7ED] px-md py-xs text-sm text-warning"
                        : "rounded-md bg-accent px-md py-xs text-sm text-text"
                  }
                >
                  {status.message}
                </li>
              ))}
            </ul>
          )}

          <EventTimeline
            events={eventLog}
            selectedEventId={selectedEventId}
            onSelect={handleSelectEvent}
          />

          <div className="mt-md flex flex-wrap items-center gap-md">
            <p className="flex flex-wrap items-center gap-x-md gap-y-xs text-text-muted">
              <span>
                육지{" "}
                <span data-testid="land-ratio" className="font-numeric tnum font-medium text-text">
                  {Math.round((landRatio ?? 0) * 100)}%
                </span>
              </span>
              <span className="font-numeric tnum">
                시도 {world.attempts}/5{world.attempts > 1 ? " (재구성)" : ""}
              </span>
              <span className="font-numeric tnum">
                도시 <span data-testid="settlement-count">{world.settlements.length}</span> · 교역로{" "}
                {world.routes.length}
              </span>
              {world.seaLevelCompensated && (
                <span className="rounded-full bg-[#FFF7ED] px-sm py-1 font-medium text-warning">
                  해수면 보정됨
                </span>
              )}
            </p>
            <div
              role="group"
              aria-label="지도 레이어"
              className="ml-auto flex overflow-hidden rounded-md border border-border"
            >
              {LAYERS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={layer === item.id}
                  onClick={() => setLayer(item.id)}
                  className={
                    layer === item.id
                      ? "bg-primary px-md py-xs font-medium text-on-primary"
                      : "px-md py-xs text-text-muted hover:bg-accent hover:text-text"
                  }
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <div ref={mapRef} className="mt-md">
            <MapCanvas
              map={world.map}
              seaLevel={world.seaLevel}
              layer={layer}
              settlements={world.settlements}
              routes={world.routes}
              live={liveSettlements}
              migrations={migrations}
              selectedSettlementId={selectedSettlementId}
              onSelectCell={setSelectedCell}
              onSelectSettlement={handleSelectSettlement}
            />
          </div>

          <div className="mt-md grid grid-cols-1 gap-md lg:grid-cols-2">
            <CityDetailPanel
              detail={cityDetail}
              series={selectedSettlementId ? (citySeries[selectedSettlementId] ?? []) : []}
              onSelectEvent={handleSelectEvent}
              onClose={() => {
                setSelectedSettlementId(null);
                setCityDetail(null);
              }}
            />
            <EventDetailPanel
              detail={eventDetail}
              onClose={() => {
                setSelectedEventId(null);
                setEventDetail(null);
              }}
              onChainRequest={handleChainRequest}
              chainLoading={chainStatus === "loading"}
            />
          </div>

          <StatsChart history={stats} />

          <div className="mt-md">
            <InterventionPanel
              settlements={
                world
                  ? world.settlements.map((settlement) => ({
                      id: settlement.id,
                      name: settlement.name,
                      status: liveSettlements[settlement.id]?.status ?? "active",
                      naturalDisasterCount:
                        liveSettlements[settlement.id]?.activeEvents.filter(
                          (event) => event.category === "natural",
                        ).length ?? 0,
                    }))
                  : []
              }
              interventionPoints={summary.interventionPoints}
              currentTick={summary.tick}
              log={interventionLog}
              eventTemplates={eventTemplates}
              onRequestTemplates={() => clientRef.current?.listEventTemplates()}
              onIntervene={handleIntervene}
            />
          </div>

          <div className="mt-md">
            <SnapshotPanel
              snapshots={snapshots}
              llmPolicy={llmPolicy}
              onLLMPolicyChange={setLlmPolicy}
              lastSavedAt={lastSavedAt}
              onSave={handleSave}
              onRefresh={() => clientRef.current?.listSnapshots()}
              onRestore={handleRestore}
              comparison={comparison}
              compareAId={compareAId}
              compareBId={compareBId}
              onCompareAChange={setCompareAId}
              onCompareBChange={setCompareBId}
              onCompare={handleCompare}
            />
          </div>

          <div className="mt-md">
            <RecommendationPanel
              status={llmStatus}
              result={llmResult}
              approvedTemplateIds={approvedTemplateIds}
              providerMode={providerMode}
              onProviderModeChange={setProviderMode}
              apiKey={apiKey}
              onApiKeyChange={setApiKey}
              automation={automation}
              onAutomationChange={setAutomation}
              chainStatus={chainStatus}
              chainResult={chainResult}
              chainParentName={chainParentName}
              onChainApprove={handleChainApprove}
              onRequest={handleLLMRequest}
              onApprove={handleLLMApprove}
            />
          </div>


          {selectedCell && (
            <CellInspector map={world.map} cell={selectedCell} seaLevel={world.seaLevel} />
          )}
        </>
      ) : (
        <p className="mt-lg text-text-muted">
          시드를 입력하고 세계를 생성해보세요. 같은 시드는 항상 같은 세계를 만듭니다.
        </p>
      )}
    </section>
  );
}
