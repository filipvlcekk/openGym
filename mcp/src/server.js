import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { TOOLS } from './tools.js'

export function createOpenGymMcpServer(options = {}) {
  const server = new McpServer({
    name: 'opengym',
    version: '0.1.0'
  })

  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: z.object(tool.schema || {}).strict() },
      async (params) => {
        try {
          const result = tool.handler(params || {}, options.context)
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
        } catch (err) {
          const code = err.code || 'ERROR'
          return {
            isError: true,
            content: [{ type: 'text', text: `${code}: ${err.message}` }]
          }
        }
      }
    )
  }

  return server
}
