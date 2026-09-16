import { createServer } from 'node:net'
import { describe, expect, it } from 'vitest'

import { describeReachability, tcpProbe } from '@/server/integrations/crm/bitrix24/reachability'

describe('the network diagnosis names whose problem it is', () => {
  const ok = (address: string) => ({ address, ms: 40, error: null })
  const dead = (address: string) => ({ address, ms: null, error: 'TIMEOUT' })

  it('blames Bitrix24 when the control host opens and no portal address does', () => {
    const line = describeReachability({
      host: 'obey.bitrix24.kz',
      control: ok('1.1.1.1'),
      portal: [dead('46.235.53.69'), dead('195.208.185.4')],
      tls: [],
      https: null, tlsSmall: null, tls12: null, tlsControls: [], egressIp: null,
    })
    expect(line).toContain('Bitrix24 bu server manzilini qabul qilmayapti')
  })

  it('blames our egress when even the control host does not open', () => {
    const line = describeReachability({ host: 'h', control: dead('1.1.1.1'), portal: [dead('a')], tls: [], https: null, tlsSmall: null, tls12: null, tlsControls: [], egressIp: null })
    expect(line).toContain('DigitalOcean tomoni')
  })

  it('says when only some portal addresses are dead', () => {
    const line = describeReachability({ host: 'h', control: ok('1.1.1.1'), portal: [ok('a'), dead('b')], tls: [], https: null, tlsSmall: null, tls12: null, tlsControls: [], egressIp: null })
    expect(line).toContain('bir qismi')
  })

  it('measures a real handshake and a refused port', async () => {
    const server = createServer().listen(0, '127.0.0.1')
    await new Promise((r) => server.once('listening', r))
    const port = (server.address() as { port: number }).port
    expect((await tcpProbe('127.0.0.1', port)).ms).not.toBeNull()
    server.close()
    await new Promise((r) => server.once('close', r))
    expect((await tcpProbe('127.0.0.1', port, 1000)).error).not.toBeNull()
  })
})
