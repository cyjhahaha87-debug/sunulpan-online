// ════════════════════════════════════════════════════════════════
//  수널판 온라인 서버 (server.js)
//  - Express + Socket.IO
//  - 권한 있는 게임 로직 (정답·검증·힌트·타이머 모두 서버)
//  - 1반/2반/3반 슬롯 기반 로비 + 도전 매칭 + 관전 미러링
// ════════════════════════════════════════════════════════════════

const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  pingInterval: 25000,
  pingTimeout: 20000,
});

app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_req, res) => res.send('ok'));

// ═══════════════════════════════════════════════
//  게임 로직 (클라이언트에서 옮겨온 것)
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
//  로비/세션 상태
//  - slots: 1반/2반/3반 = 'class1','class2','class3'
//  - 각 슬롯 상태: 'empty' | 'waiting' | 'in_match' | 'spectating'
// ═══════════════════════════════════════════════

const CLASS_IDS = ['class1', 'class2', 'class3'];
const CLASS_NAMES = { class1: '1반', class2: '2반', class3: '3반' };

const slots = {
  class1: { socketId: null, state: 'empty', practiceLevel: 0, matchId: null },
  class2: { socketId: null, state: 'empty', practiceLevel: 0, matchId: null },
  class3: { socketId: null, state: 'empty', practiceLevel: 0, matchId: null },
};

// 진행 중인 매치들. matchId -> Match
const matches = new Map();

// socketId -> classId 빠른 조회
const socketToClass = new Map();

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

class Match {
  constructor(classA, classB) {
    this.id = 'm_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    this.sides = {
      A: { classId: classA, socketId: slots[classA].socketId, state: newPlayerState(0), ready: false },
      B: { classId: classB, socketId: slots[classB].socketId, state: newPlayerState(0), ready: false },
    };
    this.spectators = new Set(); // socketId
    this.timerId = null;
    this.ended = false;
    this.endResolved = false; // 결과 후 양쪽 처리(관전/나가기) 모두 받았는지

