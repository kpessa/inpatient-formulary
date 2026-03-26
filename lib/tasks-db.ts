import { randomUUID } from 'crypto'
import { getDb } from './db'
import type { ChangeTask, FieldOverride, ProductBuild, BuildDomainProgress, TaskDomainProgress } from './types'
import type { Row } from '@libsql/client'

function rowToTask(r: Row): ChangeTask {
  return {
    id: r.id as string,
    drugKey: r.drug_key as string,
    drugDescription: r.drug_description as string,
    groupId: r.group_id as string | undefined ?? undefined,
    type: r.type as 'diff' | 'free_form',
    fieldName: r.field_name as string | undefined ?? undefined,
    fieldLabel: r.field_label as string | undefined ?? undefined,
    targetDomain: r.target_domain as string | undefined ?? undefined,
    domainValues: r.domain_values as string | undefined ?? undefined,
    targetValue: r.target_value as string | undefined ?? undefined,
    status: r.status as 'pending' | 'in_progress' | 'done',
    assignedTo: r.assigned_to as string | undefined ?? undefined,
    notes: r.notes as string | undefined ?? undefined,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
    completedAt: r.completed_at as string | undefined ?? undefined,
    completedBy: r.completed_by as string | undefined ?? undefined,
  }
}

function rowToOverride(r: Row): FieldOverride {
  return {
    id: r.id as string,
    domain: r.domain as string,
    groupId: r.group_id as string,
    fieldPath: r.field_path as string,
    overrideValue: r.override_value as string,
    taskId: r.task_id as string | undefined ?? undefined,
    appliedAt: r.applied_at as string,
    appliedBy: r.applied_by as string,
  }
}

function rowToBuild(r: Row): Omit<ProductBuild, 'domainProgress'> {
  return {
    id: r.id as string,
    drugDescription: r.drug_description as string,
    drugKey: r.drug_key as string | undefined ?? undefined,
    status: r.status as 'in_progress' | 'review' | 'complete',
    notes: r.notes as string | undefined ?? undefined,
    createdAt: r.created_at as string,
    createdBy: r.created_by as string | undefined ?? undefined,
  }
}

