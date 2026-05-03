'use client'

import { DesktopWindow } from './DesktopWindow'
import { ExtractChangesContent } from '@/app/admin/extract-changes/page'

interface Props {
  open: boolean
  minimized?: boolean
  focused?: boolean
  onClose: () => void
  onMinimize?: () => void
  onFocus?: () => void
  zIndex?: number
}

// Floating-desktop-window flavor of the Extract Changeset Viewer. Same
// content as the route at /admin/extract-changes — see ExtractChangesContent
// — just rendered inside a draggable/resizable window on the main desktop
// instead of as a standalone Next route.
export function ExtractChangesWindow(props: Props) {
  return (
    <DesktopWindow
      icon="📊"
      title="Extract Changeset Viewer"
      initialSize={{ w: 1200, h: 760 }}
      minSize={{ w: 700, h: 480 }}
      {...props}
    >
      <ExtractChangesContent />
    </DesktopWindow>
  )
}
