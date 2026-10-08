// Machine preferences, timestamps and local trust decisions never participate in sync.
export function stableJSON(value) {
  if (Array.isArray(value)) return `[${value.map(stableJSON).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).filter(key => value[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${stableJSON(value[key])}`).join(',')}}`
  return JSON.stringify(value)
}
export const sameRecord = (a, b) => stableJSON(a ?? null) === stableJSON(b ?? null)

export function workspaceRecords(workspace) {
  const records = Object.create(null)
  for (const project of workspace?.projects || []) {
    records[`project:${project.id}`] = { id: project.id, name: project.name, taskIds: project.tasks.map(task => task.id) }
    for (const task of project.tasks) {
      const { updatedAt: _updatedAt, sourceTrusted: _sourceTrusted, ...data } = task
      records[`task:${task.id}`] = { ...data, projectId: project.id }
    }
  }
  for (const type of ['customTemplates', 'documentTemplates']) for (const item of workspace?.[type] || []) {
    const { untrusted: _untrusted, ...data } = item
    records[`${type}:${item.id}`] = data
  }
  return records
}

export function recordsWorkspace(records, local) {
  const projects = []
  const localTasks = new Map((local?.projects || []).flatMap(project => project.tasks.map(task => [task.id, task])))
  const localRecords = workspaceRecords(local)
  for (const [key, value] of Object.entries(records)) {
    if (!key.startsWith('project:') || !value) continue
    const tasks = Object.entries(records).filter(([id, task]) => id.startsWith('task:') && task?.projectId === value.id)
      .map(([, task]) => {
        const { projectId: _projectId, ...data } = task
        const templateKey = `documentTemplates:${task.activeDocumentTemplateId}`
        const unchanged = sameRecord(localRecords[`task:${task.id}`], task) && sameRecord(localRecords[templateKey], records[templateKey])
        return { ...data, updatedAt: Date.now(), sourceTrusted: unchanged ? localTasks.get(task.id)?.sourceTrusted === true : false }
      }).sort((a, b) => {
        const ai = value.taskIds.indexOf(a.id), bi = value.taskIds.indexOf(b.id)
        return (ai < 0 ? Infinity : ai) - (bi < 0 ? Infinity : bi)
      })
    if (!tasks.length) continue
    const previous = local?.projects?.find(project => project.id === value.id)
    projects.push({ id: value.id, name: value.name, tasks, activeTaskId: tasks.some(task => task.id === previous?.activeTaskId) ? previous.activeTaskId : tasks[0].id })
  }
  // A concurrent project deletion must not hide a task that another device saved.
  const orphans = Object.entries(records).filter(([id, task]) => id.startsWith('task:') && task && !projects.some(project => project.id === task.projectId))
  for (const [, task] of orphans) {
    let project = projects.find(item => item.id === task.projectId)
    if (!project) { project = { id: task.projectId, name: 'Dự án được khôi phục', tasks: [], activeTaskId: task.id }; projects.push(project) }
    const { projectId: _projectId, ...data } = task
    project.tasks.push({ ...data, updatedAt: Date.now(), sourceTrusted: false })
  }
  const templates = {}
  for (const type of ['customTemplates', 'documentTemplates']) templates[type] = Object.entries(records).filter(([id, value]) => id.startsWith(`${type}:`) && value)
    .map(([id, value]) => ({ ...value, untrusted: sameRecord(localRecords[id], value) ? local?.[type]?.find(item => item.id === value.id)?.untrusted === true : true }))
  const activeProjectId = projects.some(project => project.id === local?.activeProjectId) ? local.activeProjectId : projects[0]?.id
  return { ...local, ...templates, version: 1, projects, activeProjectId }
}

export function recordChanges(baseline, current) {
  return [...new Set([...Object.keys(baseline || {}), ...Object.keys(current)])]
    .filter(key => !sameRecord(baseline?.[key], current[key]))
    .map(key => ({ key, value: current[key] ?? null }))
}

// Rebase edits made while a network request was running. Both versions survive.
export function rebaseSyncWorkspace(submitted, live, received) {
  const base = workspaceRecords(submitted), ours = workspaceRecords(live), theirs = workspaceRecords(received)
  let recovered = 0
  for (const change of recordChanges(base, ours)) {
    if (sameRecord(theirs[change.key], base[change.key]) || sameRecord(theirs[change.key], change.value)) theirs[change.key] = change.value
    else if (change.value && change.key.startsWith('task:')) {
      const id = `task-${crypto.randomUUID()}`
      theirs[`task:${id}`] = { ...change.value, id, title: `${change.value.title} — bản sửa trong lúc đồng bộ`.slice(0, 160) }
      recovered++
    } else if (change.value) {
      // Preserve local metadata and templates; remote tasks remain independently stored.
      if (change.key.startsWith('project:')) theirs[change.key] = change.value
      else {
        const prefix = change.key.split(':')[0]
        const id = `${prefix === 'customTemplates' ? 'custom-' : 'layout-'}${crypto.randomUUID()}`
        theirs[`${prefix}:${id}`] = { ...change.value, id, name: `${change.value.name} — bản sao`.slice(0, 120) }
      }
      recovered++
    }
  }
  return { workspace: recordsWorkspace(theirs, live), recovered }
}
