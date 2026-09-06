// A browser timeout stops waiting, not a server transaction. Never retry automatically.
export function withRequestDeadline(action, timeoutMs = 30000) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000)
    throw new RangeError('请求等待时间必须在 1—120000 毫秒之间');
  const controller = new AbortController();
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error('请求等待超时，业务结果未知');
      error.code = 'REQUEST_TIMEOUT';
      reject(error);
      controller.abort();
    }, timeoutMs);
  });
  // Race also bounds transports that ignore AbortSignal. Late results are discarded.
  return Promise.race([deadline, Promise.resolve().then(() => action(controller.signal))])
    .finally(() => clearTimeout(timer));
}