function rowToProgress(r: Row): BuildDomainProgress {
  return {
    buildId: r.build_id as string,
    domain: r.domain as string,
    status: r.status as 'pending' | 'in_progress' | 'done',
    completedAt: r.completed_at as string | undefined ?? undefined,
    completedBy: r.completed_by as string | undefined ?? undefined,
    notes: r.notes as string | undefined ?? undefined,
  }
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

export async function listTasksForDrug(drugKey: string): Promise<ChangeTask[]> {
  const db = getDb()
  const { rows } = await db.execute({
    sql: 'SELECT * FROM change_tasks WHERE drug_key = ? ORDER BY created_at DESC',
    args: [drugKey],
  })
  return rows.map(rowToTask)
}

export async function listAllTasks(filter?: { status?: string; assignedTo?: string }): Promise<ChangeTask[]> {
  const db = getDb()
  const conditions: string[] = []
  const args: string[] = []
  if (filter?.status)     { conditions.push('status = ?');      args.push(filter.status) }
  if (filter?.assignedTo) { conditions.push('assigned_to = ?'); args.push(filter.assignedTo) }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const { rows } = await db.execute({ sql: `SELECT * FROM change_tasks ${where} ORDER BY created_at DESC`, args })
  return rows.map(rowToTask)
}

export async function createTask(task: Omit<ChangeTask, 'id' | 'createdAt' | 'updatedAt'>): Promise<ChangeTask> {
  const db = getDb()
  const id = randomUUID()
  const now = new Date().toISOString()
  await db.execute({
    sql: `INSERT INTO change_tasks
            (id, drug_key, drug_description, group_id, type, field_name, field_label,
             target_domain, domain_values, target_value, status, assigned_to, notes,
             created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id, task.drugKey, task.drugDescription, task.groupId ?? null, task.type,
      task.fieldName ?? null, task.fieldLabel ?? null,
      task.targetDomain ?? null, task.domainValues ?? null,
      task.targetValue ?? null, task.status,
      task.assignedTo ?? null, task.notes ?? null,
      now, now,
    ],
  })
  return { ...task, id, createdAt: now, updatedAt: now }
}

export async function updateTask(id: string, patch: Partial<ChangeTask>): Promise<void> {
  const db = getDb()
  const now = new Date().toISOString()
  const sets: string[] = ['updated_at = ?']
  const args: (string | null)[] = [now]

  if (patch.status      !== undefined) { sets.push('status = ?');       args.push(patch.status) }
  if (patch.assignedTo  !== undefined) { sets.push('assigned_to = ?');  args.push(patch.assignedTo ?? null) }
  if (patch.notes       !== undefined) { sets.push('notes = ?');        args.push(patch.notes ?? null) }
  if (patch.targetValue !== undefined) { sets.push('target_value = ?'); args.push(patch.targetValue ?? null) }
  if (patch.completedAt !== undefined) { sets.push('completed_at = ?'); args.push(patch.completedAt ?? null) }
  if (patch.completedBy !== undefined) { sets.push('completed_by = ?'); args.push(patch.completedBy ?? null) }

  args.push(id)
  await db.execute({ sql: `UPDATE change_tasks SET ${sets.join(', ')} WHERE id = ?`, args })
}

export async function deleteTask(id: string): Promise<void> {
  const db = getDb()
  await db.batch([
    { sql: 'DELETE FROM task_domain_progress WHERE task_id = ?', args: [id] },
    { sql: 'DELETE FROM change_tasks WHERE id = ?', args: [id] },
  ], 'write')
}

// ---------------------------------------------------------------------------
// Task domain progress
// ---------------------------------------------------------------------------

function rowToTaskProgress(r: Row): TaskDomainProgress {
  return {
    taskId: r.task_id as string,
    domain: r.domain as string,
    status: r.status as 'pending' | 'in_progress' | 'done',
    completedAt: r.completed_at as string | undefined ?? undefined,
    completedBy: r.completed_by as string | undefined ?? undefined,
    notes: r.notes as string | undefined ?? undefined,
  }
}

export async function listAllTasksWithProgress(
  filter?: { status?: string; assignedTo?: string; drugKey?: string },
): Promise<ChangeTask[]> {
  const db = getDb()
  const conditions: string[] = []
  const args: string[] = []
  if (filter?.status)     { conditions.push('t.status = ?');      args.push(filter.status) }
  if (filter?.assignedTo) { conditions.push('t.assigned_to = ?'); args.push(filter.assignedTo) }
  if (filter?.drugKey)    { conditions.push('t.drug_key = ?');    args.push(filter.drugKey) }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  // First: fetch tasks
  const { rows: taskRows } = await db.execute({
    sql: `SELECT * FROM change_tasks t ${where} ORDER BY t.created_at DESC`,
    args,
  })
  if (taskRows.length === 0) return []

  // Second: fetch progress only for matching task IDs (uses idx_tdp_task_id)
  const taskIds = taskRows.map(r => r.id as string)
  const placeholders = taskIds.map(() => '?').join(',')
  const { rows: progressRows } = await db.execute({
    sql: `SELECT * FROM task_domain_progress WHERE task_id IN (${placeholders})`,
    args: taskIds,
  })

  const progressByTask: Record<string, TaskDomainProgress[]> = {}
  for (const r of progressRows) {
    const p = rowToTaskProgress(r)
    if (!progressByTask[p.taskId]) progressByTask[p.taskId] = []
    progressByTask[p.taskId].push(p)
  }

  return taskRows.map(r => ({
    ...rowToTask(r),
    domainProgress: progressByTask[r.id as string] ?? [],
  }))
}

export async function createTaskWithDomains(
  task: Omit<ChangeTask, 'id' | 'createdAt' | 'updatedAt' | 'domainProgress'>,
  domains: string[],
): Promise<ChangeTask> {
  const db = getDb()
  const id = randomUUID()
  const now = new Date().toISOString()

  await db.batch([
    {
      sql: `INSERT INTO change_tasks
              (id, drug_key, drug_description, group_id, type, field_name, field_label,
               target_domain, domain_values, target_value, status, assigned_to, notes,
               created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        id, task.drugKey, task.drugDescription, task.groupId ?? null, task.type,
        task.fieldName ?? null, task.fieldLabel ?? null,
        task.targetDomain ?? null, task.domainValues ?? null,
        task.targetValue ?? null, task.status,
        task.assignedTo ?? null, task.notes ?? null,
        now, now,
      ],
    },
    ...domains.map(domain => ({
      sql: `INSERT INTO task_domain_progress (task_id, domain, status) VALUES (?, ?, 'pending')`,
      args: [id, domain],
    })),
  ], 'write')

  const domainProgress: TaskDomainProgress[] = domains.map(domain => ({
    taskId: id, domain, status: 'pending' as const,
  }))
  return { ...task, id, createdAt: now, updatedAt: now, domainProgress }
}

