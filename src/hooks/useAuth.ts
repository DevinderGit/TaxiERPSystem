/**
 * Re-export of the useAuth hook so callers can import from the canonical
 * `src/hooks/` path (as referenced in the Code Architecture spec §4.1)
 * rather than reaching into the AuthProvider module. Keeps the public
 * surface stable while allowing internal refactors of AuthProvider.tsx.
 */
export { useAuth } from '../services/AuthProvider';
export type { UserRole, AuthContextValue } from '../services/AuthProvider';
