/**
 * dsh-comfyui-workspace — ComfyUI workflow model.
 *
 * Two jobs, both pure functions of their arguments so they can be tested
 * without a server and without a browser:
 *
 *   buildCards()   UI-format workflow JSON  →  the vertical stack of node cards
 *   buildPrompt()  cards + a server's /object_info  →  the API-format prompt
 *
 * The input is the JSON ComfyUI's "导出 / Export" button produces for a saved
 * *workflow* (`{nodes, links, ...}`), not the API format (`{id: {class_type,
 * inputs}}`). Widget values are read from `widgets_values_named` when the export
 * carries it, which every current frontend does; `widgets_values` alone is a
 * positional array that also holds front-end-only buttons, so it is only used
 * as a last resort, greedily matched against the server's declared inputs.
 *
 * @module dsh-comfyui-workspace/workflow
 */

/** Node classes that are editor furniture: they never reach the prompt. */
const EDITOR_ONLY = /(\bLabel\b|\bNote\b|\bMarkdownNote\b|\bReroute\b|\bPrimitiveNode\b|Bypasser|Muter|\bBookmark\b|Comparer)/i

/** Input types that are widgets; everything else uppercase is a socket. */
const WIDGET_TYPES = new Set(['INT', 'FLOAT', 'STRING', 'BOOLEAN', 'COMBO'])

/** Front-end-only widget names that are buttons or seed-control decorations. */
const PSEUDO_WIDGETS = new Set([
  'control_after_generate',
  'upload',
  'image_upload',
  'choose file to upload',
  'choose file to upload (optional)',
  '🎲 Randomize Each Time',
  '🎲 New Fixed Random',
  'USE_LAST_SEED',
  'fixed',
])

/** The exact node classes this plugin knows how to present. */
const CLASS_TABLE = {
  // ── prompts ────────────────────────────────────────────────────────────
  PrimitiveStringMultiline: { category: 'prompt', label: '提示词' },
  PrimitiveString: { category: 'prompt', label: '文本' },
  CLIPTextEncode: { category: 'prompt', label: '提示词编码' },
  // ── the diffusion model ────────────────────────────────────────────────
  UNETLoader: { category: 'model', label: '主模型 UNET' },
  CheckpointLoaderSimple: { category: 'model', label: '主模型 Checkpoint' },
  CheckpointLoader: { category: 'model', label: '主模型 Checkpoint' },
  UnetLoaderGGUF: { category: 'model', label: '主模型 GGUF' },
  'UNETLoader (GGUF)': { category: 'model', label: '主模型 GGUF' },
  // ── auxiliary model files ──────────────────────────────────────────────
  CLIPLoader: { category: 'submodel', label: '文本编码器 CLIP' },
  DualCLIPLoader: { category: 'submodel', label: '文本编码器 CLIP ×2' },
  TripleCLIPLoader: { category: 'submodel', label: '文本编码器 CLIP ×3' },
  CLIPLoaderGGUF: { category: 'submodel', label: '文本编码器 GGUF' },
  VAELoader: { category: 'submodel', label: 'VAE' },
  LoraLoader: { category: 'submodel', label: 'LoRA' },
  LoraLoaderModelOnly: { category: 'submodel', label: 'LoRA 仅模型' },
  ControlNetLoader: { category: 'submodel', label: 'ControlNet' },
  UpscaleModelLoader: { category: 'submodel', label: '放大模型' },
  StyleModelLoader: { category: 'submodel', label: '风格模型' },
  CLIPVisionLoader: { category: 'submodel', label: 'CLIP Vision' },
  GLIGENLoader: { category: 'submodel', label: 'GLIGEN' },
  // ── file inputs ────────────────────────────────────────────────────────
  LoadImage: { category: 'file', label: '输入图片' },
  LoadImageMask: { category: 'file', label: '输入蒙版' },
  LoadVideo: { category: 'file', label: '输入视频' },
  LoadAudio: { category: 'file', label: '输入音频' },
  VHS_LoadVideo: { category: 'file', label: '输入视频' },
  VHS_LoadAudio: { category: 'file', label: '输入音频' },
  // ── outputs ────────────────────────────────────────────────────────────
  SaveImage: { category: 'output', label: '保存图像' },
  PreviewImage: { category: 'output', label: '预览图像' },
  SaveVideo: { category: 'output', label: '保存视频' },
  PreviewVideo: { category: 'output', label: '预览视频' },
  SaveAudio: { category: 'output', label: '保存音频' },
  PreviewAudio: { category: 'output', label: '预览音频' },
  VHS_VideoCombine: { category: 'output', label: '合成视频' },
  SaveAnimatedWEBP: { category: 'output', label: '保存动图 WEBP' },
  SaveAnimatedPNG: { category: 'output', label: '保存动图 PNG' },
  // ── common general nodes, labelled for the card header ────────────────
  KSampler: { category: 'general', label: '采样器' },
  KSamplerAdvanced: { category: 'general', label: '高级采样器' },
  EmptyLatentImage: { category: 'general', label: '空白潜空间' },
  VAEDecode: { category: 'general', label: 'VAE 解码' },
  VAEEncode: { category: 'general', label: 'VAE 编码' },
  TextEncodeQwenImage21: { category: 'general', label: 'Qwen 文本编码' },
  ResolutionSelector: { category: 'general', label: '分辨率' },
  ImageScaleToTotalPixels: { category: 'general', label: '缩放到总像素' },
  ImageScale: { category: 'general', label: '缩放图像' },
  ComfySwitchNode: { category: 'general', label: '分支开关' },
  QwenImage21Cache: { category: 'general', label: 'Qwen 缓存' },
  TESpeedQwenImage21: { category: 'general', label: 'TE 加速' },
  'Seed (rgthree)': { category: 'general', label: '随机种子' },
  'Power Lora Loader (rgthree)': { category: 'submodel', label: 'LoRA 组' },
}

