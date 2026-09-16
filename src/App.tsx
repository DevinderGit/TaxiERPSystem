import { useEffect, useState } from 'react';
import reactLogo from './assets/react.svg';
import viteLogo from '/vite.svg';
import { supabase } from './services/supabaseClient';
import './App.css';

/**
 * Root component for TAXI-001.
 *
 * Per the Manual Test Plan step 4, this initial scaffold must render the
 * default Vite + React welcome page with both logos and no console errors.
 * Real panels, providers, and routing are added in TAXI-005 / TAXI-006.
 */
function App() {
  const [count, setCount] = useState(0);

  // TAXI-004 test — temporary. Will be removed after Manual Test Plan step 6 passes.
  useEffect(() => {
    supabase
      .from('hello')
      .select()
      .then(({ data, error }) => {
        // eslint-disable-next-line no-console
        console.log('[TAXI-004 test] hello rows:', data, 'error:', error);
      });
  }, []);

  return (
    <>
      <div>
        <a href="https://vite.dev" target="_blank" rel="noreferrer">
          <img src={viteLogo} className="logo" alt="Vite logo" />
        </a>
        <a href="https://react.dev" target="_blank" rel="noreferrer">
          <img src={reactLogo} className="logo react" alt="React logo" />
        </a>
      </div>
      <h1>Vite + React</h1>
      <div className="card">
        <button onClick={() => setCount((count) => count + 1)}>count is {count}</button>
        <p>
          Edit <code>src/App.tsx</code> and save to test HMR
        </p>
      </div>
      <p className="read-the-docs">Click on the Vite and React logos to learn more</p>
    </>
  );
}

export default App;
