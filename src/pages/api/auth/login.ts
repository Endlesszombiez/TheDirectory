import type { APIRoute } from 'astro';
import { login } from '../../../lib/auth';
import { formData, setSession, authFailure } from '../../../lib/auth-http';
export const POST: APIRoute = async (context) => {
  try {
    const form = await formData(context.request);
    const token = await login(
      form.get('username') || '',
      form.get('password') || '',
    );
    setSession(context, token);
    return context.redirect('/', 303);
  } catch (error) {
    return authFailure(context, error, '/login');
  }
};
