'use client'

// Sticky chip strip rendered above category-grouped drug lists. Each chip
// shows a category name + count, colored to match the category. Click to
// scroll-and-open that section. Doubles as an at-a-glance overview of how
// drugs are distributed across categories.
//
// Used by both the standardization-backlog and extract-changes admin views.

interface SectionRef {
  id: string
  name: string
  color: string
  count: number
}

interface Props {
  sections: SectionRef[]
  expanded: Set<string>
  onJump: (id: string) => void
  onExpandAll: () => void
  onCollapseAll: () => void
}

export function CategoryJumpBar({ sections, expanded, onJump, onExpandAll, onCollapseAll }: Props) {
  if (sections.length === 0) return null
  const allExpanded = sections.every(s => expanded.has(s.id))
  return (
    <div className="sticky top-0 z-10 mb-2 border border-[#808080] bg-white p-2"
         style={{ boxShadow: 'inset 1px 1px 0 #fff, inset -1px -1px 0 #808080' }}>
      <div className="flex flex-wrap items-center gap-1.5">
        {sections.map(s => {
          const isOpen = expanded.has(s.id)
          return (
            <button
              key={s.id}
              onClick={() => onJump(s.id)}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-mono border cursor-pointer hover:brightness-95"
              style={{
                backgroundColor: isOpen ? s.color : s.color + '22',
                color: isOpen ? '#fff' : s.color,
                borderColor: s.color,
              }}
              title={`Jump to ${s.name}${isOpen ? ' (open)' : ''}`}
            >
              <span className="font-semibold">{s.name}</span>
              <span className="opacity-90">{s.count}</span>
            </button>
          )
        })}
        <span className="ml-auto text-[10px] text-[#666]">
          <button onClick={allExpanded ? onCollapseAll : onExpandAll}
                  className="underline hover:text-[#0A246A] cursor-pointer">
            {allExpanded ? 'Collapse all' : 'Expand all'}
          </button>
        </span>
      </div>
    </div>
  )
}
