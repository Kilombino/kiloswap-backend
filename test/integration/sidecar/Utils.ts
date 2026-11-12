import toml from '@iarna/toml';
import fs from 'fs';
import path from 'path';
import Logger from '../../../lib/Logger';
import Database from '../../../lib/db/Database';
import KeyRepository from '../../../lib/db/repositories/KeyRepository';
import Sidecar from '../../../lib/sidecar/Sidecar';

// The sidecar's configuration; with BOLTZ_TEST_DB_PORT (a host whose own
// Postgres holds 5432) a copy with that port
const sidecarConfigPath = (): string => {
  const original = path.join(__dirname, 'config.toml');
  const port = process.env.BOLTZ_TEST_DB_PORT;
  if (port === undefined) {
    return original;
  }
  // Beside the original: the sidecar reads some paths relative to it
  const copy = path.join(__dirname, `config.port-${Number(port)}.toml`);
  fs.writeFileSync(
    copy,
    fs
      .readFileSync(original, 'utf-8')
      .replace(/^port = 5432$/m, `port = ${Number(port)}`),
  );
  return copy;
};

export const startSidecar = async () => {
  const configPath = sidecarConfigPath();
  const config = toml.parse(
    fs.readFileSync(configPath, {
      encoding: 'utf-8',
    }),
  );
  const db = new Database(
    Logger.disabledLogger,
    undefined,
    config.postgres as never,
  );
  await db.init();
  if ((await KeyRepository.getKeyProvider('BTC')) === null) {
    await KeyRepository.addKeyProvider({
      symbol: 'BTC',
      derivationPath: 'm/0/0',
      highestUsedIndex: 0,
    });
  }

  await db.close();

  Sidecar.start(Logger.disabledLogger, {
    loglevel: 'error',
    sidecar: {
      path: './target/debug/boltzr',
      config: configPath,
    },
  } as any);
};

export const sidecar = new Sidecar(
  Logger.disabledLogger,
  {
    grpc: {
      host: '127.0.0.1',
      port: 10_001,
      certificates: path.join(__dirname, 'sidecar', 'certificates'),
    },
  },
  '',
);
