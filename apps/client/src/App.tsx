import { GameApp } from './game/GameApp';
import { KitPage } from './KitPage';
import { MapScreen } from './map/MapScreen';
import { ThemeProvider } from './theme/ThemeProvider';

/** Simple path matching, no router dependency. `/` is the game, `/map` is the demo map, `/kit` is the UI kit. */
export function App({ path = window.location.pathname }: { path?: string }) {
  return (
    <ThemeProvider>
      {path === '/kit' || path === '/kit/' ? (
        <KitPage />
      ) : path === '/map' || path === '/map/' ? (
        <MapScreen />
      ) : path === '/' ? (
        <GameApp />
      ) : (
        <NotFound />
      )}
    </ThemeProvider>
  );
}

function NotFound() {
  return <p>Not found.</p>;
}
