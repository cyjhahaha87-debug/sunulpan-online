# 수널판 온라인 v2

교실 전자칠판용 수널판(숫자 야구 + 24게임 변형) 온라인 대전.
**v2: 방 코드 기반 매칭** — 누구나 방 만들고 4자리 코드로 친구를 초대해 1:1로 붙는다.

## 게임 모드

1. **혼자하기** — 기존 싱글 플레이 (오프라인)
2. **🆚 대결하기** — 기존 한 화면 2인 대전 (오프라인)
3. **🌐 온라인** — 방 코드 기반 2인 대전 ✨ v2 NEW

## v1 → v2 변경점

| 항목 | v1 (반 슬롯) | v2 (방 코드) |
|---|---|---|
| 매칭 | 서버 전체에 1반/2반/3반 3개 슬롯, 한 매치만 가능 | 방마다 4자리 코드, 동시 다수 방 운영 |
| 진입 | 반 선택 → 다른 반에 도전 | 방 만들기 → 코드 공유 / 방 참여 → 코드 입력 |
| 정원 | 항상 1:1 (반끼리) | 2인 우선 (코드 구조는 4인 확장 여지 있음) |
| 라벨 | "1반 vs 2반" | "1팀(방장) vs 2팀" |
| 관전 | 다른 반이 진행 중 매치 관전 가능 | (v2에서는 제거 — 단순화) |
| 다시하기 | 매치 후 메뉴 복귀 | 같은 방에서 곧바로 rematch 가능 |

## 온라인 모드 흐름 (v2)

```
메인 메뉴 → [🌐 온라인]
   ↓
진입 화면: [🏠 방 만들기] / [🚪 방 참여 (코드 입력)]
   ↓
방 대기실: 4자리 방코드 + 참가자 목록 + 연습 영역(우측)
   - 방장: [⚡ 매치 시작] 버튼 (상대가 준비완료 누르면 활성화)
   - 게스트: [🟢 준비완료] 토글
   ↓ (방장이 시작 클릭)
MATCH START! → READY 단계 (양쪽 [🟢 준비완료], 30초 타임아웃)
   ↓
3 · 2 · 1 · GO! (4초 카운트다운)
   ↓
VS 게임 (LV1·2분·0점부터 새 게임)
   ↓
결과 모달 → [🔁 다시 하기] / [방 나가기]
   - 방장이 다시하기 누르면 매치 리셋, 게스트는 방 대기실로 복귀
   - 누구든 방 나가기 누르면 그 사람만 메뉴로, 나머지는 방 유지
```

## 마스터(관전자) 모드 ✨ NEW

전체 방 목록을 실시간으로 보고, 원하는 방을 클릭해 관전할 수 있는 별도 페이지.

### 접근
```
http://<서버주소>/master
```

### 기능
- **방 목록 실시간 푸시** — 누가 방 만들면 자동으로 카드 추가, 매치 시작/점수/타이머도 2초마다 갱신
- **카드 클릭 → 관전 시작** — 매치 진행 중이면 양쪽 입력판/점수/타이머/히스토리 실시간 미러링
- **매치 전이라도 관전 가능** — "대기 중" 표시
- **완전 투명** — 관전자가 방에 들어와도 player 측에는 전혀 표시 안 됨 (`room:state.players`에 미포함)
- **정답 미노출** — 서버가 관전자에게 `secret` 필드를 절대 보내지 않음 (DevTools로 봐도 알 수 없음)

### 보안 메모
- 현재 버전은 누구나 `/master` 접근 가능. 운영용으로는 reverse proxy에서 IP 화이트리스트나 basic auth 권장.
- 추후 토큰 기반 인증으로 보호하려면 `master:hello`에 토큰 페이로드 추가하면 됨.

### 추가된 소켓 이벤트 (master)

| 방향 | 이벤트 | 설명 |
|---|---|---|
| C→S | `master:hello` | 마스터로 등록 + 즉시 방 목록 받기 |
| C→S | `master:refresh` | 방 목록 강제 새로고침 |
| C→S | `master:spectate` | 특정 방 관전 시작 (`{ code }`) |
| C→S | `master:leave_spectate` | 관전 종료, 목록으로 복귀 |
| S→C | `master:list` | 모든 방 + 매치 상태 목록 (2초마다 자동 + 변경 시) |
| S→C | `master:error` | 마스터용 에러 |
| S→C | `spectate_start` | 관전 시작 페이로드 (양쪽 publicOpp + phase, secret 제외) |
| S→C | `spectate_state` | 매치 상태 변경 시 양쪽 미러 |
| S→C | `spectate_live_input` | 양쪽 입력 실시간 (`{ side, current, activeIdx, lockedCells }`) |
| S→C | `spectate_room_closed` | 관전 중인 방이 사라질 때 |

또한 매치 중에는 `countdown`, `match_tick`, `match_end`, `match_cancelled` 가 관전자에게도 동일하게 흘러감 (`match_end`엔 `spectator: true` 플래그).



| Phase | 설명 | 키패드 | 타이머 |
|---|---|---|---|
| `ready` | 양쪽 준비완료 대기 (최대 30초) | 비활성 | 게임 타이머 정지 |
| `countdown` | 3 · 2 · 1 · GO! (4초) | 비활성 | 정지 |
| `playing` | 실제 게임 진행 | 본인 사이드만 활성 | 2:00에서 카운트 |
| `ended` | 매치 종료 | 비활성 | 정지 |

