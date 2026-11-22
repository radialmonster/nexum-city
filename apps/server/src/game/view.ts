import type { GameState, Id } from '@nexum/sim';
import type { PlayerView } from '@nexum/contracts';

/**
 * What a player may see of the world.
 *
 * TODO: switch to `viewFor` from `@nexum/sim` once the sim-core branch lands it (it will apply
 * fog and scout reveals). Until then this minimal adapter returns only the player's own
 * districts, crews, carriers and movements, plus the hubs (always public).
 */
export function viewForPlayer(state: GameState, playerId: Id): PlayerView | undefined {
  const player = state.players[playerId];
  if (!player) return undefined;
  const own = <T extends { owner: Id }>(rec: Record<Id, T>): Record<Id, T> =>
    Object.fromEntries(Object.entries(rec).filter(([, v]) => v.owner === playerId));
  return {
    nowMs: state.nowMs,
    world: state.world,
    player,
    districts: Object.fromEntries(
      Object.entries(state.districts).filter(([, d]) => d.owner === playerId || d.kind === 'hub'),
    ),
    crews: own(state.crews),
    carriers: own(state.carriers),
    movements: own(state.movements),
  };
}
