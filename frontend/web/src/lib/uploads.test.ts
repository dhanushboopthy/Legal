import { describe, expect, it } from 'vitest'

import {
  acceptedLabel,
  contentTypeFor,
  formatBytes,
  runPool,
  titleFromFilename,
  validateSelection,
} from '@/lib/uploads'
import type { UploadRules } from '@/types/api'

const rules: UploadRules = {
  max_files: 3,
  max_file_size_mb: 1,
  max_case_size_mb: 2,
  accepted: {
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
  },
}
const file = (name: string, size = 1000) => new File([new Uint8Array(size)], name)
const none = { count: 0, bytes: 0 }

describe('validateSelection', () => {
  it('accepts every allowed type, whatever the case of the extension', () => {
    const files = ['a.pdf', 'b.DOCX', 'c.doc', 'd.PNG', 'e.jpeg'].map((n) => file(n))
    const { accepted, rejected } = validateSelection(files.slice(0, 3), none, [], rules)
    expect(accepted).toHaveLength(3)
    expect(rejected).toEqual([])
  })

  it('refuses a type that is not allowed, naming the file and the allowed types', () => {
    const { accepted, rejected } = validateSelection(
      [file('run.exe'), file('a.pdf')],
      none,
      [],
      rules,
    )
    expect(accepted.map((f) => f.name)).toEqual(['a.pdf'])
    expect(rejected).toEqual([
      { name: 'run.exe', reason: "isn't an accepted file type. Use PDF, DOC, DOCX, PNG or JPG." },
    ])
  })

  it('refuses empty and oversize files', () => {
    const { rejected } = validateSelection(
      [file('empty.pdf', 0), file('big.pdf', 1024 * 1024 + 1)],
      none,
      [],
      rules,
    )
    expect(rejected.map((r) => r.reason)).toEqual(['is empty.', 'is larger than 1 MB.'])
  })

  it('counts files already on the case toward the file limit', () => {
    const { accepted, rejected } = validateSelection(
      [file('a.pdf'), file('b.pdf')],
      { count: 2, bytes: 0 },
      [],
      rules,
    )
    expect(accepted.map((f) => f.name)).toEqual(['a.pdf'])
    expect(rejected[0]?.reason).toContain('at most 3 files')
  })

  it('counts existing bytes toward the total limit', () => {
    const { accepted, rejected } = validateSelection(
      [file('a.pdf', 600_000), file('b.pdf', 600_000)],
      { count: 0, bytes: 1_000_000 * 1.4 },
      [],
      rules,
    )
    expect(accepted).toHaveLength(1)
    expect(rejected[0]?.reason).toContain('at most 2 MB')
  })

  it('does not add the same file twice, in one pick or across picks', () => {
    const dup = validateSelection([file('a.pdf'), file('a.pdf')], none, [], rules)
    expect(dup.accepted).toHaveLength(1)
    expect(dup.rejected[0]?.reason).toBe('is already in the list.')
    const again = validateSelection([file('a.pdf')], none, [{ name: 'a.pdf', size: 1000 }], rules)
    expect(again.accepted).toEqual([])
  })
})

describe('helpers', () => {
  it('maps an extension to the content type the server signs', () => {
    expect(contentTypeFor('x.JPG', rules)).toBe('image/jpeg')
    expect(contentTypeFor('x.txt', rules)).toBeNull()
    expect(contentTypeFor('noextension', rules)).toBeNull()
  })

  it('lists the accepted types once each', () => {
    expect(acceptedLabel(rules)).toBe('PDF, DOC, DOCX, PNG or JPG')
  })

  it('formats sizes', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2 KB')
    expect(formatBytes(3.5 * 1024 * 1024)).toBe('3.5 MB')
    expect(formatBytes(25 * 1024 * 1024)).toBe('25 MB')
  })

  it('turns a file name into a title', () => {
    expect(titleFromFilename('Sharma_vs_Verma-petition.pdf')).toBe('Sharma vs Verma petition')
    expect(titleFromFilename('scan.final.png')).toBe('scan.final')
    expect(titleFromFilename('noext')).toBe('noext')
  })
})

describe('runPool', () => {
  it('never runs more than `limit` at once, and runs everything', async () => {
    let active = 0
    let peak = 0
    const done: number[] = []
    await runPool([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      active += 1
      peak = Math.max(peak, active)
      await new Promise((r) => setTimeout(r, 5))
      active -= 1
      done.push(n)
    })
    expect(peak).toBe(3)
    expect(done.sort()).toEqual([1, 2, 3, 4, 5, 6, 7])
  })

  it('handles an empty list', async () => {
    await runPool([], 3, async () => {})
  })
})
