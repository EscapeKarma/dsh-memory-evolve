/**
 * tests/helpers/isolate-skills.js — 把测试里的插件装配隔离到临时技能库（issue #105）
 *
 * 缺陷：`apply(ctx, { memoryDir: dir })` 用默认配置时会调用
 * `syncBuiltinSkillsIfEnabled(config)`（`coiSyncSkills` 默认 true），把包内
 * `skills/` 的 5 个内置技能**真的复制进用户的 `~/.agents/skills`**。于是"跑一遍
 * 测试"= 往本机真实技能库里塞 4~5 个技能目录，还会顺带覆盖同名技能（用户自己
 * 改过的版本被 x-version 覆盖规则冲掉）。这是测试污染真实环境，不是产品缺陷。
 *
 * 修法：测试文件不再直接调 `apply()`，而是用本文件的 `makeIsolatedApply()`
 * 包一层，未显式指定 `skillDir` 时塞一个**每次调用都独立**的临时目录；显式
 * 指定 `skillDir` 的用例（例如 #58 的内置技能同步用例）原样透传，行为不变。
 *
 * 用法：
 *   const apply = makeIsolatedApply(applyReal)
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * 包一层插件 `apply()`：默认把 `skillDir` 指向临时目录。
 * @param {Function} applyReal - `lib/index.js` 导出的真实 apply。
 * @param {object} [options]
 * @param {boolean} [options.cleanupOnExit=true] - 进程退出时清理临时技能库。
 * @returns {Function} `(ctx, config?) => applyReal(ctx, configWithSkillDir)`
 */
export function makeIsolatedApply(applyReal, options = {}) {
  const root = mkdtempSync(join(tmpdir(), 'dsh-memory-test-skills-'))
  let seq = 0
  const apply = (ctx, config = {}) => {
    if (config && config.skillDir !== undefined && config.skillDir !== null) {
      return applyReal(ctx, config)
    }
    seq += 1
    return applyReal(ctx, { ...config, skillDir: join(root, `case-${seq}`) })
  }
  if (options.cleanupOnExit !== false) {
    const cleanup = () => {
      try { rmSync(root, { recursive: true, force: true }) } catch { /* 退出清理失败不报错 */ }
    }
    process.once('exit', cleanup)
  }
  // 供测试断言"技能确实装到了隔离目录里"（而不是装到真实技能库）
  apply.isolatedSkillRoot = root
  return apply
}
