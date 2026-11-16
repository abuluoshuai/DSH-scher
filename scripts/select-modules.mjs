#!/usr/bin/env node
/**
 * Scher 模块选择器 — 让「在 GitHub 上自主安装 Scher」时能逐一询问用户。
 *
 * DSH 的 bundle 安装本身是一次性的：装上 dsh-scher 就会挂载全部 9 行。要做成
 * 「按需选择」，做法是安装时先 `enabled: false`（只落依赖、不挂载），逐条问完用户
 * 之后把未选中的行以 `disabled: true` 写进 profile 的 cordis.patch.yml，再启用
 * bundle。本脚本负责最后一步：读取 modules.json 的目录与依赖说明，校验选择，
 * 并维护 profile 里那段「由本脚本管理」的覆盖块。
 *
 * 用法：
 *   node scripts/select-modules.mjs list    [--json]
 *   node scripts/select-modules.mjs status  [--profile-dir <dir>] [--json]
 *   node scripts/select-modules.mjs apply   --modules a,b,c|all|none
 *                                          [--profile-dir <dir>] [--dry-run] [--no-backup] [--json]
 *
 * profile 目录的解析顺序：--profile-dir > $DSH_PROFILE_DIR > `~/.dsh/profiles/<--profile>` >
 * `~/.dsh/profiles/desktop`。脚本不执行 pnpm，也不改 package.json，只在 profile 的
 * `cordis.patch.yml` 里维护一段带标记的覆盖，因此用户可以手改其它内容。
 */

import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const CATALOG_PATH = join(ROOT, 'modules.json')
const REPO_PATCH_PATH = join(ROOT, 'cordis.patch.yml')

/** Markers of the profile block this script owns. */
const BEGIN = '# >>> dsh-scher module selection — managed by scripts/select-modules.mjs >>>'
const END = '# <<< dsh-scher module selection <<<'

/** Load and validate the module catalog; exits on a broken file. */
function loadCatalog() {
  const catalog = JSON.parse(readFileSync(CATALOG_PATH, 'utf8'))
  if (!Array.isArray(catalog.modules) || catalog.modules.length === 0) {
    fail('modules.json has no modules array')
  }
  const ids = new Set()
  for (const module of catalog.modules) {
    for (const key of ['id', 'row', 'package', 'title', 'summary']) {
      if (module[key] === undefined) fail(`modules.json: module ${module.id ?? '?'} misses "${key}"`)
    }
    if (ids.has(module.id)) fail(`modules.json: duplicate module id ${module.id}`)
    ids.add(module.id)
  }
  for (const module of catalog.modules) {
    for (const [kind, list] of [
      ['requires', module.requires ?? []],
      ['recommends', module.recommends ?? []],
    ]) {
      for (const target of list) {
        if (!ids.has(target)) fail(`modules.json: ${module.id}.${kind} names unknown module ${target}`)
      }
    }
  }
  return catalog
}

/** Row ids declared by the repository's own bundle patch. */
function repoRowIds() {
  const text = readFileSync(REPO_PATCH_PATH, 'utf8')
  return new Set([...text.matchAll(/^\s*-\s*id:\s*([A-Za-z0-9._-]+)\s*$/gm)].map((match) => match[1]))
}

function fail(message) {
  console.error(`select-modules: ${message}`)
  process.exit(1)
}

function usage() {
  console.log(`用法：
  node scripts/select-modules.mjs list    [--json]
  node scripts/select-modules.mjs status  [--profile-dir <dir>] [--json]
  node scripts/select-modules.mjs apply   --modules <id,id,...|all|none>
                                         [--profile-dir <dir>] [--dry-run] [--no-backup] [--json]

选项：
  --profile-dir <dir>   profile 目录（默认 $DSH_PROFILE_DIR，其次 ~/.dsh/profiles/desktop）
  --profile <name>      ~/.dsh/profiles 下的 profile 名
  --modules           apply 时要启用的模块 id，逗号分隔；all = 全部，none = 全部关闭
  --dry-run           只打印将写入的内容，不修改文件
  --no-backup         不生成 cordis.patch.yml.bak-<时间> 备份
  --json              输出 JSON（给 Agent 逐条询问时使用）

模块目录与相互依赖说明见仓库 modules.json 与 README 的「用 GitHub 自主安装」一节。`)
}

