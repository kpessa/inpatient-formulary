"use client"

import { useState, useEffect } from "react"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { OEDefaultsTab } from "@/components/formulary/OEDefaultsTab"
import { DispenseTab } from "@/components/formulary/DispenseTab"
import { InventoryTab } from "@/components/formulary/InventoryTab"
import { ClinicalTab } from "@/components/formulary/ClinicalTab"
import { SupplyTab } from "@/components/formulary/SupplyTab"
import { IdentifiersTab } from "@/components/formulary/IdentifiersTab"
import { FormField } from "@/components/formulary/FormField"

type TabId = "oe-defaults" | "dispense" | "inventory" | "clinical" | "supply" | "identifiers" | "tpn-details" | "change-log"

// Clinical pharmacy formulary interface v2
const TABS: { id: TabId; label: string }[] = [
  { id: "oe-defaults", label: "OE Defaults" },
  { id: "dispense", label: "Dispense" },
  { id: "inventory", label: "Inventory" },
  { id: "clinical", label: "Clinical" },
  { id: "supply", label: "Supply" },
  { id: "identifiers", label: "Identifiers" },
  { id: "tpn-details", label: "TPN Details" },
  { id: "change-log", label: "Change Log" },
]

const TOOLBAR_ICONS = [
  "📄", "💾", "✂️", "📋", "🔍", "⭐", "🔧", "📊", "🏷️", "📋", "📦", "📊", "🔍"
]

function ToolbarIcon({ children }: { children: React.ReactNode }) {
  return (
    <button className="w-6 h-6 flex items-center justify-center border border-[#808080] bg-[#D4D0C8] hover:bg-[#E8E8E0] active:bg-[#B0A898] text-xs leading-none">
      {children}
    </button>
  )
}

