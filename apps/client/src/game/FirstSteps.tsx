import { Button, Panel, Tag } from '../ui';
import styles from './FirstSteps.module.css';

export interface FirstStep {
  readonly id: string;
  readonly label: string;
  readonly hint: string;
  readonly done: boolean;
}

export interface FirstStepsProps {
  readonly steps: readonly FirstStep[];
  readonly onDismiss: () => void;
}

/** A dismissible three-step "what to do first" list for new players. */
export function FirstSteps({ steps, onDismiss }: FirstStepsProps) {
  const done = steps.filter((s) => s.done).length;
  return (
    <Panel title="WHAT TO DO FIRST" tag={`${String(done)} / ${String(steps.length)}`}>
      <ol className={styles['list']}>
        {steps.map((s) => (
          <li key={s.id} className={styles['step']} data-done={s.done}>
            <Tag faction={s.done ? 'self' : 'neutral'}>{s.done ? 'DONE' : 'TODO'}</Tag>
            <span className={styles['text']}>
              <strong>{s.label}</strong>
              <small>{s.hint}</small>
            </span>
          </li>
        ))}
      </ol>
      <Button variant="ghost" onClick={onDismiss}>
        HIDE THIS
      </Button>
    </Panel>
  );
}
