import { KitPage } from './KitPage';
import { MapScreen } from './map/MapScreen';
import { ThemeProvider } from './theme/ThemeProvider';

/** Simple path matching, no router dependency. `/` shows the kit for now; `/map` is the map. */
export function App({ path = window.location.pathname }: { path?: string }) {
  return (
    <ThemeProvider>
      {path === '/kit' || path === '/kit/' || path === '/' ? (
        <KitPage />
      ) : path === '/map' || path === '/map/' ? (
        <MapScreen />
      ) : (
        <NotFound />
      )}
    </ThemeProvider>
  );
}

function NotFound() {
  return <p>Not found.</p>;
}
