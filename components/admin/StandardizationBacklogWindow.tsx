'use client'

import { DesktopWindow } from './DesktopWindow'
import { StandardizationBacklogContent } from '@/app/admin/standardization-backlog/page'

interface Props {
  open: boolean
  minimized?: boolean
  focused?: boolean
  onClose: () => void
  onMinimize?: () => void
  onFocus?: () => void
  zIndex?: number
}

// Floating-desktop-window flavor of the Standardization Backlog. Same content
// as the route at /admin/standardization-backlog — see
// StandardizationBacklogContent — just rendered inside a draggable/resizable
// window on the main desktop.
export function StandardizationBacklogWindow(props: Props) {
  return (
    <DesktopWindow
      icon="🛠️"
      title="Standardization Backlog"
      subtitle="(architect+)"
      initialSize={{ w: 1200, h: 720 }}
      minSize={{ w: 700, h: 480 }}
      {...props}
    >
      <StandardizationBacklogContent />
    </DesktopWindow>
  )
}
