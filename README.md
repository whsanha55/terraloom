# World Observatory (terraloom)

절차적으로 생성된 세계에서 환경·식량·인구·이주가 시간에 따라 변화하는 과정을 관찰하고 개입하는 시뮬레이션.

## 문서

- [docs/concept.md](docs/concept.md) — 전체 실행 기획서 (CEO·엔지·디자인 리뷰 완료)
- [docs/DESIGN.md](docs/DESIGN.md) — 디자인 시스템 (소스 오브 트루스)
- [docs/DECISIONS.md](docs/DECISIONS.md) — 기술 결정 기록
- [docs/EXPERIMENTS.md](docs/EXPERIMENTS.md) — 실험 기록
- [docs/FAILURES.md](docs/FAILURES.md) — 실패 기록
- [docs/test-plan.md](docs/test-plan.md) — 테스트 계획

## 요구 사항

- Node.js 20.9 이상 (개발은 24+ 권장)

## 스크립트

| 명령                | 설명                                |
| ------------------- | ----------------------------------- |
| `npm run dev`       | 개발 서버                           |
| `npm run build`     | 프로덕션 빌드                       |
| `npm run start`     | 프로덕션 서버                       |
| `npm run lint`      | ESLint                              |
| `npm run typecheck` | `tsc --noEmit`                      |
| `npm run test`      | Vitest (watch)                      |
| `npm run test:run`  | Vitest (1회 실행)                   |
| `npm run e2e`       | Playwright E2E (`npm run build` 후) |
| `npm run format`    | Prettier 포맷                       |

## 기술 스택 (2026-09-17 확정)

Next.js · TypeScript · Tailwind CSS · shadcn/ui · Lucide · Pretendard + Inter · Canvas 2D · Web Worker · IndexedDB · Zustand · Zod · Vitest · Playwright

## 개발 규칙

루트 `CLAUDE.md` 참고. Step 진행 규칙과 완료 조건은 [docs/concept.md](docs/concept.md) §13, §36.
