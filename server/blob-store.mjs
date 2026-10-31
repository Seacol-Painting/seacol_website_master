import * as blob from '@vercel/blob';

// Keep every SDK call private and uncached. No Blob URLs or credentials leave the server.
export function createBlobStore({ sdk = blob, env = process.env } = {}) {
  const token = env.BLOB_READ_WRITE_TOKEN;
  if (!token) throw new Error('Private storage is not configured');
  const common = { access: 'private', token };

  async function read(pathname, { signal } = {}) {
    const result = await sdk.get(pathname, { ...common, useCache: false, abortSignal: signal });
    if (result === null) return null;
    if (result.statusCode !== 200 || !result.stream || !result.blob?.etag ||
        !Number.isInteger(result.blob.size) || result.blob.size < 1 || result.blob.size > 32768) {
      throw new Error('Invalid private storage response');
    }
    const data = await new Response(result.stream).text();
    if (Buffer.byteLength(data) > 32768) throw new Error('Private record is too large');
    return { value: JSON.parse(data), etag: result.blob.etag };
  }

  async function create(pathname, value, { signal } = {}) {
    try {
      const result = await sdk.put(pathname, JSON.stringify(value), {
        ...common, addRandomSuffix: false, allowOverwrite: false,
        contentType: 'application/json; charset=utf-8', cacheControlMaxAge: 60,
        abortSignal: signal,
      });
      if (typeof result.etag !== 'string' || !result.etag) throw new Error('Storage did not confirm a version');
      return { created: true, entry: { value, etag: result.etag } };
    } catch (error) {
      // Blob reports an existing pathname as a generic SDK error. Confirm that
      // an object actually exists rather than treating every error as a conflict.
      const existing = await read(pathname, { signal });
      if (existing) return { created: false, entry: existing };
      throw error;
    }
  }

  async function replace(pathname, value, etag, { signal } = {}) {
    if (typeof etag !== 'string' || !etag) throw new Error('A storage version is required');
    try {
      const result = await sdk.put(pathname, JSON.stringify(value), {
        ...common, addRandomSuffix: false, allowOverwrite: true, ifMatch: etag,
        contentType: 'application/json; charset=utf-8', cacheControlMaxAge: 60,
        abortSignal: signal,
      });
      if (typeof result.etag !== 'string' || !result.etag) throw new Error('Storage did not confirm a version');
      return { value, etag: result.etag };
    } catch (error) {
      if (error instanceof sdk.BlobPreconditionFailedError) return null;
      throw error;
    }
  }

  return { read, create, replace };
}
