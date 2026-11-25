/**
 * Feishu-specific markdown rendering for dsh-feishu-notify.
 *
 * Feishu's interactive-card JSON 2.0 has a `markdown` content component that
 * renders headings, lists, quotes, inline code and tables. Card JSON 1.0's
 * `lark_md` only supports an inline subset, which is why a plain result body
 * used to show raw `| table |` source instead of a table.
 *
 * Two card-2.0 limits are handled here:
 *  - one markdown component renders at most four tables, so long bodies are
 *    split into several markdown components (never inside a table);
 *  - code fences are not rendered, so they are turned into blockquotes of
 *    inline-code lines.
 *
 * A card-1.0 fallback is kept for clients that reject JSON 2.0.
 */

const DEFAULT_MAX_TABLES = 4
const DEFAULT_MAX_CHARS = 7000
const TABLE_HEADER = /^\s*\|.*\|\s*$/
const TABLE_SEPARATOR = /^\s*\|?[\s:|-]+\|?\s*$/
const TABLE_ROW = /^\s*\|/
const FENCE = /^\s*```/

/**
 * Turn fenced code blocks into blockquotes of inline-code lines.
 *
 * @param {string} markdown
 * @returns {string}
 */
export function convertFencesForFeishu(markdown) {
  const lines = String(markdown ?? '').replace(/\r\n/g, '\n').split('\n')
  const out = []
  let fenced = false
  for (const line of lines) {
    if (FENCE.test(line)) {
      fenced = !fenced
      out.push(fenced ? '**代码：**' : '')
      continue
    }
    if (!fenced) {
      out.push(line)
      continue
    }
    const text = line.replace(/`/g, 'ˋ')
    out.push(text.trim() === '' ? '>' : '> `' + text + '`')
  }
  return out.join('\n')
}

/**
 * Split one message into markdown chunks. A table is copied as a whole block,
 * and a new chunk starts before a table that would exceed the per-component
 * limit, so tables are never cut in half.
 *
 * @param {string} markdown
 * @param {{ maxTables?: number, maxChars?: number }} [limits]
 * @returns {string[]}
 */
export function splitMarkdownForFeishu(markdown, limits = {}) {
  const maxTables =
    Number.isInteger(limits.maxTables) && limits.maxTables > 0 ? limits.maxTables : DEFAULT_MAX_TABLES
  const maxChars =
    Number.isInteger(limits.maxChars) && limits.maxChars > 500 ? limits.maxChars : DEFAULT_MAX_CHARS
  const lines = String(markdown ?? '').replace(/\r\n/g, '\n').split('\n')
  const chunks = []
  let chunk = []
  let tables = 0
  let chars = 0
  const flush = () => {
    if (chunk.length > 0) chunks.push(chunk.join('\n'))
    chunk = []
    tables = 0
    chars = 0
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const tableStart =
      TABLE_HEADER.test(line) && index + 1 < lines.length && TABLE_SEPARATOR.test(lines[index + 1])
    if (tableStart && tables >= maxTables) flush()
    if (tableStart) {
      tables += 1
      // Copy the header, separator and every following row line verbatim.
      chunk.push(line)
      chars += line.length + 1
      index += 1
      const separator = lines[index]
      chunk.push(separator)
      chars += separator.length + 1
      while (index + 1 < lines.length && TABLE_ROW.test(lines[index + 1])) {
        index += 1
        chunk.push(lines[index])
        chars += lines[index].length + 1
      }
      continue
    }
    if (chars + line.length > maxChars && chunk.length > 0) flush()
    chunk.push(line)
    chars += line.length + 1
  }
  flush()
  return chunks.length > 0 ? chunks : ['']
}

/**
 * Build the Feishu card JSON 2.0 used for completion pushes.
 *
 * @param {string} body markdown body
 * @returns {object}
 */
export function buildCard(body) {
  const content = convertFencesForFeishu(body)
  const elements = splitMarkdownForFeishu(content).map((chunk) => ({ tag: 'markdown', content: chunk }))
  return {
    schema: '2.0',
    config: { update_multi: true },
    header: {
      title: { tag: 'plain_text', content: 'DeepSeek Harness · 会话完成' },
      template: 'blue',
    },
    body: { elements },
  }
}

/**
 * Card JSON 1.0 fallback: flatten markdown for a `lark_md` element.
 *
 * @param {string} body markdown body
 * @returns {object}
 */
export function buildLegacyCard(body) {
  const lines = String(body ?? '').replace(/\r\n/g, '\n').split('\n')
  const out = []
  let fenced = false
  let tableHeader = null
  for (const line of lines) {
    if (FENCE.test(line)) {
      fenced = !fenced
      continue
    }
    if (fenced) {
      if (line.trim() !== '') out.push('> ' + line)
      continue
    }
    if (TABLE_HEADER.test(line)) {
      const cells = line
        .trim()
        .replace(/^\||\|$/g, '')
        .split('|')
        .map((cell) => cell.trim())
      if (tableHeader === null) {
        tableHeader = cells
        continue
      }
      if (cells.every((cell) => /^[\s:|-]*$/.test(cell))) continue
      const parts = cells
        .map((cell, index) => (tableHeader[index] ? tableHeader[index] + '：' + cell : cell))
        .filter((part) => part !== '')
      out.push('• ' + parts.join(' · '))
      continue
    }
    tableHeader = null
    const heading = /^\s*(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      out.push('**' + heading[2] + '**')
      continue
    }
    if (/^\s*[-*]\s+/.test(line)) {
      out.push('• ' + line.replace(/^\s*[-*]\s+/, ''))
      continue
    }
    out.push(line)
  }
  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: 'DeepSeek Harness · 会话完成' },
      template: 'blue',
    },
    elements: [{ tag: 'div', text: { tag: 'lark_md', content: out.join('\n') } }],
  }
}
