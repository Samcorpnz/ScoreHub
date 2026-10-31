import { S3Client, PutObjectCommand, ListObjectsV2Command, DeleteObjectsCommand } from "@aws-sdk/client-s3";

const R2_BUCKET             = process.env.R2_BUCKET;
const R2_ACCOUNT_ID         = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID      = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY  = process.env.R2_SECRET_ACCESS_KEY;
const R2_PUBLIC_URL         = process.env.R2_PUBLIC_URL?.replace(/\/$/, "");

// Object storage (SA-64/SA-27) is opt-in: when any of these are unset, every
// caller in server.ts falls back to the local-disk upload path that predates
// this module, so dev/self-hosted/Jest are unaffected.
export const r2Enabled = Boolean(R2_BUCKET && R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_PUBLIC_URL);

const client = r2Enabled
  ? new S3Client({
      region: "auto",
      endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: R2_ACCESS_KEY_ID as string, secretAccessKey: R2_SECRET_ACCESS_KEY as string },
    })
  : null;

export async function putObject(key: string, body: Buffer, contentType: string): Promise<string> {
  await client!.send(new PutObjectCommand({ Bucket: R2_BUCKET, Key: key, Body: body, ContentType: contentType }));
  return `${R2_PUBLIC_URL}/${key}`;
}

export const r2Bucket = R2_BUCKET;

// Every object under a prefix, following pagination (a single list call stops
// at 1000 keys). Used by maintenance scripts, not by request handlers.
export async function listObjects(prefix: string): Promise<{ key: string; lastModified?: Date }[]> {
  const out: { key: string; lastModified?: Date }[] = [];
  let token: string | undefined;
  do {
    const page = await client!.send(new ListObjectsV2Command({ Bucket: R2_BUCKET, Prefix: prefix, ContinuationToken: token }));
    for (const o of page.Contents ?? []) {
      if (o.Key) out.push({ key: o.Key, lastModified: o.LastModified });
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return out;
}

// Deletes the given keys, in batches of 1000 (the DeleteObjects limit).
export async function deleteObjects(keys: string[]): Promise<void> {
  for (let i = 0; i < keys.length; i += 1000) {
    const batch = keys.slice(i, i + 1000);
    const res = await client!.send(new DeleteObjectsCommand({ Bucket: R2_BUCKET, Delete: { Objects: batch.map(Key => ({ Key })) } }));
    // DeleteObjects answers 200 even when individual keys fail, listing them here.
    const failed = res?.Errors ?? [];
    if (failed.length) {
      const detail = failed.map(e => `${e.Key} (${e.Code})`).join(", ");
      throw new Error(`failed to delete ${failed.length} object(s): ${detail}`);
    }
  }
}

// Mirrors the local-disk "delete every file starting with X" pattern used for
// logos, where the uploaded file's extension isn't known at delete time.
export async function deleteByPrefix(prefix: string): Promise<void> {
  await deleteObjects((await listObjects(prefix)).map(o => o.key));
}