export async function updateTaskDomainProgress(
  taskId: string,
  domain: string,
  patch: Partial<TaskDomainProgress>,
): Promise<void> {
  const db = getDb()
  const sets: string[] = []
  const args: (string | null)[] = []

  if (patch.status      !== undefined) { sets.push('status = ?');       args.push(patch.status) }
  if (patch.completedAt !== undefined) { sets.push('completed_at = ?'); args.push(patch.completedAt ?? null) }
  if (patch.completedBy !== undefined) { sets.push('completed_by = ?'); args.push(patch.completedBy ?? null) }
  if (patch.notes       !== undefined) { sets.push('notes = ?');        args.push(patch.notes ?? null) }

  if (sets.length === 0) return
  args.push(taskId, domain)
  await db.execute({
    sql: `UPDATE task_domain_progress SET ${sets.join(', ')} WHERE task_id = ? AND domain = ?`,
    args,
  })
}

export async function bulkUpdateTaskDomainProgress(
  taskId: string,
  domains: string[],
  status: 'pending' | 'in_progress' | 'done',
  completedBy?: string,
): Promise<void> {
  if (domains.length === 0) return
  const db = getDb()
  const now = new Date().toISOString()
  await db.batch(
    domains.map(domain => ({
      sql: `UPDATE task_domain_progress SET status = ?, completed_at = ?, completed_by = ? WHERE task_id = ? AND domain = ?`,
      args: [status, status === 'done' ? now : null, status === 'done' ? (completedBy ?? 'analyst') : null, taskId, domain],
    })),
    'write',
  )
}

export async function recomputeTaskStatus(taskId: string): Promise<void> {
  const db = getDb()
  const { rows } = await db.execute({
    sql: 'SELECT status FROM task_domain_progress WHERE task_id = ?',
    args: [taskId],
  })

  if (rows.length === 0) return // no domain rows, keep current status

  const statuses = rows.map(r => r.status as string)
  const allDone = statuses.every(s => s === 'done')
  const anyInProgress = statuses.some(s => s === 'in_progress')
  const anyDone = statuses.some(s => s === 'done')

  const now = new Date().toISOString()
  let derived: string
  if (allDone) derived = 'done'
  else if (anyInProgress || anyDone) derived = 'in_progress'
  else derived = 'pending'

  await db.execute({
    sql: `UPDATE change_tasks SET status = ?, updated_at = ?${allDone ? ', completed_at = ?' : ''} WHERE id = ?`,
    args: allDone ? [derived, now, now, taskId] : [derived, now, taskId],
  })
}

export async function getTaskSummary(): Promise<{ total: number; pending: number; inProgress: number; done: number }> {
  const db = getDb()
  const { rows } = await db.execute('SELECT status, COUNT(*) as cnt FROM change_tasks GROUP BY status')
  const counts: Record<string, number> = {}
  for (const r of rows) counts[r.status as string] = r.cnt as number
  return {
    total: (counts.pending ?? 0) + (counts.in_progress ?? 0) + (counts.done ?? 0),
    pending: counts.pending ?? 0,
    inProgress: counts.in_progress ?? 0,
    done: counts.done ?? 0,
  }
}

// ---------------------------------------------------------------------------
// Overrides
// ---------------------------------------------------------------------------

