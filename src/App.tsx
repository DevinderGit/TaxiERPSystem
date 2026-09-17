import { BrowserRouter } from 'react-router-dom';
import { NavBar } from './components/NavBar';
import { AppRouter } from './components/AppRouter';

/**
 * Root component. Wraps the nav + routes in a single <BrowserRouter>
 * so both NavBar's <NavLink>s and the route elements share the same
 * router context. (Putting BrowserRouter inside AppRouter left the
 * NavBar siblings outside the router context and crashed NavLink.)
 *
 * QueryClientProvider is set in main.tsx and wraps <App />.
 * AuthProvider / RoleGuard (M2) will also wrap <App /> from main.tsx.
 */
function App() {
  return (
    <BrowserRouter>
      <NavBar />
      <AppRouter />
    </BrowserRouter>
  );
}

export default App;
