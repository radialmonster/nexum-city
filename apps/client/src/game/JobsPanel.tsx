import type { PlayerView } from '@nexum/contracts';
import { Button, Tag } from '../ui';
import {
  JOB_NAMES,
  jobDuration,
  jobPay,
  jobRisk,
  jobSentence,
  nextJobText,
  type JobOffer,
} from './streetJobs';
import styles from './JobsPanel.module.css';

export interface JobsPanelProps {
  readonly view: PlayerView;
  readonly nowMs: number;
  /** Opens the order card for one job. */
  readonly onTake: (job: JobOffer) => void;
}

/** Your street jobs: quick errands for one crew, a few minutes each. Shown while any are on offer. */
export function JobsPanel({ view, nowMs, onTake }: JobsPanelProps) {
  const jobs = view.self.jobs;
  const next = nextJobText(view, nowMs);
  if (jobs.length === 0 && next === null) return null;
  return (
    <div className={styles['block']} data-testid="street-jobs">
      <span className={styles['cap']}>STREET JOBS</span>
      {jobs.length === 0 && <small className={styles['hint']}>No jobs right now.</small>}
      <ul className={styles['list']}>
        {jobs.map((j) => (
          <li key={j.id} className={styles['item']} data-kind={j.kind}>
            <span className={styles['head']}>
              <Tag faction="merchant">{JOB_NAMES[j.kind].toUpperCase()}</Tag>
              <b className={styles['pay']}>{jobPay(j)}</b>
            </span>
            <span className={styles['line']}>{jobSentence(j)}</span>
            <small className={styles['hint']}>
              {jobDuration(j)}. {jobRisk(j)}
            </small>
            <div className={styles['actions']}>
              <Button
                variant="primary"
                onClick={() => {
                  onTake(j);
                }}
              >
                TAKE
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {next !== null && (
        <small className={styles['hint']} data-testid="next-job">
          {next}
        </small>
      )}
    </div>
  );
}
