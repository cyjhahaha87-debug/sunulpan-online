// ════════════════════════════════════════════════════════════════
//  수널판 온라인 서버 (server.js) - v2.0 방코드 기반
//  - Express + Socket.IO
//  - 권한 있는 게임 로직 (정답·검증·힌트·타이머 모두 서버)
//  - 방 코드 기반 매칭: 방 만들기/참여 (2인 우선, 추후 4인 확장 여지)
// ════════════════════════════════════════════════════════════════

const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const { Server } = require('socket.io');

const SERVER_VERSION = 'v2.2.0-sheets';

// ═══════════════════════════════════════════════
//  랭킹 (방제 기반, 익명)
//  - 매치 종료(시간 만료/완전 종료) 시 승자의 (roomName, score) 기록
//  - forfeit/무승부는 기록 안 함 (정상 경기 결과만)
//  - 저장: Google Sheets (환경변수 설정 시) + 로컬 JSON 백업
//    환경변수가 없으면 로컬 JSON만 사용 (개발/오프라인 환경)
// ═══════════════════════════════════════════════

const RANKING_FILE = path.join(__dirname, 'data', 'rankings.json');
const RANKING_KEEP_MAX = 200; // 상위 200개까지 메모리/파일에 보관 (클라엔 50개 노출)
const RANKING_TOP_N = 50;     // 클라이언트에 보내는 상위 갯수

let rankings = []; // [{ roomName, score, recordedAt }] (score desc 정렬 유지)

// ── Google Sheets 연동 (Apps Script 웹앱 방식) ──
// 환경변수 (1개만 등록하면 됨):
//   SHEETS_WEBAPP_URL - Apps Script 웹앱 배포 URL
//   (https://script.google.com/macros/s/.../exec 형태)
//
// 시트에 점수 한 줄 추가하기:  POST { roomName, score, recordedAt }
// 시트에서 전체 랭킹 받아오기: GET → JSON 배열
// (Google Cloud 설정/서비스 계정 불필요 — Apps Script만으로 동작)

const SHEETS_WEBAPP_URL = process.env.SHEETS_WEBAPP_URL || '';
const SHEETS_ENABLED = !!SHEETS_WEBAPP_URL;

async function initSheets() {
  if (!SHEETS_ENABLED) {
    console.log('[SHEETS] disabled (SHEETS_WEBAPP_URL not set) - using local JSON only');
    return;
  }
  console.log(`[SHEETS] enabled, webapp URL = ${SHEETS_WEBAPP_URL.slice(0, 60)}...`);
}

async function loadFromSheets() {
  if (!SHEETS_ENABLED) return null;
  try {
    // Node 18+ 의 글로벌 fetch 사용
    const res = await fetch(SHEETS_WEBAPP_URL, { method: 'GET' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error('not array');
    const entries = data
      .filter(e => e && e.roomName && typeof e.score === 'number')
      .map(e => ({
        roomName: String(e.roomName),
        score: parseInt(e.score, 10) || 0,
        recordedAt: e.recordedAt || '',
      }))
      .filter(e => e.score > 0);
    entries.sort((a, b) => b.score - a.score);
    console.log(`[SHEETS] loaded ${entries.length} entries from web app`);
    return entries;
  } catch (e) {
    console.error('[SHEETS] load failed:', e.message);
    return null;
  }
}

async function appendToSheets(entry) {
  if (!SHEETS_ENABLED) return false;
  try {
    const res = await fetch(SHEETS_WEBAPP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return true;
  } catch (e) {
    console.error('[SHEETS] append failed:', e.message);
    return false;
  }
}

// ── 로컬 JSON (백업) ──
function loadRankingsLocal() {
  try {
    if (fs.existsSync(RANKING_FILE)) {
      const raw = fs.readFileSync(RANKING_FILE, 'utf8');
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        return arr.filter(e => e && typeof e.score === 'number' && typeof e.roomName === 'string');
      }
    }
  } catch (e) {
    console.error('[RANKING] local load failed:', e.message);
  }
  return [];
}

let saveTimeoutId = null;
function saveRankingsLocal() {
  if (saveTimeoutId) clearTimeout(saveTimeoutId);
  saveTimeoutId = setTimeout(() => {
    try {
      fs.mkdirSync(path.dirname(RANKING_FILE), { recursive: true });
      fs.writeFileSync(RANKING_FILE, JSON.stringify(rankings, null, 2), 'utf8');
    } catch (e) {
      console.error('[RANKING] local save failed:', e.message);
    }
    saveTimeoutId = null;
  }, 500);
}

// ── 통합 로드 (서버 부팅 시) ──
//   Sheets 활성화돼있으면 Sheets에서, 아니면 로컬 JSON에서
async function loadRankings() {
  await initSheets();
  if (SHEETS_ENABLED) {
    const fromSheet = await loadFromSheets();
    if (fromSheet) {
      rankings = fromSheet;
      console.log(`[RANKING] loaded ${rankings.length} from Sheets`);
      // 로컬에도 백업 (선택적)
      saveRankingsLocal();
      return;
    }
  }
  // fallback: 로컬 JSON
  rankings = loadRankingsLocal();
  rankings.sort((a, b) => b.score - a.score);
  console.log(`[RANKING] loaded ${rankings.length} from local JSON`);
}

function addRankingEntry(roomName, score) {
  if (!roomName || typeof score !== 'number' || score <= 0) return;
  const entry = {
    roomName,
    score,
    recordedAt: new Date().toISOString(),
  };
  rankings.push(entry);
  rankings.sort((a, b) => b.score - a.score);
  if (rankings.length > RANKING_KEEP_MAX) rankings.length = RANKING_KEEP_MAX;

  // 1) Sheets에 비동기 append (실패해도 게임 진행에 영향 없음)
  appendToSheets(entry).catch(() => {});
  // 2) 로컬 JSON도 백업으로 같이 저장
  saveRankingsLocal();
  // 3) 모든 접속자에게 즉시 푸시
  io.emit('ranking:update', rankings.slice(0, RANKING_TOP_N));
}

function topRankings() {
  return rankings.slice(0, RANKING_TOP_N);
}

// 부팅 시 비동기 로드 (서버는 일단 띄우고, 데이터는 곧 도착)
loadRankings().catch(e => console.error('[RANKING] load error:', e.message));

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  pingInterval: 25000,
  pingTimeout: 20000,
});

app.use(express.static(path.join(__dirname, 'public')));
app.get('/master', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'master.html'));
});
app.get('/health', (_req, res) => res.json({
  ok: true,
  version: SERVER_VERSION,
  rooms: Object.keys(rooms).length,
  observers: masterObservers.size,
}));

// ═══════════════════════════════════════════════
//  게임 로직 (기존 그대로)
// ═══════════════════════════════════════════════

