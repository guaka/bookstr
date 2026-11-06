/** Read small metadata bodies without trusting Content-Length or buffering an unlimited response. */
export async function readBoundedResponse(response: Response, maxBytes: number, signal?: AbortSignal): Promise<Buffer> {
  if (!response.body) throw new Error('metadata response has no readable body');
  const reader = response.body.getReader();
  const abort = () => { void reader.cancel(signal!.reason).catch(() => {}); };
  const chunks: Buffer[] = [];
  let size = 0;
  signal?.addEventListener('abort', abort, { once: true });
  try {
    signal?.throwIfAborted();
    const declaredLength = Number(response.headers?.get('content-length'));
    if (declaredLength > maxBytes) throw new Error('torrent metadata is too large');
    while (true) {
      const { done, value } = await reader.read();
      signal?.throwIfAborted();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error('torrent metadata is too large');
      chunks.push(Buffer.from(value));
    }
  } catch (error) {
    await reader.cancel(error).catch(() => {});
    throw error;
  } finally {
    signal?.removeEventListener('abort', abort);
    reader.releaseLock();
  }
  return Buffer.concat(chunks, size);
}
