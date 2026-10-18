// Scenario refusals in the console's own words. The server keeps short reason codes; this maps them.
import { t, N_ } from '../../../../shared/i18n.js';

const WHY = {
  unknown: N_('找不到这个单位或字段'),
  field: N_('这个字段不属于当前战场'),
  tile: N_('这个格子不能部署该单位'),
  occupied: N_('这个格子已被占用'),
  loadout: N_('技能、模组或自选配置不合法'),
  tier: N_('盟约阶数超出上限'),
  route: N_('这条路线不存在'),
  leader: N_('领袖与当前战场不符'),
  limit: N_('超过数量上限'),
  summon: N_('召唤物没有可用的所属干员'),
  range: N_('召唤物不在所属干员允许的位置'),
  unsupported: N_('当前沙盒不支持这个字段'),
  inactive: N_('官方波次下不能再填自定义敌人'),
  motion: N_('路线移动方式与敌人不符'),
  number: N_('数值不在允许范围内'),
  object: N_('这里必须是对象'),
  key: N_('字段名不合法'),
  array: N_('列表长度不合法'),
  value: N_('取值不在允许范围内'),
  id: N_('标识不合法'),
  boolean: N_('这里必须是是否'),
  size: N_('内容超过长度限制'),
  json: N_('不是合法的 JSON'),
  version: N_('场景版本不受支持'),
  empty: N_('至少要有一个阵地'),
  duplicate: N_('单位编号重复'),
  wave: N_('这个回合没有可用波次'),
};

/** @param {{ code?: string, path?: string, reason?: string, params?: { path?: string, reason?: string } }} e */
export function scenarioText(e) {
  const path = e?.params?.path || e?.path || '';
  const reason = String(e?.params?.reason || e?.reason || '');
  const why = Object.hasOwn(WHY, reason) ? t(WHY[reason]) : reason;
  return t('场景无效：{path}，{why}', { path, why });
}
