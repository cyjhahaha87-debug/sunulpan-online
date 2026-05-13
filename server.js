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
const { Server } = require('socket.io');

const SERVER_VERSION = 'v2.0.0-room';

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  pingInterval: 25000,
  pingTimeout: 20000,
});

app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_req, res) => res.json({
  ok: true,
  version: SERVER_VERSION,
  rooms: Object.keys(rooms).length,
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

const MAX_PLAYERS = 2; // 우선 2인. 추후 4인 확장 시 여기 + 매치 클래스만 손보면 됨.
const ROOM_TTL_MS = 30 * 60 * 1000;
const DISCONNECT_GRACE_MS = 30 * 1000;

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

  broadcastState() {
    this.refreshSocketIds();
    const aSocket = this.sides.A.socketId;
    const bSocket = this.sides.B.socketId;
    if (aSocket) io.to(aSocket).emit('match_state', this.selfPayload('A'));
    if (bSocket) io.to(bSocket).emit('match_state', this.selfPayload('B'));
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

    this.refreshSocketIds();
    const aSocket = this.sides.A.socketId;
    const bSocket = this.sides.B.socketId;
    if (aSocket) io.to(aSocket).emit('match_end', { ...result, mySide: 'A' });
    if (bSocket) io.to(bSocket).emit('match_end', { ...result, mySide: 'B' });
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
    if (otherSocket) io.to(otherSocket).emit('match_end', {
      aScore: this.sides.A.state.totalScore,
      bScore: this.sides.B.state.totalScore,
      winner: other,
      aName: aP ? aP.name : '플레이어1',
      bName: bP ? bP.name : '플레이어2',
      mySide: other,
      forfeit: true,
    });
  }
}

// ═══════════════════════════════════════════════
//  방 헬퍼
// ═══════════════════════════════════════════════

function destroyRoom(room, reason) {
  if (room.match) {
    if (room.match.timerId) clearInterval(room.match.timerId);
    if (room.match.readyTimeoutId) clearTimeout(room.match.readyTimeoutId);
    if (room.match.countdownIntervalId) clearInterval(room.match.countdownIntervalId);
  }
  room.players.forEach(p => {
    if (p.leaveTimer) clearTimeout(p.leaveTimer);
  });
  io.to(room.code).emit('room:closed', { reason });
  io.in(room.code).socketsLeave(room.code);
  delete rooms[room.code];
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
//  소켓 핸들러
// ═══════════════════════════════════════════════

io.on('connection', (socket) => {
  console.log('[+]', socket.id);

  // ── 방 만들기 ──
  socket.on('room:create', () => {
    const code = genCode();
    const playerId = genPlayerId();
    const room = {
      code,
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

  // ── 명시적 나가기 ──
  socket.on('room:leave', () => {
    handleLeave(socket, 'explicit-leave');
  });

  // ── 끊김 ──
  socket.on('disconnect', () => {
    console.log('[-]', socket.id);
    handleLeave(socket, 'disconnect');
  });
});

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
    finalizeLeave(room, me, cause);
    return;
  }

  // disconnect → grace period
  me.disconnected = true;
  me.disconnectedAt = Date.now();
  broadcastRoom(room);
  if (me.leaveTimer) clearTimeout(me.leaveTimer);
  me.leaveTimer = setTimeout(() => {
    if (me.disconnected) finalizeLeave(room, me, 'grace-expired');
  }, DISCONNECT_GRACE_MS);
}

function finalizeLeave(room, me, cause) {
  if (me.leaveTimer) { clearTimeout(me.leaveTimer); me.leaveTimer = null; }
  const inMatch = !!(room.match && !room.match.ended);

  if (inMatch) {
    // 매치 진행중에 나가면 forfeit
    room.match.forfeit(me.playerId);
  }

  const wasHost = me.isHost;
  room.players = room.players.filter(p => p.playerId !== me.playerId);

  if (room.players.length === 0) {
    destroyRoom(room, '방에 아무도 없어요');
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