## 로컬 실행

```bash
npm install
npm start
# → http://localhost:3000
```

브라우저 2개 탭(또는 2개 기기)으로 접속:
1. 한쪽에서 [🌐 온라인] → [🏠 방 만들기] → 발급된 4자리 코드 확인
2. 다른 쪽에서 [🌐 온라인] → [🚪 방 참여] → 코드 입력
3. 게스트가 [🟢 준비완료], 방장이 [⚡ 매치 시작] → 매치 진행

## Render 배포

1. 이 저장소를 GitHub에 push
2. Render 대시보드에서 New > Web Service > GitHub 저장소 연결
3. `render.yaml`이 있으면 자동 인식 — Build/Start 명령 자동 설정됨
4. 무료 플랜 선택 → Create Web Service
5. 배포 완료 후 발급된 URL을 전자칠판 브라우저에 즐겨찾기

**주의 (무료 플랜)**
- Render 무료 플랜은 15분간 트래픽 없으면 슬립 모드 → 첫 접속 시 콜드 스타트(20~40초)
- 수업 시작 5분 전에 한 번 접속해서 깨워두면 좋음

## 아키텍처

### 서버 (Node + Socket.IO)
- 권한 있는 게임 상태 (정답·검증·힌트·점수·타이머 모두 서버)
- 클라이언트에는 정답(secret) 절대 안 보냄
- 방 코드 4자리(예: `ABCD`) — 혼동 쉬운 문자(I, L, O, 0, 1) 제외
- 방 인메모리 보관, 30분 무활동 자동 청소
- 연결 끊김 시 30초 grace period — 그 안에 재접속하면 매치 유지
- 방장 나가면 권한 자동 이양

### 클라이언트
- 기존 `vs-screen`을 온라인 매치 화면으로 재사용 (UI 유지)
- 입력 시 매 키마다 서버에 전송 → 서버가 상대에게 미러링
- 본인 화면도 서버 응답으로 갱신 (타이밍 동기화)

### 주요 소켓 이벤트 (v2)

| 방향 | 이벤트 | 설명 |
|---|---|---|
| C→S | `room:create` | 방 만들기 (코드 발급, 즉시 입장) |
| C→S | `room:join` | 방 코드로 참여 |
| C→S | `room:rejoin` | 재접속 (기존 playerId로) |
| C→S | `room:setReady` | 방 대기실에서 게스트 준비 토글 |
| C→S | `room:start` | 방장이 매치 시작 |
| C→S | `room:leave` | 방 나가기 |
| C→S | `match:setReady` | 매치 ready phase에서 준비완료 토글 |
| C→S | `match_press` / `match_del` / `match_submit` | 매치 입력 (playing 단계만) |
| C→S | `post_match` | 매치 종료 후 액션 (`rematch` / `leave`) |
| S→C | `room:joined` | 입장 확인 (code, myId, isHost) |
| S→C | `room:state` | 방 상태 (players 목록 + 매치 phase) |
| S→C | `room:error` | 에러 메시지 |
| S→C | `room:closed` | 방 종료 (TTL / 빈 방 등) |
| S→C | `host_changed` | 방장 이양 알림 |
| S→C | `match_start` | 매치 시작 (selfPayload, side='A' or 'B') |
| S→C | `match_state` | 매치 상태 + phase |
| S→C | `countdown` | 3·2·1·GO! 라벨 |
| S→C | `match_tick` | 매초 타이머 |
| S→C | `self_live_input` / `opp_live_input` | 실시간 입력 미러 |
| S→C | `submit_result` / `submit_error` | 제출 결과 |
| S→C | `match_end` | 매치 종료 + 결과 |
| S→C | `match_cancelled` | ready 30초 타임아웃 등으로 취소 |
| S→C | `rematch_ready` | 방장이 rematch 누름 → 방 대기실 복귀 |
| S→C | `return_to_room` | 게스트가 rematch 누름 → 방 대기실 복귀 |

## 파일 구조

```
sunulpan-online/
├── server.js          # 서버 (게임 로직 + 방 관리 + 매치 + 관전 채널)
├── package.json
├── render.yaml        # Render 배포 설정
├── README.md
└── public/
    ├── index.html     # 클라이언트 (싱글+로컬대전+온라인 통합)
    └── master.html    # 마스터 관전 클라이언트 (/master 경로)
```

## 향후 확장 (4인 모드)

서버는 이미 `MAX_PLAYERS` 상수와 `room.players[]` 배열 구조라 4인으로 늘리는 건 다음만 손보면 됨:

1. `server.js`의 `MAX_PLAYERS = 2` → `4`
2. `Match` 클래스: 현재 `sides.A/B`만 있는데 `sides.A/B/C/D` 또는 `Map<playerId, sideState>` 구조로
3. 클라이언트 `vs-screen`: 현재 좌우 2분할 → 4분할 그리드 레이아웃 추가
4. `match_tick`, `match_end` payload에 모든 사이드 정보 포함

## 라이선스 / 출처

원본 수널판 게임 코드 기반.