const OPS = ['+', '-', '*', '/'];
const LEVELS = [
  { num: 1, slots: 5, label: '초급 · 5칸' },
  { num: 2, slots: 6, label: '중급 · 6칸' },
  { num: 3, slots: 7, label: '고급 · 7칸' },
  { num: 4, slots: 8, label: '심화 · 8칸' },
];
const SCORE_RULES = [
  [{ max: 1, pts: 100 }, { max: 2, pts: 80 }, { max: 4, pts: 60 }],
  [{ max: 3, pts: 100 }, { max: 4, pts: 80 }, { max: 6, pts: 60 }],
  [{ max: 5, pts: 100 }, { max: 6, pts: 80 }, { max: 8, pts: 60 }],
  [{ max: 7, pts: 100 }, { max: 8, pts: 80 }, { max: 10, pts: 60 }],
];
const VS_DURATION_SEC = 120;
const VS_LEVELUP_BONUS_SEC = 60;
const VS_LEVELUP_STREAK = 3;

function rand(a, b) { return Math.floor(Math.random() * (b - a + 1)) + a; }
function digits(n) { return String(n).split(''); }

function makeLv1() {
  const op = OPS[rand(0, 3)];
  let a, b, c;
  if (op === '+') { a = rand(1,8); b = rand(1,9-a); c = a+b; }
  else if (op === '-') { a = rand(2,9); b = rand(1,a-1); c = a-b; }
  else if (op === '*') {
    const pairs = [];
    for (let x=1;x<=9;x++) for (let y=1;y<=9;y++) if (x*y>=1&&x*y<=9) pairs.push([x,y]);
    [a,b] = pairs[rand(0,pairs.length-1)]; c = a*b;
  } else {
    const divs = [];
    for (let y=1;y<=9;y++) for (let x=y;x<=9;x++) if (x%y===0&&x/y>=1&&x/y<=9) divs.push([x,y]);
    [a,b] = divs[rand(0,divs.length-1)]; c = a/b;
  }
  if (c<1||c>9) return null;
  return [String(a), op, String(b), '=', String(c)];
}
function makeLv2() {
  const forms = [
    () => { const a=rand(2,9),b=rand(Math.max(2,10-a),9),c=a+b; if(c<10||c>18)return null; return [String(a),'+',String(b),'=',...digits(c)]; },
    () => { const a=rand(2,9),b=rand(2,9),c=a*b; if(c<10||c>99)return null; return [String(a),'*',String(b),'=',...digits(c)]; },
    () => { const a=rand(10,18),b=rand(a-9,9),c=a-b; if(c<1||c>9)return null; return [...digits(a),'-',String(b),'=',String(c)]; },
    () => { const c=rand(2,9),b=rand(2,9),a=b*c; if(a<10||a>99)return null; return [...digits(a),'/',String(b),'=',String(c)]; },
  ];
  const tok = forms[rand(0,forms.length-1)]();
  if (!tok||tok.length!==6) return null;
  return tok;
}
function makeLv3() {
  const forms = [
    () => { const a=rand(10,89),b=rand(10,99-a),c=a+b; if(c<10||c>99)return null; return [...digits(a),'+',...digits(b),'=',...digits(c)]; },
    () => { const a=rand(20,99),b=rand(10,a-10),c=a-b; if(c<10||c>99)return null; return [...digits(a),'-',...digits(b),'=',...digits(c)]; },
    () => { const a=rand(2,9),b=rand(10,Math.floor(99/a)),c=a*b; if(c<10||c>99)return null; return [String(a),'*',...digits(b),'=',...digits(c)]; },
    () => { const a=rand(2,9),b=rand(10,Math.floor(99/a)),c=a*b; if(c<10||c>99)return null; return [...digits(b),'*',String(a),'=',...digits(c)]; },
    () => { const c=rand(10,49),b=rand(2,9),a=b*c; if(a<10||a>99)return null; return [...digits(a),'/',String(b),'=',...digits(c)]; },
  ];
  const tok = forms[rand(0,forms.length-1)]();
  if (!tok||tok.length!==7) return null;
  return tok;
}
function makeLv4() {
  const forms = [
    () => { const a=rand(20,99),b=rand(10,a-10),c=a-b; if(c<10||c>99)return null; return [...digits(a),'-',...digits(b),'=',...digits(c)]; },
    () => { const a=rand(2,9); const b=rand(Math.ceil(100/a),Math.floor(999/a)); if(b<10||b>99)return null; const c=a*b; if(c<100||c>999)return null; return [...digits(b),'*',String(a),'=',...digits(c)]; },
    () => { const a=rand(2,9); const b=rand(Math.ceil(100/a),Math.floor(999/a)); if(b<10||b>99)return null; const c=a*b; if(c<100||c>999)return null; return [String(a),'*',...digits(b),'=',...digits(c)]; },
    () => { const c=rand(10,99),b=rand(2,9),a=b*c; if(a<100||a>999)return null; return [...digits(a),'/',String(b),'=',...digits(c)]; },
  ];
  const tok = forms[rand(0,forms.length-1)]();
  if (!tok||tok.length!==8) return null;
  return tok;
}
function tryMake(lv) {
  if (lv === 0) return makeLv1();
  if (lv === 1) return makeLv2();
  if (lv === 2) return makeLv3();
  return makeLv4();
}
function makeSecret(lv) {
  for (let i = 0; i < 500; i++) {
    const eq = tryMake(lv);
    if (eq) return eq;
  }
  return ['2', '+', '3', '=', '5'];
}

function validate(tokens) {
  if (tokens.some(t=>t==='')) return {ok:false,msg:'모든 칸을 채워주세요.'};
  const eqIdx = tokens.indexOf('=');
  const eqLast = tokens.lastIndexOf('=');
  if (eqIdx<0) return {ok:false,msg:'등호(=)가 있어야 해요.'};
  if (eqIdx!==eqLast) return {ok:false,msg:'등호(=)는 1개만 가능해요.'};
  const lhs = tokens.slice(0,eqIdx);
  const rhs = tokens.slice(eqIdx+1);
  if (!lhs.length||!rhs.length) return {ok:false,msg:'식이 올바르지 않아요.'};
  if (lhs.filter(t=>OPS.includes(t)).length!==1) return {ok:false,msg:'등호 앞에는 연산자 1개만 가능해요.'};
  if (rhs.some(t=>OPS.includes(t))) return {ok:false,msg:'등호 뒤에는 숫자만!'};
  const opIdx = lhs.findIndex(t=>OPS.includes(t));
  const numA = lhs.slice(0,opIdx).join('');
  const op   = lhs[opIdx];
  const numB = lhs.slice(opIdx+1).join('');
  const numC = rhs.join('');
  if (!numA||!numB||!numC) return {ok:false,msg:'식이 올바르지 않아요.'};
  if (numA.length>1&&numA[0]==='0') return {ok:false,msg:'첫 자리에 0이 올 수 없어요.'};
  if (numB.length>1&&numB[0]==='0') return {ok:false,msg:'첫 자리에 0이 올 수 없어요.'};
  if (numC.length>1&&numC[0]==='0') return {ok:false,msg:'첫 자리에 0이 올 수 없어요.'};
  const a=parseInt(numA,10),b=parseInt(numB,10),c=parseInt(numC,10);
  let result;
  if (op==='+') result=a+b;
  else if (op==='-') result=a-b;
  else if (op==='*') result=a*b;
  else {
    if (b===0) return {ok:false,msg:'0으로 나눌 수 없어요.'};
    if (a%b!==0) return {ok:false,msg:'나누어 떨어지지 않아요.'};
    result=a/b;
  }
  if (result!==c) return {ok:false,msg:'계산 결과가 달라요.'};
  return {ok:true};
}

