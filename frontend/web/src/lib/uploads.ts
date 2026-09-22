import type { UploadRules } from '@/types/api'

// Client-side checks that mirror the server's rules (app/core/uploads.py and
// the limits in GET /config/uploads). They exist so a wrong file is refused
// before anything uploads, not to be trusted: the server checks all of it again.

const MB = 1024 * 1024

export function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.')
  return dot === -1 ? '' : filename.slice(dot).toLowerCase()
}

export function contentTypeFor(filename: string, rules: UploadRules): string | null {
  return rules.accepted[extensionOf(filename)] ?? null
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < MB) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / MB).toFixed(bytes < 10 * MB ? 1 : 0)} MB`
}

// "PDF, DOC, DOCX, PNG or JPG" from the accepted extensions, JPEG folded into JPG.
export function acceptedLabel(rules: UploadRules): string {
  const names = [
    ...new Set(
      Object.keys(rules.accepted).map((ext) => ext.slice(1).toUpperCase().replace('JPEG', 'JPG')),
    ),
  ]
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} or ${names.at(-1)}` : (names[0] ?? '')
}

export interface Rejection {
  name: string
  reason: string
}

export interface Existing {
  count: number
  bytes: number
}

const sameFile = (a: { name: string; size: number }, b: { name: string; size: number }) =>
  a.name === b.name && a.size === b.size

/**
 * Split a selection into what can be added and what can't, with a reason per
 * refused file. Files already on the case (`existing`) count toward the limits;
 * `already` are files already in the list, so picking the same file twice is a
 * no-op with a reason rather than a silent duplicate.
 */
export function validateSelection(
  files: File[],
  existing: Existing,
  already: { name: string; size: number }[],
  rules: UploadRules,
): { accepted: File[]; rejected: Rejection[] } {
  const accepted: File[] = []
  const rejected: Rejection[] = []
  let count = existing.count
  let bytes = existing.bytes

  for (const file of files) {
    const name = file.name
    if (contentTypeFor(name, rules) === null) {
      rejected.push({
        name,
        reason: `isn't an accepted file type. Use ${acceptedLabel(rules)}.`,
      })
    } else if (file.size === 0) {
      rejected.push({ name, reason: 'is empty.' })
    } else if (file.size > rules.max_file_size_mb * MB) {
      rejected.push({ name, reason: `is larger than ${rules.max_file_size_mb} MB.` })
    } else if ([...already, ...accepted].some((f) => sameFile(f, file))) {
      rejected.push({ name, reason: 'is already in the list.' })
    } else if (count + 1 > rules.max_files) {
      rejected.push({
        name,
        reason: `doesn't fit: a case can have at most ${rules.max_files} files.`,
      })
    } else if (bytes + file.size > rules.max_case_size_mb * MB) {
      rejected.push({
        name,
        reason: `doesn't fit: a case's files can total at most ${rules.max_case_size_mb} MB.`,
      })
    } else {
      accepted.push(file)
      count += 1
      bytes += file.size
    }
  }
  return { accepted, rejected }
}

// "Sharma_vs_Verma-petition.pdf" -> "Sharma vs Verma petition"
export function titleFromFilename(filename: string): string {
  const dot = filename.lastIndexOf('.')
  const base = dot > 0 ? filename.slice(0, dot) : filename
  return base.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 255)
}

/** Run `worker` over `items`, at most `limit` at a time. Never rejects: the
 *  worker is expected to record its own failures. */
export async function runPool<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0
  const lane = async () => {
    while (next < items.length) {
      await worker(items[next++] as T)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane))
}
