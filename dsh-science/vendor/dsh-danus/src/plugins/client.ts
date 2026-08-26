/**
 * plugins/client.ts — dsh-danus 包名的宿主锚点插件(host half)。
 *
 * DSH 的 client-modules 扫描器(见 @deepseek-ai/dsh-client-modules)按【加载器
 * 入口的 options.name 是否等于包名】来决定是否为某个包组合其 client half
 * (`dsh.client` manifest → `/plugins/<pkg>/client.js` 进浏览器图)。同包里的
 * 子路径入口(`dsh-danus/src/plugins/*.ts`)name 都不等于包名,光把 `dsh-danus`
 * 放进 dsh.profile.bundles 也是远远不够的——扫描器从不以包名为 key 触发
 * processOne。
 *
 * 因此这里提供一个 name 为「包名」的宿主入口,apply 不做任何宿主业务(它
 * 仅作为 client 锚点存在;真正的浏览器 UI 在 src/client,数据经 /danus/api/*
 * 由 console-api / observability 提供)。gateway 等业务插件仍以子路径单独挂载,
 * 互不重复加载。
 */
export const name = 'dsh-danus'

export function apply(): void {
  // 无宿主副作用:client-modules 只依据本入口的 options.name(== 包名)组合
  // client half;副作用全在浏览器端(dsh.client)与 /danus/api/* 宿主路由。
}
