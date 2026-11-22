import { Button, Panel, Tag } from '../ui';
import styles from './Dossier.module.css';
import type { Dossier as Data } from './rivalDossier';
import { ago, formatUnits } from './feed';

export interface DossierProps {
  readonly dossier: Data;
  readonly nowMs: number;
  readonly onFly: (districtId: string) => void;
  readonly onClose: () => void;
}

/** What you know about one rival: standing, the plots you have seen, and what has passed between you. */
export function Dossier({ dossier: d, nowMs, onFly, onClose }: DossierProps) {
  return (
    <Panel
      title={`Rival: ${d.name}`}
      tag={d.rank === null ? 'UNRANKED' : `#${String(d.rank)}`}
      className={styles['card']}
    >
      <div className={styles['stack']}>
        <p className={styles['stance']} data-stance={d.stance}>
          {d.stanceText}
        </p>
        <p className={styles['cap']}>
          {d.score === null ? 'Score unknown.' : `${formatUnits(d.score)} points.`} You know of{' '}
          {d.districts.length} of their districts.
        </p>
        <section>
          <h3>DISTRICTS</h3>
          {d.districts.length === 0 ? (
            <p className={styles['cap']}>None in sight. Scout to find them.</p>
          ) : (
            <ul className={styles['list']}>
              {d.districts.map((x) => (
                <li key={x.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onFly(x.id);
                    }}
                  >
                    <span>{x.name}</span>
                    <small>{x.kind}</small>
                    <Tag faction="rival">
                      {x.besieged ? 'UNDER SIEGE' : x.protected ? 'PROTECTED' : x.how.toUpperCase()}
                    </Tag>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section>
          <h3>HISTORY WITH YOU</h3>
          {d.interactions.length === 0 ? (
            <p className={styles['cap']}>Nothing yet.</p>
          ) : (
            <ul className={styles['list']}>
              {d.interactions.map((i) => (
                <li key={i.seq}>
                  <span className={styles['when']}>{ago(nowMs, i.at)}</span> {i.text}
                </li>
              ))}
            </ul>
          )}
        </section>
        <Button variant="ghost" onClick={onClose}>
          CLOSE
        </Button>
      </div>
    </Panel>
  );
}
