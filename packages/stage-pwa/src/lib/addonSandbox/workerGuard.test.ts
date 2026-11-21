import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { guardedSource, NETWORK_APIS } from './workerGuard'

/** A stand-in for a Worker's global scope: the network APIs sit on the PROTOTYPE chain, as they do in a real Worker. */
function workerScope() {
  const base: Record<string, unknown> = {}
  for (const name of NETWORK_APIS) base[name] = function original() { return `real ${name}` }
  const proto = Object.create(base) // like DedicatedWorkerGlobalScope.prototype -> WorkerGlobalScope.prototype
  const self = Object.create(proto)
  self.self = self
  self.out = {}
  return self as Record<string, unknown> & { out: Record<string, unknown> }
}

describe('the Worker guard: no network API is handed to an add-on (#964, docs/36 §5)', () => {
  it('removes every network API from the global scope and from the prototypes above it', () => {
    const scope = workerScope()
    runInNewContext(guardedSource(`for (var n of ${JSON.stringify(NETWORK_APIS)}) { out[n] = [typeof self[n], typeof Object.getPrototypeOf(self)[n], typeof Object.getPrototypeOf(Object.getPrototypeOf(self))[n]].join('/') }`), scope)
    for (const name of NETWORK_APIS) expect(scope.out[name], name).toBe('undefined/undefined/undefined')
  })

  it('a script cannot get the original back by reading the prototype, deleting the shadow or assigning it again', () => {
    const scope = workerScope()
    runInNewContext(guardedSource(`
      var proto = Object.getPrototypeOf(Object.getPrototypeOf(self));
      out.viaProto = typeof proto.fetch;
      try { delete self.fetch; } catch (e) {}
      out.afterDelete = typeof self.fetch;
      try { self.fetch = function () { return 'mine' }; } catch (e) {}
      out.afterAssign = typeof self.fetch;
      try { Object.defineProperty(self, 'fetch', { value: function () {} }) } catch (e) { out.redefine = 'refused' }
    `), scope)
    expect(scope.out).toMatchObject({ viaProto: 'undefined', afterDelete: 'undefined', afterAssign: 'undefined', redefine: 'refused' })
  })

  it('leaves the rest alone: the add-on still has messaging, timers and its own code runs after the guard', () => {
    const scope = workerScope()
    scope.postMessage = () => 'sent'
    runInNewContext(guardedSource(`out.post = typeof postMessage; out.ran = 1 + 1`), scope)
    expect(scope.out).toMatchObject({ post: 'function', ran: 2 })
  })
})
