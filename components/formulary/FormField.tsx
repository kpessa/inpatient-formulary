'use client'

import React from 'react'

interface FormFieldProps {
  label?: string
  required?: boolean
  children: React.ReactNode
  className?: string
  labelClassName?: string
}

/**
 * Consistent form field wrapper that ensures uniform heights across
 * Input, Select, and other form controls in the clinical interface
 */
export function FormField({
  label,
  required,
  children,
  className = '',
  labelClassName = '',
}: FormFieldProps) {
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      {label && (
        <label className={`text-xs font-mono leading-none ${labelClassName}`}>
          {required && <span className="text-[#CC0000]">*</span>} {label}
        </label>
      )}
      <div className="h-6 flex items-center px-0.5">
        {children}
      </div>
    </div>
  )
}
