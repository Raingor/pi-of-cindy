/**
 * 本机 Pi CLI 供应商(~/.pi/agent/models.json)接入 Cindy 目录时的 id 前缀约定。
 *
 * main 侧投影(piCliPanel.buildPiCliCatalogProviders)与 renderer 消费方
 * (ProvidersSection 的只读头、模型选择器分组)共用,两边必须对同一前缀判断。
 * 统一用连字符(不用冒号):它同时是 pi 运行时 slug(pi 不接受冒号)、
 * 会话持久化 providerId、停用 override 与可见性 key(`agent:pid:model`)的组成部分
 * —— 冒号在那些 key 里是分隔符,不能进 id。
 */
export const PI_CLI_PROVIDER_ID_PREFIX = 'pi-cli-';

export function isPiCliProviderId(providerId: string): boolean {
  return providerId.startsWith(PI_CLI_PROVIDER_ID_PREFIX);
}