/** Widget names that hold a selection of model files. */
const MODEL_WIDGETS = new Set(['ckpt_name', 'unet_name', 'diffusion_model'])
const SUBMODEL_WIDGETS = new Set([
  'lora_name',
  'vae_name',
  'clip_name',
  'clip_name1',
  'clip_name2',
  'clip_name3',
  'control_net_name',
  'style_model_name',
  'clip_vision_name',
  'gligen_name',
  'upscale_model_name',
])

/** Widget names whose values the panel shows as a dropdown even with no schema. */
const COMBO_HINT = /^(sampler_name|scheduler|weight_dtype|type|device|aspect_ratio|upscale_method|attention|step_cache|format|mode|precision|dtype|scheduler_type)$|(_name|_type|_method)$/

/** Widget names that carry a seed. */
const SEED_HINT = /(^seed$|_seed$|^noise_seed$)/

/** Widget names that are a file picker on a Load* node. */
const FILE_WIDGETS = new Set(['image', 'video', 'audio', 'file', 'file_name', 'video_name', 'audio_name', 'filename', 'mask', 'audio_file'])

/** Node classes whose `filename_prefix` is forwarded to the save directory. */
const PREFIX_CLASSES = new Set([
  'SaveImage',
  'VHS_VideoCombine',
  'SaveAnimatedWEBP',
  'SaveAnimatedPNG',
  'SaveVideo',
  'SaveAudio',
])

/**
 * Widget names that hold a save destination.
 *
 * Custom save nodes are not obliged to call it `filename_prefix`: the Lazy/H3
 * family names its widget `文件名` and documents it as "文件名前缀。可用 文件夹/名称"
 * — a server-relative subdirectory plus a name, which is exactly what the save
 * card manages.
 */
const SAVE_WIDGETS = new Set([
  'filename_prefix',
  'filename',
  'file_name',
  'file_prefix',
  'prefix',
  'output_path',
  'save_path',
  'output_dir',
  '文件名',
  '文件名前缀',
  '保存名称',
  '保存目录',
  '输出目录',
  '前缀',
])

/** Whether a class looks like it writes files to the server's output directory. */
function looksLikeSaveClass(type) {
  const name = String(type ?? '')
  if (PREFIX_CLASSES.has(name)) return true
  if (/保存|导出/.test(name)) return true
  // CamelCase included: `LazyVideoSave` has no word boundary before "Save".
  const lower = name.toLowerCase()
  return lower.includes('save') && !lower.includes('loader')
}

/**
 * The save-destination widget of one node, if it is a save node.
 *
 * @param {object} node - one node of the UI-format graph.
 * @returns {{name: string, value: unknown} | null}
 */
export function saveTargetOf(node) {
  const type = String(node?.type ?? '')
  if (!looksLikeSaveClass(type)) return null
  const named = node?.widgets_values_named
  const names = named !== null && typeof named === 'object' && !Array.isArray(named) ? Object.keys(named) : []
  const name = names.find((candidate) => SAVE_WIDGETS.has(candidate))
  if (name !== undefined) return { name, value: named[name] }
  // No named export: fall back to the class list, which always uses the default
  // `filename_prefix` widget.
  return PREFIX_CLASSES.has(type) ? { name: 'filename_prefix', value: undefined } : null
}

/** Largest seed this plugin hands out (kept below 2^53 so JSON stays exact). */
const SEED_MAX = 2 ** 48

/** `%date:yyyyMMdd-HHmmss%` as ComfyUI's own frontend writes it. */
const DATE_PLACEHOLDER = /%date:([^%]*)%/g

/** Pad with zeroes to `width`. */
function pad(value, width = 2) {
  return String(value).padStart(width, '0')
}

/**
 * Format one date with the SimpleDateFormat subset ComfyUI's frontend accepts.
 *
 * The frontend expands `%date:...%` before it queues a prompt, so a workflow
 * that relies on it for unique filenames produces the same names through this
 * plugin only if the same expansion happens here. Anything unrecognized is copied
 * through, which is what the frontend does too.
 *
 * @param {string} format - `yyyyMMddhhmmss`, `yyyy-MM-dd_HH-mm-ss`, …
 * @param {Date} now
 */
