import type { APIRoute } from 'astro';
import { changePassword } from '../../../lib/auth';
import { authFailure, clearSession, formData } from '../../../lib/auth-http';
export const POST: APIRoute = async (context) => {
  try {
    const form = await formData(context.request);
    await changePassword(
      context.locals.user!.id,
      form.get('currentPassword') || '',
      form.get('newPassword') || '',
    );
    clearSession(context);
    return context.redirect(
      '/login?message=Password%20changed.%20Sign%20in%20again.',
      303,
    );
  } catch (error) {
    return authFailure(context, error, '/account');
  }
};
