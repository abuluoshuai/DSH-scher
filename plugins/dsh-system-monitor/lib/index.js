/**
 * dsh-system-monitor — Host half.
 *
 * Mounts one sampler and one read-only route. The sampling happens in this
 * process on purpose: DSH can run on the user's machine or on a remote server,
 * and in both cases the browser must be shown the host the session actually
 * lives on, not the machine holding the window.
 *
 * The plugin has no dependencies, registers nothing in the agent's tool set,
 * and stops sampling the moment it is unloaded: the route is an effect on the
 * `webServer` context, so unloading removes it.
 *
 * @module dsh-system-monitor
 */

import { resolveConfig } from './config.js'
import { registerRoutes } from './routes.js'
import { createSampler } from './sampler.js'

/** Plugin id; equals the package name, the Loader row id and the dock entry id. */
export const name = 'dsh-system-monitor'

/** Must equal `package.json`'s version. */
export const VERSION = '0.1.0'

/**
 * Mount the plugin.
 *
 * @param {object} ctx - the Host context of this Loader row.
 * @param {unknown} rawConfig - the row's `config`.
 */
export function apply(ctx, rawConfig) {
  const { config, notes } = resolveConfig(rawConfig)
  const logger = ctx.logger
  for (const note of notes) logger?.warn?.(`dsh-system-monitor: ${note}`)

  const sampler = createSampler({ config, logger })

  ctx.inject(['webServer'], (webCtx) => {
    try {
      const dispose = registerRoutes(webCtx, sampler, { version: VERSION }, logger)
      logger?.info?.(`dsh-system-monitor v${VERSION}: 接口已挂在 ${'/api/system-monitor'}`)
      return () => {
        try {
          dispose?.()
        } catch {
          /* unloading must not throw */
        }
      }
    } catch (error) {
      logger?.error?.(`dsh-system-monitor: 接口注册失败：${error?.stack ?? error}`)
      return () => {}
    }
  })
}

export default { name, apply }
