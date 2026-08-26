/**
 * Focus view plugin, browser half: one condensed conversation surface in the
 * view ring — every run of Tool calls folds into an expandable step-summary
 * line ("思考了 36 秒，运行了 2 个命令，探索了 17 个文件，18 个目录"), and
 * reasoning rows expand while running and fold in on completion. Pure-consumer
 * plugin: registers the 'focus' tab into the conversation view slot, provides
 * no service, declares no Context merge.
 */
import type { Context } from 'cordis';
import { type FocusKey } from './locales.ts';
export type { FocusKey } from './locales.ts';
export type { FocusScrollPosition, FocusViewInjected, FocusViewProps } from './FocusView.tsx';
declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface LocaleNamespaceMap {
        /** The focus view's copy. */
        focus: FocusKey;
    }
}
/** Required services: the conversation view slot, the locale registry, sessions, and the host opener. */
export declare const inject: string[];
/**
 * Client plugin body: register the focus view tab.
 * The registration rides the slot service's effect wrapper, so plugin unload
 * removes the tab.
 * @param ctx - client root context.
 */
export declare function apply(ctx: Context): void;
