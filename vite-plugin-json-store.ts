import fs from 'node:fs'
import path from 'node:path'
import type { Plugin, Connect } from 'vite'
import type { IncomingMessage } from 'node:http'

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

export function jsonStorePlugin(storePath: string): Plugin {
  const absolutePath = path.resolve(storePath)

  const handler: Connect.NextHandleFunction = async (req, res, next) => {
    if (!req.url?.startsWith('/api/store')) {
      next()
      return
    }

    res.setHeader('Content-Type', 'application/json')

    try {
      if (req.method === 'GET') {
        if (!fs.existsSync(absolutePath)) {
          res.statusCode = 404
          res.end(JSON.stringify({ error: 'Store not found' }))
          return
        }
        const data = fs.readFileSync(absolutePath, 'utf8')
        res.statusCode = 200
        res.end(data)
        return
      }

      if (req.method === 'POST') {
        const body = await readBody(req as IncomingMessage)
        // Validate JSON before writing
        JSON.parse(body)
        fs.mkdirSync(path.dirname(absolutePath), { recursive: true })
        fs.writeFileSync(absolutePath, body, 'utf8')
        res.statusCode = 200
        res.end(JSON.stringify({ ok: true }))
        return
      }

      res.statusCode = 405
      res.end(JSON.stringify({ error: 'Method not allowed' }))
    } catch (err) {
      res.statusCode = 500
      res.end(
        JSON.stringify({
          error: err instanceof Error ? err.message : 'Unknown error',
        }),
      )
    }
  }

  return {
    name: 'json-store',
    configureServer(server) {
      server.middlewares.use(handler)
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler)
    },
  }
}