function getHints(guess, ans) {
  const n = ans.length;
  const hints = Array(n).fill('out');
  const usedA = Array(n).fill(false);
  const usedG = Array(n).fill(false);
  for (let i=0;i<n;i++) {
    if (guess[i]===ans[i]) { hints[i]='strike'; usedA[i]=usedG[i]=true; }
  }
  for (let i=0;i<n;i++) {
    if (usedG[i]) continue;
    for (let j=0;j<n;j++) {
      if (usedA[j]) continue;
      if (guess[i]===ans[j]) { hints[i]='ball'; usedA[j]=true; break; }
    }
  }
  return hints;
}

function calcScore(tries, lv) {
  const rules = SCORE_RULES[lv];
  for (const r of rules) {
    if (tries <= r.max) return r.pts;
  }
  return 40;
}

// ═══════════════════════════════════════════════
//  방 시스템
//  rooms: { [code]: Room }
//  Room: { code, players[], match?, createdAt, lastActivity }
//  Player: { playerId, socketId, name, isHost, ready, side?, disconnected, ... }
//
//  side는 매치 시작 시 'A','B' 할당. 2인 우선.
// ═══════════════════════════════════════════════

const rooms = {};
const socketToRoom = new Map(); // socketId -> { code, playerId }
const masterObservers = new Set(); // socketId 집합 - 방 목록 푸시 받는 마스터 클라들
const socketToObservedRoom = new Map(); // socketId -> roomCode (관전 중인 방)

const MAX_PLAYERS = 2; // 우선 2인. 추후 4인 확장 시 여기 + 매치 클래스만 손보면 됨.
const ROOM_TTL_MS = 30 * 60 * 1000;
const DISCONNECT_GRACE_MS = 30 * 1000;

// ── 방 이름 생성기 (귀여운 동물 컨셉) ──
const ROOM_ADJECTIVES = [
  '졸린', '용감한', '수줍은', '배고픈', '꿈꾸는', '신나는', '느긋한', '엉뚱한',
  '똑똑한', '귀여운', '씩씩한', '깜찍한', '포근한', '말랑한', '재빠른', '느려터진',
  '심심한', '들뜬', '심술난', '행복한', '쑥스러운', '호기심많은', '장난꾸러기', '뽀송한',
  '반짝이는', '통통한', '날쌘', '나른한', '명랑한', '도도한', '엉큼한', '용맹한',
  '소심한', '대담한', '구름같은', '솜털같은', '꼬물꼬물', '두근두근', '말많은', '조용한',
];

const ROOM_ANIMALS = [
  '토끼', '거북이', '다람쥐', '햄스터', '고슴도치', '판다', '코알라', '나무늘보',
  '여우', '너구리', '족제비', '오소리', '비버', '카피바라', '미어캣', '레서판다',
  '펭귄', '물범', '수달', '돌고래', '바다거북', '해마', '문어', '오리',
  '병아리', '오리너구리', '캥거루', '왈라비', '알파카', '라마', '라쿤', '친칠라',
  '족발이', '새끼곰', '아기사슴', '아기여우', '햇병아리', '꼬마펭귄', '아기늑대', '북극여우',
];

function genRoomName() {
  const adj = ROOM_ADJECTIVES[Math.floor(Math.random() * ROOM_ADJECTIVES.length)];
  const animal = ROOM_ANIMALS[Math.floor(Math.random() * ROOM_ANIMALS.length)];
  return `${adj} ${animal}`;
}

function genCode() {
  const pool = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let s;
  do {
    s = '';
    for (let i = 0; i < 4; i++) s += pool[Math.floor(Math.random() * pool.length)];
  } while (rooms[s]);
  return s;
}

function genPlayerId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return crypto.randomBytes(16).toString('hex');
}

function newPlayerState(level) {
  return {
    level,
    secret: makeSecret(level),
    current: Array(LEVELS[level].slots).fill(''),
    activeIdx: 0,
    won: false,
    streak: 0,
    totalScore: 0,
    tryCount: 0,
    historyLog: [],
    lockedCells: Array(LEVELS[level].slots).fill(false),
    tokenStatus: {},
    remainSec: VS_DURATION_SEC,
    ended: false,
  };
}

function snapshotRoom(room) {
  return {
    code: room.code,
    name: room.name,
    players: room.players.map(p => ({
      playerId: p.playerId,
      name: p.name,
      isHost: p.isHost,
      ready: p.ready,
      side: p.side || null,
      disconnected: !!p.disconnected,
    })),
    inMatch: !!(room.match && !room.match.ended),
    matchPhase: room.match ? room.match.phase : null,
  };
}

function broadcastRoom(room) {
  io.to(room.code).emit('room:state', snapshotRoom(room));
  room.lastActivity = Date.now();
  broadcastMasterList();
}

function findPlayerInRoom(room, playerId) {
  return room.players.find(p => p.playerId === playerId);
}

function relabelPlayers(room) {
  // 방장 = "1팀 (방장)", 나머지 = "2팀", "3팀" ...
  let idx = 0;
  room.players.forEach(p => {
    if (p.isHost) {
      p.name = '1팀 (방장)';
    } else {
      idx++;
      p.name = `${idx + 1}팀`;
    }
  });
}

class Match {
  constructor(room) {
    this.id = 'm_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    this.room = room;
    // 2인 매치: 방장이 A, 다른 한 명이 B
    const players = room.players.filter(p => !p.disconnected);
    const hostPlayer = players.find(p => p.isHost);
    const otherPlayer = players.find(p => !p.isHost);
    if (!hostPlayer || !otherPlayer) throw new Error('Need 2 players to start match');

    hostPlayer.side = 'A';
    otherPlayer.side = 'B';

    this.sides = {
      A: { playerId: hostPlayer.playerId, socketId: hostPlayer.socketId, state: newPlayerState(0), ready: false },
      B: { playerId: otherPlayer.playerId, socketId: otherPlayer.socketId, state: newPlayerState(0), ready: false },
    };
    this.timerId = null;
    this.ended = false;
    this.phase = 'ready';
    this.readyTimeoutId = null;
    this.countdownIntervalId = null;
  }

