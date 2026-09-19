import './weekly-challenge-hud.css';
export interface WeeklyHudState {
  visible: boolean;
  source: 'account' | 'practice';
  stage: number;
  completedStages: number;
  completedStageOwnTurns: number;
  status: 'playing' | 'awaiting-card' | 'finished';
  saveState: 'none' | 'pending' | 'error';
}
export interface WeeklyHudCopy {
  title: string; account: string; practice: string;
  playing: string; choosing: string; finished: string;
  allCleared: string; score: string; pending: string; error: string;
}
export interface WeeklyHudRuntime {
  element: HTMLElement;
  update(state: WeeklyHudState, copy: WeeklyHudCopy): void;
  destroy(): void;
}
export function formatWeeklyHud(state: WeeklyHudState, copy: WeeklyHudCopy): string[] {
  const fill = (text: string) => text.replace(/\{(stage|completed|turns)\}/g,
    (_match, key: string) => String(key === 'stage' ? state.stage
      : key === 'completed' ? state.completedStages : state.completedStageOwnTurns));
  const phase = state.completedStages === 10 ? copy.allCleared
    : state.status === 'awaiting-card' ? fill(copy.choosing)
    : state.status === 'finished' ? fill(copy.finished) : fill(copy.playing);
  const first = `${copy.title} · ${state.source === 'account' ? copy.account : copy.practice} · ${phase}`;
  const status = state.saveState === 'error' ? copy.error
    : state.saveState === 'pending' ? copy.pending : '';
  return [first, fill(copy.score), status];
}

export function createWeeklyChallengeHud(parent: HTMLElement): WeeklyHudRuntime {
  const element = document.createElement('section');
  element.className = 'weekly-challenge-hud'; element.hidden = true;
  const title = document.createElement('strong');
  const score = document.createElement('span');
  const status = document.createElement('small');
  status.setAttribute('role', 'status'); status.hidden = true;
  element.append(title, score, status); parent.append(element);
  const nodes = [title, score, status];
  return {
    element,
    update(state, copy) {
      if (element.hidden !== !state.visible) element.hidden = !state.visible;
      if (!state.visible) return;
      const texts = formatWeeklyHud(state, copy);
      nodes.forEach((node, index) => {
        if (node.textContent !== texts[index]) node.textContent = texts[index];
      });
      if (status.hidden !== (texts[2] === '')) status.hidden = texts[2] === '';
    },
    destroy() { element.remove(); },
  };
}
