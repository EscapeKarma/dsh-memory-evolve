/**
 * dsh-memory-evolve — atomic file writes.
 *
 * 巡检 B 组：多处「整表覆盖写」用的是 `writeFileSync(tmp)` + `renameSync`，
 * 但 tmp 名只带 pid——同一进程里两个并发写会撞名（一方 rename 后另一方再
 * rename 自己的 tmp 覆盖，或读到半截）。这里统一成 pid + 随机后缀，并在
 * rename 前 fsync（断电不会留下 0 字节文件）。
 *
 * 零运行时依赖。
 *
 * @module dsh-memory-evolve/atomic-write
 */
import { randomBytes } from 'node:crypto'
import { closeSync, fsyncSync, mkdirSync, openSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/**
 * A per-write unique temp path next to `path`.
 * @param {string} path - destination file path.
 * @returns {string} temp path (same directory, so rename stays atomic).
 */
export function tmpPathFor(path) {
  return `${path}.tmp.${process.pid}.${randomBytes(4).toString('hex')}`
}

/**
 * Write `data` to `path` atomically: unique temp file → fsync → rename.
 * @param {string} path - destination file path.
 * @param {string} data - file content.
 */
export function writeFileAtomic(path, data) {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = tmpPathFor(path)
  writeFileSync(tmp, data)
  // fsync 失败不阻断：网络盘/容器叠层可能不支持，降级为原行为。
  try {
    const fd = openSync(tmp, 'r+')
    try { fsyncSync(fd) } finally { closeSync(fd) }
  } catch {}
  renameSync(tmp, path)
}
