// D:\Stronghold-Protocol\cheat-tool.mjs
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { exec, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.dirname(__filename);
const PORT = 18888; 

// =========================================================
// 启动器阶段：原生隐身与防多开
// =========================================================
if (!process.argv.includes('--daemon')) {
  const req = http.get(`http://127.0.0.1:${PORT}/status`, (res) => {
    exec(`start http://127.0.0.1:${PORT}`);
    setTimeout(() => { process.exit(0); }, 500);
  }).on('error', () => {
    const child = spawn(process.execPath, [__filename, '--daemon'], {
      cwd: ROOT, detached: true, stdio: 'ignore', windowsHide: true
    });
    child.unref();
    process.exit(0);
  });
  req.setTimeout(500, () => req.destroy());
} 
// =========================================================
// 守护进程阶段 (V1.6)
// =========================================================
else {
  const PROTO_PATH = path.join(ROOT, 'shared', 'protocol.js');
  const INTENTS_PATH = path.join(ROOT, 'server', 'match', 'match', 'intents.js');
  const MARKER = '// [SP_CHEAT_MOD_V1.6]';

  const PROTO_ANCHOR = `'b.result': { battleId: isId, result: isBattleResult },`;
  const PROTO_INJECT = `'b.result': { battleId: isId, result: isBattleResult },
  ${MARKER}
  'g.cheat': {
    action: (v) => isStr(v, 32),
    val: (v) => v === undefined || isNum(v, -1e6, 1e6),
    $optional: ['val'],
  },`;

  const CLIENT_PANEL_CODE = `
${MARKER}
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  const pendingCheats = new Map();
  let matchPlayers = []; 
  let myTruePlayerId = null;
  let showShameMark = true; // 耻辱印记开关状态

  function updateAiButtons() {
    if (!matchPlayers || matchPlayers.length === 0 || !myTruePlayerId) return;
    const myPlayerInfo = matchPlayers.find(x => x.playerId === myTruePlayerId);
    if (!myPlayerInfo) return;
    const mySeat = myPlayerInfo.seat;

    for (let i = 0; i < 4; i++) {
      const btn = document.querySelector(\`button[data-act="takeover"][data-val="\${i}"]\`);
      if (!btn) continue;
      
      if (i === mySeat) {
        btn.style.opacity = '0.3'; btn.style.pointerEvents = 'none';
        btn.style.borderColor = '#3d4352'; btn.style.color = '#888';
        btn.textContent = \`P\${i+1} (本体)\`;
        continue;
      }

      const p = matchPlayers.find(x => x.seat === i);
      if (p) {
        const isAI = p.name && (p.name.includes('AI') || p.name.includes('bot'));
        if (p.proxiedBy) {
          btn.style.opacity = '0.4'; btn.style.pointerEvents = 'none';
          btn.style.borderColor = '#4cd964'; btn.style.color = '#4cd964';
          btn.textContent = \`[已同步]\`;
        } else if (isAI) {
          btn.style.opacity = '1'; btn.style.pointerEvents = 'auto';
          btn.style.borderColor = '#00e6ff'; btn.style.color = '#fff';
          btn.textContent = \`接管 P\${i+1} (AI)\`;
        } else {
          btn.style.opacity = '0.3'; btn.style.pointerEvents = 'none';
          btn.style.borderColor = '#3d4352'; btn.style.color = '#888';
          btn.textContent = \`P\${i+1} (玩家)\`;
        }
      } else {
        btn.style.opacity = '0.1'; btn.style.pointerEvents = 'none';
        btn.textContent = \`P\${i+1} (空)\`;
      }
    }
  }

  // 耻辱柱扫描器：加入开关状态判定
  setInterval(() => {
    document.querySelectorAll('.sp-shame-mark').forEach(el => el.remove());
    
    // 如果关闭了显示或没有数据，直接跳出不渲染
    if (!showShameMark || !matchPlayers || matchPlayers.length === 0) return;
    
    const cheaters = matchPlayers.filter(p => p.isCheater).map(p => p.name);
    if (cheaters.length === 0) return;

    const elements = Array.from(document.querySelectorAll('*')).filter(el => {
      return el.children.length === 0 && cheaters.includes(el.textContent.trim());
    });

    elements.forEach(el => {
      let card = el.parentElement;
      if (card && card.parentElement && card.parentElement.tagName === 'DIV') {
        card = card.parentElement; 
      }

      if (card && !card.querySelector('.sp-shame-mark')) {
        if (window.getComputedStyle(card).position === 'static') {
          card.style.position = 'relative';
        }
        const badge = document.createElement('div');
        badge.className = 'sp-shame-mark';
        badge.textContent = '区';
        badge.style.cssText = 'position:absolute; top:50%; left:24px; transform:translate(-50%, -50%); font-size:34px; color:#4cd964; font-weight:900; z-index:9999; pointer-events:none; text-shadow: 0 0 6px rgba(0,0,0,0.9), 0 0 12px #4cd964, 1px 1px 0px #fff; opacity:0.9; display:flex; align-items:center; justify-content:center; font-family:"Microsoft YaHei", "PingFang SC", sans-serif;';
        card.appendChild(badge);
      }
    });
  }, 1000);

  const origSend = WebSocket.prototype.send;
  WebSocket.prototype.send = function (data) {
    if (window.__spCheatWS !== this) {
      window.__spCheatWS = this;
      this.addEventListener('message', (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          
          if (msg.t === 'm.private' && msg.playerId) {
            if (!myTruePlayerId) myTruePlayerId = msg.playerId;
          }

          if (msg.t === 'm.public') { 
            if (msg.players) {
              matchPlayers = msg.players; 
              updateAiButtons();
            } else {
              matchPlayers = [];
              updateAiButtons();
            }
          }

          if (msg && msg.rid && pendingCheats.has(msg.rid)) {
            const label = pendingCheats.get(msg.rid);
            pendingCheats.delete(msg.rid);
            const statusEl = document.getElementById('sp-cheat-status');
            if (!statusEl) return;
            if (msg.t === 'ok') {
              statusEl.style.color = '#00e6ff'; statusEl.textContent = '[OK] ' + label;
            } else if (msg.t === 'error') {
              const errCode = msg.error || msg.code || 'ERR';
              const detail = msg.detail || (errCode === 'BAD_MSG' ? '未重启服务端' : '操作被拒');
              statusEl.style.color = '#ff3b30'; statusEl.textContent = '[' + errCode + '] ' + detail;
            }
          }
        } catch {}
      });
    }
    return origSend.apply(this, arguments);
  };

  let ridCounter = 999990;
  function sendCheat(action, val, label) {
    const statusEl = document.getElementById('sp-cheat-status');
    const ws = window.__spCheatWS;
    if (!ws || ws.readyState !== 1) {
      if (statusEl) { statusEl.style.color = '#ff9500'; statusEl.textContent = '[OFFLINE] 请先进对局'; }
      return;
    }
    const rid = ++ridCounter;
    pendingCheats.set(rid, label);
    if (statusEl) { statusEl.style.color = '#888'; statusEl.textContent = '[EXEC] ' + label + '...'; }
    ws.send(JSON.stringify({ t: 'g.cheat', rid, action, val }));
  }

  function mountCheatPanel() {
    if (document.getElementById('sp-cheat-panel')) return;
    const panel = document.createElement('div');
    panel.id = 'sp-cheat-panel';
    panel.style.cssText = [
      'position:fixed', 'top:16px', 'right:16px', 'z-index:999999',
      'background:rgba(18,20,24,0.96)', 'color:#eaeaea',
      'border:1px solid #3a3f4b', 'border-left:3px solid #00e6ff',
      'font-size:12px', 'font-family:"Bender", "Segoe UI", "PingFang SC", sans-serif',
      'box-shadow:0 6px 20px rgba(0,0,0,0.85)', 'user-select:none', 'width:230px',
      'box-sizing:border-box'
    ].join(';');

    panel.innerHTML = \`
      <div id="sp-cheat-header" style="display:flex;justify-content:space-between;align-items:center;cursor:move;background:#252933;padding:6px 10px;font-weight:600;letter-spacing:1px;border-bottom:1px solid #333;">
        <span style="color:#00e6ff;font-size:11px;">PRTS // TERMINAL V1.6</span>
        <span id="sp-cheat-toggle" style="cursor:pointer;color:#aaa;font-family:monospace;padding:0 4px;">[-]</span>
      </div>
      <div id="sp-cheat-body" style="padding:10px;">
        <div style="font-size:10px;color:#666;margin-bottom:4px;letter-spacing:1px;">TIMELINE // 节奏控制</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-bottom:4px;">
          <button data-act="prep_pause" data-val="1">暂停休整</button>
          <button data-act="prep_resume" data-val="1">继续休整</button>
        </div>
        <div style="display:grid;grid-template-columns:1fr;gap:4px;margin-bottom:8px;">
          <button data-act="force_ready" data-val="1" style="border-left:2px solid #00e6ff;">强制准备 (立即进战)</button>
          <button data-act="rush_combat" data-val="3" style="border-left:2px solid #ff3b30;">战斗倒计时 3 秒</button>
        </div>
        <div id="sp-ai-toggle" style="background:#151e26;color:#00e6ff;border:1px solid #005a66;padding:4px;text-align:center;font-size:11px;cursor:pointer;margin-bottom:4px;transition:0.2s;">
          [+] 精神同步 (接管 AI 队友)
        </div>
        <div id="sp-ai-content" style="display:none;padding-top:4px;border-top:1px dashed #333;margin-top:2px;margin-bottom:8px;">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-bottom:4px;">
            <button data-act="takeover" data-val="0" style="opacity:0.3;pointer-events:none;">检测中...</button>
            <button data-act="takeover" data-val="1" style="opacity:0.3;pointer-events:none;">检测中...</button>
            <button data-act="takeover" data-val="2" style="opacity:0.3;pointer-events:none;">检测中...</button>
            <button data-act="takeover" data-val="3" style="opacity:0.3;pointer-events:none;">检测中...</button>
          </div>
          <div style="display:grid;grid-template-columns:1fr;gap:4px;">
            <button data-act="takeover" data-val="-1" style="border-left:2px solid #4cd964;color:#4cd964;">解除接管 (返回本体)</button>
          </div>
        </div>
        <div id="sp-submenu-toggle" style="background:#1d2027;color:#8892a0;border:1px solid #2d3340;padding:4px;text-align:center;font-size:10px;cursor:pointer;margin-bottom:4px;transition:0.2s;">
          ▼ 展开资源修改选项 (作弊) ▼
        </div>
        <div id="sp-submenu-content" style="display:none;padding-top:4px;border-top:1px dashed #333;margin-top:2px;">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-bottom:4px;">
            <button data-act="funds" data-val="1">资金 +1</button>
            <button data-act="funds" data-val="5">资金 +5</button>
            <button data-act="lp" data-val="1">生命 +1</button>
            <button data-act="lp" data-val="5">生命 +5</button>
            <button data-act="refresh" data-val="1">刷新券 +1</button>
            <button data-act="cap" data-val="1">部署上限+1</button>
          </div>
        </div>
        <div id="sp-cheat-status" style="padding-top:6px;border-top:1px solid #282c35;font-size:10px;color:#666;font-family:monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
          STATUS: READY
        </div>
        
        <!-- 【更新】底部栏：耻辱印记开关 与 作者署名 -->
        <div style="display:flex; justify-content:space-between; align-items:center; margin-top:6px; padding-top:4px; border-top:1px dashed #282c35;">
           <span id="sp-shame-toggle" style="cursor:pointer; font-size:10px; color:#4cd964; font-family:monospace;">[★] 耻辱印记: ON</span>
           <span style="font-size:8px; color:#445059; font-family:monospace;">developed by Takethetrain</span>
        </div>
      </div>
    \`;

    panel.querySelectorAll('button').forEach((btn) => {
      btn.style.cssText += [
        'background:#2c303b', 'color:#ccc', 'border:1px solid #3d4352',
        'padding:5px 6px', 'cursor:pointer', 'font-size:11px',
        'text-align:center', 'transition:background 0.1s, color 0.1s'
      ].join(';');
      btn.onmouseenter = () => { btn.style.background = '#3b4150'; btn.style.color = '#fff'; };
      btn.onmouseleave = () => { btn.style.background = '#2c303b'; btn.style.color = '#ccc'; };
      btn.onclick = () => sendCheat(btn.dataset.act, Number(btn.dataset.val), btn.textContent.trim());
    });

    document.body.appendChild(panel);

    const body = document.getElementById('sp-cheat-body');
    const toggle = document.getElementById('sp-cheat-toggle');
    toggle.onclick = () => {
      const hidden = body.style.display === 'none';
      body.style.display = hidden ? 'block' : 'none';
      toggle.textContent = hidden ? '[-]' : '[+]';
    };

    const aiToggle = document.getElementById('sp-ai-toggle');
    const aiContent = document.getElementById('sp-ai-content');
    aiToggle.onclick = () => {
      const hidden = aiContent.style.display === 'none';
      aiContent.style.display = hidden ? 'block' : 'none';
      aiToggle.textContent = hidden ? '[-] 收起精神同步面板' : '[+] 精神同步 (接管 AI 队友)';
    };

    const subToggle = document.getElementById('sp-submenu-toggle');
    const subContent = document.getElementById('sp-submenu-content');
    subToggle.onclick = () => {
      const hidden = subContent.style.display === 'none';
      subContent.style.display = hidden ? 'block' : 'none';
      subToggle.textContent = hidden ? '▲ 收起资源修改选项 ▲' : '▼ 展开资源修改选项 (作弊) ▼';
      subToggle.style.color = hidden ? '#00e6ff' : '#8892a0';
    };

    // 绑定印记开关事件
    const shameToggleBtn = document.getElementById('sp-shame-toggle');
    if (shameToggleBtn) {
      shameToggleBtn.onclick = () => {
        showShameMark = !showShameMark;
        shameToggleBtn.textContent = showShameMark ? '[★] 耻辱印记: ON' : '[☆] 耻辱印记: OFF';
        shameToggleBtn.style.color = showShameMark ? '#4cd964' : '#555';
        if (!showShameMark) {
          document.querySelectorAll('.sp-shame-mark').forEach(el => el.remove());
        }
      };
    }

    const header = document.getElementById('sp-cheat-header');
    let dragging = false, ox = 0, oy = 0;
    header.onmousedown = (e) => {
      if (e.target === toggle) return;
      dragging = true; ox = e.clientX - panel.offsetLeft; oy = e.clientY - panel.offsetTop;
    };
    window.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      panel.style.right = 'auto';
      panel.style.left = \`\${Math.max(0, e.clientX - ox)}px\`;
      panel.style.top = \`\${Math.max(0, e.clientY - oy)}px\`;
    });
    window.addEventListener('mouseup', () => (dragging = false));
  }
  if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', mountCheatPanel);
  else mountCheatPanel();
}
`;

  const INTENTS_CASE_ANCHOR = `case 'b.result': return this._onResult(ps, msg);`;
  const INTENTS_CASE_INJECT = `case 'b.result': return this._onResult(ps, msg);
      ${MARKER}
      case 'g.cheat': return this.cheat(ps, msg);`;

  const INTENTS_METHOD_ANCHOR = `emote(ps, id) {`;
  const INTENTS_METHOD_INJECT = `${MARKER}
  cheat(ps, msg) {
    const val = Number.isFinite(msg.val) ? Math.trunc(msg.val) : 0;
    const now = this.sched.now();

    if (!this._proxyPatched) {
      this._proxyPatched = true;
      this._lastPhase = this.phase;

      this._origPublicView = this.publicView;
      this.publicView = function() {
        const v = this._origPublicView();
        if (v && Array.isArray(v.players)) {
          v.players.forEach(p => {
            const realP = this.players.get(p.playerId);
            if (realP && realP._proxiedBy) p.proxiedBy = realP._proxiedBy.playerId;
            if (realP && realP._isCheater) p.isCheater = true;
          });
        }
        return v;
      };

      this._origMarkPublic = this.markPublic;
      this.markPublic = function() {
        if (this.phase !== this._lastPhase) {
          this._lastPhase = this.phase;
          if (Array.isArray(this.order)) {
            for (const p of this.order) {
              if (p._proxyTo) {
                const ai = p._proxyTo;
                ai.isBot = true; ai.autoplay = false;
                delete ai._proxiedBy; delete p._proxyTo;
                p.autoplay = false;
                if (this.phase === 'PREP' && !ai.ready) {
                  if (typeof this.autoPickPersonalChoice === 'function') this.autoPickPersonalChoice(ai, 'random');
                  if (typeof ai.resolveTemp === 'function') ai.resolveTemp();
                  ai.setReady(true);
                }
                p.dirty(); ai.dirty();
                if (typeof this._sendPrivate === 'function') this._sendPrivate(p, true);
                const f = this.fields ? this.fields.find(x => x.players.includes(p.playerId)) : null;
                if (f && f.live && f.mode === 'client' && typeof this._sendStart === 'function') this._sendStart(p.playerId, f);
              }
            }
          }
        }
        return this._origMarkPublic();
      };

      this._origBroadcast = this.broadcast;
      this.broadcast = function(bMsg) {
        if (this.disposed) return;
        if (Array.isArray(this.order)) {
          for (const p of this.order) { if (p.connected && !p.left) this.sendTo(p.playerId, bMsg); }
        }
        if (this.spectators) {
          for (const s of this.spectators.values()) { if (s.connected && !s.left) this.sendTo(s.playerId, bMsg); }
        }
      };

      this._origSendTo = this.sendTo;
      this.sendTo = function(playerId, sendMsg) {
        const humanPs = this.order.find(p => p._proxyTo && p._proxyTo.playerId === playerId);
        if (humanPs) {
          const H = humanPs.playerId;
          const A = playerId;
          try {
            const safeA = JSON.stringify(A);
            const safeH = JSON.stringify(H);
            const strMsg = JSON.stringify(sendMsg);
            return this._origSendTo(H, JSON.parse(strMsg.split(safeA).join(safeH)));
          } catch(e) { return this._origSendTo(H, sendMsg); }
        }
        const targetPs = this.players.get(playerId);
        if (targetPs && targetPs._proxyTo) {
          if (sendMsg.t === 'm.private' || sendMsg.t === 'b.start' || sendMsg.t === 'b.end' || sendMsg.t === 'm.unitStats') return true; 
        }
        return this._origSendTo(playerId, sendMsg);
      };

      this._origHandle = this._handle;
      this._handle = function(senderPs, inMsg) {
        if (senderPs && senderPs._proxyTo && inMsg.t !== 'g.cheat') {
          const H = senderPs.playerId;
          const A = senderPs._proxyTo.playerId;
          if (inMsg.t === 'g.ready' && inMsg.ready !== undefined) senderPs.setReady(!!inMsg.ready);
          try {
            const safeH = JSON.stringify(H);
            const safeA = JSON.stringify(A);
            const strMsg = JSON.stringify(inMsg);
            return this._origHandle(senderPs._proxyTo, JSON.parse(strMsg.split(safeH).join(safeA)));
          } catch(e) { return this._origHandle(senderPs._proxyTo, inMsg); }
        }
        return this._origHandle(senderPs, inMsg);
      };

      this._origAuthorityFor = this._authorityFor;
      this._authorityFor = function(f, exclude) {
        let auth = this._origAuthorityFor(f, exclude);
        const authPs = this.players ? this.players.get(auth) : null;
        if (authPs && authPs._proxyTo) return null;
        return auth;
      };
    }

    let targetPs = ps;
    if (ps._proxyTo && msg.action !== 'takeover') targetPs = ps._proxyTo;

    switch (msg.action) {
      case 'takeover': {
        const allowedPhases = ['PREP', 'COMBAT', 'FINAL_ASSAULT', 'HIDDEN_CORE'];
        if (val !== -1 && !allowedPhases.includes(this.phase)) {
          return fail('WRONG_PHASE', '当前阶段不可用！请在「休整/排兵」或「战斗」阶段接管');
        }

        if (val === -1) {
          if (ps._proxyTo) {
            const ai = ps._proxyTo;
            ai.isBot = true; ai.autoplay = false;
            delete ai._proxiedBy; delete ps._proxyTo;
            ps.autoplay = false;

            if (this.phase === 'PREP' && !ai.ready) {
              if (typeof this.autoPickPersonalChoice === 'function') this.autoPickPersonalChoice(ai, 'random');
              if (typeof ai.resolveTemp === 'function') ai.resolveTemp();
              ai.setReady(true);
            }
            ps.dirty(); ai.dirty(); this.markPublic();
            if (typeof this._sendPrivate === 'function') this._sendPrivate(ps, true); else this.flush(true);

            const f = this.fields ? this.fields.find(x => x.players.includes(ps.playerId)) : null;
            if (f && f.live && f.mode === 'client' && typeof this._sendStart === 'function') this._sendStart(ps.playerId, f);
          }
          return OK;
        }

        const ai = this.order.find(p => p.seat === val);
        if (!ai) return fail('BAD_TARGET', '未找到该号位的玩家');
        if (ai === ps) return fail('BAD_TARGET', '不能接管自己');
        if (ai._proxiedBy && ai._proxiedBy !== ps) return fail('BAD_TARGET', '该AI已被其他人抢先接管');

        if (ps._proxyTo && ps._proxyTo !== ai) {
          const oldAi = ps._proxyTo;
          oldAi.isBot = true; oldAi.autoplay = false;
          delete oldAi._proxiedBy;
          if (this.phase === 'PREP' && !oldAi.ready) {
            if (typeof this.autoPickPersonalChoice === 'function') this.autoPickPersonalChoice(oldAi, 'random');
            if (typeof oldAi.resolveTemp === 'function') oldAi.resolveTemp();
            oldAi.setReady(true);
          }
        }

        ps._proxyTo = ai; ai._proxiedBy = ps; ps.autoplay = false;
        ai.isBot = false; ai.connected = true; ai.autoplay = false;
        
        if (this.phase === 'PREP' && ai.ready) {
          if (typeof ai.setReady === 'function') ai.setReady(false); else ai.ready = false;
        }
        if (ai.infoReady === false) {
          ai.infoReady = true;
          if (typeof this.maybeEndInfo === 'function') this.maybeEndInfo();
        }

        ps.dirty(); ai.dirty(); this.markPublic();
        if (typeof this._sendPrivate === 'function') this._sendPrivate(ai, true); else this.flush(true);

        const f = this.fields ? this.fields.find(x => x.players.includes(ai.playerId)) : null;
        if (f && f.live) {
          f.mode = 'client'; f.authority = ai.playerId;
          if (f.deadlineTimer) { this.cancel(f.deadlineTimer); f.deadlineTimer = null; }
          if (typeof this._sendStart === 'function') this._sendStart(ai.playerId, f);
        }
        break;
      }
      
      case 'funds': 
        targetPs._isCheater = true; 
        targetPs.addFunds(val, { reason: 'cheat' }); 
        this.markPublic(); 
        break;
      case 'lp':
        targetPs._isCheater = true;
        targetPs.lp = Math.max(1, (targetPs.lp || 0) + val);
        if (typeof this.teamLp === 'number') this.teamLp = Math.max(1, this.teamLp + val);
        targetPs.dirty(); this.markPublic(); 
        break;
      case 'refresh': 
        targetPs._isCheater = true; 
        targetPs.shop.freeRefreshes = Math.max(0, (targetPs.shop.freeRefreshes || 0) + val); 
        targetPs.dirty(); this.markPublic(); 
        break;
      case 'cap': 
        targetPs._isCheater = true; 
        targetPs.deployCapBonus = Math.max(0, (targetPs.deployCapBonus || 0) + val); 
        targetPs.dirty(); this.markPublic(); 
        break;

      case 'force_ready': {
        if (this.phase === 'INFO_CHECK') {
          for (const p of this.alivePlayers()) p.infoReady = true;
          this.markPublic(); this.maybeEndInfo(); return OK;
        }
        if (this.phase !== 'PREP') return fail('WRONG_PHASE', '当前不在休整阶段');
        this._prepPaused = false; this._prepRemainingMs = 0; this.prepDeadline(); break;
      }
      case 'prep_pause': {
        if (this.phase !== 'PREP') return fail('WRONG_PHASE', '当前不在休整阶段');
        if (this._prepPaused) return OK;
        const remain = this.deadline > now ? (this.deadline - now) : 30000;
        this._prepPaused = true; this._prepRemainingMs = Math.max(1000, remain);
        this.setDeadline(0); this.markPublic(); break;
      }
      case 'prep_resume': {
        if (this.phase !== 'PREP') return fail('WRONG_PHASE', '当前不在休整阶段');
        if (!this._prepPaused) {
          if (!this.deadline) { this.setDeadline(30, () => this.prepDeadline()); this.markPublic(); }
          return OK;
        }
        this._prepPaused = false;
        const secs = Math.max(1, Math.round((this._prepRemainingMs || 30000) / 1000));
        this.setDeadline(secs, () => this.prepDeadline()); this.markPublic(); break;
      }
      case 'rush_combat': {
        const isBattle = this.phase === 'COMBAT' || this.phase === 'FINAL_ASSAULT' || this.phase === 'HIDDEN_CORE';
        if (!isBattle) return fail('WRONG_PHASE', '当前不在主战斗阶段，无法收尾');

        this.deadline = now + 3000;
        if (this.overtimeAt && this.overtimeAt > now + 3000) this.overtimeAt = now + 3000;
        if (Array.isArray(this.fields)) {
          for (const f of this.fields) {
            if (!f || f.done || f.kind === 'unite') continue;
            if (f.deadlineTimer) { this.cancel(f.deadlineTimer); f.deadlineTimer = null; }
            if (f.doneTimer) { this.cancel(f.doneTimer); f.doneTimer = null; }
          }
        }
        this.markPublic();

        this.cancel(this._rushCombatTimer);
        this._rushCombatTimer = this.later(3000, () => {
          this._rushCombatTimer = null;
          if (this.phase === 'FINAL_ASSAULT' || this.phase === 'HIDDEN_CORE') {
            if (typeof this._endFinal === 'function') return this._endFinal('timeout');
          }
          if (this.phase !== 'COMBAT') return;

          if (Array.isArray(this.fields)) {
            for (const f of this.fields) {
              if (!f || f.done || f.kind === 'unite') continue;
              if (!f.result && f.mode === 'client' && typeof this._runOnServer === 'function') this._runOnServer(f, 'timeout');
              if (f.job && typeof f.job.run === 'function') {
                try {
                  f.job.run(Infinity);
                  const run = f.job.output();
                  f.battle = run.battle; f.result = run.result; f.resultSource = 'server';
                  f.timeline = run.timeline; f.endGt = Number(run.battle.time) || 0;
                } catch {}
                f.job = null;
              }
              this.broadcast({ t: 'b.end', battleId: f.battleId, fieldId: f.fieldId, reason: 'forced' });
              if (typeof this._fieldDone === 'function') this._fieldDone(f);
            }
          }
        });
        break;
      }
      default: return fail('BAD_MSG', '未知指令');
    }
    return OK;
  }

  emote(ps, id) {`;

  function checkStatus() {
    const protoExists = fs.existsSync(PROTO_PATH);
    const intentsExists = fs.existsSync(INTENTS_PATH);
    if (!protoExists || !intentsExists) return { ok: false, installed: false, msg: '未找到目标文件' };
    const protoContent = fs.readFileSync(PROTO_PATH, 'utf8');
    const intentsContent = fs.readFileSync(INTENTS_PATH, 'utf8');
    return { ok: true, installed: protoContent.includes(MARKER) && intentsContent.includes(MARKER) };
  }

  function runGameServer() {
    const gameBat = path.join(ROOT, 'scripts', 'start-windows.bat');
    if (!fs.existsSync(gameBat)) return { ok: false, msg: '找不到 scripts/start-windows.bat！' };
    const child = spawn('cmd.exe', ['/c', 'start', '""', gameBat], {
      cwd: path.join(ROOT, 'scripts'), detached: true, stdio: 'ignore'
    });
    child.unref();
    return { ok: true, msg: '游戏服务端已拉起！' };
  }

  async function installPatch() {
    if (fs.existsSync(PROTO_PATH + '.bak')) fs.copyFileSync(PROTO_PATH + '.bak', PROTO_PATH);
    if (fs.existsSync(INTENTS_PATH + '.bak')) fs.copyFileSync(INTENTS_PATH + '.bak', INTENTS_PATH);
    const protoContent = fs.readFileSync(PROTO_PATH, 'utf8');
    const intentsContent = fs.readFileSync(INTENTS_PATH, 'utf8');
    if (!fs.existsSync(PROTO_PATH + '.bak')) fs.writeFileSync(PROTO_PATH + '.bak', protoContent, 'utf8');
    if (!fs.existsSync(INTENTS_PATH + '.bak')) fs.writeFileSync(INTENTS_PATH + '.bak', intentsContent, 'utf8');

    const newProto = protoContent.replace(PROTO_ANCHOR, PROTO_INJECT) + '\n' + CLIENT_PANEL_CODE;
    const newIntents = intentsContent.replace(INTENTS_CASE_ANCHOR, INTENTS_CASE_INJECT).replace(INTENTS_METHOD_ANCHOR, INTENTS_METHOD_INJECT);
    fs.writeFileSync(PROTO_PATH, newProto, 'utf8');
    fs.writeFileSync(INTENTS_PATH, newIntents, 'utf8');
    return { ok: true, msg: `V1.6 补丁应用成功！请重启游戏服务端生效。` };
  }

  async function uninstallPatch() {
    if (fs.existsSync(PROTO_PATH + '.bak')) { fs.copyFileSync(PROTO_PATH + '.bak', PROTO_PATH); fs.unlinkSync(PROTO_PATH + '.bak'); }
    if (fs.existsSync(INTENTS_PATH + '.bak')) { fs.copyFileSync(INTENTS_PATH + '.bak', INTENTS_PATH); fs.unlinkSync(INTENTS_PATH + '.bak'); }
    return { ok: true, msg: `已还原原版！` };
  }

  const HTML_PAGE = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>PRTS 终端控制中心 V1.6</title><style>body{background:#0e1014;color:#cfd4dc;font-family:"Segoe UI",sans-serif;display:flex;justify-content:center;padding-top:50px;margin:0}.card{background:#161920;border:1px solid #282d37;border-left:4px solid #00e6ff;width:560px;padding:24px;box-shadow:0 10px 30px rgba(0,0,0,0.7)}h2{margin:0 0 4px 0;color:#fff;font-size:18px;letter-spacing:1px}.subtitle{font-size:11px;color:#667085;margin-bottom:20px;font-family:monospace}.status-box{background:#111318;border:1px solid #222630;padding:14px;margin-bottom:18px;line-height:1.8;font-size:13px}.badge-ok{color:#00e6ff;font-weight:bold}.badge-no{color:#8892a0;font-weight:bold}.btns{display:flex;gap:10px;margin-bottom:12px}button{flex:1;padding:12px;font-size:13px;font-weight:600;border:1px solid transparent;cursor:pointer;transition:0.15s}.btn-install{background:#00e6ff;color:#0c0e12}.btn-restore{background:#222631;color:#abb5c4;border-color:#313746}.btn-run{background:#4cd964;color:#0c0e12}.btn-run:hover{background:#5df277}#log{padding:12px;background:#0c0e12;font-size:12px;font-family:monospace;min-height:20px;border:1px solid #1f232b;color:#8892a0}</style></head><body><div class="card"><h2>PRTS // 调度器协议增强补丁 V1.6</h2><div class="subtitle">RHODES ISLAND TERMINAL PROTOCOL MODIFIER</div><div class="status-box" id="status-box">正在读取核心状态...</div><div class="btns"><button class="btn-install" onclick="act('/install')">应用补丁</button><button class="btn-restore" onclick="act('/uninstall')">还原原版</button></div><div class="btns" style="margin-bottom:16px;"><button class="btn-run" onclick="act('/run-game')">▶ 一键拉起游戏 (调用 start-windows.bat)</button></div><div id="log">READY // 控制终端已就绪</div><div style="text-align:right; font-size:11px; color:#445059; font-family:monospace; margin-top:12px;">developed by Takethetrain</div></div><script>async function load(){const r=await fetch('/status').then(x=>x.json());document.getElementById('status-box').innerHTML='<div>[TARGET] 协议层与控制台: <span class="badge-ok">已定位</span></div><div>[STATUS] 补丁当前状态: <span class="'+(r.installed?'badge-ok':'badge-no')+'">'+(r.installed?'ACTIVE (已激活)':'未激活')+'</span></div>';}async function act(u){document.getElementById('log').textContent='执行中...';const r=await fetch(u,{method:'POST'}).then(x=>x.json());document.getElementById('log').style.color=r.ok?'#00e6ff':'#ff3b30';document.getElementById('log').textContent=r.msg;load();}load();</script></body></html>`;

  const server = http.createServer(async (req, res) => {
    if (req.url === '/status') return res.end(JSON.stringify(checkStatus()));
    if (req.url === '/install' && req.method === 'POST') return res.end(JSON.stringify(await installPatch()));
    if (req.url === '/uninstall' && req.method === 'POST') return res.end(JSON.stringify(await uninstallPatch()));
    if (req.url === '/run-game' && req.method === 'POST') return res.end(JSON.stringify(runGameServer()));
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(HTML_PAGE);
  });
  server.on('error', (e) => {}); 
  server.listen(PORT, '127.0.0.1', () => { exec(`start http://127.0.0.1:${PORT}`); });
}