  otherSide(side) { return side === 'A' ? 'B' : 'A'; }

  playerIdToSide(playerId) {
    if (this.sides.A.playerId === playerId) return 'A';
    if (this.sides.B.playerId === playerId) return 'B';
    return null;
  }

  // 현재 socketId 갱신 (재접속 등)
  refreshSocketIds() {
    ['A','B'].forEach(s => {
      const pid = this.sides[s].playerId;
      const p = findPlayerInRoom(this.room, pid);
      if (p) this.sides[s].socketId = p.socketId;
    });
  }

  publicSelf(p) {
    return {
      level: p.level,
      slots: LEVELS[p.level].slots,
      current: p.current,
      activeIdx: p.activeIdx,
      lockedCells: p.lockedCells,
      tokenStatus: p.tokenStatus,
      historyLog: p.historyLog,
      streak: p.streak,
      totalScore: p.totalScore,
      tryCount: p.tryCount,
      remainSec: p.remainSec,
      ended: p.ended,
      won: p.won,
    };
  }

  publicOpp(p) {
    return {
      level: p.level,
      slots: LEVELS[p.level].slots,
      current: p.current,
      activeIdx: p.activeIdx,
      lockedCells: p.lockedCells,
      historyLog: p.historyLog,
      streak: p.streak,
      totalScore: p.totalScore,
      tryCount: p.tryCount,
      remainSec: p.remainSec,
      ended: p.ended,
      won: p.won,
    };
  }

  selfPayload(side) {
    const me = this.sides[side].state;
    const op = this.sides[this.otherSide(side)].state;
    const myP = findPlayerInRoom(this.room, this.sides[side].playerId);
    const opP = findPlayerInRoom(this.room, this.sides[this.otherSide(side)].playerId);
    return {
      side,
      myName: myP ? myP.name : '나',
      opName: opP ? opP.name : '상대',
      mine: this.publicSelf(me),
      opp: this.publicOpp(op),
      phase: this.phase,
      myReady: this.sides[side].ready,
      oppReady: this.sides[this.otherSide(side)].ready,
    };
  }

  // 관전자용 페이로드 - A/B 양쪽을 publicOpp 수준으로 (secret 노출 없음)
  spectatorPayload() {
    const aP = findPlayerInRoom(this.room, this.sides.A.playerId);
    const bP = findPlayerInRoom(this.room, this.sides.B.playerId);
    return {
      code: this.room.code,
      roomName: this.room.name,
      aName: aP ? aP.name : '플레이어1',
      bName: bP ? bP.name : '플레이어2',
      a: this.publicOpp(this.sides.A.state),
      b: this.publicOpp(this.sides.B.state),
      phase: this.phase,
      aReady: this.sides.A.ready,
      bReady: this.sides.B.ready,
    };
  }

  // 관전자 socket들에게 이벤트 전달
  emitToObservers(event, payload) {
    if (!this.room.observers || this.room.observers.size === 0) return;
    for (const sid of this.room.observers) {
      io.to(sid).emit(event, payload);
    }
  }

  broadcastState() {
    this.refreshSocketIds();
    const aSocket = this.sides.A.socketId;
    const bSocket = this.sides.B.socketId;
    if (aSocket) io.to(aSocket).emit('match_state', this.selfPayload('A'));
    if (bSocket) io.to(bSocket).emit('match_state', this.selfPayload('B'));
    // 관전자에게도
    this.emitToObservers('spectate_state', this.spectatorPayload());
  }

  broadcastLiveInput(side) {
    this.refreshSocketIds();
    const p = this.sides[side].state;
    const liveData = {
      side,
      current: p.current,
      activeIdx: p.activeIdx,
      lockedCells: p.lockedCells,
    };
    const otherSocket = this.sides[this.otherSide(side)].socketId;
    if (otherSocket) io.to(otherSocket).emit('opp_live_input', liveData);
    // 관전자에게도 (어느 쪽 입력인지 side 정보 포함)
    this.emitToObservers('spectate_live_input', liveData);
  }

  startReadyPhase() {
    this.phase = 'ready';
    this.readyTimeoutId = setTimeout(() => {
      if (this.phase === 'ready') this.cancelDueToReady();
    }, 30000);
    this.broadcastState();
  }

  setReady(playerId, ready) {
    if (this.phase !== 'ready' || this.ended) return;
    const side = this.playerIdToSide(playerId);
    if (!side) return;
    this.sides[side].ready = !!ready;
    this.broadcastState();
    if (this.sides.A.ready && this.sides.B.ready) this.startCountdown();
  }

  startCountdown() {
    if (this.phase !== 'ready') return;
    this.phase = 'countdown';
    if (this.readyTimeoutId) { clearTimeout(this.readyTimeoutId); this.readyTimeoutId = null; }

    const send = (label) => {
      this.refreshSocketIds();
      const aSocket = this.sides.A.socketId;
      const bSocket = this.sides.B.socketId;
      const payload = { label };
      if (aSocket) io.to(aSocket).emit('countdown', payload);
      if (bSocket) io.to(bSocket).emit('countdown', payload);
      this.emitToObservers('countdown', payload);
    };

    this.broadcastState();

    let n = 3;
    send('3');
    this.countdownIntervalId = setInterval(() => {
      n--;
      if (n === 2) send('2');
      else if (n === 1) send('1');
      else if (n === 0) send('GO!');
      else if (n < 0) {
        clearInterval(this.countdownIntervalId);
        this.countdownIntervalId = null;
        this.phase = 'playing';
        send(null);
        this.broadcastState();
        this.startTimer();
      }
    }, 1000);
  }

  cancelDueToReady() {
    if (this.ended) return;
    this.ended = true;
    this.phase = 'ended';
    if (this.readyTimeoutId) { clearTimeout(this.readyTimeoutId); this.readyTimeoutId = null; }
    if (this.countdownIntervalId) { clearInterval(this.countdownIntervalId); this.countdownIntervalId = null; }

    this.refreshSocketIds();
    const payload = {
      reason: 'ready_timeout',
      msg: '30초 안에 양쪽이 준비되지 않아 매치가 취소되었어요.'
    };
    const aSocket = this.sides.A.socketId;
    const bSocket = this.sides.B.socketId;
    if (aSocket) io.to(aSocket).emit('match_cancelled', payload);
    if (bSocket) io.to(bSocket).emit('match_cancelled', payload);
    this.emitToObservers('match_cancelled', payload);
  }

