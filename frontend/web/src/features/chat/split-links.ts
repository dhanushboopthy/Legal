// Chat text is plain text, always: it is split into words and links and
// rendered as React text nodes, never as HTML. Only http and https become links.
const URL_PATTERN = /\bhttps?:\/\/[^\s<>"']+/gi
// Punctuation that usually ends a sentence rather than the address.
const TRAILING = /[.,;:!?)\]}]+$/

export type TextPart = { text: string; href?: string }

export function splitLinks(text: string): TextPart[] {
  const parts: TextPart[] = []
  let last = 0
  for (const match of text.matchAll(URL_PATTERN)) {
    const start = match.index ?? 0
    let url = match[0]
    const trailing = TRAILING.exec(url)?.[0] ?? ''
    if (trailing) url = url.slice(0, url.length - trailing.length)
    if (start > last) parts.push({ text: text.slice(last, start) })
    parts.push({ text: url, href: url })
    last = start + url.length
  }
  if (last < text.length) parts.push({ text: text.slice(last) })
  return parts
}
