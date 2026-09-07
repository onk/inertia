import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('http', async () => {
  const actual = await vi.importActual<typeof import('http')>('http')
  return { ...actual, createServer: vi.fn(actual.createServer) }
})

import * as http from 'http'
import createSSRServer from '../src/server'

const mockCreateServer = http.createServer as unknown as ReturnType<typeof vi.fn>

describe('SSR Server', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('forwards the host option to listen', () => {
    const listenSpy = vi.spyOn(http.Server.prototype, 'listen').mockReturnThis()

    createSSRServer(() => Promise.resolve({ body: '', head: [] }), { port: 19990, host: '127.0.0.1' })

    expect(listenSpy).toHaveBeenCalledWith({ port: 19990, host: '127.0.0.1' }, expect.any(Function))
  })

  it('reassembles multi-byte UTF-8 characters split across request body chunk boundaries', async () => {
    let handler: (req: unknown, res: unknown) => Promise<void>
    mockCreateServer.mockImplementationOnce((cb: unknown) => {
      handler = cb as typeof handler
      return { listen: vi.fn() } as unknown as http.Server
    })

    let receivedPage: { props: { text: string } } | undefined
    createSSRServer((page) => {
      receivedPage = page as unknown as { props: { text: string } }
      return Promise.resolve({ body: '', head: [] })
    })

    const payload = JSON.stringify({ component: 'Test', props: { text: '日本語のテスト' } })
    const buffer = Buffer.from(payload, 'utf8')
    // Split inside "語" (a 3-byte UTF-8 sequence) so a chunk boundary lands mid-character.
    const splitIndex = buffer.indexOf(Buffer.from('語', 'utf8')) + 1
    const chunks = [buffer.subarray(0, splitIndex), buffer.subarray(splitIndex)]

    const req = createMockRequest('/render', chunks)
    const res = createMockResponse()

    await handler!(req, res)

    expect(receivedPage?.props.text).toBe('日本語のテスト')
  })
})

function createMockRequest(url: string, chunks: Buffer[]) {
  let dataCallback: (chunk: Buffer) => void
  let endCallback: () => void

  return {
    url,
    on: vi.fn((event: string, callback: (...args: unknown[]) => void) => {
      if (event === 'data') {
        dataCallback = callback
        chunks.forEach((chunk, i) => setTimeout(() => dataCallback(chunk), i))
      } else if (event === 'end') {
        endCallback = callback
        setTimeout(() => endCallback(), chunks.length + 1)
      }
    }),
  }
}

function createMockResponse() {
  return { writeHead: vi.fn(), write: vi.fn(), end: vi.fn(), headersSent: false }
}
