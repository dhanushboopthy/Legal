import { getDownloadUrl } from '@/lib/api/documents'

/**
 * Open a stored document in a new tab.
 *
 * The link has to be fetched from the server first, and a browser only lets a
 * tab open in direct response to a tap, not after a request. So the tab is
 * opened right away, blank, and pointed at the link once it arrives; if the
 * link can't be had, the blank tab is closed and the error is thrown.
 */
export async function openDocument(documentId: string): Promise<void> {
  const tab = window.open('', '_blank')
  try {
    const url = await getDownloadUrl(documentId)
    if (tab) {
      tab.opener = null
      tab.location.href = url
    } else {
      // Pop-ups blocked outright: fall back to leaving this page for the file.
      window.location.assign(url)
    }
  } catch (err) {
    tab?.close()
    throw err
  }
}
