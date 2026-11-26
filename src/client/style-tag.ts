/**
 * 运行时注入 `<style>` 的归属标记。
 *
 * 背景（上游 issue #89）：`@deepseek-ai/dsh-client-modules` 的浏览器半侧用
 * `<style>` 上的 `data-plugin` 维护一张样式归属账本：
 *
 * - 物化一个插件 bundle 之后调用 `claimStyles(id)`，会把页面上**所有没有
 *   `data-plugin` 的 `<style>`** 认领到 `id` 名下；
 * - 该插件重载 / 图重组回收时 `removeOwnedStyles(id)` 会删掉归属 `id` 的标签。
 *
 * 所以运行时注入却不写归属，会双向受伤：自己的样式被后来物化的插件认领走
 * （那个插件一重载，这里的样式就没了 → 整页掉 CSS，且注入守卫认为"已注入"
 * 不再补），本插件物化时又会把别人的孤儿标签认领走、重载时连带删掉。
 *
 * 归属键必须等于**包名**（client 模块 specifier 去掉 `/client` 后缀后的
 * ownerId），因为账本用的 ownerId 就是它。Loader 条目 id 仍固定为
 * `dsh-memory-evolve`，改名不影响 profile 里的条目。
 */
export const STYLE_OWNER = '@escapekarma49/dsh-memory-evolve'

/**
 * 历史归属键。v0.7.0 把包名改成 scoped 之前，注入的标签写的是这个值；
 * 重新注入时顺手把它们改成新键（否则旧标签既不属于任何 ownerId，也不会被
 * 我们自己回收）。
 */
const LEGACY_OWNERS: readonly string[] = ['dsh-memory-evolve']

function ownedByUs(current: string | null): boolean {
  return current === STYLE_OWNER || (current !== null && LEGACY_OWNERS.includes(current))
}

/**
 * 给样式标签打上本插件的归属。
 *
 * 幂等：已经归属自己时不做任何事；归属别人（或旧键）时抢回来（修复历史上
 * 被误认领的遗留标签）。非 DOM 环境 / 桩对象上调用不会抛错。
 */
export function claimStyleOwnership(el: Element | null | undefined): void {
  if (el === null || el === undefined) return
  try {
    if (!ownedByUs(el.getAttribute('data-plugin'))) {
      el.setAttribute('data-plugin', STYLE_OWNER)
    }
  } catch {
    /* 测试桩 / 无 DOM 环境：忽略 */
  }
}
