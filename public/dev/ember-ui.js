// Development controls; pack strings are escaped before insertion into this static markup.
import { t } from '../../shared/i18n.js';
const escapeText = (value) => String(value).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
export function translatePage() {
  document.title = t("通用战斗测试 · 卫戍协议");
  document.getElementById('controls').innerHTML = `
      <h1>${escapeText(t("通用战斗测试"))}</h1>
      <p>${escapeText(t("一名干员面对一只指定敌人，使用完整战斗模拟和真实模型。初始暂停，修改配置后自动重建。"))}</p>
      <fieldset><legend>${escapeText(t("干员与装备"))}</legend>
        <label>${escapeText(t("搜索中文名或 ID"))}<input id="operator-search" type="search" placeholder="${escapeText(t("例如：角峰 / char_1_02"))}"></label>
        <label>${escapeText(t("干员"))}<select id="operator"></select></label>
        <label hidden>${escapeText(t("棋子版本"))}<select id="operator-variant"></select></label>
        <label><input id="operator-elite" type="checkbox">${escapeText(t("精锐"))}</label>
        <label>${escapeText(t("技能"))}<select id="skill"></select></label>
        <label>${escapeText(t("模组"))}<select id="module"></select></label>
        <div class="row"><label>${escapeText(t("潜能"))}<select id="potential"><option>1</option><option>2</option><option>3</option><option>4</option><option>5</option><option selected>6</option></select></label>
          <label>${escapeText(t("练度"))}<select id="cultivate"><option selected>0</option><option>1</option><option>2</option><option>3</option></select></label></div>
        <small id="loadout-info"></small>
      </fieldset>
      <fieldset><legend>${escapeText(t("敌人与场景"))}</legend>
        <label>${escapeText(t("搜索名称、编号或能力"))}<input id="enemy-search" type="search" placeholder="${escapeText(t("例如：弩手 / enemy_"))}"></label>
        <div class="enemy-filters">
          <label>${escapeText(t("地位"))}<select id="enemy-filter-rank"></select></label>
          <label>${escapeText(t("行动方式"))}<select id="enemy-filter-motion"></select></label>
          <label>${escapeText(t("种类"))}<select id="enemy-filter-kind"></select></label>
          <label>${escapeText(t("攻击方式"))}<select id="enemy-filter-attack"></select></label>
          <label>${escapeText(t("伤害类型"))}<select id="enemy-filter-damage"></select></label>
        </div>
        <small id="enemy-filter-count" role="status"></small>
        <button id="enemy-filter-clear">${escapeText(t("清除筛选"))}</button>
        <label>${escapeText(t("敌人"))}<select id="enemy"></select></label>
        <label>${escapeText(t("地图"))}<select id="stage"></select></label>
        <p id="context"></p>
        <div class="row"><label>${escapeText(t("干员行"))}<input id="row" type="number" min="0" max="18"></label><label>${escapeText(t("列"))}<input id="col" type="number" min="0" max="20"></label></div>
        <label>${escapeText(t("朝向"))}<select id="dir"><option value="RIGHT">${escapeText(t("右"))}</option><option value="UP">${escapeText(t("上"))}</option><option value="LEFT">${escapeText(t("左"))}</option><option value="DOWN">${escapeText(t("下"))}</option></select></label>
        <div class="row"><label>${escapeText(t("出生行"))}<input id="start-row" type="number" min="0" max="18"></label><label>${escapeText(t("列"))}<input id="start-col" type="number" min="0" max="20"></label></div>
        <div class="row"><label>${escapeText(t("终点行"))}<input id="end-row" type="number" min="0" max="18"></label><label>${escapeText(t("列"))}<input id="end-col" type="number" min="0" max="20"></label></div>
        <label>${escapeText(t("途经点（行,列；用分号分隔）"))}<textarea id="checkpoints" rows="2" placeholder="9,8; 9,6"></textarea></label>
        <label><input id="template-route" type="checkbox">${escapeText(t("使用所选领袖/部件的真实模板路线（保留巡逻和传送；自定义路线输入停用）"))}</label>
        <label>${escapeText(t("固定随机种子"))}<input id="seed" type="number" min="1" max="4294967295" value="7"></label>
        <small>${escapeText(t("坐标以左下为原点。普通场部署行 9～12、列 2～10；领袖场部署行 2～5、列 2～10。地面路线自动寻路，飞行路线直线经过途经点。"))}</small>
      </fieldset>
      <label><input id="ally-auto" type="checkbox" checked>${escapeText(t("干员方普通自动攻击"))}</label>
      <label><input id="enemy-auto" type="checkbox" checked>${escapeText(t("敌人方普通自动攻击"))}</label>
      <small>${escapeText(t("关闭攻击仍保留阻挡、移动、技能和阶段计时。技能按游戏原有自动操作策略运行。"))}</small>
      <div class="buttons">
        <button id="restart" disabled>${escapeText(t("重来"))}</button><button id="pause" disabled>${escapeText(t("开始"))}</button><button id="step" disabled>${escapeText(t("前进 1 秒"))}</button>
        <button id="step-frame" disabled>${escapeText(t("前进 1 帧"))}</button><input id="frame-count" type="number" min="1" max="18000" value="30" aria-label="${escapeText(t("帧数"))}"><button id="step-n" disabled>${escapeText(t("前进 N 帧"))}</button>
      </div>
      <label>${escapeText(t("播放速度"))}<select id="speed"><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option><option value="4">4×</option></select></label>
      <fieldset><legend>${escapeText(t("测试操作：手动伤害"))}</legend>
        <label>${escapeText(t("目标"))}<select id="target"><option value="enemy">${escapeText(t("所选敌人"))}</option><option value="operator">${escapeText(t("干员"))}</option></select></label>
        <div class="row"><label>${escapeText(t("伤害数值"))}<input id="damage" type="number" min="0.01" step="any" value="1000"></label><label>${escapeText(t("类型"))}<select id="damage-type"><option value="true">${escapeText(t("真实"))}</option><option value="phys">${escapeText(t("物理"))}</option><option value="arts">${escapeText(t("法术"))}</option></select></label></div>
        <div class="buttons"><button id="knockout" disabled>${escapeText(t("强制造成致死生命流失"))}</button><button id="damage-apply" disabled>${escapeText(t("造成指定伤害"))}</button><button id="hit" disabled>${escapeText(t("频次目标攻击一次"))}</button></div>
        <small>${escapeText(t("手动伤害是测试注入，记录会标注“测试操作”。强制致死绕过防御与无敌，仍触发致死与复活规则；普通伤害保留减伤、护盾与单次限伤。"))}</small>
      </fieldset>
      <div class="buttons"><button id="withdraw" disabled>${escapeText(t("撤下干员"))}</button><button id="rebuild-view" disabled>${escapeText(t("重建当前视图"))}</button></div>
      <div id="state" role="status">${escapeText(t("加载中…"))}</div>
      <p id="models"></p>
      <fieldset><legend>${escapeText(t("场景 JSON 与重放"))}</legend>
        <textarea id="scene-json" rows="7" spellcheck="false" aria-label="${escapeText(t("场景 JSON"))}"></textarea>
        <label>${escapeText(t("导入文件"))}<input id="scene-file" type="file" accept=".json,application/json"></label>
        <div class="buttons"><button id="export" disabled>${escapeText(t("导出场景"))}</button><button id="download" disabled>${escapeText(t("下载 JSON"))}</button><button id="import" disabled>${escapeText(t("导入并重放"))}</button><button id="replay" disabled>${escapeText(t("重放当前操作"))}</button></div>
        <small>${escapeText(t("从初始配置重新模拟；tick 0 在初始部署和出生后，同帧操作按 sequence 顺序执行。版本不一致时提示，结果不保证相同。"))}</small>
        <p id="version-warning" role="status"></p>
      </fieldset>
      <label>${escapeText(t("日志筛选"))}<select id="log-filter"><option value="all">${escapeText(t("全部"))}</option><option value="operation">${escapeText(t("测试操作"))}</option><option value="phase">${escapeText(t("阶段"))}</option><option value="combat">${escapeText(t("战斗事件"))}</option><option value="error">${escapeText(t("错误"))}</option></select></label>
      <div class="buttons"><button id="copy-log">${escapeText(t("复制日志"))}</button></div>
      <small>${escapeText(t("日志最多保留 200 条；筛选和复制只处理当前保留的日志。"))}</small>
      <ol id="log"></ol>
      <p id="error" role="alert"></p>
    `;
}