export function formatDatePattern(format, now = new Date()) {
  const tokens = {
    yyyy: () => String(now.getFullYear()),
    yy: () => String(now.getFullYear()).slice(-2),
    MM: () => pad(now.getMonth() + 1),
    dd: () => pad(now.getDate()),
    HH: () => pad(now.getHours()),
    hh: () => pad(now.getHours() % 12 === 0 ? 12 : now.getHours() % 12),
    mm: () => pad(now.getMinutes()),
    ss: () => pad(now.getSeconds()),
    SSS: () => pad(now.getMilliseconds(), 3),
    M: () => String(now.getMonth() + 1),
    d: () => String(now.getDate()),
    H: () => String(now.getHours()),
    h: () => String(now.getHours() % 12 === 0 ? 12 : now.getHours() % 12),
    m: () => String(now.getMinutes()),
    s: () => String(now.getSeconds()),
  }
  const order = ['yyyy', 'yy', 'SSS', 'MM', 'dd', 'HH', 'hh', 'mm', 'ss', 'M', 'd', 'H', 'h', 'm', 's']
  let out = ''
  let index = 0
  while (index < format.length) {
    let matched = false
    for (const token of order) {
      if (format.startsWith(token, index)) {
        out += tokens[token]()
        index += token.length
        matched = true
        break
      }
    }
    if (!matched) {
      out += format[index]
      index += 1
    }
  }
  return out
}

/**
 * Expand the `%date:...%` placeholders in one string value.
 *
 * @param {unknown} value
 * @param {Date} now
 * @returns {unknown} the value, with placeholders expanded when it was a string.
 */
export function expandDatePlaceholders(value, now = new Date()) {
  if (typeof value !== 'string' || !value.includes('%date:')) return value
  return value.replace(DATE_PLACEHOLDER, (_match, format) => formatDatePattern(String(format), now))
}

/** Extension → media kind for the output cards. */
const MEDIA_BY_EXTENSION = {
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  webp: 'image',
  gif: 'image',
  bmp: 'image',
  mp4: 'video',
  webm: 'video',
  mkv: 'video',
  mov: 'video',
  avi: 'video',
  mp3: 'audio',
  wav: 'audio',
  flac: 'audio',
  ogg: 'audio',
  m4a: 'audio',
}

/** The media kind of a filename, or `unknown`. */
export function mediaKind(filename) {
  const match = /\.([a-z0-9]+)$/i.exec(String(filename ?? ''))
  if (match === null) return 'unknown'
  return MEDIA_BY_EXTENSION[match[1].toLowerCase()] ?? 'unknown'
}

/** A fresh seed in `[0, SEED_MAX)`. */
export function rollSeed(random = Math.random) {
  return Math.floor(random() * SEED_MAX)
}

/** Read `raw.links` into a `linkId → link` map, tolerating object-form links. */
function linkMap(raw) {
  const map = new Map()
  for (const link of Array.isArray(raw?.links) ? raw.links : []) {
    if (Array.isArray(link) && link.length >= 5) map.set(link[0], link)
    else if (link !== null && typeof link === 'object' && typeof link.id === 'number') {
      map.set(link.id, [link.id, link.origin_id, link.origin_slot, link.target_id, link.target_slot, link.type])
    }
  }
  return map
}

/** Every declared input of one class, flattened out of `/object_info`. */
export function inputSpecs(objectInfo, className) {
  const entry = objectInfo?.[className]
  if (entry === null || typeof entry !== 'object') return null
  const specs = new Map()
  for (const section of ['required', 'optional']) {
    const block = entry.input?.[section]
    if (block === null || typeof block !== 'object') continue
    for (const [name, raw] of Object.entries(block)) {
      if (!Array.isArray(raw) || raw.length === 0) continue
      specs.set(name, {
        type: raw[0],
        opts: raw[1] !== null && typeof raw[1] === 'object' ? raw[1] : {},
        section,
      })
    }
  }
  const order = []
  for (const section of ['required', 'optional']) {
    for (const name of entry.input_order?.[section] ?? []) if (specs.has(name)) order.push(name)
  }
  for (const name of specs.keys()) if (!order.includes(name)) order.push(name)
  return { specs, order, entry }
}

/** Whether one declared input is a widget the panel can edit. */
function isWidgetSpec(spec) {
  if (spec === undefined || spec === null) return false
  const type = spec.type
  if (Array.isArray(type)) return true
  if (type === 'COMBO') return true
  return typeof type === 'string' && WIDGET_TYPES.has(type)
}

/** The options of one combo input, in either of the two shapes ComfyUI emits. */
function comboOptions(spec) {
  if (Array.isArray(spec?.type)) return spec.type.filter((item) => typeof item === 'string' || typeof item === 'number')
  if (spec?.type === 'COMBO' && Array.isArray(spec.opts?.options)) {
    return spec.opts.options.filter((item) => typeof item === 'string' || typeof item === 'number')
  }
  return []
}

/** The number bounds a declared input carries, when it declares any. */
function numericBounds(spec) {
  const opts = spec?.opts ?? {}
  const out = {}
  if (typeof opts.min === 'number') out.min = opts.min
  if (typeof opts.max === 'number') out.max = opts.max
  if (typeof opts.step === 'number') out.step = opts.step
  return out
}

