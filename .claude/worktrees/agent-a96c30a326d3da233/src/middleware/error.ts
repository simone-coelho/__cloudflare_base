import { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { ZodError } from 'zod';

export const errorHandler = (err: Error, c: Context) => {
  console.error('Error:', err);
  
  if (err instanceof HTTPException) {
    return c.json(
      {
        error: err.message,
        status: err.status,
        requestId: c.get('requestId'),
      },
      err.status
    );
  }
  
  if (err instanceof ZodError) {
    return c.json(
      {
        error: 'Validation error',
        details: err.issues,
        requestId: c.get('requestId'),
      },
      400
    );
  }
  
  return c.json(
    {
      error: 'Internal server error',
      message: err.message,
      requestId: c.get('requestId'),
    },
    500
  );
};