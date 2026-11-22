import { useEffect, useMemo } from 'react';
import { GameScreen } from './GameScreen';
import { LoginScreen } from './LoginScreen';
import { createSession } from './session';
import { SessionContext, useSession } from './sessionContext';
import { createStore, GameContext, useGame } from './store';
import { Toasts } from './Toasts';

function Gate() {
  const status = useGame((s) => s.status);
  const session = useSession();
  if (status === 'loading') return null;
  return status === 'anon' ? (
    <LoginScreen onLogin={(c) => session.login(c)} onRegister={(c) => session.register(c)} />
  ) : (
    <GameScreen />
  );
}

/** Owns the store and the session; shows the sign-in screen or the game. */
export function GameApp() {
  const store = useMemo(() => createStore(), []);
  const session = useMemo(() => createSession(store), [store]);
  useEffect(() => {
    void session.start();
    return () => {
      session.stop();
    };
  }, [session]);
  return (
    <GameContext.Provider value={store}>
      <SessionContext.Provider value={session}>
        <Gate />
        <Toasts />
      </SessionContext.Provider>
    </GameContext.Provider>
  );
}
