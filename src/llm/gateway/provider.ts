/**
 * LLM Provider 어댑터 (§31 Provider Adapter).
 *
 * - MockLLMProvider: API 키 없이 항상 동작하는 결정론적 모의 제공자 (Step 11 기본).
 *   프롬프트 해시에서 파생 시드로 카탈로그를 선택 — 같은 입력에 같은 출력.
 * - OpenAICompatibleProvider: BYOK. 키는 세션 메모리만(§30 저장 금지 경로 전부 회피).
 *   호출 실패는 게이트웨이가 잡아 규칙 기반 폴백으로 전환한다(§22).
 */
import { createRng } from "@/world/random/rng";
import { fnv1a32 } from "@/world/random/seed";
import type { LLMRecommendation } from "../schemas/recommendation";

export interface LLMProvider {
  readonly name: string;
  readonly model: string;
  /** 프롬프트를 받아 JSON 텍스트를 반환한다 (LLM 원본 출력) */
  generateRecommendations(prompt: string): Promise<string>;
}

interface Blueprint {
  name: string;
  category: "natural" | "health" | "social" | "economic";
  summary: string;
  effects: Array<{ targetMetric: string; operation: "add" | "multiply"; value: number }>;
  preconditions: Array<{ metric: string; operator: "lt" | "gte"; value: number }>;
  reasoning: string;
}

/** 모의 카탈로그 — 허용 메트릭·범위(§20.2~20.3) 안에서만 구성된 후보 청사진 */
const CATALOG: Blueprint[] = [
  {
    name: "곡물 배급제 도입",
    category: "economic",
    summary: "부족한 곡물을 배급으로 분배하며 민심을 안정시킵니다.",
    effects: [{ targetMetric: "settlement.stability", operation: "add", value: 6 }],
    preconditions: [{ metric: "settlement.foodMonthsRemaining", operator: "lt", value: 2 }],
    reasoning: "식량 잔여가 낮아 배급이 시민 불안을 줄일 수 있습니다.",
  },
  {
    name: "곡물 암시장 형성",
    category: "economic",
    summary: "공식 배급망 밖의 거래가 커지며 질서가 흔들립니다.",
    effects: [{ targetMetric: "settlement.stability", operation: "add", value: -4 }],
    preconditions: [{ metric: "settlement.foodMonthsRemaining", operator: "lt", value: 2 }],
    reasoning: "배급 부족은 비공식 거래를 부추깁니다.",
  },
  {
    name: "주민 의료 지원",
    category: "health",
    summary: "이동 의료반을 편성해 질병 확산을 늦춥니다.",
    effects: [{ targetMetric: "settlement.diseaseLevel", operation: "add", value: -0.15 }],
    preconditions: [],
    reasoning: "질병 수준이 높은 도시에 의료 지원이 효과적입니다.",
  },
  {
    name: "이주 단속 강화",
    category: "social",
    summary: "도시가 이주민 유입을 통제하려 단속을 강화합니다.",
    effects: [{ targetMetric: "settlement.migrationPressure", operation: "add", value: -0.2 }],
    preconditions: [],
    reasoning: "높은 이주 압력을 줄이기 위한 행정 조치입니다.",
  },
  {
    name: "관개 긴급 공사",
    category: "natural",
    summary: "가뭄에 대비해 관개 시설을 서둘러 보수합니다.",
    effects: [{ targetMetric: "settlement.foodProduction", operation: "multiply", value: 1.12 }],
    preconditions: [],
    reasoning: "생산 기반 보강이 가뭄 피해를 줄입니다.",
  },
  {
    name: "난민 수용 갈등",
    category: "social",
    summary: "유입 이주민과 기존 주민 사이 긴장이 커집니다.",
    effects: [
      { targetMetric: "settlement.stability", operation: "add", value: -8 },
      { targetMetric: "settlement.migrationPressure", operation: "add", value: 0.2 },
    ],
    preconditions: [{ metric: "settlement.migrationPressure", operator: "gte", value: 0.3 }],
    reasoning: "이주 압력이 높은 도시는 수용 갈등이 쉽게 격화됩니다.",
  },
  {
    name: "밀수 확산",
    category: "economic",
    summary: "단속을 피한 밀수가 물가와 치안을 어지럽힙니다.",
    effects: [{ targetMetric: "settlement.stability", operation: "add", value: -5 }],
    preconditions: [],
    reasoning: "통제력이 약해진 상태에서 밀수가 번집니다.",
  },
];