export async function getOverridesForDrug(domain: string, groupId: string): Promise<FieldOverride[]> {
  const db = getDb()
  const { rows } = await db.execute({
    sql: 'SELECT * FROM field_overrides WHERE domain = ? AND group_id = ?',
    args: [domain, groupId],
  })
  return rows.map(rowToOverride)
}

export async function applyOverride(
  override: Omit<FieldOverride, 'id' | 'appliedAt'>
): Promise<FieldOverride> {
  const db = getDb()
  const id = randomUUID()
  const now = new Date().toISOString()
  await db.execute({
    sql: `INSERT INTO field_overrides
            (id, domain, group_id, field_path, override_value, task_id, applied_at, applied_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id, override.domain, override.groupId, override.fieldPath,
      override.overrideValue, override.taskId ?? null, now, override.appliedBy,
    ],
  })
  return { ...override, id, appliedAt: now }
}

// ---------------------------------------------------------------------------
// Builds
// ---------------------------------------------------------------------------

export async function listBuilds(): Promise<ProductBuild[]> {
  const db = getDb()
  const [{ rows: buildRows }, { rows: progressRows }] = await db.batch([
    { sql: 'SELECT * FROM product_builds ORDER BY created_at DESC', args: [] },
    { sql: 'SELECT * FROM build_domain_progress', args: [] },
  ], 'read')

  const progressByBuild: Record<string, BuildDomainProgress[]> = {}
  for (const r of progressRows) {
    const p = rowToProgress(r)
    if (!progressByBuild[p.buildId]) progressByBuild[p.buildId] = []
    progressByBuild[p.buildId].push(p)
  }

  return buildRows.map(r => ({
    ...rowToBuild(r),
    domainProgress: progressByBuild[r.id as string] ?? [],
  }))
}

export async function createBuild(
  build: Omit<ProductBuild, 'id' | 'createdAt' | 'domainProgress'>,
  domains: string[],
): Promise<ProductBuild> {
  const db = getDb()
  const id = randomUUID()
  const now = new Date().toISOString()

  await db.batch([
    {
      sql: `INSERT INTO product_builds (id, drug_description, drug_key, status, notes, created_at, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [id, build.drugDescription, build.drugKey ?? null, build.status, build.notes ?? null, now, build.createdBy ?? null],
    },
    ...domains.map(domain => ({
      sql: `INSERT INTO build_domain_progress (build_id, domain, status) VALUES (?, ?, 'pending')`,
      args: [id, domain],
    })),
  ], 'write')

  const domainProgress: BuildDomainProgress[] = domains.map(domain => ({
    buildId: id, domain, status: 'pending',
  }))
  return { ...build, id, createdAt: now, domainProgress }
}

export async function updateBuild(id: string, patch: Partial<ProductBuild>): Promise<void> {
  const db = getDb()
  const sets: string[] = []
  const args: (string | null)[] = []

  if (patch.status !== undefined) { sets.push('status = ?');    args.push(patch.status) }
  if (patch.notes  !== undefined) { sets.push('notes = ?');     args.push(patch.notes ?? null) }
  if (patch.drugKey !== undefined) { sets.push('drug_key = ?'); args.push(patch.drugKey ?? null) }

  if (sets.length === 0) return
  args.push(id)
  await db.execute({ sql: `UPDATE product_builds SET ${sets.join(', ')} WHERE id = ?`, args })
}

export async function updateBuildDomainProgress(
  buildId: string,
  domain: string,
  patch: Partial<BuildDomainProgress>,
): Promise<void> {
  const db = getDb()
  const sets: string[] = []
  const args: (string | null)[] = []

  if (patch.status      !== undefined) { sets.push('status = ?');       args.push(patch.status) }
  if (patch.completedAt !== undefined) { sets.push('completed_at = ?'); args.push(patch.completedAt ?? null) }
  if (patch.completedBy !== undefined) { sets.push('completed_by = ?'); args.push(patch.completedBy ?? null) }
  if (patch.notes       !== undefined) { sets.push('notes = ?');        args.push(patch.notes ?? null) }

  if (sets.length === 0) return
  args.push(buildId, domain)
  await db.execute({
    sql: `UPDATE build_domain_progress SET ${sets.join(', ')} WHERE build_id = ? AND domain = ?`,
    args,
  })
}