/** Parse `--flag value` / `--flag=value` / boolean switches. */
function parseArgs(argv) {
  const options = { command: argv[0] }
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index]
    if (!arg.startsWith('--')) fail(`unexpected argument ${arg}`)
    const [flag, inline] = arg.slice(2).split('=')
    const takeValue = () => {
      if (inline !== undefined) return inline
      const value = argv[index + 1]
      if (value === undefined) fail(`--${flag} needs a value`)
      index += 1
      return value
    }
    if (flag === 'modules' || flag === 'profile-dir' || flag === 'profile') options[flag] = takeValue()
    else if (flag === 'dry-run') options.dryRun = true
    else if (flag === 'no-backup') options.noBackup = true
    else if (flag === 'json') options.json = true
    else if (flag === 'help') options.help = true
    else fail(`unknown option --${flag}`)
  }
  return options
}

/** Resolve the DSH profile directory and the file this script manages. */
function resolveProfile(options) {
  let directory = options['profile-dir']
  if (directory === undefined && process.env.DSH_PROFILE_DIR) directory = process.env.DSH_PROFILE_DIR
  if (directory === undefined && options.profile) directory = join(homedir(), '.dsh', 'profiles', options.profile)
  if (directory === undefined) {
    const desktop = join(homedir(), '.dsh', 'profiles', 'desktop')
    if (existsSync(join(desktop, 'package.json'))) directory = desktop
  }
  if (directory === undefined) fail('cannot find a DSH profile; pass --profile-dir or --profile')
  const absolute = resolve(directory)
  const patchFile = join(absolute, 'cordis.patch.yml')
  if (!existsSync(join(absolute, 'package.json'))) fail(`not a DSH profile (no package.json): ${absolute}`)
  return { directory: absolute, patchFile, patchExists: existsSync(patchFile) }
}

/** Extract the ids this script currently disables in the profile patch. */
function readManagedBlock(text) {
  const block = new RegExp(`${escapeRegExp(BEGIN)}[^\\n]*\\n([\\s\\S]*?)${escapeRegExp(END)}`, 'm').exec(text)
  if (block === null) return { present: false, disabled: [], block: undefined }
  const disabled = [...block[1].matchAll(/^\s*-\s*id:\s*([A-Za-z0-9._-]+)\s*$/gm)].map((match) => match[1])
  return { present: true, disabled, block: block[0] }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Render the managed override block for one selection. */
function renderBlock(catalog, selectedIds) {
  const lines = [BEGIN]
  const disabled = catalog.modules.filter((module) => !selectedIds.has(module.id))
  if (disabled.length === 0) {
    lines.push('# 全部模块已启用（由本脚本维护；删除整块也等于全部启用）。')
  } else {
    lines.push('# 未列出的模块保持启用；列出的行在 composition 里被关闭。')
    for (const module of disabled) {
      lines.push(`- id: ${module.row}`)
      lines.push('  disabled: true')
    }
  }
  lines.push(END)
  return `${lines.join('\n')}\n`
}

/** Replace or append the managed block, keeping everything else intact. */
function writeManagedBlock(text, block) {
  const pattern = new RegExp(`${escapeRegExp(BEGIN)}[^\\n]*\\n[\\s\\S]*?${escapeRegExp(END)}[^\\n]*\\n?`, 'm')
  if (pattern.test(text)) return normalize(`${text.replace(pattern, block)}`)

  // A fresh profile patch is just `[]`; a YAML sequence cannot follow that flow
  // sequence, so replace that line instead of appending after it.
  const lines = text.split('\n')
  const emptyIndex = lines.findIndex((line) => line.trim() === '[]')
  const meaningful = lines.filter((line) => line.trim() !== '' && !line.trim().startsWith('#'))
  if (emptyIndex >= 0 && meaningful.length === 1 && meaningful[0].trim() === '[]') {
    const before = lines.slice(0, emptyIndex).join('\n')
    const after = lines.slice(emptyIndex + 1).join('\n')
    const prefix = before === '' ? '' : `${before}\n`
    const suffix = after === '' ? '' : `${after}\n`
    return normalize(`${prefix}${block}${suffix}`)
  }

  const separator = text.endsWith('\n') || text.length === 0 ? '' : '\n'
  return normalize(`${text}${separator}\n${block}`)
}

function normalize(text) {
  const trimmed = text.replace(/\n{3,}$/u, '\n\n')
  return trimmed.endsWith('\n') ? trimmed : `${trimmed}\n`
}

/** Check a selection against the catalog's dependency notes. */
function analyze(catalog, selectedIds) {
  const byId = new Map(catalog.modules.map((module) => [module.id, module]))
  const errors = []
  const warnings = []
  const external = []
  for (const module of catalog.modules) {
    if (!selectedIds.has(module.id)) continue
    for (const target of module.requires ?? []) {
      if (!selectedIds.has(target)) errors.push(`${module.id} 依赖 ${target}，但 ${target} 没被选中`)
    }
    for (const target of module.recommends ?? []) {
      if (selectedIds.has(target)) continue
      const why = module.recommendsWhy?.[target] ?? ''
      warnings.push(`${module.id} 建议与 ${target} 一起安装${why === '' ? '' : `：${why}`}`)
    }
    for (const prerequisite of module.external ?? []) {
      external.push(`${module.id} 需要外部前提：${prerequisite.zh ?? prerequisite.name}`)
    }
  }
  return { errors, warnings, external, byId }
}

/** Resolve `--modules` into a selected set. */
function resolveSelection(catalog, value) {
  if (value === undefined) fail('apply needs --modules')
  const ids = catalog.modules.map((module) => module.id)
  if (value === 'all') return new Set(ids)
  if (value === 'none') return new Set()
  const selected = new Set(
    value
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item !== ''),
  )
  const unknown = [...selected].filter((id) => !ids.includes(id))
  if (unknown.length > 0) fail(`unknown module id(s): ${unknown.join(', ')}（可用：${ids.join(', ')}）`)
  if (selected.size === 0) fail('--modules resolved to an empty selection; pass all, none, or ids')
  return selected
}

