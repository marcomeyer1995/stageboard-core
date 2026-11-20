import { Ajv, type ValidateFunction } from 'ajv'
import type { AddonError, Contributes, Envelope, JsonSchema } from 'shared-types'

/**
 * The boundary a method call crosses (#964, docs/36 §3, §4). Everything an add-on contributes is declared with a JSON Schema, and the core never looks
 * inside; but it does check both directions here: the add-on never receives a body its manifest did not describe, and the core never takes an answer
 * whose shape the add-on did not declare. The add-on's own error travels untouched - the core adds no message of its own for an add-on's domain.
 */

/** How long an add-on has to answer a method before the call counts as a timeout. A hung method must not hold the caller forever. */
export const METHOD_TIMEOUT_MS = 10_000

/**
 * What `callMethod` needs from a sandbox - the real one in `nodeSandbox.ts` (Task 4) or a Worker on a tablet. Kept as a narrow interface so the boundary
 * can be tested without a process and so the envelope stays the only thing spoken.
 */
export interface MethodSandbox {
  /** Sends a `request` and resolves with the add-on's response envelope; rejects when the add-on does not answer in time. */
  request(method: string, body: unknown, timeoutMs: number, onProgress?: (fraction: number) => void, grants?: readonly string[]): Promise<Envelope>
}

export type MethodResult = { ok: true; body: unknown } | { ok: false; error: AddonError }

// One validator set for the whole process. A schema object is compiled once; `addUsedSchema: false` keeps an add-on's `$id` from colliding with another's.
// `strict: false` because an add-on's schema is not ours to police - keywords this ajv does not know are ignored, not turned into a startup error.
const ajv = new Ajv({ allErrors: true, strict: false, addUsedSchema: false })
const validators = new WeakMap<JsonSchema, ValidateFunction>()

function validatorFor(schema: JsonSchema): ValidateFunction {
  const cached = validators.get(schema)
  if (cached) return cached
  const validator = ajv.compile(schema)
  validators.set(schema, validator)
  return validator
}

function declaredMethod(contributes: Contributes, method: string): { in: JsonSchema; out: JsonSchema; timeoutMs?: number; progress?: boolean } | undefined {
  // `Object.hasOwn`: `methods.toString` or `methods.__proto__` must be undeclared, not inherited from Object.prototype.
  return Object.hasOwn(contributes.methods, method) ? contributes.methods[method] : undefined
}

function validationErrorText(validate: ValidateFunction): string {
  return ajv.errorsText(validate.errors, { separator: '; ' })
}

/**
 * Calls a method the manifest declared and checks the body in and the answer out. Four outcomes are the core's own, all other errors are the add-on's:
 * - `method.undeclared` - the manifest has no such method, so nothing is sent;
 * - `method.input` - the body violates the declared `in` schema, so the add-on is not called;
 * - `method.schema` - the declared schema does not compile, so there is nothing honest to check against;
 * - `method.output` - the answer violates the declared `out` schema (or is not a response at all).
 * A rejection from the sandbox (a timeout kills the add-on, docs/36 §9) becomes `timeout`.
 */
export async function callMethod(sandbox: MethodSandbox, contributes: Contributes, method: string, body: unknown, options: { onProgress?: (fraction: number) => void; grants?: readonly string[] } = {}): Promise<MethodResult> {
  const declared = declaredMethod(contributes, method)
  if (!declared) {
    return { ok: false, error: { code: 'method.undeclared', message: `The add-on declared no method "${method}".`, params: { method } } }
  }

  const timeoutMs = declared.timeoutMs ?? METHOD_TIMEOUT_MS

  let validateInput: ValidateFunction
  let validateOutput: ValidateFunction
  try {
    validateInput = validatorFor(declared.in)
    validateOutput = validatorFor(declared.out)
  } catch (error) {
    return {
      ok: false,
      error: {
        code: 'method.schema',
        message: `The schema of method "${method}" is not valid JSON Schema: ${error instanceof Error ? error.message : String(error)}`,
        params: { method },
      },
    }
  }

  if (!validateInput(body)) {
    const errors = validationErrorText(validateInput)
    return {
      ok: false,
      error: {
        code: 'method.input',
        message: `The call to "${method}" does not match the method's declared input: ${errors}`,
        params: { method, errors },
      },
    }
  }

  let answer: Envelope
  try {
    answer = await sandbox.request(method, body, timeoutMs, declared.progress ? options.onProgress : undefined, options.grants)
  } catch {
    // The add-on did not answer in time or its process died: from the caller's side that is one thing, a call that will not complete.
    return {
      ok: false,
      error: { code: 'timeout', message: `The add-on did not answer "${method}" within ${timeoutMs} ms.`, params: { method, timeoutMs } },
    }
  }

  if (answer.kind !== 'response') {
    return {
      ok: false,
      error: { code: 'method.output', message: `The add-on answered "${method}" with a ${answer.kind} instead of a response.`, params: { method, errors: `kind ${answer.kind}` } },
    }
  }
  if (!answer.ok) return { ok: false, error: answer.error }

  if (!validateOutput(answer.body)) {
    const errors = validationErrorText(validateOutput)
    return {
      ok: false,
      error: {
        code: 'method.output',
        message: `The answer of "${method}" does not match the method's declared output: ${errors}`,
        params: { method, errors },
      },
    }
  }

  return { ok: true, body: answer.body }
}