/** A widget kind inferred from a value alone, for a server that cannot answer. */
function inferKind(name, value) {
  if (typeof value === 'boolean') return 'bool'
  if (typeof value === 'number') return Number.isInteger(value) ? 'int' : 'float'
  if (COMBO_HINT.test(name)) return 'combo'
  if (typeof value === 'string' && value.includes('\n')) return 'text'
  return 'string'
}

/** One editable field from a declared input, or from the value alone. */
function fieldFrom(name, spec, value, linkedBy) {
  const label = name
  const base = { name, label, value, locked: linkedBy !== undefined, lockedBy: linkedBy }
  if (spec !== undefined && spec !== null && isWidgetSpec(spec)) {
    const type = spec.type
    if (Array.isArray(type) || type === 'COMBO') {
      const options = comboOptions(spec)
      const supported = options.length === 0 ? undefined : options.includes(value)
      return { ...base, kind: 'combo', options, supported, fallback: options.length === 0 }
    }
    if (type === 'INT' || type === 'FLOAT') {
      return { ...base, kind: type === 'INT' ? 'int' : 'float', ...numericBounds(spec) }
    }
    if (type === 'BOOLEAN') return { ...base, kind: 'bool' }
    if (type === 'STRING') {
      return {
        ...base,
        kind: spec.opts?.multiline === true || String(value ?? '').includes('\n') ? 'text' : 'string',
        multiline: spec.opts?.multiline === true,
      }
    }
  }
  // No schema (class unknown to the server, or the server is offline): keep the
  // value editable with the kind its own type implies.
  const kind = inferKind(name, value)
  return { ...base, kind, options: kind === 'combo' ? [] : undefined, fallback: kind === 'combo' }
}

/**
 * The widget values of one node, named, ready to be turned into fields.
 *
 * Names come from the server's declared inputs when it answered, and from
 * `widgets_values_named` otherwise. A name the server declares but the export
 * did not carry stays out: the graph never set it, so the server's own default
 * is the truth.
 *
 * @param {object} node - one node of the UI-format graph.
 * @param {object|null} objectInfo - the server's `/object_info`, or `null`.
 * @returns {Array<{name: string, spec: object|undefined, value: unknown}>}
 */
export function namedWidgets(node, objectInfo) {
  const info = inputSpecs(objectInfo, node?.type)
  const raw = node?.widgets_values_named
  const named = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : null

  /** @type {Array<{name: string, spec: object|undefined, value: unknown}>} */
  const entries = []
  const used = new Set()

  if (info !== null) {
    for (const name of info.order) {
      const spec = info.specs.get(name)
      if (!isWidgetSpec(spec)) continue
      if (named !== null && Object.hasOwn(named, name)) {
        entries.push({ name, spec, value: named[name] })
        used.add(name)
      } else if (named === null) {
        // No named export: the value is found positionally below.
        entries.push({ name, spec, value: undefined, positional: true })
        used.add(name)
      }
    }
  }
  if (named !== null) {
    for (const [name, value] of Object.entries(named)) {
      if (used.has(name) || PSEUDO_WIDGETS.has(name)) continue
      // A widget the server's schema does not declare at all is front-end
      // furniture (a preview button, a hidden helper): sending it would be noise
      // at best. A saved value for it still shows up through the config layer.
      if (info !== null && !info.specs.has(name)) continue
      if (info !== null && info.specs.has(name) && !isWidgetSpec(info.specs.get(name))) continue
      entries.push({ name, spec: info?.specs.get(name), value })
      used.add(name)
    }
  }

  // Positional fallback: consume `widgets_values` with type-compatible greedy
  // matching, which skips the extra strings a front-end button leaves behind.
  if (named === null) {
    const queue = Array.isArray(node?.widgets_values) ? [...node.widgets_values] : []
    const editable = entries.filter((entry) => entry.positional === true)
    const isCompatible = (spec, value) => {
      if (spec === undefined || spec === null) return true
      const type = spec.type
      if (Array.isArray(type) || type === 'COMBO') {
        const options = comboOptions(spec)
        return options.length === 0 || options.includes(value)
      }
      if (type === 'INT' || type === 'FLOAT') return typeof value === 'number'
      if (type === 'BOOLEAN') return typeof value === 'boolean'
      if (type === 'STRING') return typeof value === 'string'
      return true
    }
    for (const entry of editable) {
      const index = queue.findIndex((candidate) => isCompatible(entry.spec, candidate))
      if (index === -1) continue
      entry.value = queue.splice(index, 1)[0]
    }
    // Leftover values belong to widgets the schema did not name. They are
    // dropped rather than sent: an input name the server does not declare is a
    // silent no-op at best, and a confusing validation error at worst.
  }

  return entries.filter((entry) => entry.value !== undefined && entry.orphan !== true)
}

/** The display title of one node. */
export function cardTitle(node) {
  const own = typeof node?.title === 'string' ? node.title.trim() : ''
  if (own !== '') return own
  return CLASS_TABLE[node?.type]?.label ?? String(node?.type ?? '未命名节点')
}

