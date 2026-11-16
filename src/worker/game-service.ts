import { WorkerEntrypoint } from 'cloudflare:workers';
import type { GameService as GameServiceContract } from './lib/id-rpc';
import type { Bindings } from './types';
import { deleteAccount } from './lib/account';

/**
 * What vegtab provides to the kan-game.app ID platform, which binds it as GAME_VEGTAB
 * (kan/game docs/ID_DESIGN.md「ゲームとの RPC」). A named entrypoint, so the binding reaches this
 * method only and not the HTTP API.
 */
export class GameService extends WorkerEntrypoint<Bindings> implements GameServiceContract {
  /** Withdrawal: records the ID as deleted and deletes its records */
  async deleteAccount(id: string): Promise<void> {
    if (typeof id !== 'string' || id === '') throw new Error('invalid id');
    await deleteAccount(this.env, id);
  }
}