/** 프롬프트 본문에서 도시 요약 줄을 추출 — 모의 provider의 대상 선택용.
 *  정착지 id는 "settlement:0"처럼 콜론을 포함한다. */
function extractCityIds(prompt: string): string[] {
  const ids: string[] = [];
  for (const line of prompt.split("\n")) {
    const match = /^- ([a-zA-Z0-9:_-]+): 인구/.exec(line.trim());
    if (match?.[1]) ids.push(match[1]);
  }
  return ids;
}

export class MockLLMProvider implements LLMProvider {
  readonly name = "mock";
  readonly model = "mock-catalog-1";

  async generateRecommendations(prompt: string): Promise<string> {
    const rng = createRng(fnv1a32(`${this.model}:${prompt}`));
    const cities = extractCityIds(prompt);
    const isChainPrompt = prompt.includes("suggestedChainWeight"); // 연쇄 프롬프트 식별
    const count = rng.nextInt(3, 6); // 3~5개
    const pool = [...CATALOG.keys()];
    // 결정론적 셔플
    for (let i = pool.length - 1; i > 0; i--) {
      const j = rng.nextInt(0, i + 1);
      [pool[i], pool[j]] = [pool[j]!, pool[i]!];
    }
    const recommendations: Array<Record<string, unknown>> = [];
    for (let index = 0; index < count; index++) {
      const blueprint = CATALOG[pool[index] % CATALOG.length];
      if (!blueprint) continue;
      const targetId = cities.length > 0 ? cities[index % Math.min(cities.length, 2)]! : "aren";
      const recommendation: Record<string, unknown> & Partial<LLMRecommendation> = {
        temporaryId: `candidate_${index + 1}`,
        name: blueprint.name,
        category: blueprint.category,
        summary: blueprint.summary,
        scope: "settlement",
        targetIds: [targetId],
        preconditions: blueprint.preconditions.map((condition) => ({
          metric: condition.metric,
          operator: condition.operator,
          value: condition.value,
        })),
        suggestedBaseProbability: Number((0.02 + rng.next() * 0.06).toFixed(3)),
        suggestedDurationTicks: rng.nextInt(4, 13),
        effects: blueprint.effects.map((effect) => ({ ...effect })),
        followUps: [],
        reasoningSummary: blueprint.reasoning,
      };
      if (isChainPrompt) {
        recommendation.suggestedMinDelayTicks = rng.nextInt(1, 5);
        recommendation.suggestedMaxDelayTicks = rng.nextInt(5, 13);
        recommendation.suggestedChainWeight = Number((0.5 + rng.next() * 2).toFixed(2));
      }
      recommendations.push(recommendation);
    }
    // 모의 출력은 원시 JSON 텍스트 — 실제 LLM과 동일하게 게이트웨이가 스키마 검증한다
    return JSON.stringify({ recommendations });
  }
}

export interface ByokOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
}

/** OpenAI 호환 BYOK 제공자 — 키는 호출 시점 메모리에서만 사용된다 (§30) */
export class OpenAICompatibleProvider implements LLMProvider {
  readonly name = "byok-openai-compatible";

  constructor(private readonly options: ByokOptions) {}

  get model(): string {
    return this.options.model;
  }

  async generateRecommendations(prompt: string): Promise<string> {
    const response = await fetch(`${this.options.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.options.apiKey}`,
      },
      body: JSON.stringify({
        model: this.options.model,
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
      }),
    });
    if (!response.ok) {
      throw new Error(`LLM 호출 실패: HTTP ${response.status}`);
    }
    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error("LLM 응답에 내용이 없습니다");
    return content;
  }
}