  startTimer() {
    if (this.timerId) clearInterval(this.timerId);
    this.timerId = setInterval(() => {
      if (this.ended) { clearInterval(this.timerId); this.timerId = null; return; }
      let allEnded = true;
      ['A','B'].forEach(s => {
        const p = this.sides[s].state;
        if (p.ended) return;
        p.remainSec--;
        if (p.remainSec <= 0) { p.remainSec = 0; p.ended = true; }
        else allEnded = false;
      });
      this.refreshSocketIds();
      const tickPayload = {
        aRemainSec: this.sides.A.state.remainSec,
        bRemainSec: this.sides.B.state.remainSec,
        aEnded: this.sides.A.state.ended,
        bEnded: this.sides.B.state.ended,
      };
      const aSocket = this.sides.A.socketId;
      const bSocket = this.sides.B.socketId;
      if (aSocket) io.to(aSocket).emit('match_tick', tickPayload);
      if (bSocket) io.to(bSocket).emit('match_tick', tickPayload);
      this.emitToObservers('match_tick', tickPayload);
      if (allEnded) this.finish();
    }, 1000);
  }

  handleSubmit(playerId, tokens) {
    const side = this.playerIdToSide(playerId);
    if (!side) return;
    if (this.phase !== 'playing') return;
    const p = this.sides[side].state;
    if (this.ended || p.ended || p.won) return;

    const v = validate(tokens);
    if (!v.ok) {
      this.refreshSocketIds();
      const sock = this.sides[side].socketId;
      if (sock) io.to(sock).emit('submit_error', { msg: v.msg });
      return;
    }
    p.current = tokens.slice();

    const hints = getHints(p.current, p.secret);
    const isWin = p.current.every((c, i) => c === p.secret[i]);
    p.tryCount++;

    const presentInSecret = new Set(p.secret);
    for (let i = 0; i < p.current.length; i++) {
      const t = p.current[i];
      if (presentInSecret.has(t)) p.tokenStatus[t] = 'seen';
      else if (p.tokenStatus[t] !== 'seen') p.tokenStatus[t] = 'eliminated';
    }
    for (let i = 0; i < hints.length; i++) {
      if (hints[i] === 'strike') p.lockedCells[i] = true;
    }

    p.historyLog.push({ guess: p.current.slice(), hints: hints.slice(), isReveal: false });

    let levelUp = false;
    let earned = 0;

    if (isWin) {
      p.won = true;
      p.streak++;
      earned = calcScore(p.tryCount, p.level);
      p.totalScore += earned;
      if (p.streak >= VS_LEVELUP_STREAK && p.level < LEVELS.length - 1) {
        p.streak = 0;
        p.level++;
        p.remainSec += VS_LEVELUP_BONUS_SEC;
        levelUp = true;
      }
    } else {
      p.current = p.secret.map((v, i) => p.lockedCells[i] ? v : '');
      let firstUnlocked = p.lockedCells.findIndex(l => !l);
      if (firstUnlocked < 0) firstUnlocked = 0;
      p.activeIdx = firstUnlocked;
    }

    this.refreshSocketIds();
    const sock = this.sides[side].socketId;
    if (sock) io.to(sock).emit('submit_result', {
      hints, isWin, earned, levelUp,
      newLevel: p.level,
      remainSec: p.remainSec,
    });

    if (isWin) {
      setTimeout(() => {
        if (this.ended || p.ended) return;
        const newLv = p.level;
        p.secret = makeSecret(newLv);
        const newSlots = LEVELS[newLv].slots;
        p.current = Array(newSlots).fill('');
        p.activeIdx = 0;
        p.won = false;
        p.tryCount = 0;
        p.lockedCells = Array(newSlots).fill(false);
        p.tokenStatus = {};
        p.historyLog = [];
        this.broadcastState();
      }, 1100);
    }

    this.broadcastState();
  }

  handlePress(playerId, value) {
    const side = this.playerIdToSide(playerId);
    if (!side) return;
    if (this.phase !== 'playing') return;
    const p = this.sides[side].state;
    if (this.ended || p.ended || p.won) return;
    if (p.activeIdx < 0 || p.activeIdx >= p.current.length) return;
    if (p.lockedCells[p.activeIdx]) return;
    p.current[p.activeIdx] = value;
    let i = p.activeIdx + 1;
    while (i < p.current.length && p.lockedCells[i]) i++;
    if (i < p.current.length) p.activeIdx = i;
    this.broadcastLiveInput(side);
    this.refreshSocketIds();
    const sock = this.sides[side].socketId;
    if (sock) io.to(sock).emit('self_live_input', {
      current: p.current, activeIdx: p.activeIdx, lockedCells: p.lockedCells,
    });
  }

  handleDel(playerId) {
    const side = this.playerIdToSide(playerId);
    if (!side) return;
    if (this.phase !== 'playing') return;
    const p = this.sides[side].state;
    if (this.ended || p.ended || p.won) return;
    if (p.activeIdx < 0) return;
    if (p.lockedCells[p.activeIdx]) {
      let i = p.activeIdx - 1;
      while (i >= 0 && p.lockedCells[i]) i--;
      if (i >= 0) { p.activeIdx = i; p.current[p.activeIdx] = ''; }
    } else if (p.current[p.activeIdx] !== '') {
      p.current[p.activeIdx] = '';
    } else {
      let i = p.activeIdx - 1;
      while (i >= 0 && p.lockedCells[i]) i--;
      if (i >= 0) { p.activeIdx = i; p.current[p.activeIdx] = ''; }
    }
    this.broadcastLiveInput(side);
    this.refreshSocketIds();
    const sock = this.sides[side].socketId;
    if (sock) io.to(sock).emit('self_live_input', {
      current: p.current, activeIdx: p.activeIdx, lockedCells: p.lockedCells,
    });
  }

  finish() {
    if (this.ended) return;
    this.ended = true;
    this.phase = 'ended';
    if (this.timerId) { clearInterval(this.timerId); this.timerId = null; }
    if (this.readyTimeoutId) { clearTimeout(this.readyTimeoutId); this.readyTimeoutId = null; }
    if (this.countdownIntervalId) { clearInterval(this.countdownIntervalId); this.countdownIntervalId = null; }

    const aScore = this.sides.A.state.totalScore;
    const bScore = this.sides.B.state.totalScore;
    let winner = null;
    if (aScore > bScore) winner = 'A';
    else if (bScore > aScore) winner = 'B';

    const aP = findPlayerInRoom(this.room, this.sides.A.playerId);
    const bP = findPlayerInRoom(this.room, this.sides.B.playerId);
    const result = {
      aScore, bScore, winner,
      aName: aP ? aP.name : '플레이어1',
      bName: bP ? bP.name : '플레이어2',
    };

    // 랭킹 기록: 정상 종료(시간 만료)이고 승자가 있을 때만, 방제+승자 점수로
    if (winner) {
      const winnerScore = winner === 'A' ? aScore : bScore;
      addRankingEntry(this.room.name, winnerScore);
      console.log(`[RANKING+] room="${this.room.name}" score=${winnerScore} (winner=${winner})`);
    }

    this.refreshSocketIds();
    const aSocket = this.sides.A.socketId;
    const bSocket = this.sides.B.socketId;
    if (aSocket) io.to(aSocket).emit('match_end', { ...result, mySide: 'A' });
    if (bSocket) io.to(bSocket).emit('match_end', { ...result, mySide: 'B' });
    this.emitToObservers('match_end', { ...result, spectator: true });
  }