export default function PharmNetFormulary() {
  const [activeTab, setActiveTab] = useState<TabId>("oe-defaults")
  const [searchValue, setSearchValue] = useState("")
  const [dateStr, setDateStr] = useState<string | null>(null)
  const [timeStr, setTimeStr] = useState<string | null>(null)

  useEffect(() => {
    const updateTime = () => {
      const now = new Date()
      setDateStr(`${now.getMonth() + 1}/${now.getDate()}/${now.getFullYear()}`)
      setTimeStr(now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }))
    }
    updateTime()
    const interval = setInterval(updateTime, 60000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="min-h-screen bg-[#808080] flex items-start justify-center p-4">
    <div
      className="flex flex-col bg-[#D4D0C8] font-mono text-xs select-none shadow-lg w-full max-w-[740px] min-h-[620px]"
    >
      {/* Title bar */}
      <div className="flex items-center justify-between bg-[#C85A00] text-white px-2 h-7 shrink-0">
        <div className="flex items-center gap-1.5">
          {/* App icon placeholder */}
          <div className="w-4 h-4 bg-white/20 border border-white/40 flex items-center justify-center text-[8px]">Rx</div>
          <span className="text-sm font-bold font-mono tracking-tight">PharmNet Inpatient Formulary Manager</span>
        </div>
        {/* Window controls */}
        <div className="flex gap-1">
          <button className="w-5 h-5 border border-white/40 bg-[#D4D0C8] text-black flex items-center justify-center text-[10px] leading-none">─</button>
          <button className="w-5 h-5 border border-white/40 bg-[#D4D0C8] text-black flex items-center justify-center text-[10px] leading-none">□</button>
          <button className="w-5 h-5 border border-white/40 bg-[#D4D0C8] text-black flex items-center justify-center text-[10px] leading-none">✕</button>
        </div>
      </div>

      {/* Menu bar */}
      <div className="flex items-center gap-4 bg-[#D4D0C8] px-2 h-6 border-b border-[#808080] shrink-0">
        {["Task", "Edit", "View", "Help"].map((item) => (
          <button key={item} className="text-xs font-mono px-1 hover:bg-[#316AC5] hover:text-white">
            {item}
          </button>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-1 bg-[#D4D0C8] px-2 py-1 border-b border-[#808080] shrink-0">
        <div className="flex gap-0.5 mr-1">
          {[..."📄💾✂️📋"].map((icon, i) => (
            <ToolbarIcon key={i}>{icon}</ToolbarIcon>
          ))}
        </div>
        <div className="w-px h-5 bg-[#808080] mx-0.5" />
        <div className="flex gap-0.5 mr-1">
          {[..."🔍⚡"].map((icon, i) => (
            <ToolbarIcon key={i}>{icon}</ToolbarIcon>
          ))}
        </div>
        <div className="w-px h-5 bg-[#808080] mx-0.5" />
        <div className="flex gap-0.5 mr-1">
          {[..."📊📋📦🏷️🔧📊"].map((icon, i) => (
            <ToolbarIcon key={i}>{icon}</ToolbarIcon>
          ))}
        </div>
        <div className="w-px h-5 bg-[#808080] mx-0.5" />
        <div className="flex gap-0.5">
          {["⬛"].map((icon, i) => (
            <ToolbarIcon key={i}>{icon}</ToolbarIcon>
          ))}
        </div>
        {/* Search area */}
        <div className="flex items-center gap-1 ml-auto">
          <span className="text-xs font-mono">Search for:</span>
          <Input
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            className="h-5 text-xs font-mono rounded-none border-[#808080] px-1 py-0 w-40 bg-white"
          />
          <button className="w-6 h-5 border border-[#808080] bg-[#D4D0C8] flex items-center justify-center text-xs">
            🔍
          </button>
        </div>
      </div>

      {/* Global fields area */}
      <div className="px-3 py-2 bg-[#D4D0C8] border-b border-[#808080] shrink-0">
        {/* Row 1: Description / Strength / Status / Therapeutic Substitutions */}
        <div className="flex gap-3 items-end mb-2">
          <FormField label="Description:" required className="flex-1 min-w-0 max-w-[220px]">
            <Input
              defaultValue="acetaminophen 500 mg Tab"
              className="w-full text-xs font-mono rounded-none border-[#808080] px-1 border bg-white"
            />
          </FormField>
          <FormField label="Strength:" required className="w-28">
            <Input
              defaultValue="500 mg"
              className="w-full text-xs font-mono rounded-none border-[#808080] px-1 border bg-white"
            />
          </FormField>
          <FormField label="Status:" className="w-28">
            <Input
              defaultValue="Active"
              disabled
              className="w-full text-xs font-mono rounded-none border-[#808080] px-1 border bg-[#D4D0C8]"
            />
          </FormField>
          <div className="flex items-start gap-1 pb-0.5 ml-2">
            <Checkbox className="rounded-none border-[#808080] h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span className="text-xs font-mono leading-tight">Therapeutic<br />Substitutions</span>
          </div>
        </div>

        {/* Row 2: Generic / Dosage form / Legal status / Mnemonic */}
        <div className="flex gap-3 items-end">
          <FormField label="Generic:" required className="flex-1 min-w-0 max-w-[220px]">
            <Input
              defaultValue="acetaminophen"
              className="w-full text-xs font-mono rounded-none border-[#808080] px-1 border bg-white"
            />
          </FormField>
          <FormField label="Dosage form:" required className="w-28">
            <Select defaultValue="tab">
              <SelectTrigger className="w-full text-xs font-mono rounded-none border-[#808080] px-1 border bg-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="text-xs font-mono rounded-none">
                <SelectItem value="tab">Tab</SelectItem>
                <SelectItem value="cap">Cap</SelectItem>
                <SelectItem value="liq">Liquid</SelectItem>
                <SelectItem value="inj">Injection</SelectItem>
                <SelectItem value="patch">Patch</SelectItem>
              </SelectContent>
            </Select>
          </FormField>
          <FormField label="Legal status:" required className="w-28">
            <Select defaultValue="otc">
              <SelectTrigger className="w-full text-xs font-mono rounded-none border-[#808080] px-1 border bg-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="text-xs font-mono rounded-none">
                <SelectItem value="otc">OTC</SelectItem>
                <SelectItem value="rx">Rx</SelectItem>
                <SelectItem value="cii">C-II</SelectItem>
                <SelectItem value="ciii">C-III</SelectItem>
                <SelectItem value="civ">C-IV</SelectItem>
              </SelectContent>
            </Select>
          </FormField>
          <FormField label="Mnemonic:" required className="flex-1 min-w-0 max-w-[140px]">
            <Input
              defaultValue="acetaminophen 5"
              className="w-full text-xs font-mono rounded-none border-[#808080] px-1 border bg-white"
            />
          </FormField>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-0.5 px-3 pt-2 bg-[#D4D0C8] shrink-0 border-b border-[#808080]">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`
              px-1.5 py-0.5 text-xs font-sans border-t border-l border-r border-[#808080] rounded-t-sm
              ${activeTab === tab.id
                ? "bg-[#D4D0C8] border-b-[#D4D0C8] relative z-10 top-[1px] -mb-[1px] shadow-sm pb-1"
                : "bg-[#D4D0C8] hover:bg-[#E0DBD0] mt-0.5 border-b-[#808080]"
              }
            `}
          >
            {activeTab === tab.id ? <u>{tab.label}</u> : tab.label}
          </button>
        ))}
      </div>

      {/* Tab content area */}
      <div className="bg-[#D4D0C8] flex-1 border border-[#808080] mx-3 mb-2 overflow-auto min-h-[420px]">
        {activeTab === "oe-defaults" && <OEDefaultsTab />}
        {activeTab === "dispense" && <DispenseTab />}
        {activeTab === "inventory" && <InventoryTab />}
        {activeTab === "clinical" && <ClinicalTab />}
        {activeTab === "supply" && <SupplyTab />}
        {activeTab === "identifiers" && <IdentifiersTab />}
        {activeTab === "tpn-details" && (
          <div className="p-4 text-xs font-mono text-[#808080]">TPN Details tab content</div>
        )}
        {activeTab === "change-log" && (
          <div className="p-4 text-xs font-mono text-[#808080]">Change Log tab content</div>
        )}
      </div>

      {/* Status bar */}
      <div className="flex items-center h-6 bg-[#D4D0C8] border-t border-[#808080] px-2 shrink-0" suppressHydrationWarning>
        <span className="flex-1 text-xs font-mono">Ready.</span>
        <div className="flex gap-0" suppressHydrationWarning>
          <span className="text-xs font-mono px-2 border-l border-[#808080] h-5 flex items-center">C152E</span>
          <span className="text-xs font-mono px-2 border-l border-[#808080] h-5 flex items-center">PESSK</span>
          <span className="text-xs font-mono px-2 border-l border-[#808080] h-5 flex items-center" suppressHydrationWarning>{dateStr}</span>
          <span className="text-xs font-mono px-2 border-l border-[#808080] h-5 flex items-center" suppressHydrationWarning>{timeStr}</span>
        </div>
      </div>
    </div>
    </div>
  )
}
