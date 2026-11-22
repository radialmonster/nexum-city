import { useState, type FormEvent } from 'react';
import { Button, Panel, Tabs } from '../ui';
import type { Credentials } from './api';
import styles from './LoginScreen.module.css';

export interface LoginScreenProps {
  readonly onLogin: (c: Credentials) => Promise<boolean>;
  readonly onRegister: (c: Credentials) => Promise<boolean>;
}

/** Sign in or create an account. Errors arrive as toasts from the session. */
export function LoginScreen({ onLogin, onRegister }: LoginScreenProps) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await (mode === 'login' ? onLogin : onRegister)({ username: username.trim(), password });
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className={styles['screen']}>
      <div className={styles['logo']}>
        NEXUM<span>//</span>CITY
      </div>
      <Panel title={mode === 'login' ? 'Sign in' : 'New account'} className={styles['card']}>
        <form
          className={styles['form']}
          onSubmit={(e) => {
            void submit(e);
          }}
        >
          <Tabs
            label="Sign in or register"
            value={mode}
            onChange={(id) => {
              setMode(id === 'register' ? 'register' : 'login');
            }}
            tabs={[
              { id: 'login', label: 'SIGN IN' },
              { id: 'register', label: 'REGISTER' },
            ]}
          />
          <label className={styles['field']}>
            <span>USERNAME</span>
            <input
              value={username}
              autoComplete="username"
              required
              minLength={3}
              maxLength={32}
              onChange={(e) => {
                setUsername(e.target.value);
              }}
            />
          </label>
          <label className={styles['field']}>
            <span>PASSWORD</span>
            <input
              type="password"
              value={password}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              required
              minLength={8}
              onChange={(e) => {
                setPassword(e.target.value);
              }}
            />
          </label>
          <Button type="submit" variant="primary" disabled={busy}>
            {mode === 'login' ? 'SIGN IN' : 'CREATE ACCOUNT'}
          </Button>
        </form>
      </Panel>
    </main>
  );
}