/** The card category of one node. */
export function classify(node) {
  const type = String(node?.type ?? '')
  if (type === '') return null
  if (EDITOR_ONLY.test(type)) return null
  const known = CLASS_TABLE[type]
  if (known !== undefined) return known.category
  // A custom node that writes files (`LazyVideoSave` and friends) is an output
  // card: its card shows what it wrote, its destination lives in the save card.
  if (saveTargetOf(node) !== null) return 'output'
  if (/^Load(Image|Video|Audio|Mask)/i.test(type) || /^VHS_Load/.test(type)) return 'file'
  if (/^(Save|Preview)/.test(type) && !/^(PreviewAny|PreviewBridge)/.test(type)) return 'output'
  const names = Object.keys(node?.widgets_values_named ?? {})
  if (names.some((name) => MODEL_WIDGETS.has(name))) return 'model'
  if (names.some((name) => SUBMODEL_WIDGETS.has(name))) return 'submodel'
  if (names.some((name) => FILE_WIDGETS.has(name))) return 'file'
  return 'general'
}

/** The label of one node, for the card header. */
export function classLabel(node) {
  return CLASS_TABLE[node?.type]?.label ?? String(node?.type ?? '')
}

/** Whether one node runs, given the graph's own mode and the panel's override. */
export function nodeEnabled(node, override) {
  if (override !== null && typeof override === 'object' && typeof override.enabled === 'boolean') return override.enabled
  return (node?.mode ?? 0) === 0
}

/** Sort key that follows the graph's execution order, then its position. */
function orderOf(node) {
  const order = Number(node?.order)
  if (Number.isFinite(order)) return order
  const pos = Array.isArray(node?.pos) ? node.pos : [0, 0]
  return 1e6 + Number(pos[1] ?? 0) * 1000 + Number(pos[0] ?? 0) / 1000
}

/** The file widget of one node, if it has one. */
function fileWidgetOf(node) {
  const names = Object.keys(node?.widgets_values_named ?? {})
  const hit = names.find((name) => FILE_WIDGETS.has(name))
  if (hit !== undefined) return hit
  const inputs = Array.isArray(node?.inputs) ? node.inputs : []
  const fallback = inputs.find((input) => FILE_WIDGETS.has(input?.name))
  return fallback?.name
}

/**
 * The virtual card that holds every run's destination.
 *
 * One row per save node in the graph: a custom save node's own prefix is a
 * server-relative directory (`z视频/z`), and it belongs next to "服务器目录" and
 * "本地目录" rather than on the node's card, which keeps its preview.
 *
 * @param {object|null} config
 * @param {Array<{id: string, title: string, widget: string, value: unknown}>} [targets]
 */
export function saveCard(config, targets = []) {
  const save = config?.save ?? {}
  const prefixes = save.prefixes !== null && typeof save.prefixes === 'object' ? save.prefixes : {}
  const perNode = targets.map((target) => ({
    name: `prefix:${target.id}`,
    nodeId: target.id,
    label: `#${target.id} ${target.title}`,
    hint: '该节点在服务器 output/ 下的相对目录（可含子文件夹）',
    kind: 'string',
    widget: target.widget,
    value: typeof prefixes[target.id] === 'string' && prefixes[target.id] !== ''
      ? prefixes[target.id]
      : (typeof target.value === 'string' ? target.value : ''),
  }))
  return {
    id: '__save__',
    type: '__save__',
    title: '保存位置',
    subtitle: '本插件自定义 · 管理每个保存节点的输出目录',
    category: 'save',
    enabled: true,
    fields: [
      {
        name: 'subfolder',
        label: '服务器目录',
        hint: '统一加到下面每个节点路径前的子目录；留空 = 用各节点自己的路径',
        kind: 'string',
        value: typeof save.subfolder === 'string' ? save.subfolder : '',
      },
      ...perNode,
      {
        name: 'localDir',
        label: '本地目录',
        hint: '运行结束后把结果下载到这里；留空 = 只留在服务器',
        kind: 'path',
        value: typeof save.localDir === 'string' ? save.localDir : '',
      },
    ],
  }
}

/**
 * Build the vertical card stack of one workflow.
 *
 * @param {object} raw - the UI-format workflow JSON.
 * @param {object|null} objectInfo - the server's `/object_info`, or `null` offline.
 * @param {object|null} config - this panel's per-node configuration.
 * @returns {Array<object>} cards, in graph order, with the save card last.
 */
