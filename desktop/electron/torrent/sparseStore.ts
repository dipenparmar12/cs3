import fs from 'fs';
import path from 'path';
import type { ChunkStoreCtor } from 'webtorrent';

/**
 * WebTorrent's own file store (`fs-chunk-store`), with every file opened
 * **sparse**.
 *
 * The default store opens files plainly, and on NTFS a plain file written at an
 * offset is zero-filled up to that offset. A stream writes far from the start
 * almost at once (the tail window for an MP4's `moov`, any forward seek), so the
 * whole file was allocated within seconds of Play. Measured 2026-10-30 with
 * fs-chunk-store 5.0.1 on NTFS: first piece then last piece of a 2 GB file,
 * 2,048 MB consumed and 1.3 s spent zero-filling; opened sparse, 8 MB and 5 ms.
 * An 18 GB film on a disk with 16 GB free failed its first tail write outright.
 *
 * `random-access-file` already knows how (`sparse: true`, through
 * `fs-native-extensions`); `fs-chunk-store` just never asks. Everything else is
 * the stock store. ext4 and APFS make holes on their own, so this only changes
 * anything on Windows.
 */
let storeLoad: Promise<ChunkStoreCtor> | null = null;

export function loadSparseFileStore(): Promise<ChunkStoreCtor> {
  storeLoad ??= Promise.all([import('fs-chunk-store'), import('random-access-file')]).then(
    ([{ default: FileStore }, { default: RandomAccessFile }]) =>
      class SparseFileStore extends FileStore {
        constructor(chunkLength: number, opts: Record<string, unknown>) {
          super(chunkLength, opts);
          for (const file of this.files) {
            // Same contract as the store's own `thunky` opener: one handle per
            // file, and a failed open is retried by the next caller.
            let opening: Promise<unknown> | null = null;
            file.open = (cb) => {
              opening ??= new Promise((resolve, reject) => {
                if (this.closed) return reject(new Error('Storage is closed'));
                fs.mkdir(path.dirname(file.path), { recursive: true }, (err) => {
                  if (err) return reject(err);
                  if (this.closed) return reject(new Error('Storage is closed'));
                  resolve(new RandomAccessFile(file.path, { sparse: true }));
                });
              });
              opening.then(
                (handle) => cb(null, handle),
                (err: Error) => {
                  opening = null;
                  cb(err);
                }
              );
            };
          }
        }
      }
  );
  return storeLoad;
}
