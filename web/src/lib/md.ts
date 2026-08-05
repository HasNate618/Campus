import { marked, type Tokens } from 'marked'
import katex from 'katex'
import 'katex/dist/katex.min.css'

/**
 * Shared markdown → HTML for the chat (and content) renderers.
 *
 * marked is configured globally here (its config is module-global) with:
 *   - GFM + breaks
 *   - LaTeX: $...$ inline and $$...$$ block via katex (marked extensions)
 *   - Footnotes: [^n] refs + [^n]: definition lines (pre-processed, since
 *     marked has no native footnote support)
 */

// ── LaTeX ──────────────────────────────────────────────────────────────

const katexInline = {
  name: 'katexInline',
  level: 'inline' as const,
  start: (src: string) => src.indexOf('$'),
  tokenizer: (src: string) => {
    // $$ is block math — never match it here
    const match = src.match(/^\$(?!\$)([^$\n]+)\$/)
    if (match) return { type: 'katexInline', raw: match[0], text: match[1] } as Tokens.Generic
    return undefined
  },
  renderer: (token: Tokens.Generic) =>
    katex.renderToString(token.text as string, { throwOnError: false, displayMode: false }),
}

const katexBlock = {
  name: 'katexBlock',
  level: 'block' as const,
  start: (src: string) => src.indexOf('$$'),
  tokenizer: (src: string) => {
    const match = src.match(/^\$\$([\s\S]+?)\$\$/)
    if (match) return { type: 'katexBlock', raw: match[0], text: match[1] } as Tokens.Generic
    return undefined
  },
  renderer: (token: Tokens.Generic) =>
    `<div class="katex-block">${katex.renderToString(token.text as string, {
      throwOnError: false,
      displayMode: true,
    })}</div>`,
}

// ── Footnotes ──────────────────────────────────────────────────────────

/** Rewrite [^n] refs + definition lines into numbered superscript links and
 *  an appended footnote list. Definitions and refs inside fenced code blocks
 *  are left untouched. */
function renderFootnotes(md: string): string {
  const defs = new Map<string, string>()
  const used = new Map<string, number>()
  const out: string[] = []
  let inFence = false

  for (const line of md.split('\n')) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence
      out.push(line)
      continue
    }
    if (inFence) {
      out.push(line)
      continue
    }
    const dm = line.match(/^\[\^([\w-]+)\]:\s*(.*)$/)
    if (dm) {
      defs.set(dm[1], dm[2].trim())
      continue // drop the definition line from the body
    }
    const withRefs = line.replace(/\[\^([\w-]+)\]/g, (_m, key: string) => {
      if (!used.has(key)) used.set(key, used.size + 1)
      const n = used.get(key)!
      return `<sup class="fn-ref"><a id="fnref-${n}" href="#fn-${n}">[${n}]</a></sup>`
    })
    out.push(withRefs)
  }

  const items: string[] = []
  for (const [key, n] of [...used.entries()].sort((a, b) => a[1] - b[1])) {
    const def = defs.get(key)
    if (def) {
      items.push(
        `<li id="fn-${n}">${def} <a class="fn-back" href="#fnref-${n}" aria-label="Back to reference">↩</a></li>`,
      )
    }
  }
  if (items.length === 0) return out.join('\n')
  return `${out.join('\n')}\n\n<div class="footnotes"><hr /><ol>${items.join('')}</ol></div>`
}

marked.use({ gfm: true, breaks: true })
marked.use({ extensions: [katexInline, katexBlock] })

/** While a message is still streaming, the model types the opening fence
 *  (```python) token by token — marked would render the half-typed fence as
 *  literal backticks at the top of the block. If the content has an
 *  unmatched line-start fence, append a closing fence so the partial code
 *  renders as a (growing) code block instead of raw ``` garbage. */
function balanceFences(md: string): string {
  const open = (md.match(/^\s*```/gm) ?? []).length
  if (open % 2 === 1) return `${md}\n\`\`\``
  return md
}

export function parseMarkdown(content: string): string {
  return (marked.parse(balanceFences(renderFootnotes(content ?? ''))) as string) || ''
}