export function buildCards(raw, objectInfo = null, config = null) {
  const links = linkMap(raw)
  const nodeById = new Map()
  for (const node of Array.isArray(raw?.nodes) ? raw.nodes : []) {
    if (node !== null && typeof node === 'object') nodeById.set(String(node.id), node)
  }
  const nodes = [...nodeById.values()].sort((left, right) => orderOf(left) - orderOf(right))
  const cards = []
  /** One row per save node, handed to the save card at the bottom. */
  const saveTargets = []
  for (const node of nodes) {
    const id = String(node.id)
    const category = classify(node)
    if (category === null) continue
    const override = config?.nodes?.[id] ?? null
    const entries = namedWidgets(node, objectInfo)
    const linkedNames = new Map()
    for (const input of Array.isArray(node.inputs) ? node.inputs : []) {
      if (input?.link === null || input?.link === undefined) continue
      const link = links.get(input.link)
      if (link === undefined) continue
      const name = typeof input.widget?.name === 'string' ? input.widget.name : input.name
      linkedNames.set(name, String(link[1]))
    }
    const values = override?.values ?? {}
    const fields = entries.map((entry) => {
      const value = Object.hasOwn(values, entry.name) ? values[entry.name] : entry.value
      return fieldFrom(entry.name, entry.spec, value, linkedNames.get(entry.name))
    })
    // A field the schema does not know but the user's saved config has (an
    // upgrade renamed a widget) stays visible instead of silently disappearing.
    for (const [name, value] of Object.entries(values)) {
      if (fields.some((field) => field.name === name)) continue
      if (PSEUDO_WIDGETS.has(name)) continue
      fields.push(fieldFrom(name, inputSpecs(objectInfo, node.type)?.specs.get(name), value, undefined))
    }
    const file = category === 'file' ? fileWidgetOf(node) : undefined
    // A save node keeps its card — as a preview of what it wrote — while its
    // destination widget moves to the save card, so there is one place to look.
    const saveTarget = category === 'output' ? saveTargetOf(node) : null
    const saveField = saveTarget === null
      ? undefined
      : fields.find((field) => field.name === saveTarget.name)?.value ?? saveTarget.value
    if (category === 'general' && fields.length === 0) continue
    if (category === 'file' && file === undefined) continue
    const card = {
      id,
      type: String(node.type),
      title: cardTitle(node),
      subtitle: `${String(node.type)} #${id}`,
      category,
      enabled: nodeEnabled(node, override),
      muted: (node.mode ?? 0) !== 0,
      // Mute produces nothing; bypass (and the panel's own switch) hands the
      // same-typed input through to whoever consumed the output.
      bypass: (node.mode ?? 0) !== 2,
      /** Hidden in the panel's view: the node still runs with these values. */
      hidden: override?.hidden === true,
      order: orderOf(node),
      fields,
      randomSeed: override?.randomSeed === true,
    }
    if (file !== undefined) {
      const fileValue = Object.hasOwn(values, file) ? values[file] : node.widgets_values_named?.[file]
      card.file = { widget: file, value: typeof fileValue === 'string' ? fileValue : '' }
      card.fields = fields.filter((field) => field.name !== file)
    }
    if (saveTarget !== null) {
      card.saveTarget = { widget: saveTarget.name, value: saveField }
      card.fields = card.fields.filter((field) => field.name !== saveTarget.name)
      saveTargets.push({ id, title: card.title, widget: saveTarget.name, value: saveField })
    }
    cards.push(card)
  }
  cards.push(saveCard(config, saveTargets))
  return cards
}

/** Coerce one value to the type its declared input expects. */
export function coerce(value, spec) {
  if (spec === undefined || spec === null) return value
  const type = spec.type
  if (type === 'INT') {
    const number = Number(value)
    return Number.isFinite(number) ? Math.round(number) : value
  }
  if (type === 'FLOAT') {
    const number = Number(value)
    return Number.isFinite(number) ? number : value
  }
  if (type === 'BOOLEAN') {
    if (typeof value === 'boolean') return value
    if (typeof value === 'number') return value !== 0
    if (typeof value === 'string') return value === 'true' || value === '1'
    return Boolean(value)
  }
  if (type === 'STRING') return value === null || value === undefined ? '' : String(value)
  return value
}

/** Join a save subfolder and a filename prefix the way ComfyUI expects. */
export function joinPrefix(subfolder, prefix) {
  const dir = String(subfolder ?? '').trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  const base = String(prefix ?? '').replace(/^\/+/, '')
  if (dir === '') return prefix
  return `${dir}/${base}`
}

/**
 * Follow a link through a skipped node, the way ComfyUI's Bypass does.
 *
 * Bypass (mode 4) does not mean "remove this node": it means "do not execute it,
 * and hand its inputs straight to whatever consumed its outputs". That is why a
 * bypassed `LoRA → MODEL` chain still produces a usable sampler: the sampler's
 * `model` input ends up on the loader behind the chain. Mute (mode 2) is the
 * other thing — the node produces nothing, and its consumers lose the input.
 *
 * @param {Map<number, any[]>} links - linkId → link tuple.
 * @param {Map<string, object>} nodeById
 * @param {Set<string>} included - node ids that will be executed.
 * @param {string} sourceId - the skipped node.
 * @param {number} sourceSlot - which of its outputs the consumer asked for.
 * @param {Set<string>} seen - cycle guard.
 * @returns {[string, number] | null} the nearest executing ancestor with the same
 *   type, or `null` when the value cannot be produced.
 */