    // 매치 phase: 'ready' | 'countdown' | 'playing' | 'ended'
    this.phase = 'ready';
    this.readyTimeoutId = null;   // 30초 타임아웃
    this.countdownIntervalId = null;
  }

  otherSide(side) { return side === 'A' ? 'B' : 'A'; }

  socketSide(socketId) {
    if (this.sides.A.socketId === socketId) return 'A';
    if (this.sides.B.socketId === socketId) return 'B';
    return null;
  }

  // 본인 시점 페이로드 (자기 secret은 안 보냄)
  selfPayload(side) {
    const me = this.sides[side].state;
    const op = this.sides[this.otherSide(side)].state;
    return {
      side,
      myClass: CLASS_NAMES[this.sides[side].classId],
      opClass: CLASS_NAMES[this.sides[this.otherSide(side)].classId],
      mine: this.publicSelf(me),
      opp: this.publicOpp(op),
      phase: this.phase,
      myReady: this.sides[side].ready,
      oppReady: this.sides[this.otherSide(side)].ready,
    };
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
    // 상대방 정보 - secret 제외, 입력 진행 상태는 포함
    return {
      level: p.level,
      slots: LEVELS[p.level].slots,
      current: p.current, // 실시간 입력 미러링
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

  // 관전자용 - 양쪽 모두 publicOpp 수준 (정답 모름)
  spectatorPayload() {
    return {
      aClass: CLASS_NAMES[this.sides.A.classId],
      bClass: CLASS_NAMES[this.sides.B.classId],
      a: this.publicOpp(this.sides.A.state),
      b: this.publicOpp(this.sides.B.state),
      phase: this.phase,
      aReady: this.sides.A.ready,
      bReady: this.sides.B.ready,
    };
  }

  // 양쪽 + 모든 관전자에게 상태 푸시
  broadcastState() {
    const aSocket = this.sides.A.socketId;
    const bSocket = this.sides.B.socketId;
    if (aSocket) io.to(aSocket).emit('match_state', this.selfPayload('A'));
    if (bSocket) io.to(bSocket).emit('match_state', this.selfPayload('B'));
    const specPayload = this.spectatorPayload();
    for (const sid of this.spectators) {
      io.to(sid).emit('spectate_state', specPayload);
    }
  }

  // 가벼운 라이브 입력 알림 (전체 state 보내지 않고 입력만)
  broadcastLiveInput(side) {
    const p = this.sides[side].state;
    const liveData = {
      side, // 'A' or 'B'
      current: p.current,
      activeIdx: p.activeIdx,
      lockedCells: p.lockedCells,
    };
    // 상대방에게: opp 입력으로
    const otherSocket = this.sides[this.otherSide(side)].socketId;
    if (otherSocket) io.to(otherSocket).emit('opp_live_input', liveData);
    // 관전자에게
    for (const sid of this.spectators) {
      io.to(sid).emit('spectate_live_input', liveData);
    }
  }

  // ── Ready phase: 양쪽 다 준비완료 누를 때까지 30초 대기 ──
  startReadyPhase() {
    this.phase = 'ready';
    // 30초 타임아웃
    this.readyTimeoutId = setTimeout(() => {
      if (this.phase === 'ready') {
        // 자동 취소
        this.cancelDueToReady();
      }
    }, 30000);
    this.broadcastState();
  }

  // 사용자 준비완료 토글 (한번 누르면 ready, 다시 누르면 해제)
  setReady(socketId, ready) {
    if (this.phase !== 'ready' || this.ended) return;
    const side = this.socketSide(socketId);
    if (!side) return;
    this.sides[side].ready = !!ready;
    this.broadcastState();
    // 양쪽 다 준비됐으면 카운트다운 시작
    if (this.sides.A.ready && this.sides.B.ready) {
      this.startCountdown();
    }
  }

  // ── Countdown phase: 3·2·1·GO! (4초) ──
  startCountdown() {
    if (this.phase !== 'ready') return;
    this.phase = 'countdown';
    if (this.readyTimeoutId) { clearTimeout(this.readyTimeoutId); this.readyTimeoutId = null; }

    const send = (label) => {
      const aSocket = this.sides.A.socketId;
      const bSocket = this.sides.B.socketId;
      const payload = { label };
      if (aSocket) io.to(aSocket).emit('countdown', payload);
      if (bSocket) io.to(bSocket).emit('countdown', payload);
      for (const sid of this.spectators) io.to(sid).emit('countdown', payload);
    };

    // 즉시 phase 변경 알림
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
        send(null); // 카운트다운 종료 신호
        this.broadcastState();
        this.startTimer();
      }
    }, 1000);
  }

  // ── 준비 단계 타임아웃으로 매치 자동 취소 ──
  cancelDueToReady() {
    if (this.ended) return;
    this.ended = true;
    this.phase = 'ended';
    if (this.readyTimeoutId) { clearTimeout(this.readyTimeoutId); this.readyTimeoutId = null; }
    if (this.countdownIntervalId) { clearInterval(this.countdownIntervalId); this.countdownIntervalId = null; }

    const aSocket = this.sides.A.socketId;
    const bSocket = this.sides.B.socketId;
    const payload = {
      reason: 'ready_timeout',
      msg: '30초 안에 양쪽이 준비되지 않아 매치가 취소되었어요.'
    };
    if (aSocket) io.to(aSocket).emit('match_cancelled', payload);
    if (bSocket) io.to(bSocket).emit('match_cancelled', payload);
    for (const sid of this.spectators) io.to(sid).emit('match_cancelled', payload);
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
      // 매초마다 가벼운 tick 알림
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
      for (const sid of this.spectators) io.to(sid).emit('match_tick', tickPayload);
      if (allEnded) this.finish();
    }, 1000);
  }

  handleSubmit(socketId, tokens) {
    const side = this.socketSide(socketId);
    if (!side) return;
    if (this.phase !== 'playing') return;
    const p = this.sides[side].state;
    if (this.ended || p.ended || p.won) return;

    const v = validate(tokens);
    if (!v.ok) {
      io.to(socketId).emit('submit_error', { msg: v.msg });
      return;
    }
    // current를 받은 tokens로 동기화 (서버가 권한 있는 사본으로)
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
      // 락 안된 칸은 비우기 (클라 동작과 동일)
      p.current = p.secret.map((v, i) => p.lockedCells[i] ? v : '');
      let firstUnlocked = p.lockedCells.findIndex(l => !l);
      if (firstUnlocked < 0) firstUnlocked = 0;
      p.activeIdx = firstUnlocked;
    }

    // 본인에게 결과 알림
    io.to(socketId).emit('submit_result', {
      hints, isWin, earned, levelUp,
      newLevel: p.level,
      remainSec: p.remainSec,
    });

    // 정답이면 잠시 후 새 문제
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
        // historyLog는 유지? -> 클라이언트와 동일하게 새 문제마다 리셋
        p.historyLog = [];
        this.broadcastState();
      }, 1100);
    }

    this.broadcastState();
  }

  handlePress(socketId, value) {
    const side = this.socketSide(socketId);
    if (!side) return;
    if (this.phase !== 'playing') return;
    const p = this.sides[side].state;
    if (this.ended || p.ended || p.won) return;
    if (p.activeIdx < 0 || p.activeIdx >= p.current.length) return;
    if (p.lockedCells[p.activeIdx]) return;
    p.current[p.activeIdx] = value;
    // 다음 unlocked로 이동
    let i = p.activeIdx + 1;
    while (i < p.current.length && p.lockedCells[i]) i++;
    if (i < p.current.length) p.activeIdx = i;
    // 가벼운 라이브 입력 브로드캐스트
    this.broadcastLiveInput(side);
    // 본인에게도 갱신 (자기 입력 확인용 - 가벼움)
    io.to(socketId).emit('self_live_input', {
      current: p.current, activeIdx: p.activeIdx, lockedCells: p.lockedCells,
    });
  }

  handleDel(socketId) {
    const side = this.socketSide(socketId);
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
    io.to(socketId).emit('self_live_input', {
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

    const result = {
      aScore, bScore, winner,
      aClass: CLASS_NAMES[this.sides.A.classId],
      bClass: CLASS_NAMES[this.sides.B.classId],
    };

    const aSocket = this.sides.A.socketId;
    const bSocket = this.sides.B.socketId;
    if (aSocket) io.to(aSocket).emit('match_end', { ...result, mySide: 'A' });
    if (bSocket) io.to(bSocket).emit('match_end', { ...result, mySide: 'B' });
    for (const sid of this.spectators) io.to(sid).emit('match_end', { ...result, spectator: true });
  }

  removePlayer(socketId) {
    // 한쪽 연결 끊김 → 매치 강제 종료
    if (this.ended) return;
    const side = this.socketSide(socketId);
    if (!side) return;
    this.sides[side].socketId = null;
    // 상대 자동 승
    const other = this.otherSide(side);
    const otherSocket = this.sides[other].socketId;
    this.ended = true;
    this.phase = 'ended';
    if (this.timerId) { clearInterval(this.timerId); this.timerId = null; }
    if (this.readyTimeoutId) { clearTimeout(this.readyTimeoutId); this.readyTimeoutId = null; }
    if (this.countdownIntervalId) { clearInterval(this.countdownIntervalId); this.countdownIntervalId = null; }
    if (otherSocket) io.to(otherSocket).emit('match_end', {
      aScore: this.sides.A.state.totalScore,
      bScore: this.sides.B.state.totalScore,
      winner: other,
      aClass: CLASS_NAMES[this.sides.A.classId],
      bClass: CLASS_NAMES[this.sides.B.classId],
      mySide: other,
      forfeit: true,
    });
    for (const sid of this.spectators) io.to(sid).emit('match_end', {
      aScore: this.sides.A.state.totalScore,
      bScore: this.sides.B.state.totalScore,
      winner: other,
      aClass: CLASS_NAMES[this.sides.A.classId],
      bClass: CLASS_NAMES[this.sides.B.classId],
      spectator: true,
      forfeit: true,
    });
  }
}

// ═══════════════════════════════════════════════
//  로비 헬퍼
// ═══════════════════════════════════════════════

function lobbyView() {
  return CLASS_IDS.map(cid => ({
    classId: cid,
    name: CLASS_NAMES[cid],
    state: slots[cid].state,
    matchId: slots[cid].matchId,
    practiceLevel: slots[cid].practiceLevel,
  }));
}

function broadcastLobby() {
  io.emit('lobby_update', lobbyView());
}

function freeSlot(classId) {
  slots[classId].socketId = null;
  slots[classId].state = 'empty';
  slots[classId].matchId = null;
  slots[classId].practiceLevel = 0;
}

// ═══════════════════════════════════════════════
//  소켓 이벤트
// ═══════════════════════════════════════════════

io.on('connection', (socket) => {
  console.log('[+]', socket.id);

  // 현재 로비 즉시 송신
  socket.emit('lobby_update', lobbyView());

  // ── 반 입장 (대기 시작) ──
  // payload: { classId: 'class1' | 'class2' | 'class3', practiceLevel: 0..3 }
  socket.on('enter_class', ({ classId, practiceLevel }) => {
    if (!CLASS_IDS.includes(classId)) {
      socket.emit('error_msg', { msg: '잘못된 반 선택' });
      return;
    }
    if (slots[classId].state !== 'empty') {
      socket.emit('error_msg', { msg: `${CLASS_NAMES[classId]}은 이미 사용 중이에요.` });
      return;
    }
    if (typeof practiceLevel !== 'number' || practiceLevel < 0 || practiceLevel > 3) {
      practiceLevel = 0;
    }
    slots[classId].socketId = socket.id;
    slots[classId].state = 'waiting';
    slots[classId].practiceLevel = practiceLevel;
    slots[classId].matchId = null;
    socketToClass.set(socket.id, classId);
    socket.emit('entered_class', {
      classId,
      name: CLASS_NAMES[classId],
      practiceLevel,
    });
    broadcastLobby();
  });

  // ── 도전! (waiting 상태인 다른 반에게) ──
  // payload: { targetClassId }
  // 결정: 즉시 매칭 시작 (수락 단계 없음)
  socket.on('challenge', ({ targetClassId }) => {
    const myClass = socketToClass.get(socket.id);
    if (!myClass) return socket.emit('error_msg', { msg: '먼저 반에 입장하세요.' });
    if (!CLASS_IDS.includes(targetClassId)) return;
    if (myClass === targetClassId) return socket.emit('error_msg', { msg: '자기 반에는 도전 못 해요.' });
    if (slots[myClass].state !== 'waiting') return socket.emit('error_msg', { msg: '연습 대기 중일 때만 도전 가능' });
    if (slots[targetClassId].state !== 'waiting') return socket.emit('error_msg', { msg: '상대 반이 대기 중이 아니에요.' });

    // 매치 생성 (도전한 쪽 = A, 받은 쪽 = B)
    const m = new Match(myClass, targetClassId);
    matches.set(m.id, m);
    slots[myClass].state = 'in_match';
    slots[myClass].matchId = m.id;
    slots[targetClassId].state = 'in_match';
    slots[targetClassId].matchId = m.id;

    // 양쪽에 매치 시작 알림
    const aSock = slots[myClass].socketId;
    const bSock = slots[targetClassId].socketId;
    if (aSock) io.to(aSock).emit('match_start', m.selfPayload('A'));
    if (bSock) io.to(bSock).emit('match_start', m.selfPayload('B'));

    m.broadcastState();
    m.startReadyPhase();
    broadcastLobby();
  });

  // ── 준비완료 토글 ──
  socket.on('set_ready', ({ ready }) => {
    const myClass = socketToClass.get(socket.id);
    if (!myClass) return;
    const matchId = slots[myClass].matchId;
    if (!matchId) return;
    const m = matches.get(matchId);
    if (!m) return;
    m.setReady(socket.id, ready);
  });

  // ── 관전 진입 ──
  // payload: { matchId }
  socket.on('spectate', ({ matchId }) => {
    const m = matches.get(matchId);
    if (!m || m.ended) return socket.emit('error_msg', { msg: '진행 중인 경기가 아니에요.' });
    // 본인이 어떤 반인지 - 관전 중인 동안은 슬롯 state를 spectating으로
    const myClass = socketToClass.get(socket.id);
    if (myClass) {
      slots[myClass].state = 'spectating';
      slots[myClass].matchId = matchId;
      broadcastLobby();
    }
    m.spectators.add(socket.id);
    socket.emit('spectate_start', {
      matchId,
      ...m.spectatorPayload(),
    });
  });

  // ── 관전 종료 (자발적) ──
  socket.on('leave_spectate', () => {
    const myClass = socketToClass.get(socket.id);
    if (!myClass) return;
    const matchId = slots[myClass].matchId;
    if (matchId) {
      const m = matches.get(matchId);
      if (m) m.spectators.delete(socket.id);
    }
    slots[myClass].state = 'waiting';
    slots[myClass].matchId = null;
    socket.emit('back_to_waiting', {
      classId: myClass,
      name: CLASS_NAMES[myClass],
      practiceLevel: slots[myClass].practiceLevel,
    });
    broadcastLobby();
  });

  // ── 매치 입력 ──
  socket.on('match_press', ({ value }) => {
    const myClass = socketToClass.get(socket.id);
    if (!myClass) return;
    const matchId = slots[myClass].matchId;
    if (!matchId) return;
    const m = matches.get(matchId);
    if (!m) return;
    m.handlePress(socket.id, value);
  });

  socket.on('match_del', () => {
    const myClass = socketToClass.get(socket.id);
    if (!myClass) return;
    const matchId = slots[myClass].matchId;
    if (!matchId) return;
    const m = matches.get(matchId);
    if (!m) return;
    m.handleDel(socket.id);
  });

  socket.on('match_submit', ({ tokens }) => {
    const myClass = socketToClass.get(socket.id);
    if (!myClass) return;
    const matchId = slots[myClass].matchId;
    if (!matchId) return;
    const m = matches.get(matchId);
    if (!m) return;
    m.handleSubmit(socket.id, tokens);
  });

  // ── 매치 종료 후 처리 ──
  // payload: { action: 'wait' | 'spectate' | 'leave' }
  //   wait     - 대기 화면 복귀 (승자가 다음 도전 기다림)
  //   spectate - (당장 관전할 매치는 없음, leave랑 같이 처리: 그냥 대기로 복귀)
  //              실제 다른 매치가 진행 중이면 그쪽 관전 입장은 별도 spectate 이벤트
  //   leave    - 메인 메뉴로 (반에서 나감)
  socket.on('post_match', ({ action }) => {
    const myClass = socketToClass.get(socket.id);
    if (!myClass) return;
    const matchId = slots[myClass].matchId;
    const m = matchId ? matches.get(matchId) : null;

    // 매치에서 본인 socketId 정리
    if (m) {
      // 관전자 목록에서도 빼기 (안전)
      m.spectators.delete(socket.id);
    }

    if (action === 'leave') {
      // 슬롯 비우기
      freeSlot(myClass);
      socketToClass.delete(socket.id);
      socket.emit('back_to_menu');
      broadcastLobby();
    } else {
      // 'wait' 또는 'spectate'(=후처리) 모두 일단 대기 화면 복귀
      slots[myClass].state = 'waiting';
      slots[myClass].matchId = null;
      // practiceLevel은 유지
      socket.emit('back_to_waiting', {
        classId: myClass,
        name: CLASS_NAMES[myClass],
        practiceLevel: slots[myClass].practiceLevel,
      });
      broadcastLobby();
    }

    // 양쪽 모두 처리 완료 + 매치 종료된 상태면 매치 정리
    if (m && m.ended) {
      const aGone = !m.sides.A.socketId || !slots[m.sides.A.classId] || slots[m.sides.A.classId].matchId !== m.id;
      const bGone = !m.sides.B.socketId || !slots[m.sides.B.classId] || slots[m.sides.B.classId].matchId !== m.id;
      const noSpec = m.spectators.size === 0;
      if (aGone && bGone && noSpec) {
        matches.delete(m.id);
      }
    }
  });

  // ── 연습 레벨 변경 (대기 중일 때) ──
  socket.on('set_practice_level', ({ level }) => {
    const myClass = socketToClass.get(socket.id);
    if (!myClass) return;
    if (slots[myClass].state !== 'waiting') return;
    if (typeof level === 'number' && level >= 0 && level <= 3) {
      slots[myClass].practiceLevel = level;
      broadcastLobby();
    }
  });

  // ── 메뉴로 나가기 (대기 중에서) ──
  socket.on('exit_class', () => {
    const myClass = socketToClass.get(socket.id);
    if (!myClass) return;
    // 매치 중이면 forfeit 처리
    if (slots[myClass].state === 'in_match') {
      const m = matches.get(slots[myClass].matchId);
      if (m) m.removePlayer(socket.id);
    }
    if (slots[myClass].state === 'spectating') {
      const m = matches.get(slots[myClass].matchId);
      if (m) m.spectators.delete(socket.id);
    }
    freeSlot(myClass);
    socketToClass.delete(socket.id);
    socket.emit('back_to_menu');
    broadcastLobby();
  });

  // ── 연결 끊김 ──
  socket.on('disconnect', () => {
    console.log('[-]', socket.id);
    const myClass = socketToClass.get(socket.id);
    if (myClass) {
      if (slots[myClass].state === 'in_match') {
        const m = matches.get(slots[myClass].matchId);
        if (m) m.removePlayer(socket.id);
      }
      if (slots[myClass].state === 'spectating') {
        const m = matches.get(slots[myClass].matchId);
        if (m) m.spectators.delete(socket.id);
      }
      freeSlot(myClass);
      socketToClass.delete(socket.id);
      broadcastLobby();
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`수널판 서버 listening on :${PORT}`);
});