  // 한 쪽 플레이어가 방을 떠나면 매치 즉시 종료 (상대 자동 승)
  forfeit(playerId) {
    if (this.ended) return;
    const side = this.playerIdToSide(playerId);
    if (!side) return;
    const other = this.otherSide(side);
    this.ended = true;
    this.phase = 'ended';
    if (this.timerId) { clearInterval(this.timerId); this.timerId = null; }
    if (this.readyTimeoutId) { clearTimeout(this.readyTimeoutId); this.readyTimeoutId = null; }
    if (this.countdownIntervalId) { clearInterval(this.countdownIntervalId); this.countdownIntervalId = null; }

    this.refreshSocketIds();
    const otherSocket = this.sides[other].socketId;
    const aP = findPlayerInRoom(this.room, this.sides.A.playerId);
    const bP = findPlayerInRoom(this.room, this.sides.B.playerId);
    const baseResult = {
      aScore: this.sides.A.state.totalScore,
      bScore: this.sides.B.state.totalScore,
      winner: other,
      aName: aP ? aP.name : '플레이어1',
      bName: bP ? bP.name : '플레이어2',
      forfeit: true,
    };
    if (otherSocket) io.to(otherSocket).emit('match_end', {
      ...baseResult,
      mySide: other,
    });
    this.emitToObservers('match_end', { ...baseResult, spectator: true });
  }
}

// ═══════════════════════════════════════════════
//  방 헬퍼
// ═══════════════════════════════════════════════

function destroyRoom(room, reason, opts = {}) {
  if (room.match) {
    if (room.match.timerId) clearInterval(room.match.timerId);
    if (room.match.readyTimeoutId) clearTimeout(room.match.readyTimeoutId);
    if (room.match.countdownIntervalId) clearInterval(room.match.countdownIntervalId);
  }
  room.players.forEach(p => {
    if (p.leaveTimer) clearTimeout(p.leaveTimer);
  });
  // 관전자에게도 방 종료 알림
  if (room.observers) {
    for (const sid of room.observers) {
      io.to(sid).emit('spectate_room_closed', { code: room.code, reason });
      socketToObservedRoom.delete(sid);
    }
  }
  // 방 멤버에게 room:closed 알림 - 단, 본인 의지로 나가는 socket은 제외
  // (자기가 마지막 한 명이라 방이 사라진 경우 "방에 아무도 없어요" 같은 메시지가
  //  본인에게 가는 게 어색하므로)
  const excludeId = opts.excludeSocketId;
  if (excludeId) {
    const room$ = io.to(room.code);
    // socket.id로 제외하려면 except 사용 (socket.io v4 문법)
    io.to(room.code).except(excludeId).emit('room:closed', { reason });
  } else {
    io.to(room.code).emit('room:closed', { reason });
  }
  io.in(room.code).socketsLeave(room.code);
  delete rooms[room.code];
  broadcastMasterList();
}

// 매치 후 방 재사용을 위해 매치 상태 리셋 (방은 유지)
function resetMatchInRoom(room) {
  if (room.match) {
    if (room.match.timerId) clearInterval(room.match.timerId);
    if (room.match.readyTimeoutId) clearTimeout(room.match.readyTimeoutId);
    if (room.match.countdownIntervalId) clearInterval(room.match.countdownIntervalId);
  }
  room.match = null;
  room.players.forEach(p => {
    p.ready = p.isHost; // 방장은 자동 ready
    p.side = null;
  });
}

// ═══════════════════════════════════════════════
//  마스터(관전자) 헬퍼
//  - 마스터는 player 카운트에 포함되지 않음
//  - 방 참가자에게 노출되지 않음 (room:state.players에 안 들어감)
//  - 방 목록 자동 푸시 + 특정 방 매치 관전
// ═══════════════════════════════════════════════

function masterRoomListPayload() {
  const list = [];
  for (const code of Object.keys(rooms)) {
    const room = rooms[code];
    const activePlayers = room.players.filter(p => !p.disconnected);
    const inMatch = !!(room.match && !room.match.ended);
    list.push({
      code,
      name: room.name,
      playerCount: activePlayers.length,
      maxPlayers: MAX_PLAYERS,
      players: room.players.map(p => ({
        name: p.name,
        isHost: p.isHost,
        ready: p.ready,
        disconnected: !!p.disconnected,
      })),
      inMatch,
      matchPhase: inMatch ? room.match.phase : null,
      aScore: inMatch ? room.match.sides.A.state.totalScore : null,
      bScore: inMatch ? room.match.sides.B.state.totalScore : null,
      aRemainSec: inMatch ? room.match.sides.A.state.remainSec : null,
      bRemainSec: inMatch ? room.match.sides.B.state.remainSec : null,
      observerCount: room.observers ? room.observers.size : 0,
      createdAt: room.createdAt,
    });
  }
  return { rooms: list, serverTime: Date.now() };
}

function broadcastMasterList() {
  if (masterObservers.size === 0) return;
  const payload = masterRoomListPayload();
  for (const sid of masterObservers) {
    io.to(sid).emit('master:list', payload);
  }
}

// 정기적으로 마스터에 목록 푸시 (매치 진행 중 점수/시간 갱신용)
setInterval(broadcastMasterList, 2000);

// ═══════════════════════════════════════════════
//  소켓 핸들러
// ═══════════════════════════════════════════════

