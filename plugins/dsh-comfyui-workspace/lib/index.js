/**
 * dsh-comfyui-workspace — Host half.
 *
 * Wires four things and nothing else:
 *
 *   store    the plugin's own JSON (settings / workflows / archive) under $DSH_HOME
 *   app      the operations the panel and the agent tools both call
 *   routes   `api/comfyui-workspace/*` for the browser panel
 *   tools    the agent's comfy_workspace_* surface
 *
 * No `@deepseek-ai/*` import: the routes use the plain `webServer.register`
 * contract, the tools use raw JSON Schema, and every optional service is read
 * with `ctx.inject`/`ctx.get`, so this plugin keeps mounting in a lean profile
 * that has no credential store, no tools, or no prompt registry.
 *
 * @module dsh-comfyui-workspace
 */

import { createApp } from './app.js'
import { PLUGIN_ID, resolveConfig } from './config.js'
import { registerRoutes } from './routes.js'
import { createStore, resolveHome } from './store.js'
import { createTools, GUIDANCE, selectTools } from './tools.js'

/** Must equal `package.json`'s version. */
export const VERSION = '0.7.0'

/** Plugin id; also the Loader row id and the Client panel id. */
export const name = PLUGIN_ID

/** Where the guidance sits among the other prompt sections. */
const GUIDANCE_ORDER = 3050

/**
 * Mount the plugin.
 *
 * @param {object} ctx - the Host context of this Loader row.
 * @param {unknown} rawConfig - the row's `config`.
 */
export async function apply(ctx, rawConfig) {
  const { config, notes } = resolveConfig(rawConfig)
  const logger = ctx.logger
  for (const note of notes) logger?.warn?.(`dsh-comfyui-workspace: ${note}`)

  const store = createStore({
    dir: resolveHome(config),
    archiveLimit: config.archiveLimit,
    logger,
  })
  const app = createApp({
    store,
    config,
    logger,
    credentials: ctx.get?.('credentials') ?? null,
  })

  // A first-run failure must not take the mount down: without its directory the
  // panel still opens and says what is wrong, which beats a plugin that does not
  // appear at all.
  try {
    await store.ensure()
    await app.init()
  } catch (error) {
    logger?.error?.(`dsh-comfyui-workspace: 初始化失败：${error?.stack ?? error}`)
  }

  ctx.inject(['webServer'], (webCtx) => {
    let dispose = null
    try {
      dispose = registerRoutes(webCtx, app, logger)
      logger?.info?.(`dsh-comfyui-workspace: 面板接口已挂在 /api/comfyui-workspace（${store.dir}）`)
    } catch (error) {
      logger?.error?.(`dsh-comfyui-workspace: 面板接口注册失败：${error?.stack ?? error}`)
    }
    return () => {
      try {
        dispose?.()
      } catch {
        /* unloading must not throw */
      }
    }
  })

  const toolMode = config.toolGroups
  if (toolMode !== 'none') {
    const definitions = selectTools(createTools(app), toolMode)
    if (definitions.length > 0) {
      ctx.inject(['tools'], (toolCtx) => {
        const disposers = []
        for (const definition of definitions) {
          try {
            disposers.push(toolCtx.tools.register(definition))
          } catch (error) {
            logger?.warn?.(`dsh-comfyui-workspace: 工具 ${definition.name} 注册失败：${error?.message ?? error}`)
          }
        }
        return () => {
          for (const dispose of disposers) {
            try {
              dispose?.()
            } catch {
              /* unloading must not throw */
            }
          }
        }
      })
    }
  }

  if (config.guidance === true && toolMode !== 'none') {
    ctx.inject(['systemPrompt'], (promptCtx) => {
      try {
        return promptCtx.systemPrompt.section({
          name: 'dsh-comfyui-workspace:guidance',
          order: GUIDANCE_ORDER,
          text: GUIDANCE,
        })
      } catch (error) {
        logger?.warn?.(`dsh-comfyui-workspace: 用法指引注册失败：${error?.message ?? error}`)
        return () => {}
      }
    })
  }

  // A run that is mid-flight when the plugin unloads has no one following it;
  // stop it rather than leaving a render burning the GPU unattended.
  ctx.effect(() => () => {
    void app.stop?.().catch?.(() => undefined)
  }, 'dsh-comfyui-workspace: stop the active run on unload')

  logger?.info?.(`dsh-comfyui-workspace v${VERSION} 已挂载（toolGroups=${toolMode}，存档 ${store.dir}）`)
}

export default { name, apply }
