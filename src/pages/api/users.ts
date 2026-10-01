import type { APIRoute } from 'astro';
import { createUser, listUsers, manageUser } from '../../lib/auth';
import { authFailure, formData } from '../../lib/auth-http';
export const GET: APIRoute = async ({ locals }) =>
  locals.user?.role === 'admin'
    ? Response.json(await listUsers())
    : Response.json(
        { error: 'Administrator access required' },
        { status: 403 },
      );
export const POST: APIRoute = async (context) => {
  if (context.locals.user?.role !== 'admin')
    return Response.json(
      { error: 'Administrator access required' },
      { status: 403 },
    );
  try {
    const form = await formData(context.request);
    const action = form.get('action');
    if (action === 'create')
      await createUser(
        context.locals.user!.id,
        form.get('username') || '',
        form.get('password') || '',
        form.get('role') || '',
      );
    else
      await manageUser(
        context.locals.user!.id,
        form.get('userId') || '',
        action || '',
        form.get('value') || '',
      );
    return context.redirect('/users?message=Account%20updated.', 303);
  } catch (error) {
    return authFailure(context, error, '/users');
  }
};