export function resolveThroughSkipped(links, nodeById, included, sourceId, sourceSlot, seen = new Set()) {
  if (seen.has(sourceId)) return null
  seen.add(sourceId)
  const node = nodeById.get(sourceId)
  if (node === undefined) return null
  // Mute produces nothing; only bypass passes through.
  if ((node.mode ?? 0) === 2) return null
  const outputs = Array.isArray(node.outputs) ? node.outputs : []
  const type = outputs[sourceSlot]?.type
  const inputs = Array.isArray(node.inputs) ? node.inputs : []
  const candidates = []
  for (const [index, input] of inputs.entries()) {
    if (input?.link === null || input?.link === undefined) continue
    if (type !== undefined && type !== '*' && input.type !== type && input.type !== '*') continue
    candidates.push({ index, input })
  }
  if (candidates.length === 0) return null
  // Same slot first, then any input of the matching type: a LoRA's `model` sits
  // at slot 0 matching its MODEL output, while a multi-output node with two
  // same-typed slots (positive/negative) stays predictable.
  const chosen = candidates.find((candidate) => candidate.index === sourceSlot) ?? candidates[0]
  const upstream = links.get(chosen.input.link)
  if (upstream === undefined) return null
  const upstreamId = String(upstream[1])
  if (included.has(upstreamId)) return [upstreamId, upstream[2]]
  return resolveThroughSkipped(links, nodeById, included, upstreamId, upstream[2], seen)
}

/**
 * Turn one workflow plus the panel's configuration into an API prompt.
 *
 * @param {object} input
 * @param {object} input.raw - UI-format workflow JSON.
 * @param {object|null} [input.config] - `{nodes: {[id]: {enabled, values, randomSeed}}, save}`.
 * @param {object|null} objectInfo - the server's `/object_info`; `null` skips schema checks.
 * @param {{random?: () => number}} [options]
 * @returns {{prompt: object, seeds: Record<string, number>, warnings: string[], errors: string[], values: object}}
 */
export function buildPrompt(input, objectInfo = null, options = {}) {
  const random = options.random ?? Math.random
  const now = options.now instanceof Date ? options.now : new Date()
  const raw = input?.raw
  const config = input?.config ?? null
  const links = linkMap(raw)
  const warnings = []
  const errors = []
  const seeds = {}
  const seedFields = {}
  const valuesByNode = {}
  const prompt = {}

  const nodes = Array.isArray(raw?.nodes) ? raw.nodes.filter((node) => node !== null && typeof node === 'object') : []
  const nodeById = new Map(nodes.map((node) => [String(node.id), node]))
  // Two reasons a node stays out of the prompt: the user switched its card off,
  // or it is editor furniture (Label, Bypasser, Note, Reroute, Comparer). The
  // second group never reaches ComfyUI's API, so anything wired to it has to
  // lose that wire here rather than at validation time.
  const included = new Set()
  for (const node of nodes) {
    const id = String(node.id)
    if (classify(node) === null) continue
    if (nodeEnabled(node, config?.nodes?.[id] ?? null) !== true) continue
    included.add(id)
  }

  for (const node of nodes) {
    const id = String(node.id)
    if (included.has(id) !== true) continue
    const type = String(node.type)
    const info = inputSpecs(objectInfo, type)
    if (objectInfo !== null && info === null) {
      errors.push(`服务器上没有节点类型「${type}」（节点 #${id}）——是不是缺了对应的自定义节点包？`)
      continue
    }
    const override = config?.nodes?.[id] ?? null
    const userValues = override?.values ?? {}
    const inputs = {}
    const linkedWidgets = new Set()

    for (const input_ of Array.isArray(node.inputs) ? node.inputs : []) {
      if (input_.link === null || input_.link === undefined) continue
      const link = links.get(input_.link)
      if (link === undefined) continue
      const sourceId = String(link[1])
      const widgetName = typeof input_.widget?.name === 'string' ? input_.widget.name : undefined
      const spec = info?.specs.get(input_.name)
      // A skipped source is not necessarily a missing value: Bypass hands the
      // same-typed input through, so a disabled LoRA/TE-speed node leaves the
      // sampler connected to the loader behind it.
      const target = included.has(sourceId)
        ? [sourceId, link[2]]
        : resolveThroughSkipped(links, nodeById, included, sourceId, link[2])
      if (target === null) {
        const sourceNode = nodeById.get(sourceId)
        const reason = sourceNode === undefined
          ? '未知节点'
          : classify(sourceNode) === null
            ? sourceNode.type
            : (sourceNode.mode ?? 0) === 2
              ? '静音节点'
              : '已旁路的节点（没有同类型输入可直通）'
        // A converted widget keeps working without its source: the node falls
        // back to the value it carries itself, which is handled below. Only a
        // socket that cannot be filled any other way is worth a warning, and only
        // when it is required — the optional image slots of a text encoder are
        // routinely bypassed, and listing eight of them buries the one that matters.
        if (widgetName === undefined && spec !== undefined && spec.section === 'required') {
          warnings.push(`节点 #${id} 的输入「${input_.name}」来自${reason} #${sourceId}，本次不会连接`)
        }
        continue
      }
      if (widgetName !== undefined) linkedWidgets.add(widgetName)
      inputs[input_.name] = target
    }

    const applied = {}
    for (const entry of namedWidgets(node, objectInfo)) {
      const { name, spec } = entry
      if (linkedWidgets.has(name)) continue
      let value = Object.hasOwn(userValues, name) ? userValues[name] : entry.value
      if (value === undefined) continue
      value = coerce(value, spec)
      // The ComfyUI frontend expands `%date:…%` in every string input before
      // queueing; without it a filename prefix stays literal and every run lands
      // in the same `_00001_` slot.
      if (typeof value === 'string') value = expandDatePlaceholders(value, now)
      if (SEED_HINT.test(name)) {
        const numeric = Number(value)
        const wantsRandom = override?.randomSeed === true
        if (wantsRandom || !Number.isFinite(numeric) || numeric < 0) {
          value = rollSeed(random)
          seeds[id] = value
        } else {
          value = Math.round(numeric)
          seeds[id] = value
        }
        seedFields[id] = name
      }
      // The save card owns every save node's destination: a per-node override from
      // the panel first, then the shared subdirectory in front of it.
      const saveTarget = saveTargetOf(node)
      if (saveTarget !== null && saveTarget.name === name) {
        const prefixes = config?.save?.prefixes
        const overridden = prefixes !== null && typeof prefixes === 'object' ? prefixes[id] : undefined
        if (typeof overridden === 'string' && overridden.trim() !== '') value = overridden.trim()
        if (typeof config?.save?.subfolder === 'string' && config.save.subfolder.trim() !== '') {
          value = joinPrefix(config.save.subfolder, value)
        }
      }
      inputs[name] = value
      applied[name] = value
    }

    prompt[id] = { class_type: type, inputs, _meta: { title: cardTitle(node) } }
    valuesByNode[id] = { type, title: cardTitle(node), values: applied }
  }

  if (Object.keys(prompt).length === 0) {
    errors.push('这个工作流没有任何可执行的节点：所有卡片都被停用了')
  }

  return { prompt, seeds, seedFields, warnings, errors, values: valuesByNode }
}

