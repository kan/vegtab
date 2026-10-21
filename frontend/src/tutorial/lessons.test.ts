import { describe, it, expect } from 'vitest';
import {
  countObstacles, hasMatches, playGame, processAction,
  type Action, type GameState,
} from '@vegtab/engine';
import { dirBetween, type BoardInput } from '@/lib/boardInput';
import { LESSONS, FREE_LESSON_SEED, FREE_LESSON_OBSTACLES, type Lesson, type LessonTask } from './lessons';

/**
 * Plays a task the way a player following the hints would, through the engine as PuzzleBoard does:
 * a swap hint is a swap, a tap hint a tap, and a tap followed by a pick (a spoon) is the spoon
 * picking that cell
 */
function playTask(task: LessonTask, state: GameState): GameState {
  const [hint, pick] = task.hints(state);
  let inputs: BoardInput[];
  let action: Action;
  if (hint.type === 'swap') {
    const dir = dirBetween(hint.from, hint.to);
    inputs = [{ type: 'swap', pos: hint.from, dir }];
    action = { type: 'swap', pos: hint.from, dir };
  } else if (pick?.type === 'tap' && pick.whileSelecting) {
    inputs = [{ type: 'tap', pos: hint.at }, { type: 'select', pos: pick.at }];
    action = { type: 'scope', pos: hint.at, targetCells: [pick.at] };
  } else {
    inputs = [{ type: 'tap', pos: hint.at }];
    action = { type: 'tap', pos: hint.at };
  }
  for (const input of inputs) expect(task.accepts(input, state), JSON.stringify(input)).toBe(true);
  const next = processAction(state, action);
  expect(next.moveCount, `the move ${JSON.stringify(action)} changed nothing`).toBe(state.moveCount + 1);
  return next;
}

function playLesson(lesson: Lesson): GameState {
  let state = lesson.start();
  lesson.tasks.forEach((task, i) => {
    expect(state.isGameOver, `the game ended before task ${i + 1}`).toBe(false);
    state = playTask(task, state);
  });
  return state;
}

const byId = (id: string) => LESSONS.find(l => l.id === id)!;

describe('チュートリアルのレッスン', () => {
  const guided = LESSONS.filter(l => l.tasks.length > 0);
  const guidedCases = guided.map(l => [l.id, l] as const);

  it.each(guidedCases)('%s: 始めの盤に揃いがない', (_id, lesson) => {
    expect(hasMatches(lesson.start().board)).toBe(false);
  });

  it.each(guidedCases)('%s: 示したマスの手で最後まで進める', (_id, lesson) => {
    playLesson(lesson);
  });

  it('今の手以外の入力は受け付けない', () => {
    const match = byId('match');
    const task = match.tasks[0];
    const state = match.start();
    expect(task.accepts({ type: 'swap', pos: { row: 0, col: 0 }, dir: 'right' }, state)).toBe(false);
    expect(task.accepts({ type: 'tap', pos: { row: 4, col: 5 } }, state)).toBe(false);
    // The same swap dragged from the other cell is accepted
    expect(task.accepts({ type: 'swap', pos: { row: 3, col: 5 }, dir: 'down' }, state)).toBe(true);
  });

  it('obstacle: 隣の揃いで、耐久 1 のおじゃまは壊れ、耐久 2 のおじゃまは 1 になる', () => {
    const end = playLesson(byId('obstacle'));
    expect(end.board[2][4]?.obstacle).toBeUndefined();
    expect(end.board[2][3]?.obstacle?.durability).toBe(1);
  });

  it.each(['spoon', 'scissors', 'dishes', 'salad', 'combo'])('%s: 終わるとおじゃまが全部なくなる', id => {
    const start = byId(id).start();
    expect(countObstacles(start.board)).toBeGreaterThan(0);
    const end = playLesson(byId(id));
    expect(countObstacles(end.board)).toBe(0);
    expect(end.isCleared).toBe(true);
  });

  it('何度やっても同じ展開になる', () => {
    for (const lesson of guided) expect(playLesson(lesson)).toEqual(playLesson(lesson));
  });

  it('free: 盤をクリアできる', () => {
    const result = playGame(FREE_LESSON_SEED, { obstacleCount: FREE_LESSON_OBSTACLES });
    expect(result.isCleared).toBe(true);
    expect(byId('free').tasks).toEqual([]);
  });
});