io.on('connection', (socket) => {
  console.log('[+]', socket.id);

  // 접속 시 자동으로 랭킹 전송 (메인/마스터 어디서든 즉시 받음)
  socket.emit('ranking:update', topRankings());

  // 명시적 요청 (페이지 진입 시 등)
  socket.on('ranking:get', () => {
    socket.emit('ranking:update', topRankings());
  });

  // ── 방 만들기 ──
  socket.on('room:create', () => {
    const code = genCode();
    const playerId = genPlayerId();
    const room = {
      code,
      name: genRoomName(),
      players: [{
        playerId,
        socketId: socket.id,
        name: '1팀 (방장)',
        isHost: true,
        ready: true, // 방장은 항상 ready 기본
        side: null,
        disconnected: false,
        disconnectedAt: 0,
        leaveTimer: null,
      }],
      match: null,
      observers: new Set(), // socketId 집합. player에겐 안 보이는 관전자
      createdAt: Date.now(),
      lastActivity: Date.now(),
    };
    rooms[code] = room;
    socket.join(code);
    socketToRoom.set(socket.id, { code, playerId });
    socket.emit('room:joined', {
      code, myId: playerId, isHost: true,
    });
    broadcastRoom(room);
    console.log(`[ROOM-CREATE] code=${code} host=${playerId.slice(0,6)}`);
  });

  // ── 방 참여 ──
  socket.on('room:join', ({ code }) => {
    code = (code || '').toUpperCase().trim();
    const room = rooms[code];
    if (!room) {
      socket.emit('room:error', { reason: '방을 찾을 수 없어요. 코드를 확인해주세요.' });
      return;
    }
    const activeCount = room.players.filter(p => !p.disconnected).length;
    if (activeCount >= MAX_PLAYERS) {
      socket.emit('room:error', { reason: '방이 가득 찼어요.' });
      return;
    }
    if (room.match && !room.match.ended) {
      socket.emit('room:error', { reason: '이미 경기가 진행 중인 방이에요.' });
      return;
    }

    const playerId = genPlayerId();
    const newPlayer = {
      playerId,
      socketId: socket.id,
      name: '2팀',
      isHost: false,
      ready: false,
      side: null,
      disconnected: false,
      disconnectedAt: 0,
      leaveTimer: null,
    };
    room.players.push(newPlayer);
    relabelPlayers(room);
    socket.join(code);
    socketToRoom.set(socket.id, { code, playerId });
    socket.emit('room:joined', {
      code, myId: playerId, isHost: false,
    });
    broadcastRoom(room);
    console.log(`[ROOM-JOIN] code=${code} player=${playerId.slice(0,6)}`);
  });

  // ── 재접속 ──
  socket.on('room:rejoin', ({ code, playerId }) => {
    code = (code || '').toUpperCase().trim();
    const room = rooms[code];
    if (!room) {
      socket.emit('room:error', { reason: '방이 더 이상 존재하지 않아요.' });
      return;
    }
    const me = findPlayerInRoom(room, playerId);
    if (!me) {
      socket.emit('room:error', { reason: '이 방에 본인 자리가 없어요.' });
      return;
    }
    if (me.leaveTimer) { clearTimeout(me.leaveTimer); me.leaveTimer = null; }
    me.disconnected = false;
    me.disconnectedAt = 0;
    me.socketId = socket.id;
    socket.join(code);
    socketToRoom.set(socket.id, { code, playerId });
    socket.emit('room:joined', {
      code, myId: playerId, isHost: me.isHost, rejoined: true,
    });
    broadcastRoom(room);
    if (room.match && !room.match.ended) {
      room.match.refreshSocketIds();
      const side = room.match.playerIdToSide(playerId);
      if (side) socket.emit('match_state', room.match.selfPayload(side));
    }
    console.log(`[ROOM-REJOIN] code=${code} player=${playerId.slice(0,6)}`);
  });

  // ── 준비 토글 (방장 아닌 사람만 / 매치 시작 전) ──
  socket.on('room:setReady', ({ ready }) => {
    const ref = socketToRoom.get(socket.id);
    if (!ref) return;
    const room = rooms[ref.code];
    if (!room) return;
    if (room.match && !room.match.ended) return;
    const me = findPlayerInRoom(room, ref.playerId);
    if (!me || me.isHost) return;
    me.ready = !!ready;
    broadcastRoom(room);
  });

  // ── 매치 시작 (방장만) ──
  socket.on('room:start', () => {
    const ref = socketToRoom.get(socket.id);
    if (!ref) return;
    const room = rooms[ref.code];
    if (!room) return;
    const me = findPlayerInRoom(room, ref.playerId);
    if (!me || !me.isHost) {
      socket.emit('room:error', { reason: '방장만 시작할 수 있어요.' });
      return;
    }
    const activePlayers = room.players.filter(p => !p.disconnected);
    if (activePlayers.length < 2) {
      socket.emit('room:error', { reason: '2명이 모여야 시작할 수 있어요.' });
      return;
    }
    if (!activePlayers.filter(p => !p.isHost).every(p => p.ready)) {
      socket.emit('room:error', { reason: '상대가 아직 준비되지 않았어요.' });
      return;
    }
    if (room.match && !room.match.ended) return;

    try {
      room.match = new Match(room);
    } catch (e) {
      socket.emit('room:error', { reason: '매치 생성 실패: ' + e.message });
      return;
    }
    broadcastRoom(room);

    // 시작 알림 (양쪽에 selfPayload 전송)
    const aSock = room.match.sides.A.socketId;
    const bSock = room.match.sides.B.socketId;
    if (aSock) io.to(aSock).emit('match_start', room.match.selfPayload('A'));
    if (bSock) io.to(bSock).emit('match_start', room.match.selfPayload('B'));

    room.match.startReadyPhase();
    console.log(`[MATCH-START] code=${room.code}`);
  });

  // ── 매치 안 준비완료 토글 ──
  socket.on('match:setReady', ({ ready }) => {
    const ref = socketToRoom.get(socket.id);
    if (!ref) return;
    const room = rooms[ref.code];
    if (!room || !room.match) return;
    room.match.setReady(ref.playerId, ready);
  });

  // ── 매치 입력 ──
  socket.on('match_press', ({ value }) => {
    const ref = socketToRoom.get(socket.id);
    if (!ref) return;
    const room = rooms[ref.code];
    if (!room || !room.match) return;
    room.match.handlePress(ref.playerId, value);
    room.lastActivity = Date.now();
  });

  socket.on('match_del', () => {
    const ref = socketToRoom.get(socket.id);
    if (!ref) return;
    const room = rooms[ref.code];
    if (!room || !room.match) return;
    room.match.handleDel(ref.playerId);
    room.lastActivity = Date.now();
  });

  socket.on('match_submit', ({ tokens }) => {
    const ref = socketToRoom.get(socket.id);
    if (!ref) return;
    const room = rooms[ref.code];
    if (!room || !room.match) return;
    room.match.handleSubmit(ref.playerId, tokens);
    room.lastActivity = Date.now();
  });

  // ── 매치 후 처리: action = 'rematch' | 'leave' ──
  socket.on('post_match', ({ action }) => {
    const ref = socketToRoom.get(socket.id);
    if (!ref) return;
    const room = rooms[ref.code];
    if (!room) return;
    const me = findPlayerInRoom(room, ref.playerId);
    if (!me) return;

    if (action === 'leave') {
      handleLeave(socket, 'explicit-leave');
      return;
    }
    // rematch: 매치만 리셋하고 방은 유지. 방장이 다시 시작 누르면 됨.
    if (action === 'rematch') {
      if (me.isHost) {
        // 방장이 누른 경우에만 매치 리셋 (양쪽 동시에 누르면 race 가능하지만 idempotent)
        resetMatchInRoom(room);
        broadcastRoom(room);
        io.to(room.code).emit('rematch_ready');
      } else {
        // 방장 아닌 사람: 일단 클라이언트가 방 대기 화면으로 돌아가도록 알림
        socket.emit('return_to_room');
      }
    }
  });

  // ════════════════════════════════════════════
  //  마스터(관전자) 이벤트
  // ════════════════════════════════════════════

  // 마스터로 등록 + 즉시 방 목록 받기
  socket.on('master:hello', () => {
    masterObservers.add(socket.id);
    socket.emit('master:list', masterRoomListPayload());
    console.log(`[MASTER+] socket=${socket.id.slice(0,6)} total=${masterObservers.size}`);
  });

  // 방 목록 강제 새로고침
  socket.on('master:refresh', () => {
    if (!masterObservers.has(socket.id)) return;
    socket.emit('master:list', masterRoomListPayload());
  });

  // 특정 방 관전 시작
  socket.on('master:spectate', ({ code }) => {
    if (!masterObservers.has(socket.id)) {
      socket.emit('master:error', { reason: '마스터로 등록되지 않았어요.' });
      return;
    }
    code = (code || '').toUpperCase().trim();
    const room = rooms[code];
    if (!room) {
      socket.emit('master:error', { reason: '방이 없어요.' });
      return;
    }
    // 이전에 다른 방 관전 중이었으면 정리
    const prevCode = socketToObservedRoom.get(socket.id);
    if (prevCode && prevCode !== code && rooms[prevCode]) {
      rooms[prevCode].observers.delete(socket.id);
    }
    room.observers.add(socket.id);
    socketToObservedRoom.set(socket.id, code);

    // 즉시 현재 상태 보내기
    if (room.match && !room.match.ended) {
      socket.emit('spectate_start', {
        code,
        ...room.match.spectatorPayload(),
      });
    } else {
      // 매치 없으면 방 정보만
      socket.emit('spectate_start', {
        code,
        roomName: room.name,
        noMatch: true,
        players: room.players.map(p => ({
          name: p.name, isHost: p.isHost, ready: p.ready, disconnected: !!p.disconnected,
        })),
      });
    }
    console.log(`[MASTER-SPECTATE] socket=${socket.id.slice(0,6)} code=${code}`);
  });

  // 관전 종료 (방 목록으로 복귀)
  socket.on('master:leave_spectate', () => {
    const code = socketToObservedRoom.get(socket.id);
    if (code && rooms[code]) {
      rooms[code].observers.delete(socket.id);
    }
    socketToObservedRoom.delete(socket.id);
    // 새 방 목록을 다시 보내줌
    if (masterObservers.has(socket.id)) {
      socket.emit('master:list', masterRoomListPayload());
    }
  });

  // 마스터 종료 (선택적)
  socket.on('master:bye', () => {
    cleanupMaster(socket.id);
  });

  // ── 명시적 나가기 ──
  socket.on('room:leave', () => {
    handleLeave(socket, 'explicit-leave');
  });

  // ── 끊김 ──
  socket.on('disconnect', () => {
    console.log('[-]', socket.id);
    cleanupMaster(socket.id);
    handleLeave(socket, 'disconnect');
  });
});

