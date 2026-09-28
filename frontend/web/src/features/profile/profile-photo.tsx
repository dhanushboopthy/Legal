import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Camera, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { useAuth } from '@/auth/auth-context'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useToast } from '@/components/ui/toast-context'
import { UserAvatar } from '@/components/ui/user-avatar'
import { removeAvatar, uploadAvatar } from '@/lib/api/users'
import { getErrorMessage } from '@/lib/errors'
import type { UserOut } from '@/types/api'

// Pictures are cropped to a centred square and shrunk before upload, so a
// 10 MB phone photo goes up as a ~60 KB JPEG.
const SIDE = 512
const MAX_SOURCE_MB = 20

async function toSquareJpeg(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  const side = Math.min(bitmap.width, bitmap.height)
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = Math.min(SIDE, side)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Your browser could not prepare the picture.')
  ctx.drawImage(
    bitmap,
    (bitmap.width - side) / 2,
    (bitmap.height - side) / 2,
    side,
    side,
    0,
    0,
    canvas.width,
    canvas.height,
  )
  bitmap.close()
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error('Your browser could not prepare the picture.')),
      'image/jpeg',
      0.88,
    ),
  )
}

export function ProfilePhoto({ user }: { user: UserOut }) {
  const { toast } = useToast()
  const { refreshUser } = useAuth()
  const queryClient = useQueryClient()
  const input = useRef<HTMLInputElement>(null)
  const [picked, setPicked] = useState<{ blob: Blob; preview: string } | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)

  useEffect(
    () => () => {
      if (picked) URL.revokeObjectURL(picked.preview)
    },
    [picked],
  )

  const updated = (fresh: UserOut) => {
    queryClient.setQueryData(['me'], fresh)
    void queryClient.invalidateQueries({ queryKey: ['users'] })
    void refreshUser()
  }

  const save = useMutation({
    mutationFn: (blob: Blob) => uploadAvatar(blob),
    onSuccess: (fresh) => {
      setPicked(null)
      updated(fresh)
      toast({ variant: 'success', title: 'Photo saved' })
    },
    onError: (err) =>
      toast({
        variant: 'error',
        title: "Couldn't save your photo",
        description: getErrorMessage(err),
      }),
  })

  const remove = useMutation({
    mutationFn: removeAvatar,
    onSuccess: (fresh) => {
      setConfirmRemove(false)
      updated(fresh)
      toast({ variant: 'success', title: 'Photo removed' })
    },
    onError: (err) =>
      toast({
        variant: 'error',
        title: "Couldn't remove your photo",
        description: getErrorMessage(err),
      }),
  })

  async function choose(file: File | undefined) {
    if (!file) return
    if (!file.type.startsWith('image/') || file.size > MAX_SOURCE_MB * 1024 * 1024) {
      toast({
        variant: 'error',
        title: "That file can't be used",
        description: `Choose a JPEG or PNG photo under ${MAX_SOURCE_MB} MB.`,
      })
      return
    }
    try {
      const blob = await toSquareJpeg(file)
      setPicked({ blob, preview: URL.createObjectURL(blob) })
    } catch {
      toast({
        variant: 'error',
        title: "That photo couldn't be opened",
        description: 'Choose a JPEG or PNG photo.',
      })
    }
  }

  return (
    <Card>
      <div className="flex flex-col items-center gap-5 text-center sm:flex-row sm:text-left">
        {picked ? (
          <img
            src={picked.preview}
            alt="Your new photo"
            className="size-24 shrink-0 rounded-full object-cover"
          />
        ) : (
          <UserAvatar name={user.full_name} src={user.avatar_url} className="size-24 text-2xl" />
        )}
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold">Profile photo</h2>
          <p className="text-muted mt-0.5 text-sm">
            {picked
              ? 'This is how your photo will look. Save it, or choose another.'
              : 'Shown to the advocate and in your account menu.'}
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-2 sm:justify-start">
            {picked ? (
              <>
                <Button loading={save.isPending} onClick={() => save.mutate(picked.blob)}>
                  Save photo
                </Button>
                <Button variant="ghost" disabled={save.isPending} onClick={() => setPicked(null)}>
                  Cancel
                </Button>
              </>
            ) : (
              <>
                <Button variant="secondary" onClick={() => input.current?.click()}>
                  <Camera className="size-4" aria-hidden />
                  {user.avatar_url ? 'Change photo' : 'Add photo'}
                </Button>
                {user.avatar_url && (
                  <Button variant="ghost" onClick={() => setConfirmRemove(true)}>
                    <Trash2 className="size-4" aria-hidden /> Remove
                  </Button>
                )}
              </>
            )}
          </div>
          <input
            ref={input}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            onChange={(e) => {
              void choose(e.target.files?.[0])
              e.target.value = ''
            }}
          />
        </div>
      </div>

      <ConfirmDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title="Remove your photo?"
        description="Your initials will be shown instead. You can add a photo again at any time."
        confirmLabel="Remove photo"
        tone="danger"
        loading={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </Card>
  )
}
