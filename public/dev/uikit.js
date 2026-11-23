
    import '/js/ui/compat.js';
    import { render } from '/vendor/preact.module.js';
    import { useState } from '/vendor/hooks.module.js';
    import {
      html, Button, Panel, MicroLabel, Chevrons, HexBadge, TierChip, BondDisc, SevenSeg, Countdown, Modal, confirmDialog,
      alertDialog, Tooltip, ProgressBar, Tabs, Spinner, AvatarFrame, PhaseBanner, PingPill, DifficultyTag, TextField,
      UiHosts, Icon, ICONS,
    } from '/js/ui/components.js';
    import { ToastHost, toast } from '/js/ui/toasts.js';
    import { data, useData, getBond } from '/js/data.js';
    import { DIFFICULTIES, EMOTE_THEMES, EMOTES } from '/shared/constants.js';
    import { EmoteWheel, EmoteBubble, EmoteArt } from '/js/ui/emotes.js';

    const SWATCHES = [
      ['bg-0', '#0c0f0e'], ['bg-1', '#141816'], ['bg-2', '#1e2421'], ['line', '#2f3a35'],
      ['mint-500', '#4ed8af'], ['mint-400', '#59f4ca'], ['mint-600', '#35d8b4'], ['mint-glow', '#17f9b7'],
      ['gold', '#ffc600'], ['amber', '#f6a329'], ['orange', '#e85a1a'], ['red', '#e73118'], ['abyss', '#ff0024'],
      ['premium', '#ff5454'], ['ice', '#9fd4ff'], ['text-lo', '#8a948f'],
    ];
    const BONDS = ['yanShip', 'sargonShip', 'victoriaShip', 'kjeragShip', 'preciShip', 'swiftShip', 'deputShip', 'investShip'];

    function Sec({ n, title, micro, children }) {
      return html`<section class="kit-sec">
        <h2><span class="num">${n}</span>${title}<${MicroLabel}>${micro}<//></h2>
        ${children}
      </section>`;
    }

    /** 13 · official emotes: wheel (pager per theme) → bubble beside the sender's avatar; bubbles per theme; catalog. */
    function EmoteDemo() {
      useData('local');
      const [open, setOpen] = useState(true);
      const [offline, setOffline] = useState(false);
      const [bubbles, setBubbles] = useState(() => ({ me: null, p2: { id: 'slug_autochess_battle_nice_work', seq: 1 } }));
      const [replay, setReplay] = useState(0);
      const say = (who, id) => setBubbles((b) => ({ ...b, [who]: { id, seq: Date.now() + Math.random(), at: Date.now() } }));
      const rows = [['me', '我'], ['p2', '2P']];
      return html`
        <div class="grid2">
          <div class="emo-stage" id="emo-stage">
            <div class="emo-team">
              ${rows.map(([who, t]) => html`<div class="emo-row" key=${who}><span class="pav">${t}</span>
                ${bubbles[who] ? html`<${EmoteBubble} key=${bubbles[who].seq} id=${bubbles[who].id} at=${bubbles[who].at} class="team__bubble" />` : null}</div>`)}
            </div>
            <${EmoteWheel} open=${open} onToggle=${setOpen} disabled=${offline} onSend=${(id) => say('me', id)} />
          </div>
          <div class="stack">
            <div class="row">
              <${Button} size="sm" onClick=${() => setOpen((o) => !o)}>${open ? '收起面板' : '展开面板'}<//>
              <${Button} size="sm" variant="amber" onClick=${() => say('p2', EMOTES[Math.floor(Math.random() * EMOTES.length)])}>队友发送表情<//>
              <${Button} size="sm" variant="ghost" onClick=${() => say('p2', 'not_an_emote')}>缺图回退<//>
              <${Button} size="sm" variant=${offline ? 'danger' : 'ghost'} onClick=${() => setOffline((v) => !v)}>${offline ? '已断线' : '断线'}<//>
            </div>
            <p class="t-lo" style="font-size:.14rem">左右滑动 / 拖动 / ← → / 点击圆点切换主题；发送后按钮冷却 1 秒；气泡 3 秒后淡出，新表情替换旧表情。</p>
            <div class="emo-bubbles" key=${replay}>
              ${EMOTE_THEMES.map((t) => html`<figure key=${t.themeId}><${EmoteBubble} id=${t.emotes[0].id} ttl=${600000} /><figcaption>${t.dir}</figcaption></figure>`)}
              <figure><${EmoteBubble} id="missing_art" ttl=${600000} /><figcaption>fallback</figcaption></figure>
            </div>
            <div class="row"><${Button} size="sm" icon="refresh" onClick=${() => setReplay((r) => r + 1)}>重播气泡<//></div>
          </div>
        </div>
        <div class="emo-cat" style="margin-top:.3rem">
          ${EMOTE_THEMES.map((t, ti) => [
            html`<h3 key=${`h${t.themeId}`}>${ti + 1}. ${t.name} <span class="t-lo">(${t.themeId})</span></h3>`,
            ...t.emotes.map((e) => html`<figure key=${e.id}><div class="cell"><${EmoteArt} id=${e.id} /></div><figcaption>${e.sortId} · ${e.picId}</figcaption></figure>`),
          ])}
        </div>`;
    }

    function Kit() {
      useData('assets', 'bonds');
      const assets = data.get('assets');
      const [tab, setTab] = useState('shop');
      const [modal, setModal] = useState(false);
      const [banner, setBanner] = useState(0);
      const [name, setName] = useState('凯尔希');
      const [code, setCode] = useState('');
      const [deadline] = useState(() => Date.now() + 25000);
      const [progress, setProgress] = useState(62);
      const bond = (id) => ({ id, name: getBond(id)?.name || id.replace('Ship', ''), icon: assets?.bonds?.[id] || null, minCount: getBond(id)?.thresholds?.[0] ?? 0 });

      return html`<div class="kit">
        <header class="kit-head">
          <div>
            <${MicroLabel} tone="mint">STRONGHOLD PROTOCOL // DESIGN SYSTEM<//>
            <h1>UI Kit · 卫戍协议<em>：盟约</em></h1>
          </div>
          <div class="row" style="margin:0">
            <${PingPill} ms=${38} /><${PingPill} ms=${120} /><${PingPill} ms=${260} /><${PingPill} online=${false} />
          </div>
        </header>

        <${Sec} n="01" title="色板" micro="PALETTE">
          <div class="row">${SWATCHES.map(([n, c]) => html`<div class="swatch" key=${n}><i style=${`background:${c}`}></i><b>${n}</b>${c}</div>`)}</div>
        <//>

        <${Sec} n="02" title="字体" micro="TYPOGRAPHY">
          <div class="grid2">
            <div class="type-demo">
              <span style="font-size:.56rem;font-weight:900">卫戍协议：盟约</span>
              <span style="font-size:.26rem;font-weight:700">休整期 · 调度中心 · 联防阶段</span>
              <span style="font-size:.18rem">正文 Noto Sans SC — 调配资金与干员，抵御多波次进攻。</span>
              <span class="t-lo" style="font-size:.15rem">次要文本 text-lo · 说明与提示</span>
            </div>
            <div class="type-demo">
              <span class="display" style="font-size:.34rem">STRONGHOLD PROTOCOL</span>
              <span class="num" style="font-size:.5rem;font-weight:700">0123456789 <span class="t-gold">+12</span></span>
              <${MicroLabel} tone="mint">RHODES ISLAND // SIMULATION SERVICE<//>
              <${MicroLabel}>COUNTDOWN · LEVEL · STAGE 04<//>
            </div>
          </div>
        <//>

        <${Sec} n="03" title="按钮" micro="BUTTON">
          ${['primary', 'secondary', 'amber', 'ice', 'danger', 'ghost'].map((v) => html`<div class="row" key=${v}>
            <span class="cap">${v}</span>
            <${Button} variant=${v} size="sm">小按钮<//>
            <${Button} variant=${v} icon="check">准备就绪<//>
            <${Button} variant=${v} size="lg" iconRight="chevrons">开始模拟<//>
            <${Button} variant=${v} square=${true} icon=${v === 'danger' ? 'exit' : v === 'ice' ? 'snow' : v === 'amber' ? 'refresh' : 'plus'} aria-label="icon" />
            <${Button} variant=${v} disabled=${true}>禁用<//>
            <${Button} variant=${v} loading=${true}>加载中<//>
          </div>`)}
          <div class="row"><span class="cap">xl / active / block</span>
            <${Button} variant="primary" size="xl" iconRight="chevrons">开始<//>
            <${Button} variant="secondary" active=${true} icon="check">已选定<//>
            <div style="width:3rem"><${Button} variant="amber" block=${true} icon="users">加入同盟<//></div>
          </div>
        <//>

        <${Sec} n="04" title="面板" micro="PANEL · BRACKET FRAME">
          <div class="grid3">
            <${Panel} title="调度中心" micro="SHOP · LEVEL 3" actions=${html`<${HexBadge} value=${5} size="sm" />`}>
              <p class="t-lo">带括号角框的面板，标题栏含微型技术标签与操作区。</p>
            <//>
            <${Panel} title="联防阶段" micro="UNITE" tone="orange"><p class="t-lo">tone = orange</p><//>
            <${Panel} title="模拟结束" micro="RESULT" tone="gold" glow=${true}><p class="t-lo">tone = gold, glow</p><//>
          </div>
        <//>

        <${Sec} n="05" title="徽记" micro="HEX BADGE · TIER CHIP · DIFFICULTY">
          <div class="row"><span class="cap">hex badge</span>
            <${HexBadge} value=${2} /><${HexBadge} value=${4} tone="discount" /><${HexBadge} value=${5} tone="premium" />
            <${HexBadge} value=${0} tone="mint" /><${HexBadge} value=${1} tone="amber" icon="refresh" /><${HexBadge} value=${'VI'} tone="dark" />
            <${HexBadge} value=${13} size="lg" icon="rook" tone="gold" /><${HexBadge} value=${3} size="sm" tone="ice" />
          </div>
          <div class="row"><span class="cap">tier chip</span>
            ${[1, 2, 3, 4, 5, 6].map((t) => html`<${TierChip} key=${t} tier=${t} />`)}
            ${[1, 3, 6].map((t) => html`<${TierChip} key=${`g${t}`} tier=${t} golden=${true} />`)}
            <${TierChip} tier=${2} size="sm" /><${TierChip} tier=${5} size="lg" /><${TierChip} tier=${6} size="lg" golden=${true} />
          </div>
          <div class="row"><span class="cap">difficulty</span>
            ${DIFFICULTIES.map((d) => html`<${DifficultyTag} key=${d} difficulty=${d} code=${`AC-${DIFFICULTIES.indexOf(d) + 1}`} />`)}
            <${DifficultyTag} difficulty="ABYSS" size="lg" />
          </div>
        <//>

        <${Sec} n="06" title="盟约" micro="BOND DISC">
          <div class="row">
            ${BONDS.map((id, i) => {
              const b = bond(id);
              return html`<${BondDisc} key=${id} name=${b.name} icon=${b.icon} layers=${[358, 155, 144, 34, 14, 10, 3, 0][i]}
                tier=${[3, 2, 2, 1, 1, 1, 0, 0][i]} active=${i < 6} disabled=${i === 7} minCount=${i < 6 ? b.minCount : 0} onClick=${() => toast(`${b.name}：查看盟约详情`)} />`;
            })}
          </div>
          <div class="row"><span class="cap">sizes · layers disabled · glyph fallback · member progress</span>
            <${BondDisc} name="炎" size="sm" layers=${4} tier=${1} active=${true} minCount=${bond('yanShip').minCount} />
            <${BondDisc} name="萨尔贡" size="lg" layers=${12} tier=${2} active=${true} icon=${bond('sargonShip').icon} minCount=${bond('sargonShip').minCount} />
            <${BondDisc} name="助力" layers=${34} tier=${1} active=${true} layersDisabled=${true} minCount=${bond('deputShip').minCount} />
            <${BondDisc} name="谢拉格" layers=${0} members=${1} minCount=${3} />
          </div>
        <//>

        <${Sec} n="07" title="倒计时" micro="SEVEN SEGMENT · COUNTDOWN">
          <div class="row row--top">
            <${Countdown} seconds=${59} total=${65} />
            <${Countdown} seconds=${8} total=${65} />
            <${Countdown} deadline=${deadline} total=${25} size="lg" />
            <${Countdown} seconds=${195} total=${195} size="sm" />
            <${Countdown} />
          </div>
          <div class="row">
            <${SevenSeg} text="12:45" size=".5rem" /><${SevenSeg} text="-99" tone="orange" size=".5rem" />
            <${SevenSeg} text="0123456789" tone="gold" size=".4rem" /><${SevenSeg} text="HELP" tone="ice" size=".4rem" />
            <${SevenSeg} text="Err" tone="red" size=".4rem" />
          </div>
        <//>

        <${Sec} n="08" title="横幅" micro="PHASE BANNER">
          <div class="stack">
            <${PhaseBanner} key=${`a${banner}`} title="休整期" micro="PHASE // PREP" sub="第 3 回合" />
            <${PhaseBanner} key=${`b${banner}`} title="联防阶段" micro="PHASE // UNITE" sub="层数叠加已禁用" tone="orange" />
            <${PhaseBanner} key=${`c${banner}`} title="最终攻势" micro="PHASE // FINAL ASSAULT" tone="red" />
          </div>
          <div class="row" style="margin-top:.2rem">
            <${Button} icon="refresh" onClick=${() => setBanner((b) => b + 1)}>重播动画<//>
            <${Button} variant="amber" onClick=${() => setBanner((b) => -(Math.abs(b) + 1))}>全屏横幅 (2.2s)<//>
            <${Chevrons} /><${Chevrons} tone="orange" count=${5} /><${Chevrons} tone="gold" dir="left" />
          </div>
          ${banner < 0 ? html`<${PhaseBanner} key=${`o${banner}`} mode="overlay" duration=${2200} title="机变阶段" micro="PHASE // SP DRAFT"
            sub="当前轮到你决策" tone="gold" onDone=${() => setBanner(0)} />` : null}
        <//>

        <${Sec} n="09" title="进度 · 标签页 · 加载" micro="PROGRESS · TABS · SPINNER">
          <div class="grid2">
            <div class="stack">
              <${ProgressBar} value=${progress} label="首领生命值" showValue=${true} tone="orange" />
              <${ProgressBar} value=${7} max=${9} segments=${9} label="已部署" showValue=${true} />
              <${ProgressBar} value=${35} tone="ice" size="sm" />
              <${ProgressBar} value=${90} tone="gold" size="lg" label="经验" />
              <div class="row"><${Button} size="sm" onClick=${() => setProgress((p) => (p + 17) % 101)}>改变进度<//></div>
            </div>
            <div class="stack">
              <${Tabs} value=${tab} onChange=${setTab} items=${[
                { id: 'shop', label: '调度中心' }, { id: 'bonds', label: '盟约', badge: 6 }, { id: 'enemy', label: '敌方情报' },
                { id: 'locked', label: '未解锁', disabled: true },
              ]} />
              <${Tabs} size="sm" value=${tab} onChange=${setTab} items=${[{ id: 'shop', label: '自己' }, { id: 'bonds', label: '队友' }]} />
              <div class="row"><${Spinner} size="sm" /><${Spinner} label="LOADING" /><${Spinner} size="lg" tone="gold" label="SYNCING" /></div>
            </div>
          </div>
        <//>

        <${Sec} n="10" title="头像框" micro="AVATAR FRAME">
          <div class="row">
            <${AvatarFrame} name="凯尔希" size="lg" host=${true} self=${true} ready=${true} />
            <${AvatarFrame} name="Doctor" size="lg" seat=${1} />
            <${AvatarFrame} name="AI·华法琳" size="lg" seat=${2} bot=${true} />
            <${AvatarFrame} name="阿米娅" size="lg" seat=${3} offline=${true} />
            <${AvatarFrame} size="lg" empty=${true} />
            <${AvatarFrame} name="W" size="md" seat=${2} dead=${true} />
            <${AvatarFrame} name="惊蛰" size="sm" seat=${1} self=${true} />
            <${AvatarFrame} name="艾雅法拉" size="xl" seat=${0} host=${true} />
          </div>
        <//>

        <${Sec} n="11" title="输入 · 提示 · 对话框" micro="FIELD · TOOLTIP · MODAL · TOAST">
          <div class="grid2">
            <div class="stack">
              <${TextField} label="博士代号" micro="CALLSIGN" icon="user" value=${name} onInput=${setName} maxLength=${12} />
              <${TextField} size="code" icon="key" value=${code} placeholder="输入同盟密钥" onInput=${(v) => setCode(v.toUpperCase().slice(0, 4))} />
              <${TextField} label="无效输入" value="!!" onInput=${() => {}} invalid=${true} hint="仅限字母与数字" />
            </div>
            <div class="stack">
              <div class="row">
                <${Tooltip} text="刷新调度中心（消耗 1 资金）"><${Button} variant="amber" icon="refresh">刷新<//><//>
                <${Tooltip} text=${'冻结后，调度中心在下一回合开始时保留\n快捷键 F'} placement="bottom"><${Button} variant="ice" icon="snow">冻结<//><//>
                <${Tooltip} text="只有房主可以操作"><${TierChip} tier=${4} /><//>
              </div>
              <div class="row">
                <${Button} onClick=${() => setModal(true)}>打开模态框<//>
                <${Button} variant="danger" onClick=${async () => toast((await confirmDialog({ title: '放弃模拟', text: '确定要离开吗？', danger: true, okText: '离开' })) ? '已确认' : '已取消')}>确认对话框<//>
                <${Button} variant="ghost" onClick=${() => alertDialog({ title: '提示', text: '同盟人数达标，准许进入模拟。' })}>提示对话框<//>
              </div>
              <div class="row">
                <${Button} size="sm" onClick=${() => toast('已复制同盟密钥 ABCD', 'success')}>成功<//>
                <${Button} size="sm" onClick=${() => toast('新的回合即将开始')}>信息<//>
                <${Button} size="sm" onClick=${() => toast('尚未连接到服务器，请稍候', 'warn')}>警告<//>
                <${Button} size="sm" onClick=${() => toast('资金不足', 'error')}>错误<//>
              </div>
            </div>
          </div>
          <${Modal} open=${modal} title="装备替换" micro="EQUIPMENT" onClose=${() => setModal(false)}
            actions=${html`<${Button} onClick=${() => setModal(false)}>取消<//><${Button} variant="primary" icon="check" onClick=${() => setModal(false)}>替换<//>`}>
            <p class="modal__text">该干员已装备 2 件装备。继续配发将<b class="t-orange">销毁</b>较早的装备，是否继续？</p>
          <//>
        <//>

        <${Sec} n="12" title="图标" micro="ICONS">
          <div class="row">${Object.keys(ICONS).map((n) => html`<${Tooltip} key=${n} text=${n}><span style="font-size:.3rem;color:var(--text-md)"><${Icon} name=${n} /></span><//>`)}</div>
        <//>

        <${Sec} n="13" title="表情" micro="EMOTES · 6 THEMES × 6 · PICTURE ONLY">
          <${EmoteDemo} />
        <//>
      </div>
      <${ToastHost} />
      <${UiHosts} />`;
    }
    render(html`<${Kit} />`, document.getElementById('kit'));
  