/**
 * Collect every output file from one `/history` entry, grouped by node id.
 *
 * ComfyUI's own save nodes report `{images|gifs|videos: [{filename, subfolder,
 * type}]}`; custom ones are freer — the Lazy/H3 family returns the finished path
 * as plain text — so a bare string that names a media file counts as a file too.
 */
export function collectOutputs(historyEntry) {
  const out = {}
  const outputs = historyEntry?.outputs
  if (outputs === null || typeof outputs !== 'object') return out
  for (const [nodeId, bucket] of Object.entries(outputs)) {
    if (bucket === null || typeof bucket !== 'object') continue
    const files = []
    const seen = new Set()
    const push = (filename, subfolder, type) => {
      if (filename === '') return
      const key = `${type}/${subfolder}/${filename}`
      if (seen.has(key)) return
      seen.add(key)
      files.push({ kind: mediaKind(filename), filename, subfolder, type })
    }
    for (const list of Object.values(bucket)) {
      if (!Array.isArray(list)) continue
      for (const item of list) {
        if (typeof item === 'string') {
          // A custom save node may report the finished path as text. Only a
          // string that actually names a media file is treated as one; the rest
          // (status lines) is not an output.
          const path = item.trim().replace(/\\/g, '/')
          if (path === '' || mediaKind(path) === 'unknown') continue
          const index = path.lastIndexOf('/')
          if (index === -1) push(path, '', 'output')
          else push(path.slice(index + 1), path.slice(0, index), 'output')
          continue
        }
        if (item === null || typeof item !== 'object') continue
        const filename = typeof item.filename === 'string' ? item.filename : ''
        push(filename, typeof item.subfolder === 'string' ? item.subfolder : '', typeof item.type === 'string' ? item.type : 'output')
      }
    }
    if (files.length > 0) out[nodeId] = files
  }
  return out
}

/** Turn the server's `node_errors` into one readable line. */
export function describePromptError(body) {
  const errors = body?.node_errors
  const lines = []
  if (errors !== null && typeof errors === 'object') {
    for (const [nodeId, detail] of Object.entries(errors)) {
      const title = detail?.class_type ?? ''
      const messages = Array.isArray(detail?.errors) ? detail.errors : []
      for (const item of messages) {
        lines.push(`节点 #${nodeId}${title === '' ? '' : `（${title}）`}：${item?.message ?? '校验失败'}${item?.details === undefined ? '' : ` — ${item.details}`}`)
      }
    }
  }
  if (lines.length === 0 && typeof body?.error === 'string') lines.push(body.error)
  if (lines.length === 0) lines.push('服务器拒绝了这次提交，但没有给出原因')
  return lines.join('\n')
}

/** The default per-node configuration of a freshly imported workflow. */
export function defaultConfig(raw, objectInfo = null) {
  const nodes = {}
  for (const node of Array.isArray(raw?.nodes) ? raw.nodes : []) {
    if (node === null || typeof node !== 'object') continue
    nodes[String(node.id)] = { enabled: (node.mode ?? 0) === 0 }
  }
  const save = { subfolder: '', localDir: '' }
  return { nodes, save }
}
