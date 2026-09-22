import { Download, FileText } from 'lucide-react'

import { Sheet } from '@/components/ui/sheet'
import { useToast } from '@/components/ui/toast-context'
import { openDocument } from '@/lib/download'
import { getErrorMessage } from '@/lib/errors'
import { formatBytes } from '@/lib/uploads'
import type { DocumentOut } from '@/types/api'

export function FilesSheet({
  open,
  onOpenChange,
  files,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  files: DocumentOut[]
}) {
  const { toast } = useToast()

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Files" description="What was submitted with this case.">
      {files.length === 0 ? (
        <p className="text-muted text-label">No files uploaded.</p>
      ) : (
        <ul className="space-y-2">
          {files.map((doc) => (
            <li key={doc.id}>
              <button
                onClick={async () => {
                  try {
                    await openDocument(doc.id)
                  } catch (err) {
                    toast({
                      variant: 'error',
                      title: 'Could not open file',
                      description: getErrorMessage(err),
                    })
                  }
                }}
                className="text-label flex w-full items-center gap-2 rounded-[var(--radius-control)] border border-[var(--border)] px-3 py-2.5 text-left transition-colors hover:bg-black/[0.02]"
              >
                <FileText className="size-4 shrink-0 text-[var(--fg-muted)]" />
                <span className="flex-1 truncate">{doc.original_filename}</span>
                {doc.size_bytes !== null && (
                  <span className="text-muted text-caption shrink-0">{formatBytes(doc.size_bytes)}</span>
                )}
                <Download className="size-4 shrink-0 text-[var(--fg-muted)]" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  )
}
