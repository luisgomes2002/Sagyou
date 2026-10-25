// Mirror of src/renderer/src/types/mcp-actions.ts. Main never imports the
// renderer (tsconfig.node.json excludes it); a test keeps the name lists equal.

/** MCP write tools validated and applied by the renderer against the live store. */
export const MCP_RENDERER_WRITE_TOOLS = [
  'create_project',
  'update_project',
  'archive_project',
  'unarchive_project',
  'delete_project',
  'create_column',
  'update_column',
  'reorder_columns',
  'delete_column',
  'update_task',
  'move_task',
  'complete_task',
  'reopen_task',
  'delete_task',
  'create_sprint',
  'create_goal',
  'update_goal',
  'add_goal_progress',
  'delete_goal',
  'create_note',
  'update_note',
  'delete_note',
  'create_transaction',
  'update_transaction',
  'delete_transaction',
  'create_financial_table',
  'add_financial_category',
  'remove_financial_category',
  'create_financial_profile',
  'rename_financial_profile'
] as const

/** MCP write tools on main-owned memory, applied in the main process. */
export const MCP_MEMORY_WRITE_TOOLS = [
  'update_memory',
  'archive_memory',
  'unarchive_memory',
  'delete_memory',
  'resolve_memory_conflict'
] as const

export type McpRendererWriteTool = (typeof MCP_RENDERER_WRITE_TOOLS)[number]
export type McpMemoryWriteTool = (typeof MCP_MEMORY_WRITE_TOOLS)[number]
export type McpWriteTool = McpRendererWriteTool | McpMemoryWriteTool

export interface McpScope {
  projectId: string | null
  financialProfileId: string
}

export interface McpActionRequest {
  phase: 'prepare' | 'apply'
  name: string
  args: Record<string, unknown>
  scope: McpScope
}

export type McpActionResult =
  | { ok: true; id: string; resumo?: string; [key: string]: unknown }
  | { ok: false; error: string; candidatos?: { id: string; title: string }[] }