function printList(catalog) {
  console.log(`Scher 可选模块（${catalog.modules.length} 个）\n`)
  for (const module of catalog.modules) {
    const badge = module.defaultSelected ? '默认' : '可选'
    const size = module.sizeMB === undefined ? '' : `${module.sizeMB.toFixed(2)} MB`
    console.log(`[${badge}] ${module.id.padEnd(16)} v${module.version.padEnd(7)} ${size.padStart(8)}  ${module.title.zh}`)
    console.log(`         ${module.summary.zh}`)
    for (const target of module.recommends ?? []) {
      const why = module.recommendsWhy?.[target] ?? ''
      console.log(`         ⚠ 相互依赖：建议与 ${target} 一起安装${why === '' ? '' : `（${why}）`}`)
    }
    for (const prerequisite of module.external ?? []) {
      console.log(`         ⚠ 外部前提：${prerequisite.zh ?? prerequisite.name}`)
    }
    if (module.notes?.zh) console.log(`         · ${module.notes.zh}`)
    console.log('')
  }
  console.log('安装时请逐条询问用户是否需要该模块；有「相互依赖 / 外部前提」的必须重点提醒。')
}

function printStatus(catalog, profile) {
  if (!profile.patchExists) {
    console.log(`profile: ${profile.directory}`)
    console.log('cordis.patch.yml 不存在：bundle 尚未写入任何覆盖，当前视为全部模块启用。')
    return
  }
  const text = readFileSync(profile.patchFile, 'utf8')
  const { present, disabled } = readManagedBlock(text)
  const disabledSet = new Set(disabled)
  console.log(`profile: ${profile.directory}`)
  console.log(present ? '托管块：存在（本脚本维护的模块选择）' : '托管块：不存在（全部模块启用）')
  for (const module of catalog.modules) {
    console.log(`  [${disabledSet.has(module.row) ? ' ' : 'x'}] ${module.id.padEnd(16)} ${module.title.zh}`)
  }
}

/** JSON rendering for agent consumption. */
function toJson(catalog, selection, analysis, profile, extra = {}) {
  return {
    bundle: catalog.bundle,
    profile: profile.directory,
    modules: catalog.modules.map((module) => ({
      id: module.id,
      row: module.row,
      title: module.title,
      summary: module.summary,
      version: module.version,
      sizeMB: module.sizeMB,
      defaultSelected: module.defaultSelected,
      requires: module.requires ?? [],
      recommends: module.recommends ?? [],
      external: module.external ?? [],
      notes: module.notes,
      selected: selection === undefined ? undefined : selection.has(module.id),
    })),
    warnings: analysis.warnings,
    errors: analysis.errors,
    external: analysis.external,
    ...extra,
  }
}

