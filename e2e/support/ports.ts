import { createServer, type Server } from 'node:net';

/** The suite's servers listen on 127.0.0.1 within this range, on ports found free at run time. */
export const PORT_RANGE = { first: 40000, last: 49999 } as const;

function candidate(): number {
  return PORT_RANGE.first + Math.floor(Math.random() * (PORT_RANGE.last - PORT_RANGE.first + 1));
}

function isAddressInUse(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'EADDRINUSE';
}

/** Listens on a free port of the range, trying another one while a port is taken. */
export async function listenInRange(server: Server): Promise<number> {
  for (let attempt = 0; attempt < 50; attempt++) {
    const port = candidate();
    try {
      await new Promise<void>((done, fail) => {
        server.once('error', fail);
        server.listen(port, '127.0.0.1', () => {
          server.off('error', fail);
          done();
        });
      });
      return port;
    } catch (error) {
      if (!isAddressInUse(error)) throw error;
    }
  }
  throw new Error(`No free port in ${PORT_RANGE.first}-${PORT_RANGE.last}`);
}

/** A port of the range that was free a moment ago, for a child process that binds it itself. */
export async function freePort(): Promise<number> {
  const probe = createServer();
  const port = await listenInRange(probe);
  await new Promise((done) => probe.close(done));
  return port;
}
