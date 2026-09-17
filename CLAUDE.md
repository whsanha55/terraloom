# terraLoom / World Observatory

절차적 세계 생성 + 시간 기반 시뮬레이션 관찰 서비스.
기획: `docs/concept.md` · 디자인: `docs/DESIGN.md` · 테스트: `docs/test-plan.md`

## 개발 규칙 (docs/concept.md 요약 — 원문 우선)

- **Step 진행**: 각 Step의 완료 조건을 충족하기 전에 다음 Step 기능을 섞지 않는다 (§36).
- **결정론**: 시뮬레이션·월드젠 코드에 `Math.random()` 금지. 모든 난수는 파생 시드를 사용한다 (§7).
- **수치 연산 제한**: 초월함수(`Math.sin` 등) 금지 — 기본 산술·정수 순열 노이즈·정수 해시만.
  해시·PRNG 곱셈은 `Math.imul`, `| 0`, `>>> 0`으로 32비트 강제 (§7.1).
- **수치 안전**: 분모 0 사전 검사, 공식 결과 clamp, 상태 값 NaN/±Infinity 금지 (§8.1).
- **LLM 한계**: LLM은 제안만 한다. 상태 직접 변경·확률 난수 생성·최종 발생 판정 금지 (§6).
- **UI**: `docs/DESIGN.md`가 소스 오브 트루스. 본문 14px 최소, 수치는 `tnum`(Inter),
  주황·빨강은 위험 상태 전용. 신규 UI 라이브러리 추가 금지 (shadcn/ui + Lucide만).
- **테스트**: 핵심 로직은 구현 전에 테스트를 먼저 작성한다 (§36.5). 필수 테스트 목록은 §33.
- **디렉터리**: `src/app/`, `src/tests/` 외 폴더는 해당 Step 착수 시 만든다 (§32는 참고 구조).
- **커밋**: 한국어 Conventional Commits (`feat:`, `fix:`, `test:`, `chore:` …).

## 기술 스택 (2026-09-17 확정)

- Next.js(App Router) + TypeScript + Tailwind CSS + shadcn/ui, 아이콘 Lucide만
- 폰트: Pretendard(본문) + Inter(수치, tabular-nums)
- 시뮬레이션: Web Worker (결정론 코드 단일 소스 — 월드젠 포함), 저장: IndexedDB
- 테스트: Vitest(단위) · Playwright(E2E)

@AGENTS.md