function main() {
  const argv = process.argv.slice(2)
  const options = parseArgs(argv)
  if (options.help || options.command === undefined) {
    usage()
    process.exit(options.command === undefined ? 1 : 0)
  }
  const catalog = loadCatalog()

  if (options.command === 'list') {
    if (options.json) {
      console.log(JSON.stringify({ bundle: catalog.bundle, modules: catalog.modules }, null, 2))
      return
    }
    printList(catalog)
    return
  }

  const profile = resolveProfile(options)

  if (options.command === 'status') {
    if (options.json) {
      const analysis = analyze(catalog, new Set(catalog.modules.map((module) => module.id)))
      console.log(JSON.stringify(toJson(catalog, undefined, analysis, profile), null, 2))
      return
    }
    printStatus(catalog, profile)
    return
  }

  if (options.command !== 'apply') {
    usage()
    fail(`unknown command ${String(options.command)}`)
  }

  const selection = resolveSelection(catalog, options.modules)
  const analysis = analyze(catalog, selection)
  const rows = repoRowIds()
  for (const module of catalog.modules) {
    if (selection.has(module.id) && !rows.has(module.row)) {
      fail(`modules.json drift: row "${module.row}" is not declared in ${REPO_PATCH_PATH}`)
    }
  }
  if (!profile.patchExists) {
    fail(
      `profile has no cordis.patch.yml (${profile.patchFile}); install the dsh-scher bundle first ` +
        '(plugin_manager install_bundle with enabled: false), then re-run this command',
    )
  }
  const disabled = catalog.modules.filter((module) => !selection.has(module.id))
  const block = renderBlock(catalog, selection)

  if (options.dryRun) {
    if (options.json) {
      console.log(
        JSON.stringify(
          toJson(catalog, selection, analysis, profile, {
            dryRun: true,
            disabledRows: disabled.map((module) => module.row),
            block,
          }),
          null,
          2,
        ),
      )
      return
    }
    console.log('（dry-run）将写入 profile 的托管块：\n')
    console.log(block)
    printAnalysis(analysis, selection, catalog)
    return
  }

  const text = readFileSync(profile.patchFile, 'utf8')
  const next = writeManagedBlock(text, block)
  if (next === text) {
    console.log('profile 的模块选择已是最新，没有修改。')
    return
  }
  if (!options.noBackup) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    copyFileSync(profile.patchFile, `${profile.patchFile}.bak-${stamp}`)
  }
  writeFileSync(profile.patchFile, next)
  if (options.json) {
    console.log(
      JSON.stringify(
        toJson(catalog, selection, analysis, profile, {
          applied: true,
          disabledRows: disabled.map((module) => module.row),
        }),
        null,
        2,
      ),
    )
    return
  }
  printAnalysis(analysis, selection, catalog)
  console.log(`\n已写入 ${profile.patchFile}`)
  console.log('下一步：重启 DSH 生效；或在 Plugins 里把 dsh-scher 停用再启用（HMR 重组合）。')
}

function printAnalysis(analysis, selection, catalog) {
  const selected = catalog.modules.filter((module) => selection.has(module.id))
  const skipped = catalog.modules.filter((module) => !selection.has(module.id))
  console.log(`已选（${selected.length}）：${selected.map((module) => module.id).join(', ') || '（无）'}`)
  console.log(`未选（${skipped.length}）：${skipped.map((module) => module.id).join(', ') || '（无）'}`)
  if (analysis.warnings.length > 0) {
    console.log('\n相互依赖提醒：')
    for (const line of analysis.warnings) console.log(`  ⚠ ${line}`)
  }
  if (analysis.external.length > 0) {
    console.log('\n外部前提（要告诉用户）：')
    for (const line of analysis.external) console.log(`  - ${line}`)
  }
  if (analysis.errors.length > 0) {
    console.log('\n错误：')
    for (const line of analysis.errors) console.log(`  ✖ ${line}`)
  }
}

main()
