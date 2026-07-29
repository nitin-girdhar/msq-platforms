// Shared outbound-HTTP concerns for backend services.
//
// Every service-to-service and third-party call in the platform used a bare
// `fetch` with NO timeout. Node's fetch does not impose one, so a hung upstream
// (a wedged service, a slow third-party API, a dropped SYN-ACK) held the caller's
// socket and its Fastify request open indefinitely. Under load that turns one
// stuck dependency into an exhausted connection pool in every service upstream of
// it — the gateway included. This module makes a bounded timeout the default and
// gives each call site its own env-tunable budget.

/**
 * Reads a per-call-site timeout budget from the environment.
 *
 * Each outbound dependency gets its OWN variable rather than one global knob:
 * a WhatsApp send to a third-party API and an internal known-contacts lookup
 * have very different acceptable latencies, and tuning one must not move the
 * other. `fallbackMs` is what ships when the variable is unset.
 *
 * A non-numeric or non-positive value falls back rather than throwing — a typo
 * in an env var should not stop a service from booting, and 0/negative would
 * otherwise mean "abort immediately", failing every call.
 */
export function timeoutFromEnv(name: string, fallbackMs: number): number {
  const raw = process.env[name];
  if (!raw) return fallbackMs;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackMs;
}

/** Thrown when an outbound call exceeds its timeout budget. */
export class UpstreamTimeoutError extends Error {
  readonly timeoutMs: number;
  readonly target: string;

  constructor(target: string, timeoutMs: number) {
    super(`Upstream request to ${target} timed out after ${timeoutMs}ms`);
    this.name = 'UpstreamTimeoutError';
    this.timeoutMs = timeoutMs;
    this.target = target;
  }
}

export interface FetchWithTimeoutOptions extends RequestInit {
  /** Milliseconds before the request is aborted. */
  timeoutMs: number;
  /**
   * Label used in the timeout error message, e.g. 'leads-service'. Defaults to
   * the request URL — pass a name when the URL carries ids you would rather not
   * put in an error string that may reach a client.
   */
  target?: string;
}

/**
 * `fetch` with a hard deadline covering BOTH connection and response body.
 *
 * Use for ordinary request/response calls. Do NOT use for streaming responses
 * that must stay open (SSE) — the deadline would kill the stream mid-flight;
 * use {@link fetchStreamWithConnectTimeout} for those.
 *
 * Distinguishes a timeout from other transport failures by rethrowing
 * {@link UpstreamTimeoutError}, so callers can map it to a 504 rather than
 * lumping it in with a generic 502.
 */
export async function fetchWithTimeout(
  url: string,
  options: FetchWithTimeoutOptions,
): Promise<Response> {
  const { timeoutMs, target, ...init } = options;
  const label = target ?? url;

  // An explicit controller rather than AbortSignal.timeout() so an
  // already-supplied caller signal (client disconnect) still composes: whichever
  // fires first aborts the request.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const callerSignal = init.signal;
  const onCallerAbort = () => controller.abort();
  callerSignal?.addEventListener('abort', onCallerAbort, { once: true });

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    // Only OUR timer firing is a timeout. A caller-initiated abort (client hung
    // up) is not, and must not be reported as an upstream fault.
    if (controller.signal.aborted && !callerSignal?.aborted) {
      throw new UpstreamTimeoutError(label, timeoutMs);
    }
    throw err;
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener('abort', onCallerAbort);
  }
}

export interface StreamFetchResult {
  response: Response;
  /**
   * Releases the upstream connection. Call when the downstream client goes away,
   * otherwise the upstream request stays open for the life of the process.
   */
  abort: () => void;
}

/**
 * `fetch` for long-lived streaming responses (SSE), where only ESTABLISHING the
 * connection may be bounded.
 *
 * A plain timeout is wrong here: `fetch` resolves as soon as response headers
 * arrive, but the body streams for as long as the connection lives, and an
 * AbortSignal attached to the request also tears down that body. So the deadline
 * is cancelled the moment headers land, leaving the stream free to run
 * indefinitely — while a peer that accepts the TCP connection and then never
 * responds is still cut loose instead of leaking a connection forever.
 */
export async function fetchStreamWithConnectTimeout(
  url: string,
  options: RequestInit & { connectTimeoutMs: number; target?: string },
): Promise<StreamFetchResult> {
  const { connectTimeoutMs, target, ...init } = options;
  const label = target ?? url;

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, connectTimeoutMs);

  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    // Headers are in. From here the body may stream for hours.
    clearTimeout(timer);
    return { response, abort: () => controller.abort() };
  } catch (err) {
    clearTimeout(timer);
    if (timedOut) throw new UpstreamTimeoutError(label, connectTimeoutMs);
    throw err;
  }
}
