# 수널판 온라인

교실 전자칠판용 수널판(숫자 야구 + 24게임 변형) 온라인 대전.

## 게임 모드

1. **혼자하기** — 기존 싱글 플레이 (오프라인)
2. **🆚 대결하기** — 기존 한 화면 2인 대전 (오프라인)
3. **🌐 온라인** — 1반/2반/3반 칠판 간 인터넷 대전 ✨ NEW

## 온라인 모드 흐름

```
메인 메뉴 → [🌐 온라인] → 레벨 카드 선택(연습 시작 레벨)
   ↓
반 선택 (1반/2반/3반)
   ↓
대기 화면: 우측 연습 + 좌측 다른 반 로비
   ↓
[다른 반에 ⚡도전!] 또는 [다른 반의 도전을 받음]
   ↓
NEW CHALLENGER! → READY 단계 (양쪽 [🟢 준비완료] 눌러야 시작, 30초 타임아웃)
   ↓
3 · 2 · 1 · GO! (4초 카운트다운)
   ↓
VS 게임 (LV1·2분·0점부터 새 게임)
   ↓
결과 → 승자: "다음 도전 기다리기" / 패자: "대기 화면으로" / 관전자: "관전 종료"
   ↓ (대전 중인 경기를 다른 반이 [👀 관전] 가능 - ready/countdown부터 같이 봄)
```

## 매치 생명주기 (Phase)

| Phase | 설명 | 키패드 | 타이머 |
|---|---|---|---|
| `ready` | 양쪽 준비완료 대기 (최대 30초) | 비활성 | 게임 타이머 정지 |
| `countdown` | 3 · 2 · 1 · GO! (4초) | 비활성 | 정지 |
| `playing` | 실제 게임 진행 | 활성 | 2:00에서 카운트 |
| `ended` | 매치 종료 | 비활성 | 정지 |

## 로컬 실행

```bash
npm install
npm start
# → http://localhost:3000
```

브라우저 3개 탭(또는 3개 기기)으로 접속해서 각각 1반/2반/3반 선택하면 테스트 가능.

## Render 배포

1. 이 저장소를 GitHub에 push
2. Render 대시보드에서 New > Web Service > GitHub 저장소 연결
3. `render.yaml`이 있으면 자동 인식 — Build/Start 명령 자동 설정됨
4. 무료 플랜 선택 → Create Web Service
5. 배포 완료 후 발급된 URL을 전자칠판 브라우저에 즐겨찾기

**주의 (무료 플랜)**
- Render 무료 플랜은 15분간 트래픽 없으면 슬립 모드 → 첫 접속 시 콜드 스타트(20~40초) 있음
- 수업 시작 5분 전에 한 번 접속해서 깨워두면 좋음
- 동시접속 수십 명, 트래픽 작으니 무료로도 충분

## 아키텍처

### 서버 (Node + Socket.IO)
- 권한 있는 게임 상태 (정답·검증·힌트·점수·타이머 모두 서버)
- 클라이언트에는 정답(secret)을 절대 보내지 않음 → 콘솔로 훔쳐볼 수 없음
- 슬롯 기반 로비: `class1`, `class2`, `class3` 각각 1명 점유
- 도전 시 즉시 매칭(수락 단계 없음, 단순)

### 클라이언트
- 기존 `vs-screen`을 온라인 매치/관전 화면으로 재사용
- 입력 시 매 키마다 서버에 전송 → 서버가 상대·관전자에게 미러링
- 본인 화면도 서버 응답으로 갱신 (타이밍 동기화)

### 주요 이벤트

| 방향 | 이벤트 | 설명 |
|---|---|---|
| C→S | `enter_class` | 반 선택 입장 |
| C→S | `challenge` | 다른 반에 도전 (즉시 매칭, ready 단계 진입) |
| C→S | `set_ready` | 준비완료 토글 |
| C→S | `spectate` | 진행 중 매치 관전 입장 (ready 단계부터 가능) |
| C→S | `match_press` / `match_del` / `match_submit` | 매치 입력 (playing 단계만) |
| C→S | `post_match` | 매치 종료 후 액션 (wait/leave) |
| C→S | `exit_class` | 반에서 나가기 (ready 중이면 매치 자동 forfeit) |
| S→C | `lobby_update` | 슬롯 상태 변경 브로드캐스트 |
| S→C | `match_start` | 매치 시작 (ready 단계 진입) |
| S→C | `match_state` | 매치 상태 + phase 정보 |
| S→C | `countdown` | 3·2·1·GO! 라벨 |
| S→C | `match_cancelled` | ready 30초 타임아웃 등으로 취소 |
| S→C | `match_tick` | 매초 타이머 |
| S→C | `self_live_input` / `opp_live_input` | 실시간 입력 미러 |
| S→C | `submit_result` / `submit_error` | 제출 결과 |
| S→C | `match_end` | 매치 종료 + 결과 |
| S→C | `spectate_state` / `spectate_live_input` | 관전자용 미러 |

## 파일 구조

```
sunulpan-online/
├── server.js          # 서버 (게임 로직 + 로비 + 매칭)
├── package.json
├── render.yaml        # Render 배포 설정
├── .gitignore
├── README.md
└── public/
    └── index.html     # 클라이언트 (싱글+로컬대전+온라인 통합)
```

## 라이선스 / 출처

원본 수널판 게임 코드 기반.
```
