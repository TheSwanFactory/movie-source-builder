import { createWriteStream } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import yauzl, { type Entry, type ZipFile } from "yauzl";
import yazl from "yazl";

const openZip = promisify<string, yauzl.Options, ZipFile>(yauzl.open);
export const DEFAULT_ARCHIVE_LIMITS = {
  maxEntries: 10_000,
  maxEntryBytes: 512 * 1024 * 1024,
  maxTotalBytes: 2 * 1024 * 1024 * 1024,
};

export interface ArchiveEntry {
  name: string;
  size: number;
  read(): Promise<Buffer>;
}

function safeName(raw: string): string {
  const name = raw.replaceAll("\\", "/");
  if (
    !name ||
    name.startsWith("/") ||
    /^[a-zA-Z]:/.test(name) ||
    name.split("/").includes("..") ||
    name.includes("\0")
  ) {
    throw new Error(`unsafe archive path: ${raw}`);
  }
  return path.posix.normalize(name).replace(/^\.\//, "");
}

function readEntry(zip: ZipFile, entry: Entry): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    zip.openReadStream(entry, (error, stream) => {
      if (error || !stream)
        return reject(error ?? new Error("entry stream unavailable"));
      const chunks: Buffer[] = [];
      stream.on("data", (chunk: Buffer) => chunks.push(chunk));
      stream.on("end", () => resolve(Buffer.concat(chunks)));
      stream.on("error", reject);
    }),
  );
}

export async function readArchive(
  file: string,
  limits = DEFAULT_ARCHIVE_LIMITS,
): Promise<Map<string, Buffer>> {
  const zip = await openZip(file, {
    lazyEntries: true,
    autoClose: false,
    decodeStrings: true,
    validateEntrySizes: true,
  });
  return await new Promise((resolve, reject) => {
    const entries = new Map<string, Buffer>();
    const metadata: Array<{ name: string; entry: Entry }> = [];
    let total = 0;
    zip.on("entry", (entry: Entry) => {
      try {
        const name = safeName(entry.fileName);
        const mode = (entry.externalFileAttributes >>> 16) & 0xffff;
        if ((mode & 0o170000) === 0o120000)
          throw new Error(`archive links are forbidden: ${name}`);
        if (entries.has(name) || metadata.some((item) => item.name === name))
          throw new Error(`duplicate archive entry: ${name}`);
        if (!name.endsWith("/")) {
          if (entry.uncompressedSize > limits.maxEntryBytes)
            throw new Error(`archive entry too large: ${name}`);
          total += entry.uncompressedSize;
          if (total > limits.maxTotalBytes)
            throw new Error("archive expansion limit exceeded");
          metadata.push({ name, entry });
          if (metadata.length > limits.maxEntries)
            throw new Error("archive entry limit exceeded");
        }
        zip.readEntry();
      } catch (error) {
        zip.close();
        reject(error);
      }
    });
    zip.on("end", async () => {
      try {
        for (const item of metadata)
          entries.set(item.name, await readEntry(zip, item.entry));
        zip.close();
        resolve(entries);
      } catch (error) {
        reject(error);
      }
    });
    zip.on("error", reject);
    zip.readEntry();
  });
}

async function walk(
  directory: string,
  base = directory,
): Promise<Array<{ absolute: string; name: string }>> {
  const { readdir } = await import("node:fs/promises");
  const result: Array<{ absolute: string; name: string }> = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, item.name);
    if (item.isSymbolicLink())
      throw new Error(`source links are forbidden: ${absolute}`);
    if (item.isDirectory()) result.push(...(await walk(absolute, base)));
    else if (item.isFile())
      result.push({
        absolute,
        name: path.relative(base, absolute).split(path.sep).join("/"),
      });
  }
  return result.sort((a, b) => a.name.localeCompare(b.name));
}

export async function writeArchiveFromDirectory(
  directory: string,
  output: string,
  options: { exclude?: (name: string) => boolean } = {},
): Promise<void> {
  if (!(await stat(directory)).isDirectory())
    throw new Error(`not a directory: ${directory}`);
  await mkdir(path.dirname(path.resolve(output)), { recursive: true });
  const zip = new yazl.ZipFile();
  for (const file of await walk(directory)) {
    if (options.exclude?.(file.name)) continue;
    zip.addFile(file.absolute, file.name, {
      mtime: new Date(0),
      mode: 0o100644,
    });
  }
  await new Promise<void>((resolve, reject) => {
    zip.outputStream
      .pipe(createWriteStream(output))
      .on("close", resolve)
      .on("error", reject);
    zip.end();
  });
}

export async function writeArchive(
  entries: Map<string, Buffer>,
  output: string,
): Promise<void> {
  await mkdir(path.dirname(path.resolve(output)), { recursive: true });
  const zip = new yazl.ZipFile();
  for (const [name, data] of [...entries].sort(([a], [b]) =>
    a.localeCompare(b),
  ))
    zip.addBuffer(data, safeName(name), { mtime: new Date(0), mode: 0o100644 });
  await new Promise<void>((resolve, reject) => {
    zip.outputStream
      .pipe(createWriteStream(output))
      .on("close", resolve)
      .on("error", reject);
    zip.end();
  });
}
