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
| 방 식별 | 반 이름 고정 | 자동 부여 귀여운 이름 (예: "졸린 토끼", "구름같은 수달") |
| 관전 | 다른 반이 진행 중 매치 관전 가능 | 별도 `/master` 페이지에서 전체 모니터링 + 클릭 관전 |
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

## 랭킹 시스템 (v2.2.0) ✨ NEW

매치가 정상 종료(시간 만료)되고 승자가 있을 때, 방제 + 승자 점수를 익명으로 기록합니다. 매치당 1행. forfeit/무승부는 기록하지 않음. 개인을 식별할 수 있는 정보는 어디에도 저장하지 않습니다 (방제는 서버가 무작위로 부여한 동물 이름이라 비식별 정보).

랭킹 표시: 온라인 진입 화면 우측 "🏆 명예의 전당" 패널, 상위 50개.

### 데이터 저장 방식

두 가지 모드를 자동 분기:

**A. Google Sheets 모드 (권장 — 영구 보존)**
- 환경변수 3개를 설정하면 자동 활성화
- 매치 결과가 즉시 Google 스프레드시트에 append됨
- 서버 재시작/재배포/슬립 후에도 데이터 유지

**B. 로컬 JSON 모드 (기본 — 환경변수 없을 때)**
- `data/rankings.json` 파일에 저장
- Render 무료 플랜에선 서버 재시작/슬립 시 초기화됨

두 모드 동시 사용 가능 — Sheets에 저장하더라도 로컬 JSON에도 백업으로 같이 씁니다.

### Google Sheets 연동 설정 (Apps Script 방식 — 5분이면 끝)

Google Cloud 설정 불필요, 결제 등록 불필요. 그냥 스프레드시트 + Apps Script만 사용.

**1단계: Google 스프레드시트 만들기**

- https://sheets.google.com 에서 빈 스프레드시트 만들기
- 이름: 아무거나 (예: `수널판 랭킹`)
- 첫 줄(A1, B1, C1)에 헤더 입력:
  - A1: `roomName`
  - B1: `score`
  - C1: `recordedAt`

**2단계: Apps Script 열기**

- 시트 상단 메뉴 → "확장 프로그램" → "Apps Script"
- 새 탭으로 코드 편집기가 열림
- 기본 함수가 있으면 다 지우고 아래 코드를 통째로 붙여넣기:

```javascript
// 수널판 랭킹 — Google Apps Script 웹앱
const SHEET_NAME = 'Sheet1'; // 시트 탭 이름. 한글 '시트1'이면 그걸로 바꾸기

// GET: 시트에서 전체 랭킹 읽어서 JSON으로 반환
function doGet() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  if (!sheet) return _json([]);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return _json([]);
  const values = sheet.getRange(2, 1, lastRow - 1, 3).getValues();
  const entries = values
    .filter(r => r[0] && r[1] !== '' && r[1] !== null)
    .map(r => ({
      roomName: String(r[0]),
      score: Number(r[1]) || 0,
      recordedAt: r[2] ? String(r[2]) : '',
    }))
    .filter(e => e.score > 0);
  return _json(entries);
}

// POST: { roomName, score, recordedAt } 받아 시트에 한 줄 추가
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    if (!data.roomName || typeof data.score !== 'number') {
      return _json({ ok: false, error: 'invalid payload' });
    }
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
    sheet.appendRow([data.roomName, data.score, data.recordedAt || new Date().toISOString()]);
    return _json({ ok: true });
  } catch (err) {
    return _json({ ok: false, error: String(err) });
  }
}

function _json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
```

- 저장 (디스크 아이콘 또는 Ctrl+S) — 프로젝트 이름 묻거든 `수널판 랭킹 API` 같은 거 입력

**3단계: 웹앱으로 배포**

- 코드 편집기 우상단 "배포" 버튼 → "새 배포"
- 톱니바퀴 아이콘 → "웹 앱" 선택
- 설정:
  - **설명**: 아무거나 (예: `v1`)
  - **다음 사용자로 실행**: "나(본인 이메일)"
  - **액세스 권한**: **"모든 사용자"** ← 중요!
- "배포" 클릭
- 첫 배포라면 권한 승인 팝업 뜸:
  - "엑세스 권한 검토" → 본인 Google 계정 선택
  - "안전하지 않음으로 이동" → "..."이 만든 ... (안전하지 않음)" 클릭 (본인이 만든 거니까 안전)
  - "허용"
- 배포 완료되면 **웹앱 URL** 표시됨: `https://script.google.com/macros/s/.../exec`
- 이 URL을 복사 (메모해두기)

**4단계: URL이 동작하는지 확인 (선택)**

- 새 탭에서 그 URL을 그대로 열어보기
- `[]` (빈 배열) 또는 기존 행이 있으면 JSON 배열이 보이면 OK
- 시트가 안 보이거나 권한 에러 뜨면 3단계 액세스 권한이 "모든 사용자"인지 다시 확인

**5단계: Render 환경변수 등록**

Render 대시보드 → 해당 서비스 → "Environment" 탭 → 환경변수 1개만 추가:

| Key | Value |
|---|---|
| `SHEETS_WEBAPP_URL` | 3단계의 웹앱 URL |

저장하면 Render가 자동 재배포. 서버 로그(Render 대시보드 → Logs)에 `[SHEETS] enabled, webapp URL = ...` 가 뜨면 성공.

### 확인하기

- 매치 한 판 정상 종료시키면 시트에 한 줄 추가됨
- 메인 → 온라인 진입 화면 → 우측 패널에 즉시 반영
- 시트는 평소 Google Sheets로 직접 열어서 확인/엑셀 내보내기/줄 삭제 등 자유롭게 관리 가능

### 트러블슈팅

- 서버 로그에 `[SHEETS] disabled` 가 뜨면 → Render 환경변수 등록 안 됨
- 서버 로그에 `[SHEETS] load failed: HTTP 401` 또는 `403` 이 뜨면 → 3단계 액세스 권한이 "모든 사용자" 아닐 가능성. 배포 설정 다시 확인
- 시트에 한글이 깨진다면 → Apps Script 파일이 UTF-8로 저장됐는지 확인 (기본은 UTF-8)
- Apps Script 무료 호출 한도: 일 20,000회 — 학교 규모는 아주 여유

### 코드 업데이트할 때

Apps Script 코드를 나중에 수정했다면 "배포" → "배포 관리" → 기존 배포 옆 연필 → "버전: 새 버전" → 배포. 이때 **웹앱 URL은 바뀌지 않음** (Render 환경변수 그대로 두면 됨).


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
