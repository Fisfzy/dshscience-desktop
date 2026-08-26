/**
 * client/index.tsx — dsh-danus 浏览器端 half:Danus Console。
 *
 * 经 dsh-better-sidebar 的 ctx.betterSidebar.registerTab 注册为侧边栏
 * 页面(id `danus:console`);React 由 host 提供(external);组件内全部
 * 数据走同源 /danus/api/*(host half 路由,见 src/plugins/console-api.ts
 * 与 src/plugins/observability.ts)。
 */
import type { Context } from 'cordis'
import type { ReactNode } from 'react'
import { DanusConsole } from './DanusConsole'

/** ctx.betterSidebar 的最小结构类型(避免对 dsh-better-sidebar 的类型依赖)。 */
interface BetterSidebarLike {
  registerTab(descriptor: {
    id: string
    title: string
    single?: boolean
    component: (props: { scope: { sessionId: string } }) => ReactNode
  }): () => void
}

/** 必需依赖:betterSidebar 服务(dsh-better-sidebar 提供)。 */
export const inject = ['betterSidebar']

export function apply(ctx: Context): void {
  const betterSidebar = (ctx as unknown as { betterSidebar: BetterSidebarLike }).betterSidebar
  ctx.effect(
    () => betterSidebar.registerTab({
      id: 'danus:console',
      title: 'Danus',
      single: true,
      component: () => <DanusConsole />,
    }),
    'danus: console tab',
  )
}
