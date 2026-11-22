import { KitPage } from './KitPage';
import { ThemeProvider } from './theme/ThemeProvider';

/** Simple path matching, no router dependency. `/` shows the kit for now. */
export function App({ path = window.location.pathname }: { path?: string }) {
  return (
    <ThemeProvider>
      {path === '/kit' || path === '/kit/' || path === '/' ? <KitPage /> : <NotFound />}
    </ThemeProvider>
  );
}

function NotFound() {
  return <p>Not found.</p>;
}
