---
# gstack: design-md-format=spec
name: World Observatory
description: 차가운 회백 위 흰 패널의 현대적 세계 시뮬레이션 운영 콘솔 — 블루 주 강조, 위험만 주황·빨강
colors:
  primary: "#2563EB" # blue-600 — 선택·주요 행동·재생
  on-primary: "#FFFFFF"
  surface: "#FFFFFF" # 패널은 흰색
  text: "#0F172A" # slate-900
  text-muted: "#64748B" # slate-500
  background: "#F1F5F9" # slate-100 — 차가운 회백 (페이지 배경)
  accent: "#EFF6FF" # blue-50 — 호버·선택 표면
  success: "#2563EB"
  warning: "#EA580C" # orange-600 — 위험 상태 전용
  error: "#DC2626" # red-600 — 위험 상태 전용
typography:
  display:
    fontFamily: "Pretendard Variable"
    fontWeight: 700
    fontSize: "1.5rem"
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Pretendard Variable"
    fontSize: "0.875rem" # 14px 최소 — 본문은 14px 미만 금지
    lineHeight: 1.6
  label:
    fontFamily: "Pretendard Variable"
    fontSize: "0.8125rem" # 13px — 보조 메타만
    fontWeight: 500
  mono:
    fontFamily: "Inter"
    fontFeature: "tnum" # 모든 수치 — 실시간 갱신 흔들림 방지
rounded:
  sm: 4px
  md: 6px
  lg: 8px
  full: 9999px
spacing:
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 24px
  2xl: 32px
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.md}"
  panel:
    backgroundColor: "{colors.surface}"
    borderColor: "#E2E8F0"
    boxShadow: "0 1px 2px rgba(15,23,42,0.05)"
    rounded: "{rounded.lg}"
  topnav-link-active:
    backgroundColor: "{colors.background}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
  status-tag-warning:
    backgroundColor: "#FFF7ED"
    textColor: "{colors.warning}"
    rounded: "{rounded.full}"
  map-marker-city:
    fill: "{colors.primary}"
    stroke: "none"
    rule: "면적 = 인구 비례"
  map-marker-selected:
    stroke: "{colors.primary}"
    strokeWidth: "2.5"
    rule: "선택 링"
  map-path-migration:
    stroke: "#0EA5E9"
    markerEnd: "arrow"
    rule: "이동 경로는 항상 파란 화살표"
---

# World Observatory

## Overview

**Creative North Star:** 실제 운영자가 빠르게 판단하는 현대적 세계 시뮬레이션 운영 콘솔 — 장식이 아니라 정보 위계가 일을 한다.
**Product context:** 시드 기반 세계를 관찰·개입하는 1인 개발 한국어 데스크톱 웹앱. 지도 중심 관측 콘솔(OPERATE 모드).
**Mode per surface:** Operate (전체)
**Reference sites:** NASA Worldview, Windy, Flightradar24 (구조 참고 — 비주얼은 현대 콘솔)
**Key characteristics:** 5초 안에 위기 도시와 원인 파악. 회백 배경 위 흰 패널. 블루 외 색은 의미(위험)로만 등장.

## Colors

**Strategy:** Restrained — 블루 단일 주 강조, 주황·빨강은 위험 상태 전용. 데이터 차트는 chart-1..3(blue/sky/slate)과 위험색만.
**Light or dark:** 주간 운영 콘솔 — 밝은 환경에서 오래 읽는 운영자. 배경 차가운 회백 `#F1F5F9`, 패널 흰색.
토큰 규칙: `--primary`는 선택·주요 행동·재생에만. 주황(`--warning`)·빨강(`--error`)은 위기 상태·파괴적 행동에만. 나머지 정보는 slate 중립 축. 페이지 전체에는 border 없음 — 독립 패널에만 border + 약한 shadow.

## Typography

**Pretendard + Inter 2축.** Pretendard(한글 포함)가 UI·본문 담당, Inter가 숫자·라틴 담당(tabular-nums). 세리프 금지, 장식 자간 금지, 영문 대문자 부제 금지.
본문 14px 최소. 보조 메타만 13px. 수치는 항상 `font-variant-numeric: tabular-nums`(Inter tnum).

## Layout

- 상단 글로벌 내비게이션(52px) → 시뮬레이션 제어 도구 모음(52px) → 3열 작업 영역(좌 280 위기 도시 / 중앙 지도 / 우 360 상세·조치)
- gap 12px, 패널은 독립 카드(border + shadow-sm). 중첩 카드 금지.
- 소형 화면(<1100px): 우측 상세를 Sheet(shadcn/ui)로 전환, 플로팅 버튼으로 열기
- 동일 정보의 다중 영역 반복 금지 — 각 정보는 한 곳에서.

## Elevation & Depth

패널만 `0 1px 2px rgba(15,23,42,.05)`. 페이지 배경에 그림자 없음. 깊이는 표면 색 차이로.

## Shapes

radius: 4/6/8px. 도시 마커는 원. 사건 마커는 45° 다이아몬드. 이동 경로는 화살표 — 예외 없음.

## Components

shadcn/ui 표준 컴포넌트(Button, Sheet, Tabs, Badge)를 토큰으로 구성. 아이콘은 Lucide만. 신규 UI 라이브러리 추가 금지.
지도 마커 규칙(전역 일관): 도시 = 원(면적=인구, 안정 상태=blue-600 채움, 주의=orange, 위험=red), 선택 = blue 링 2.5px, 폐허 = 중립 외곽 다이아몬드, 사건 = 위험도색 다이아몬드, 이동 = 파란(sky-500) 화살표 경로.

## Do's and Don'ts

- Do: 본문 14px 이상 유지, 수치에 tabular-nums, 위험 상태에만 주황·빨강, 패널 단위 border+shadow, 정보 단일 배치
- Don't: 세리프·장식 자간·영문 대문자 부제, 빈티지/양피지/세피아/노이즈, 중첩 카드·과도한 separator, 의미 없는 점선·장식 요소, 동일 정보 반복, 페이지 전체 border

## Motion

- **Approach:** minimal-functional
- **Easing:** enter(ease-out) exit(ease-in)
- **Duration:** micro(100ms) short(200ms) — 장면 전환 400ms 상한
- **The one authored moment:** 재생 헤드 진행과 도시 수치 갱신 — 깜빡임 없이 값만 교체

## Decisions Log

| Date       | Decision                      | Rationale                                                                                                                                                   |
| ---------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-09-17 | Initial design system created | /design-consultation — 관측소/잉크 방향 폐기, 사용자 지정 현대 운영 콘솔 스펙(Next.js·shadcn/ui·Tailwind·Lucide·Pretendard/Inter·회백/화이트·블루)으로 확정 |
| 2026-09-17 | 마커·경로 시각 규칙 통일      | 운영자의 즉시 판단 — 원=도시(면적=인구), 다이아몬드=사건(위험도색), 화살표=이동                                                                             |
