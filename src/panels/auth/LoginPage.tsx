import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';

/**
 * Login page. Email + password form with RHF + Zod validation.
 *
 * Manual Test Plan reference (TaskList TAXI-204 step 1–11):
 *  - Empty submit → inline errors
 *  - Invalid email format → blocked
 *  - Password < 8 chars → blocked
 *  - Wrong credentials → red "Invalid login credentials" banner
 *  - Correct credentials → spinner on button → redirect to / (or to the
 *    `from` page they originally tried to load).
 */

const schema = z.object({
  email: z.string().min(1, 'Email is required').email('Invalid email format'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

type LoginForm = z.infer<typeof schema>;

interface FromState {
  from?: { pathname?: string };
}

export function LoginPage() {
  const { signIn, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginForm>({
    resolver: zodResolver(schema),
    mode: 'onSubmit',
  });

  // If the user is already signed in, bounce them out of /login.
  if (user) {
    const fromPath = (location.state as FromState | null)?.from?.pathname || '/';
    return <Navigate to={fromPath} replace />;
  }

  const onSubmit = async (data: LoginForm) => {
    setServerError(null);
    const { error } = await signIn(data.email, data.password);
    if (error) {
      // Normalise the GoTrue message — anything sensitive is already
      // redacted by Supabase; we just show it verbatim.
      const msg =
        error.message?.toLowerCase().includes('invalid') ||
        error.message?.toLowerCase().includes('credentials')
          ? 'Invalid login credentials'
          : error.message || 'Sign-in failed. Try again.';
      setServerError(msg);
    } else {
      const fromPath = (location.state as FromState | null)?.from?.pathname || '/';
      navigate(fromPath, { replace: true });
    }
  };

  return (
    <main className="app-main app-main--auth">
      <div className="auth-card">
        <h1 className="page-title">
          <span className="page-title__accent">Sign in</span> to Taxi ERP
        </h1>
        <p className="page-subtitle">Enter your operator credentials.</p>

        <form onSubmit={handleSubmit(onSubmit)} className="auth-form" noValidate>
          <div className="form-field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              {...register('email')}
            />
            {errors.email && <span className="form-error">{errors.email.message}</span>}
          </div>

          <div className="form-field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              {...register('password')}
            />
            {errors.password && (
              <span className="form-error">{errors.password.message}</span>
            )}
          </div>

          {serverError && (
            <div className="form-error form-error--server" role="alert">
              {serverError}
            </div>
          )}

          <button
            type="submit"
            className="btn btn--primary"
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <>
                <span className="loading__spinner" aria-hidden="true" />
                Signing in…
              </>
            ) : (
              'Sign In'
            )}
          </button>
        </form>
      </div>
    </main>
  );
}
