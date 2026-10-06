/* Browser shims some Solana libraries still expect (Buffer, process, global). Imported first by main.ts. */
import { Buffer } from 'buffer';

const g = globalThis as any;
if (!g.Buffer) g.Buffer = Buffer;
if (!g.global) g.global = globalThis;
if (!g.process) g.process = { env: { NODE_ENV: import.meta.env.MODE }, browser: true, version: '', versions: {}, nextTick: (fn: (...a: unknown[]) => void, ...args: unknown[]) => queueMicrotask(() => fn(...args)) };
