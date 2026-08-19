import { readFile, realpath, stat } from "node:fs/promises";

export type WorkerSecret = Readonly<{ path: string; rnc: string; password: string }>;

export type NativeDependencies = Readonly<{
  cwd: () => string;
  env: NodeJS.ProcessEnv;
  execArgv: readonly string[];
  nodeVersion: string;
  clock: () => number;
  fs: Readonly<{
    realpath: (path: string) => Promise<string>;
    stat: (path: string) => Promise<{ size: number; isFile: () => boolean }>;
    readFile: (path: string) => Promise<Buffer | Uint8Array>;
  }>;
  fetch: (request: Request) => Promise<Response>;
}>;

export function createNativeSmokeInput(dependencies: NativeDependencies) {
  return (secret: WorkerSecret) => Object.freeze({
    secret: Object.freeze({ certificatePath: secret.path, password: secret.password, rnc: secret.rnc }),
    fs: dependencies.fs,
    repositoryRoot: dependencies.cwd(),
    nodeVersion: dependencies.nodeVersion,
    env: Object.freeze({ ...dependencies.env }),
    execArgv: Object.freeze([...dependencies.execArgv]),
    clock: dependencies.clock,
    executor: dependencies.fetch,
  });
}

export const nativeSmokeInput = createNativeSmokeInput({
  cwd: () => process.cwd(),
  env: process.env,
  execArgv: process.execArgv,
  nodeVersion: process.versions.node,
  clock: Date.now,
  fs: { realpath, stat, readFile },
  fetch,
});
