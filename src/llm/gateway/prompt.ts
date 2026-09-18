/**
 * 프롬프트 빌더 (§16 절차 3~4 / §18) — 버전 관리.
 *
 * 세계 요약 + 허용 메트릭 + 이벤트 DSL 제약을 프롬프트에 주입한다.
 * 프롬프트 변경은 PROMPT_VERSION 증가와 함께 eval 기준선(T17)과 비교된다.
 */
import type { LLMInput } from "./summary";

export const PROMPT_VERSION = "llm-events-v1";

export function buildEventRecommendationPrompt(input: LLMInput): string {
  const settlements = input.settlements
    .map(
      (s) =>
        `- ${s.id}: 인구 ${s.population}, 식량잔여 ${s.foodMonthsRemaining}개월, 안정도 ${s.stability}/100, 이주압력 ${s.migrationPressure}`,
    )
    .join("\n");

  const history = input.recentHistory
    .map((event) => `- ${event.type} (틱 ${event.tick})`)
    .join("\n");

  return `당신은 세계 시뮬레이션의 사건 기획자입니다. [프롬프트 버전 ${PROMPT_VERSION}]

현재 세계 상태:
- 세계력 ${input.world.year}년 (${input.world.season})
- 총인구 ${input.world.globalPopulation}
- 활성 주요 사건: ${input.world.activeMajorEvents.length > 0 ? input.world.activeMajorEvents.join(", ") : "없음"}

주요 도시 (위기순):
${settlements}

최근 역사:
${history.length > 0 ? history : "- 기록 없음"}

이 상태에서 발생 가능한 사건 후보 3~5개를 추천하세요.

규칙:
1. 오직 아래 허용 메트릭만 효과로 수정할 수 있습니다:
${input.allowedMetrics.map((metric) => `   - ${metric}`).join("\n")}
2. 효과 연산은 add(즉시·영구) 또는 multiply(지속) 중 하나입니다.
3. 안정도 변화는 -15~15, 질병 수준은 -0.2~0.2, 이주 압력은 -0.3~0.3,
   생산·용량 배율은 0.5~1.5 범위로 제안하세요.
4. 지속 시간은 1~36틱(월 단위)으로 제안하세요.
5. 존재하는 도시 id만 참조하세요.
6. 출력은 아래 JSON 형식과 정확히 일치해야 합니다. 다른 필드는 추가하지 마세요.

{
  "recommendations": [
    {
      "temporaryId": "candidate_1",
      "name": "사건 이름 (60자 이하)",
      "category": "natural | health | social | economic",
      "summary": "한 줄 설명 (500자 이하)",
      "scope": "settlement",
      "targetIds": ["도시id"],
      "preconditions": [{ "metric": "settlement.foodMonthsRemaining", "operator": "lt", "value": 2 }],
      "suggestedBaseProbability": 0.05,
      "suggestedDurationTicks": 8,
      "effects": [{ "targetMetric": "settlement.stability", "operation": "add", "value": -3 }],
      "followUps": [{ "eventType": "후속사건이름", "minimumDelayTicks": 2, "maximumDelayTicks": 6, "baseWeight": 0.4 }],
      "reasoningSummary": "이 상태를 고른 이유 (500자 이하)"
    }
  ]
}

주의: 사건의 실제 발생 여부는 규칙 엔진이 확률로 결정합니다. 당신은 후보만 제안합니다.`;
}