// 마스터/관전자 정리
function cleanupMaster(socketId) {
  if (masterObservers.has(socketId)) {
    masterObservers.delete(socketId);
    console.log(`[MASTER-] socket=${socketId.slice(0,6)} total=${masterObservers.size}`);
  }
  const code = socketToObservedRoom.get(socketId);
  if (code && rooms[code]) {
    rooms[code].observers.delete(socketId);
  }
  socketToObservedRoom.delete(socketId);
}

// ═══════════════════════════════════════════════
//  나가기 처리 (grace period 포함)
// ═══════════════════════════════════════════════

function handleLeave(socket, cause) {
  const ref = socketToRoom.get(socket.id);
  if (!ref) return;
  socketToRoom.delete(socket.id);
  const room = rooms[ref.code];
  if (!room) return;
  const me = findPlayerInRoom(room, ref.playerId);
  if (!me) return;
  if (me.socketId !== socket.id) return; // 이미 다른 소켓으로 재접속됨

  const isExplicit = cause === 'explicit-leave';
  if (isExplicit) {
    finalizeLeave(room, me, cause, socket.id);
    return;
  }

  // disconnect → grace period
  me.disconnected = true;
  me.disconnectedAt = Date.now();
  broadcastRoom(room);
  if (me.leaveTimer) clearTimeout(me.leaveTimer);
  me.leaveTimer = setTimeout(() => {
    if (me.disconnected) finalizeLeave(room, me, 'grace-expired', null);
  }, DISCONNECT_GRACE_MS);
}

function finalizeLeave(room, me, cause, leavingSocketId) {
  if (me.leaveTimer) { clearTimeout(me.leaveTimer); me.leaveTimer = null; }
  const inMatch = !!(room.match && !room.match.ended);

  if (inMatch) {
    // 매치 진행중에 나가면 forfeit
    room.match.forfeit(me.playerId);
  }

  // 명시적 leave인 경우, 떠나는 socket을 io room에서 즉시 분리
  // (안 그러면 이후 io.to(room.code).emit()이 이 socket에도 전달됨)
  if (leavingSocketId) {
    const s = io.sockets.sockets.get(leavingSocketId);
    if (s) s.leave(room.code);
  }

  const wasHost = me.isHost;
  room.players = room.players.filter(p => p.playerId !== me.playerId);

  if (room.players.length === 0) {
    // 본인 의지로 나간 경우(leavingSocketId 있음) → 본인은 room:closed 안 받음
    // ("방에 아무도 없어요"가 본인에게 가는 건 어색)
    destroyRoom(room, '방에 아무도 없어요', { excludeSocketId: leavingSocketId });
    console.log(`[ROOM-DESTROYED] code=${room.code} reason=empty`);
    return;
  }

  // 방장이 나갔으면 권한 이양
  if (wasHost) {
    const newHost = room.players.find(p => !p.disconnected) || room.players[0];
    newHost.isHost = true;
    newHost.ready = true;
    io.to(room.code).emit('host_changed', { playerId: newHost.playerId, name: newHost.name });
  }

  if (!room.match || room.match.ended) {
    relabelPlayers(room);
  }
  broadcastRoom(room);
  console.log(`[LEAVE] code=${room.code} player=${me.playerId.slice(0,6)} cause=${cause}`);
}

// ═══════════════════════════════════════════════
//  방 TTL 청소
// ═══════════════════════════════════════════════
setInterval(() => {
  const now = Date.now();
  for (const code of Object.keys(rooms)) {
    const room = rooms[code];
    if (now - room.lastActivity > ROOM_TTL_MS) {
      console.log(`[ROOM-DESTROYED] code=${code} reason=ttl-idle`);
      destroyRoom(room, '비활성으로 방이 종료되었어요');
    }
  }
}, 10 * 60 * 1000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`수널판 서버 ${SERVER_VERSION} listening on :${PORT}`);
});
